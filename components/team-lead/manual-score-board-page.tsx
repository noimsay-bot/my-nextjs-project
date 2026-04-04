"use client";

import { useCallback, useEffect, useState } from "react";
import { escapeTeamLeadPrintHtml, printTeamLeadDocument } from "@/lib/team-lead/print";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  getBroadcastAccidentCards,
  getLiveSafetyCards,
  refreshScoreboardState,
  TEAM_LEAD_SCORE_BASE,
  TEAM_LEAD_SCOREBOARD_EVENT,
  TeamLeadManualScoreCard,
  TeamLeadManualScoreCategory,
  TeamLeadScoreItem,
  updateTeamLeadManualScoreItems,
} from "@/lib/team-lead/scoreboard";
import {
  TEAM_LEAD_CONTRIBUTION_EVENT,
  TEAM_LEAD_FINAL_CUT_EVENT,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
  refreshTeamLeadState,
} from "@/lib/team-lead/storage";

interface DraftItem {
  id: string;
  label: string;
  scoreText: string;
}

interface DraftState {
  [name: string]: DraftItem[];
}

function createDraftItem(): DraftItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: "",
    scoreText: "",
  };
}

function toDraftItem(item: TeamLeadScoreItem): DraftItem {
  return {
    id: item.id,
    label: item.label,
    scoreText: item.score.toFixed(1),
  };
}

function formatScore(score: number) {
  return score.toFixed(1);
}

function isValidScoreText(value: string) {
  return /^-?\d*(\.\d?)?$/.test(value);
}

function normalizeScore(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 10) / 10;
}

function getCards(category: TeamLeadManualScoreCategory) {
  return category === "broadcastAccident" ? getBroadcastAccidentCards() : getLiveSafetyCards();
}

function buildManualScorePrintBody(cards: TeamLeadManualScoreCard[]) {
  const rows = [...cards]
    .sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"))
    .map(
      (card, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeTeamLeadPrintHtml(card.name)}</strong></td>
          <td>${formatScore(card.baseScore)}점</td>
          <td>${formatScore(card.manualScore)}점</td>
          <td>${formatScore(card.totalScore)}점</td>
          <td>${card.items.length}건</td>
        </tr>`,
    )
    .join("");

  return `
    <table class="team-lead-print-table">
      <thead>
        <tr>
          <th>순위</th>
          <th>이름</th>
          <th>기본점수</th>
          <th>가감점수</th>
          <th>총점</th>
          <th>항목수</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function ManualScoreBoardPage({
  title,
  description,
  category,
}: {
  title: string;
  description: string;
  category: TeamLeadManualScoreCategory;
}) {
  const [cards, setCards] = useState<TeamLeadManualScoreCard[]>([]);
  const [expandedNames, setExpandedNames] = useState<string[]>([]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftState>({});
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const syncFromCache = useCallback(() => {
    setCards(getCards(category));
  }, [category]);

  useEffect(() => {
    const refresh = async () => {
      await Promise.all([refreshScheduleState(), refreshPublishedSchedules(), refreshTeamLeadState(), refreshScoreboardState()]);
      syncFromCache();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };

    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    window.addEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_FINAL_CUT_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_SCOREBOARD_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
      window.removeEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_FINAL_CUT_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_SCOREBOARD_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    };
  }, [category, syncFromCache]);

  const toggleExpanded = (name: string) => {
    setExpandedNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const startEdit = (card: TeamLeadManualScoreCard) => {
    setEditingName(card.name);
    setExpandedNames((current) => (current.includes(card.name) ? current : [...current, card.name]));
    setDrafts((current) => ({
      ...current,
      [card.name]:
        editingName === card.name
          ? [...(current[card.name] ?? []), createDraftItem()]
          : [...card.items.map((item) => toDraftItem(item)), createDraftItem()],
    }));
  };

  const cancelEdit = () => {
    if (!editingName) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[editingName];
      return next;
    });
    setEditingName(null);
  };

  const saveEdit = () => {
    if (!editingName) return;
    const items = (drafts[editingName] ?? [])
      .map((item) => ({
        id: item.id,
        label: item.label.trim(),
        score: normalizeScore(item.scoreText),
      }))
      .filter((item) => item.label);

    updateTeamLeadManualScoreItems(category, editingName, items);
    setMessage({ tone: "ok", text: "수동 점수를 저장했습니다." });
    setEditingName(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[editingName];
      return next;
    });
  };

  const handlePrint = () => {
    const ok = printTeamLeadDocument(title, [
      {
        title,
        bodyHtml: buildManualScorePrintBody(cards),
        size: "dense",
      },
    ]);

    if (!ok) {
      setMessage({ tone: "warn", text: "인쇄 화면을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">{title}</div>
          <strong style={{ fontSize: 24 }}>{title}</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={handlePrint} disabled={cards.length === 0}>
              인쇄
            </button>
          </div>
          <div className="status note">
            {description} 기본점수는 {TEAM_LEAD_SCORE_BASE}점이고, 카드 안에서 사유별로 플러스/마이너스 점수를 직접 입력합니다.
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
          const draftItems = drafts[card.name] ?? [];

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
                        <span className="muted">기본 {formatScore(card.baseScore)}</span>
                        <span className="muted">가감 {formatScore(card.manualScore)}</span>
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
                      <strong style={{ fontSize: 15 }}>가감 항목</strong>
                      {(isEditing ? draftItems.length > 0 : card.items.length > 0) ? (
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
                                    placeholder="사유 입력"
                                    onChange={(event) =>
                                      setDrafts((current) => ({
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
                                        ? setDrafts((current) => ({
                                            ...current,
                                            [card.name]: (current[card.name] ?? []).map((currentItem) =>
                                              currentItem.id === item.id
                                                ? { ...currentItem, scoreText: event.target.value }
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
                                      setDrafts((current) => ({
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
                            : card.items.map((item) => (
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
                                  <strong style={{ color: item.score >= 0 ? "#86efac" : "#fca5a5" }}>
                                    {item.score > 0 ? "+" : ""}
                                    {formatScore(item.score)}점
                                  </strong>
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
                            {isEditing ? "사유와 점수를 입력한 뒤 저장하세요." : "아직 입력된 가감 항목이 없습니다."}
                          </span>
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
