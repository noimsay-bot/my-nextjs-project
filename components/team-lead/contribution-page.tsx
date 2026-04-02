"use client";

import { useCallback, useEffect, useState } from "react";
import { getUsers } from "@/lib/auth/storage";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  ContributionManualItem,
  ContributionPersonCard,
  getContributionCards,
  getContributionPeriod,
  TEAM_LEAD_CONTRIBUTION_EVENT,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
  refreshTeamLeadState,
  updateContributionManualItems,
} from "@/lib/team-lead/storage";

interface ManualDraftItem {
  id: string;
  label: string;
  scoreText: string;
}

interface ManualEditorState {
  [name: string]: ManualDraftItem[];
}

function formatScore(score: number) {
  return score.toFixed(1);
}

function createManualItem(): ManualDraftItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: "",
    scoreText: "",
  };
}

function normalizeScoreInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 10) / 10;
}

function toManualDraftItem(item: ContributionManualItem): ManualDraftItem {
  return {
    id: item.id,
    label: item.label,
    scoreText: item.score.toFixed(1),
  };
}

function isValidScoreText(value: string) {
  return /^\d*(\.\d?)?$/.test(value);
}

function createEmptyCard(name: string): ContributionPersonCard {
  return {
    name,
    totalScore: 0,
    autoScore: 0,
    manualScore: 0,
    clockInScore: 0,
    clockOutScore: 0,
    coverageScore: 0,
    itemCount: 0,
    items: [],
    manualItems: [],
  };
}

function getHiddenContributionCardNames() {
  return new Set(
    getUsers()
      .filter((user) => user.role === "team_lead" || user.role === "desk")
      .map((user) => user.username.trim())
      .filter(Boolean),
  );
}

export function ContributionPage() {
  const [cards, setCards] = useState<ContributionPersonCard[]>([]);
  const [expandedNames, setExpandedNames] = useState<string[]>([]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [manualDrafts, setManualDrafts] = useState<ManualEditorState>({});
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [period, setPeriod] = useState(() => getContributionPeriod());

  const syncFromCache = useCallback(() => {
    const users = getUsers();
    const hiddenNames = getHiddenContributionCardNames();
    const contributionCards = getContributionCards();
    const cardMap = new Map(contributionCards.map((card) => [card.name, card] as const));

    const merged = users
      .map((user) => user.username.trim())
      .filter(Boolean)
      .filter((name) => !hiddenNames.has(name))
      .sort((left, right) => left.localeCompare(right, "ko"))
      .map((name) => cardMap.get(name) ?? createEmptyCard(name));

    const extraCards = contributionCards.filter(
      (card) =>
        !hiddenNames.has(card.name.trim()) &&
        !merged.some((mergedCard) => mergedCard.name === card.name),
    );

    setCards(
      [...merged, ...extraCards].sort(
        (left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"),
      ),
    );
    setPeriod(getContributionPeriod());
  }, []);

  useEffect(() => {
    const refresh = async () => {
      await Promise.all([refreshScheduleState(), refreshPublishedSchedules(), refreshTeamLeadState()]);
      syncFromCache();
    };

    void refresh();
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, syncFromCache);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    window.addEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, syncFromCache);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
      window.removeEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    };
  }, [syncFromCache]);

  const toggleExpanded = (name: string) => {
    setExpandedNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const startEdit = (card: ContributionPersonCard) => {
    setEditingName(card.name);
    setExpandedNames((current) => (current.includes(card.name) ? current : [...current, card.name]));
    setManualDrafts((current) => ({
      ...current,
      [card.name]:
        editingName === card.name
          ? [...(current[card.name] ?? []), createManualItem()]
          : [...card.manualItems.map((item) => toManualDraftItem(item)), createManualItem()],
    }));
  };

  const cancelEdit = () => {
    if (!editingName) return;
    setManualDrafts((current) => {
      const next = { ...current };
      delete next[editingName];
      return next;
    });
    setEditingName(null);
  };

  const saveEdit = () => {
    if (!editingName) return;

    const items = (manualDrafts[editingName] ?? [])
      .map((item) => ({
        id: item.id,
        label: item.label.trim(),
        score: normalizeScoreInput(item.scoreText),
      }))
      .filter((item) => item.label);

    updateContributionManualItems(editingName, items);
    setMessage({ tone: "ok", text: "기여도 수동 점수를 저장했습니다." });
    setEditingName(null);
    setManualDrafts((current) => {
      const next = { ...current };
      delete next[editingName];
      return next;
    });
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">기여도</div>
          <strong style={{ fontSize: 24 }}>기여도 점수</strong>
          <div className="status note">
            기준 기간은 {period.startLabel}부터 {period.endLabel}까지입니다. 자동 점수는 일정배정의
            출근/퇴근 시간과 가점을 합산해 반영합니다.
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <section
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        {cards.map((card) => {
          const isExpanded = expandedNames.includes(card.name);
          const isEditing = editingName === card.name;
          const draftItems = manualDrafts[card.name] ?? [];

          return (
            <article key={card.name} className="panel">
              <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => toggleExpanded(card.name)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <strong style={{ fontSize: 21, color: "#ffffff" }}>{card.name}</strong>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 86,
                      padding: "7px 14px",
                      borderRadius: 999,
                      border: "1px solid rgba(56,189,248,.28)",
                      background: "rgba(34,211,238,.14)",
                      color: "#d8fbff",
                      fontSize: 17,
                      fontWeight: 900,
                    }}
                  >
                    {formatScore(card.totalScore)}점
                  </span>
                </button>

                {isExpanded ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className="muted">자동합계 {formatScore(card.autoScore)}</span>
                        <span className="muted">추가합계 {formatScore(card.manualScore)}</span>
                        <span className="muted">출근 {formatScore(card.clockInScore)}</span>
                        <span className="muted">퇴근 {formatScore(card.clockOutScore)}</span>
                        <span className="muted">가점 {formatScore(card.coverageScore)}</span>
                        <span className="muted">자동반영 {card.itemCount}건</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {isEditing ? (
                          <>
                            <button type="button" className="btn primary" onClick={saveEdit}>
                              저장
                            </button>
                            <button type="button" className="btn" onClick={cancelEdit}>
                              취소
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn" onClick={() => startEdit(card)}>
                            항목추가
                          </button>
                        )}
                      </div>
                    </div>

                    <section style={{ display: "grid", gap: 8 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <strong style={{ fontSize: 15 }}>추가 항목</strong>
                        {isEditing ? (
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() =>
                              setManualDrafts((current) => ({
                                ...current,
                                [card.name]: [...(current[card.name] ?? []), createManualItem()],
                              }))
                            }
                          >
                            항목추가
                          </button>
                        ) : null}
                      </div>

                      {(isEditing ? draftItems.length > 0 : card.manualItems.length > 0) ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {isEditing
                            ? draftItems.map((item) => (
                              <div
                                key={item.id}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "minmax(0, 1fr) 92px auto",
                                  gap: 8,
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  className="field-input"
                                  value={item.label}
                                  placeholder="항목명"
                                  onChange={(event) =>
                                    setManualDrafts((current) => ({
                                      ...current,
                                      [card.name]: (current[card.name] ?? []).map((currentItem) =>
                                        currentItem.id === item.id
                                          ? { ...currentItem, label: event.target.value }
                                          : currentItem,
                                      ),
                                    }))
                                  }
                                />
                                <input
                                  className="field-input"
                                  inputMode="decimal"
                                  value={item.scoreText}
                                  placeholder="점수"
                                  onChange={(event) =>
                                    isValidScoreText(event.target.value)
                                      ? setManualDrafts((current) => ({
                                          ...current,
                                          [card.name]: (current[card.name] ?? []).map((currentItem) =>
                                            currentItem.id === item.id
                                              ? {
                                                  ...currentItem,
                                                  scoreText: event.target.value,
                                                }
                                              : currentItem,
                                          ),
                                        }))
                                      : null
                                  }
                                />
                                <button
                                  type="button"
                                  className="btn"
                                  style={{ padding: "4px 8px", fontSize: 12 }}
                                  onClick={() =>
                                    setManualDrafts((current) => ({
                                      ...current,
                                      [card.name]: (current[card.name] ?? []).filter(
                                        (currentItem) => currentItem.id !== item.id,
                                      ),
                                    }))
                                  }
                                >
                                  삭제
                                </button>
                              </div>
                            ))
                            : card.manualItems.map((item) => (
                              <div
                                key={item.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  alignItems: "center",
                                  padding: "10px 12px",
                                  borderRadius: 14,
                                  border: "1px solid rgba(148,163,184,.18)",
                                  background: "rgba(15,23,42,.16)",
                                }}
                              >
                                <span>{item.label}</span>
                                <strong>{formatScore(item.score)}점</strong>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div
                          style={{
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: "1px dashed rgba(148,163,184,.24)",
                            background: "rgba(15,23,42,.12)",
                          }}
                        >
                          <span className="muted">
                            {isEditing
                              ? "항목 추가 버튼으로 점수를 입력하세요."
                              : "추가된 항목이 없습니다."}
                          </span>
                        </div>
                      )}
                    </section>

                    <section style={{ display: "grid", gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>자동 반영 내역</strong>
                      {card.items.length > 0 ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {card.items.map((item, index) => (
                            <div
                              key={`${card.name}-${item.dateKey}-${item.duty}-${index}`}
                              style={{
                                display: "grid",
                                gap: 6,
                                padding: "10px 12px",
                                borderRadius: 14,
                                border: "1px solid rgba(148,163,184,.18)",
                                background: "rgba(15,23,42,.16)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                <strong>{item.dateKey}</strong>
                                <span className="muted">{item.duty}</span>
                              </div>
                              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                                <span className="muted">출근 {item.clockIn || "-"}</span>
                                <span className="muted">퇴근 {item.clockOut || "-"}</span>
                                <span className="muted">가점 {formatScore(item.coverageScore)}</span>
                              </div>
                              {item.coverageNote ? (
                                <div className="muted">가점 사유: {item.coverageNote}</div>
                              ) : null}
                              <div style={{ display: "grid", gap: 4 }}>
                                {item.schedules.length > 0 ? (
                                  item.schedules.map((schedule, scheduleIndex) => (
                                    <div
                                      key={`${item.dateKey}-${item.duty}-schedule-${scheduleIndex}`}
                                      className="muted"
                                    >
                                      {schedule}
                                    </div>
                                  ))
                                ) : (
                                  <div className="muted">일정 내용 없음</div>
                                )}
                              </div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <span className="muted">출근점수 {formatScore(item.clockInScore)}</span>
                                <span className="muted">퇴근점수 {formatScore(item.clockOutScore)}</span>
                                <strong style={{ color: "#f8fbff" }}>
                                  합계 {formatScore(item.totalScore)}점
                                </strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          style={{
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: "1px dashed rgba(148,163,184,.24)",
                            background: "rgba(15,23,42,.12)",
                          }}
                        >
                          <span className="muted">기준 기간 내 자동 반영된 점수가 없습니다.</span>
                        </div>
                      )}
                    </section>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}
