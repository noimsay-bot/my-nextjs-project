"use client";

import { useEffect, useMemo, useState } from "react";
import { PUBLISHED_SCHEDULES_EVENT } from "@/lib/schedule/published";
import { readStoredScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  FinalCutDecision,
  FinalCutPersonCard,
  TEAM_LEAD_FINAL_CUT_EVENT,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  getFinalCutCards,
  getTeamLeadSchedules,
  updateFinalCutDecision,
} from "@/lib/team-lead/storage";

const decisionButtons: Array<{
  value: Exclude<FinalCutDecision, "">;
  label: string;
  activeStyle: { borderColor: string; background: string; color: string };
}> = [
  {
    value: "circle",
    label: "○",
    activeStyle: {
      borderColor: "rgba(74,222,128,.82)",
      background: "rgba(34,197,94,.22)",
      color: "#dcfce7",
    },
  },
  {
    value: "triangle",
    label: "△",
    activeStyle: {
      borderColor: "rgba(250,204,21,.82)",
      background: "rgba(250,204,21,.22)",
      color: "#fef3c7",
    },
  },
  {
    value: "cross",
    label: "×",
    activeStyle: {
      borderColor: "rgba(248,113,113,.82)",
      background: "rgba(239,68,68,.22)",
      color: "#fee2e2",
    },
  },
];

type FinalCutQuarterNumber = 1 | 2 | 3 | 4;

interface FinalCutQuarterGroup {
  key: string;
  year: number;
  quarter: FinalCutQuarterNumber;
  monthKeys: string[];
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function getQuarterMeta(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);

  if (month === 12) {
    return { year: year + 1, quarter: 1 as FinalCutQuarterNumber };
  }
  if (month >= 1 && month <= 2) {
    return { year, quarter: 1 as FinalCutQuarterNumber };
  }
  if (month >= 3 && month <= 5) {
    return { year, quarter: 2 as FinalCutQuarterNumber };
  }
  if (month >= 6 && month <= 8) {
    return { year, quarter: 3 as FinalCutQuarterNumber };
  }
  return { year, quarter: 4 as FinalCutQuarterNumber };
}

function getQuarterKey(monthKey: string) {
  const meta = getQuarterMeta(monthKey);
  return `${meta.year}-Q${meta.quarter}`;
}

function formatQuarterLabel(group: FinalCutQuarterGroup) {
  return `${group.year}년 ${group.quarter}분기`;
}

function formatQuarterRange(group: FinalCutQuarterGroup) {
  if (group.quarter === 1) return `${group.year - 1}년 12월 ~ ${group.year}년 2월`;
  if (group.quarter === 2) return `${group.year}년 3월 ~ ${group.year}년 5월`;
  if (group.quarter === 3) return `${group.year}년 6월 ~ ${group.year}년 8월`;
  return `${group.year}년 9월 ~ ${group.year}년 11월`;
}

function buildQuarterGroups(monthKeys: string[]) {
  const quarterMap = new Map<string, FinalCutQuarterGroup>();

  monthKeys.forEach((monthKey) => {
    const meta = getQuarterMeta(monthKey);
    const key = getQuarterKey(monthKey);
    const current = quarterMap.get(key);
    if (current) {
      current.monthKeys.push(monthKey);
      return;
    }
    quarterMap.set(key, {
      key,
      year: meta.year,
      quarter: meta.quarter,
      monthKeys: [monthKey],
    });
  });

  return Array.from(quarterMap.values())
    .map((group) => ({
      ...group,
      monthKeys: [...group.monthKeys].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.year - right.year || left.quarter - right.quarter);
}

function getDecisionButtonStyle(active: boolean, decision: Exclude<FinalCutDecision, "">) {
  const config = decisionButtons.find((button) => button.value === decision);
  if (!config) return {};
  if (!active) {
    return {
      borderColor: "rgba(148,163,184,.28)",
      background: "rgba(15,23,42,.22)",
      color: "#94a3b8",
    };
  }
  return config.activeStyle;
}

function filterCardsByQuarter(cards: FinalCutPersonCard[], quarterKey: string) {
  if (!quarterKey) return [];

  return cards
    .map((card) => ({
      ...card,
      items: card.items.filter((item) => getQuarterKey(item.dateKey.slice(0, 7)) === quarterKey),
    }))
    .filter((card) => card.items.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

function getDecisionSummary(card: FinalCutPersonCard) {
  return card.items.reduce(
    (summary, item) => {
      if (item.decision === "circle") summary.circle += 1;
      if (item.decision === "triangle") summary.triangle += 1;
      if (item.decision === "cross") summary.cross += 1;
      return summary;
    },
    { circle: 0, triangle: 0, cross: 0 },
  );
}

export function FinalCutPage() {
  const [quarterGroups, setQuarterGroups] = useState<FinalCutQuarterGroup[]>([]);
  const [selectedQuarterKey, setSelectedQuarterKey] = useState("");
  const [cards, setCards] = useState<FinalCutPersonCard[]>([]);
  const [expandedNames, setExpandedNames] = useState<string[]>([]);

  useEffect(() => {
    const refresh = () => {
      const schedules = getTeamLeadSchedules();
      const generatedState = readStoredScheduleState();
      const generatedMonthKeys = generatedState.generatedHistory.map((schedule) => schedule.monthKey);
      const baseMonthKeys = schedules.map((schedule) => schedule.monthKey);
      const nextMonthKeys = Array.from(new Set([...baseMonthKeys, ...generatedMonthKeys])).sort((left, right) =>
        left.localeCompare(right),
      );
      const nextQuarterGroups = buildQuarterGroups(nextMonthKeys);
      const fallbackQuarterKey = nextQuarterGroups[0]?.key ?? "";

      setQuarterGroups(nextQuarterGroups);
      setSelectedQuarterKey((current) =>
        nextQuarterGroups.some((group) => group.key === current) ? current : fallbackQuarterKey,
      );
      setCards(getFinalCutCards());
    };

    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, refresh);
    window.addEventListener(SCHEDULE_STATE_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_FINAL_CUT_EVENT, refresh);

    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, refresh);
      window.removeEventListener(SCHEDULE_STATE_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_FINAL_CUT_EVENT, refresh);
    };
  }, []);

  const selectedQuarterGroup = useMemo(
    () => quarterGroups.find((group) => group.key === selectedQuarterKey) ?? null,
    [quarterGroups, selectedQuarterKey],
  );
  const filteredCards = useMemo(
    () => filterCardsByQuarter(cards, selectedQuarterKey),
    [cards, selectedQuarterKey],
  );

  const toggleExpanded = (name: string) => {
    setExpandedNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  if (quarterGroups.length === 0) {
    return (
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">정제본</div>
          <strong style={{ fontSize: 24 }}>정제본</strong>
          <div className="status note">근무표나 일정배정 데이터가 아직 없어 정제본 목록을 만들 수 없습니다.</div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">정제본</div>
              <strong style={{ fontSize: 24 }}>
                {selectedQuarterGroup ? formatQuarterLabel(selectedQuarterGroup) : "정제본"}
              </strong>
              {selectedQuarterGroup ? (
                <span className="muted">{formatQuarterRange(selectedQuarterGroup)}</span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {quarterGroups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className={`btn ${selectedQuarterKey === group.key ? "white" : ""}`}
                  onClick={() => setSelectedQuarterKey(group.key)}
                >
                  {formatQuarterLabel(group)}
                </button>
              ))}
            </div>
          </div>
          <div className="status note">
            일정배정에 입력된 일정만 사람별 카드로 모읍니다. 분기 탭은 12월~2월, 3월~5월, 6월~8월, 9월~11월 기준으로 합쳐서 보여줍니다.
          </div>
        </div>
      </article>

      {filteredCards.length > 0 ? (
        <section
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          {filteredCards.map((card) => (
            <article key={`${selectedQuarterKey}-${card.name}`} className="panel">
              <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
                {(() => {
                  const summary = getDecisionSummary(card);

                  return (
                <button
                  type="button"
                  onClick={() => toggleExpanded(card.name)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
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
                  <strong style={{ fontSize: 22, color: "#ffffff" }}>{card.name}</strong>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      justifySelf: "center",
                      color: "#cbd5e1",
                      fontSize: 15,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: "#4ade80" }}>○ {summary.circle}</span>
                    <span style={{ color: "#facc15" }}>△ {summary.triangle}</span>
                    <span style={{ color: "#f87171" }}>× {summary.cross}</span>
                  </span>
                  <span className="chip">{card.items.length}건</span>
                </button>
                  );
                })()}

                {expandedNames.includes(card.name) ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {card.items.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "grid",
                          gap: 10,
                          padding: "12px 14px",
                          borderRadius: 16,
                          border: "1px solid rgba(148,163,184,.18)",
                          background: "rgba(15,23,42,.16)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <strong>{item.dateKey}</strong>
                          <span className="muted">{item.duty || "근무 미지정"}</span>
                        </div>
                        <div style={{ color: "#f8fbff", lineHeight: 1.6 }}>{item.schedule}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {decisionButtons.map((button) => {
                            const active = item.decision === button.value;
                            return (
                              <button
                                key={`${item.id}-${button.value}`}
                                type="button"
                                className="btn"
                                onClick={() => updateFinalCutDecision(item.id, active ? "" : button.value)}
                                style={{
                                  minWidth: 52,
                                  padding: "8px 12px",
                                  fontSize: 18,
                                  fontWeight: 900,
                                  ...getDecisionButtonStyle(active, button.value),
                                }}
                              >
                                {button.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-pad">
            <div className="status note">선택한 분기에 일정배정으로 넘어온 정제본 카드가 없습니다.</div>
          </div>
        </section>
      )}
    </section>
  );
}
