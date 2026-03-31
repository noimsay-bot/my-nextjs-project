"use client";

import { useEffect, useState } from "react";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  addSelectedFinalCutQuarter,
  FinalCutQuarterGroup,
  formatFinalCutQuarterLabel,
  getFinalCutQuarterGroups,
  getOverallScoreCards,
  getSelectedFinalCutQuarterKeys,
  removeSelectedFinalCutQuarter,
  refreshScoreboardState,
  TEAM_LEAD_SCOREBOARD_EVENT,
  TeamLeadOverallScoreCard,
} from "@/lib/team-lead/scoreboard";
import {
  TEAM_LEAD_CONTRIBUTION_EVENT,
  TEAM_LEAD_FINAL_CUT_EVENT,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
  refreshTeamLeadState,
} from "@/lib/team-lead/storage";

function formatScore(score: number) {
  return score.toFixed(1);
}

export function OverallScorePage() {
  const [cards, setCards] = useState<TeamLeadOverallScoreCard[]>([]);
  const [expandedNames, setExpandedNames] = useState<string[]>([]);
  const [quarterGroups, setQuarterGroups] = useState<FinalCutQuarterGroup[]>([]);
  const [selectedQuarterKeys, setSelectedQuarterKeys] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  useEffect(() => {
    const refresh = async () => {
      await Promise.all([refreshScheduleState(), refreshPublishedSchedules(), refreshTeamLeadState(), refreshScoreboardState()]);
      setCards(getOverallScoreCards());
      setQuarterGroups(getFinalCutQuarterGroups());
      setSelectedQuarterKeys(getSelectedFinalCutQuarterKeys());
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };

    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, refresh);
    window.addEventListener(SCHEDULE_STATE_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_FINAL_CUT_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_SCOREBOARD_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, refresh);
      window.removeEventListener(SCHEDULE_STATE_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_FINAL_CUT_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_SCOREBOARD_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    };
  }, []);

  const toggleExpanded = (name: string) => {
    setExpandedNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">종합 점수</div>
          <strong style={{ fontSize: 24 }}>종합 점수</strong>
          <div className="status note">
            활성 사용자 기준으로 기여도, 베스트리포트 평가, 정제본, 방송사고, LIVE 무사고 점수를 합산합니다.
            정제본 점수는 선택한 분기만 반영됩니다.
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <section
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        }}
      >
        {cards.map((card) => (
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

              {expandedNames.includes(card.name) ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: "12px 14px",
                      borderRadius: 16,
                      border: "1px solid rgba(148,163,184,.18)",
                      background: "rgba(15,23,42,.16)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <strong>정제본</strong>
                      <strong>{formatScore(card.finalCutScore)}점</strong>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {quarterGroups.map((group) => {
                        const selected = selectedQuarterKeys.includes(group.key);
                        return (
                          <button
                            key={group.key}
                            type="button"
                            className={`btn ${selected ? "white" : ""}`}
                            style={{ padding: "6px 10px", fontSize: 12 }}
                            onClick={() => {
                              if (selected) {
                                removeSelectedFinalCutQuarter(group.key);
                              } else {
                                addSelectedFinalCutQuarter(group.key);
                              }
                              setMessage({ tone: "ok", text: "정제본 반영 분기를 저장했습니다." });
                            }}
                          >
                            {selected ? "제외" : "추가"} | {formatFinalCutQuarterLabel(group)}
                          </button>
                        );
                      })}
                    </div>
                    {card.finalCutQuarterScores.length > 0 ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        {card.finalCutQuarterScores.map((item) => (
                          <div
                            key={`${card.name}-${item.key}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                              color: "#cbd5e1",
                              fontSize: 14,
                            }}
                          >
                            <span>{item.label}</span>
                            <span>
                              {item.itemCount}건 | {item.ratePercent.toFixed(1)}% | {item.convertedScore.toFixed(1)}점
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">선택된 정제본 분기가 없습니다.</span>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 14px",
                      borderRadius: 16,
                      border: "1px solid rgba(148,163,184,.18)",
                      background: "rgba(15,23,42,.16)",
                    }}
                  >
                    <strong>베스트리포트 평가</strong>
                    <strong>{formatScore(card.videoReviewScore)}점</strong>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 14px",
                      borderRadius: 16,
                      border: "1px solid rgba(148,163,184,.18)",
                      background: "rgba(15,23,42,.16)",
                    }}
                  >
                    <strong>기여도</strong>
                    <strong>{formatScore(card.contributionScore)}점</strong>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 14px",
                      borderRadius: 16,
                      border: "1px solid rgba(148,163,184,.18)",
                      background: "rgba(15,23,42,.16)",
                    }}
                  >
                    <strong>방송사고</strong>
                    <strong>{formatScore(card.broadcastAccidentScore)}점</strong>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 14px",
                      borderRadius: 16,
                      border: "1px solid rgba(148,163,184,.18)",
                      background: "rgba(15,23,42,.16)",
                    }}
                  >
                    <strong>LIVE 무사고</strong>
                    <strong>{formatScore(card.liveSafetyScore)}점</strong>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}

