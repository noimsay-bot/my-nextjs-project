"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { refreshUsers } from "@/lib/auth/storage";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  addSelectedFinalCutQuarter,
  FinalCutQuarterGroup,
  formatFinalCutQuarterLabel,
  getContributionSummaryRows,
  getFinalCutQuarterGroups,
  getFinalCutSummaryRows,
  getOverallScoreCards,
  getSelectedFinalCutQuarterKeys,
  getVideoReviewSummaryRows,
  refreshScoreboardState,
  removeSelectedFinalCutQuarter,
  TEAM_LEAD_SCOREBOARD_EVENT,
  TeamLeadFinalCutSummaryRow,
  TeamLeadOverallScoreCard,
  TeamLeadWeightedQuarterSummaryRow,
} from "@/lib/team-lead/scoreboard";
import {
  refreshTeamLeadState,
  TEAM_LEAD_CONTRIBUTION_EVENT,
  TEAM_LEAD_FINAL_CUT_EVENT,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
} from "@/lib/team-lead/storage";

function formatScore(score: number) {
  return score.toFixed(1);
}

function formatPercent(score: number) {
  return `${score.toFixed(1)}%`;
}

function averageOf(cards: TeamLeadOverallScoreCard[], selector: (card: TeamLeadOverallScoreCard) => number) {
  if (cards.length === 0) return 0;
  return cards.reduce((sum, card) => sum + selector(card), 0) / cards.length;
}

function WeightedQuarterSummaryTable({
  title,
  groupLabel,
  weightLabel,
  rows,
}: {
  title: string;
  groupLabel: string;
  weightLabel: string;
  rows: TeamLeadWeightedQuarterSummaryRow[];
}) {
  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 18 }}>{title}</strong>
        <div style={{ overflowX: "auto" }}>
          <table className="table-like team-lead-summary-table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ minWidth: 72 }}>순위</th>
                <th rowSpan={2} style={{ minWidth: 120 }}>이름</th>
                <th colSpan={6} style={{ textAlign: "center" }}>{groupLabel}</th>
              </tr>
              <tr>
                {["12-2월", "3-5월", "6-8월", "9-11월", "합산", weightLabel].map((label) => (
                  <th key={`${title}-${label}`} style={{ textAlign: "center", minWidth: 110 }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${row.name}`}>
                  <td style={{ fontWeight: 800 }}>{index + 1}</td>
                  <td style={{ fontWeight: 800 }}>{row.name}</td>
                  {row.quarterScores.map((item) => (
                    <td key={`${title}-${row.name}-${item.key}`} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {formatScore(item.score)}
                    </td>
                  ))}
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{formatScore(row.totalScore)}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", fontWeight: 800 }}>
                    {formatScore(row.convertedScore)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

function FinalCutSummaryTable({ rows }: { rows: TeamLeadFinalCutSummaryRow[] }) {
  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 18 }}>정제본 제작</strong>
        <div style={{ overflowX: "hidden" }}>
          <table
            className="table-like team-lead-summary-table team-lead-summary-table--compact"
            style={{ width: "100%", tableLayout: "fixed" }}
          >
            <thead>
              <tr>
                <th rowSpan={3} style={{ width: 48, textAlign: "center" }}>순위</th>
                <th rowSpan={3} style={{ width: 74, textAlign: "center" }}>이름</th>
                <th colSpan={14} style={{ textAlign: "center" }}>정제본 제작</th>
              </tr>
              <tr>
                {["12-2월", "3-5월", "6-8월", "9-11월"].map((label) => (
                  <th key={`final-cut-group-${label}`} colSpan={3} style={{ textAlign: "center" }}>
                    {label}
                  </th>
                ))}
                <th rowSpan={2} style={{ textAlign: "center", width: 72 }}>전체수행률</th>
                <th rowSpan={2} style={{ textAlign: "center", width: 60 }}>10%환산</th>
              </tr>
              <tr>
                {Array.from({ length: 4 }).map((_, groupIndex) =>
                  ["일정수", "정제본", "수행률"].map((label) => (
                    <th
                      key={`final-cut-sub-${groupIndex}-${label}`}
                      style={{ textAlign: "center" }}
                    >
                      {label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`final-cut-summary-${row.name}`}>
                  <td style={{ fontWeight: 800 }}>{index + 1}</td>
                  <td style={{ fontWeight: 800 }}>{row.name}</td>
                  {row.quarterScores.flatMap((item) => [
                    <td key={`${row.name}-${item.key}-count`} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {item.itemCount}
                    </td>,
                    <td key={`${row.name}-${item.key}-earned`} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {formatScore(item.earnedScore)}
                    </td>,
                    <td key={`${row.name}-${item.key}-rate`} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {formatPercent(item.ratePercent)}
                    </td>,
                  ])}
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{formatPercent(row.overallRatePercent)}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", fontWeight: 800 }}>
                    {formatScore(row.convertedScore)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

export function OverallScoreSummaryPage() {
  const [cards, setCards] = useState<TeamLeadOverallScoreCard[]>([]);
  const [quarterGroups, setQuarterGroups] = useState<FinalCutQuarterGroup[]>([]);
  const [selectedQuarterKeys, setSelectedQuarterKeys] = useState<string[]>([]);
  const [videoReviewRows, setVideoReviewRows] = useState<TeamLeadWeightedQuarterSummaryRow[]>([]);
  const [contributionRows, setContributionRows] = useState<TeamLeadWeightedQuarterSummaryRow[]>([]);
  const [finalCutRows, setFinalCutRows] = useState<TeamLeadFinalCutSummaryRow[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  const syncFromCache = useCallback(() => {
    setCards(getOverallScoreCards());
    setQuarterGroups(getFinalCutQuarterGroups());
    setSelectedQuarterKeys(getSelectedFinalCutQuarterKeys());
    setVideoReviewRows(getVideoReviewSummaryRows());
    setContributionRows(getContributionSummaryRows());
    setFinalCutRows(getFinalCutSummaryRows());
  }, []);

  useEffect(() => {
    const refresh = async () => {
      await Promise.all([
        refreshUsers(),
        refreshScheduleState(),
        refreshPublishedSchedules(),
        refreshTeamLeadState(),
        refreshScoreboardState(),
      ]);
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
  }, [syncFromCache]);

  const ranking = useMemo(
    () => [...cards].sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko")),
    [cards],
  );
  const topCard = ranking[0] ?? null;
  const bottomCard = ranking[ranking.length - 1] ?? null;

  const averages = useMemo(
    () => ({
      total: averageOf(cards, (card) => card.totalScore),
      finalCut: averageOf(cards, (card) => card.finalCutScore),
      review: averageOf(cards, (card) => card.videoReviewScore),
      contribution: averageOf(cards, (card) => card.contributionScore),
      accident: averageOf(cards, (card) => card.broadcastAccidentScore),
      liveSafety: averageOf(cards, (card) => card.liveSafetyScore),
    }),
    [cards],
  );

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">종합점수</div>
          <strong style={{ fontSize: 24 }}>종합점수</strong>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <strong style={{ fontSize: 18 }}>정제본 반영 분기</strong>
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
        </div>
      </article>

      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        {[
          { label: "전체 평균", value: averages.total },
          { label: "정제본 평균", value: averages.finalCut },
          { label: "평가 평균", value: averages.review },
          { label: "기여도 평균", value: averages.contribution },
          { label: "사고 점수 평균", value: averages.accident },
          { label: "LIVE 평균", value: averages.liveSafety },
        ].map((item) => (
          <article key={item.label} className="panel">
            <div className="panel-pad" style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 13 }}>{item.label}</span>
              <strong style={{ fontSize: 24 }}>{formatScore(item.value)}점</strong>
            </div>
          </article>
        ))}
      </section>

      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        }}
      >
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 8 }}>
            <span className="muted">최고 점수</span>
            {topCard ? (
              <>
                <strong style={{ fontSize: 22 }}>{topCard.name}</strong>
                <strong style={{ fontSize: 28, color: "#d8fbff" }}>{formatScore(topCard.totalScore)}점</strong>
              </>
            ) : (
              <span className="muted">데이터 없음</span>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 8 }}>
            <span className="muted">최저 점수</span>
            {bottomCard ? (
              <>
                <strong style={{ fontSize: 22 }}>{bottomCard.name}</strong>
                <strong style={{ fontSize: 28, color: "#ffd7d7" }}>{formatScore(bottomCard.totalScore)}점</strong>
              </>
            ) : (
              <span className="muted">데이터 없음</span>
            )}
          </div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <strong style={{ fontSize: 18 }}>전체 순위</strong>
          <div style={{ overflowX: "auto" }}>
            <table className="team-lead-summary-table" style={{ width: "100%", minWidth: 840, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["순위", "이름", "총점", "정제본", "평가 평균", "기여도", "장비/인적 사고", "LIVE 무사고"].map((label) => (
                    <th
                      key={label}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        fontSize: 13,
                        color: "#9bb0c7",
                        borderBottom: "1px solid rgba(255,255,255,.1)",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranking.map((card, index) => (
                  <tr key={`overall-summary-${card.name}`}>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)", fontWeight: 800 }}>{index + 1}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)", fontWeight: 800 }}>{card.name}</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{formatScore(card.totalScore)}점</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{formatScore(card.finalCutScore)}점</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{formatScore(card.videoReviewScore)}점</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{formatScore(card.contributionScore)}점</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{formatScore(card.broadcastAccidentScore)}점</td>
                    <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{formatScore(card.liveSafetyScore)}점</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <WeightedQuarterSummaryTable
        title="영상평가"
        groupLabel="영상평가"
        weightLabel="20%환산"
        rows={videoReviewRows}
      />

      <WeightedQuarterSummaryTable
        title="참여기여도"
        groupLabel="참여기여도"
        weightLabel="30%환산"
        rows={contributionRows}
      />

      <FinalCutSummaryTable rows={finalCutRows} />
    </section>
  );
}
