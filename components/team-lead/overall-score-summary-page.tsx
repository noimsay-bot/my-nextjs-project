"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { refreshUsers } from "@/lib/auth/storage";
import { useTeamLeadEvaluationYear } from "@/components/team-lead/use-team-lead-evaluation-year";
import { escapeTeamLeadPrintHtml, printTeamLeadDocument, TeamLeadPrintPage } from "@/lib/team-lead/print";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  getContributionSummaryRows,
  getFinalCutSummaryRows,
  getOverallScoreCards,
  getVideoReviewSummaryRows,
  refreshScoreboardState,
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

function buildOverallRankingPrintPage(cards: TeamLeadOverallScoreCard[]) {
  const rows = [...cards]
    .sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"))
    .map(
      (card, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeTeamLeadPrintHtml(card.name)}</strong></td>
          <td>${formatScore(card.totalScore)}점</td>
          <td>${formatScore(card.finalCutScore)}점</td>
          <td>${formatScore(card.videoReviewScore)}점</td>
          <td>${formatScore(card.contributionScore)}점</td>
          <td>${formatScore(card.broadcastAccidentScore)}점</td>
          <td>${formatScore(card.liveSafetyScore)}점</td>
        </tr>`,
    )
    .join("");

  return {
    title: "종합점수",
    bodyHtml: `
      <table class="team-lead-print-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>이름</th>
            <th>총점</th>
            <th>정제본</th>
            <th>영상평가</th>
            <th>팀 기여도</th>
            <th>장비/인적 사고</th>
            <th>라이브 무사고</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`,
    size: "dense",
  } satisfies TeamLeadPrintPage;
}

function buildWeightedPrintPage(
  title: string,
  rows: TeamLeadWeightedQuarterSummaryRow[],
  midLabel: string,
  getMidValue: (row: TeamLeadWeightedQuarterSummaryRow) => number,
) {
  const bodyRows = rows
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeTeamLeadPrintHtml(row.name)}</strong></td>
          <td>${formatScore(row.quarterScores[0]?.score ?? 0)}</td>
          <td>${formatScore(row.quarterScores[1]?.score ?? 0)}</td>
          <td>${formatScore(getMidValue(row))}</td>
          <td>${formatScore(row.quarterScores[2]?.score ?? 0)}</td>
          <td>${formatScore(row.quarterScores[3]?.score ?? 0)}</td>
          <td>${formatScore(row.totalScore)}</td>
          <td>${formatScore(row.convertedScore)}</td>
        </tr>`,
    )
    .join("");

  return {
    title,
    bodyHtml: `
      <table class="team-lead-print-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>이름</th>
            <th>12-2월</th>
            <th>3-5월</th>
            <th>${escapeTeamLeadPrintHtml(midLabel)}</th>
            <th>6-8월</th>
            <th>9-11월</th>
            <th>합산</th>
            <th>환산</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`,
    size: "dense",
  } satisfies TeamLeadPrintPage;
}

function buildFinalCutPrintPage(rows: TeamLeadFinalCutSummaryRow[]) {
  const bodyRows = rows
    .map((row, index) => {
      const halfItemCount = row.quarterScores.slice(0, 2).reduce((sum, item) => sum + item.itemCount, 0);
      const halfEarnedScore = row.quarterScores.slice(0, 2).reduce((sum, item) => sum + item.earnedScore, 0);
      const halfRate = halfItemCount > 0 ? (halfEarnedScore / halfItemCount) * 100 : 0;

      return `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeTeamLeadPrintHtml(row.name)}</strong></td>
          <td>${row.quarterScores[0]?.itemCount ?? 0}</td>
          <td>${formatScore(row.quarterScores[0]?.earnedScore ?? 0)}</td>
          <td>${formatPercent(row.quarterScores[0]?.ratePercent ?? 0)}</td>
          <td>${row.quarterScores[1]?.itemCount ?? 0}</td>
          <td>${formatScore(row.quarterScores[1]?.earnedScore ?? 0)}</td>
          <td>${formatPercent(row.quarterScores[1]?.ratePercent ?? 0)}</td>
          <td>${formatPercent(halfRate)}</td>
          <td>${row.quarterScores[2]?.itemCount ?? 0}</td>
          <td>${formatScore(row.quarterScores[2]?.earnedScore ?? 0)}</td>
          <td>${formatPercent(row.quarterScores[2]?.ratePercent ?? 0)}</td>
          <td>${row.quarterScores[3]?.itemCount ?? 0}</td>
          <td>${formatScore(row.quarterScores[3]?.earnedScore ?? 0)}</td>
          <td>${formatPercent(row.quarterScores[3]?.ratePercent ?? 0)}</td>
          <td>${formatPercent(row.overallRatePercent)}</td>
          <td>${formatScore(row.convertedScore)}</td>
        </tr>`;
    })
    .join("");

  return {
    title: "정제본 제작",
    bodyHtml: `
      <table class="team-lead-print-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>이름</th>
            <th>12-2 일정수</th>
            <th>12-2 정제본</th>
            <th>12-2 수행률</th>
            <th>3-5 일정수</th>
            <th>3-5 정제본</th>
            <th>3-5 수행률</th>
            <th>중간 합계</th>
            <th>6-8 일정수</th>
            <th>6-8 정제본</th>
            <th>6-8 수행률</th>
            <th>9-11 일정수</th>
            <th>9-11 정제본</th>
            <th>9-11 수행률</th>
            <th>전체수행률</th>
            <th>10%환산</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`,
    size: "compact",
  } satisfies TeamLeadPrintPage;
}

function WeightedQuarterSummaryTable({
  title,
  groupLabel,
  weightLabel,
  midLabel,
  getMidValue,
  rows,
}: {
  title: string;
  groupLabel: string;
  weightLabel: string;
  midLabel: string;
  getMidValue: (row: TeamLeadWeightedQuarterSummaryRow) => number;
  rows: TeamLeadWeightedQuarterSummaryRow[];
}) {
  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 18 }}>{title}</strong>
        <div style={{ overflowX: "auto" }}>
          <table className="table-like team-lead-summary-table" style={{ minWidth: 1120 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ minWidth: 72 }}>순위</th>
                <th rowSpan={2} style={{ minWidth: 120 }}>이름</th>
                <th colSpan={7} style={{ textAlign: "center" }}>{groupLabel}</th>
              </tr>
              <tr>
                {["12-2월", "3-5월", midLabel, "6-8월", "9-11월", "합산", weightLabel].map((label) => (
                  <th key={`${title}-${label}`} style={{ textAlign: "center", minWidth: 110 }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${row.name}-${index}`}>
                  <td style={{ fontWeight: 800 }}>{index + 1}</td>
                  <td style={{ fontWeight: 800 }}>{row.name}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{formatScore(row.quarterScores[0]?.score ?? 0)}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{formatScore(row.quarterScores[1]?.score ?? 0)}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", fontWeight: 800 }}>{formatScore(getMidValue(row))}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{formatScore(row.quarterScores[2]?.score ?? 0)}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{formatScore(row.quarterScores[3]?.score ?? 0)}</td>
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
                <th colSpan={15} style={{ textAlign: "center" }}>정제본 제작</th>
              </tr>
              <tr>
                {["12-2월", "3-5월", "6-8월", "9-11월"].map((label) => (
                  <th key={`final-cut-group-${label}`} colSpan={3} style={{ textAlign: "center" }}>
                    {label}
                  </th>
                )).slice(0, 2)}
                <th rowSpan={2} style={{ textAlign: "center", width: 78 }}>중간 합계</th>
                {["6-8월", "9-11월"].map((label) => (
                  <th key={`final-cut-group-tail-${label}`} colSpan={3} style={{ textAlign: "center" }}>
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
                <tr key={`final-cut-summary-${row.name}-${index}`}>
                  <td style={{ fontWeight: 800 }}>{index + 1}</td>
                  <td style={{ fontWeight: 800 }}>{row.name}</td>
                  {row.quarterScores.slice(0, 2).flatMap((item) => [
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
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", fontWeight: 800 }}>
                    {formatPercent(
                      (() => {
                        const halfItemCount = row.quarterScores.slice(0, 2).reduce((sum, item) => sum + item.itemCount, 0);
                        const halfEarnedScore = row.quarterScores.slice(0, 2).reduce((sum, item) => sum + item.earnedScore, 0);
                        return halfItemCount > 0 ? (halfEarnedScore / halfItemCount) * 100 : 0;
                      })(),
                    )}
                  </td>
                  {row.quarterScores.slice(2).flatMap((item) => [
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
  const evaluationYear = useTeamLeadEvaluationYear();
  const [cards, setCards] = useState<TeamLeadOverallScoreCard[]>([]);
  const [videoReviewRows, setVideoReviewRows] = useState<TeamLeadWeightedQuarterSummaryRow[]>([]);
  const [contributionRows, setContributionRows] = useState<TeamLeadWeightedQuarterSummaryRow[]>([]);
  const [finalCutRows, setFinalCutRows] = useState<TeamLeadFinalCutSummaryRow[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  const syncFromCache = useCallback(() => {
    setCards(getOverallScoreCards(evaluationYear));
    setVideoReviewRows(getVideoReviewSummaryRows(evaluationYear));
    setContributionRows(getContributionSummaryRows(evaluationYear));
    setFinalCutRows(getFinalCutSummaryRows(evaluationYear));
  }, [evaluationYear]);

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

  const handlePrint = () => {
    const ok = printTeamLeadDocument("종합점수", [
      buildOverallRankingPrintPage(ranking),
      buildWeightedPrintPage("영상평가", videoReviewRows, "중간 합계", (row) => ((row.quarterScores[0]?.score ?? 0) + (row.quarterScores[1]?.score ?? 0)) * 0.2),
      buildWeightedPrintPage("팀 기여도", contributionRows, "중간 합계", (row) => (row.quarterScores[0]?.score ?? 0) + (row.quarterScores[1]?.score ?? 0)),
      buildFinalCutPrintPage(finalCutRows),
    ]);

    if (!ok) {
      setMessage({ tone: "warn", text: "인쇄 화면을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">종합점수</div>
          <strong style={{ fontSize: 24 }}>종합점수</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            {evaluationYear - 1}년 12월 ~ {evaluationYear}년 11월 기준
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={handlePrint} disabled={cards.length === 0}>
              인쇄
            </button>
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
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
          { label: "팀 기여도 평균", value: averages.contribution },
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
                  {["순위", "이름", "총점", "정제본", "평가 평균", "팀 기여도", "장비/인적 사고", "라이브 무사고"].map((label) => (
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
                  <tr key={`overall-summary-${card.name}-${index}`}>
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
        midLabel="중간 합계"
        getMidValue={(row) => ((row.quarterScores[0]?.score ?? 0) + (row.quarterScores[1]?.score ?? 0)) * 0.2}
        rows={videoReviewRows}
      />

      <WeightedQuarterSummaryTable
        title="팀 기여도"
        groupLabel="팀 기여도"
        weightLabel="30%환산"
        midLabel="중간 합계"
        getMidValue={(row) => (row.quarterScores[0]?.score ?? 0) + (row.quarterScores[1]?.score ?? 0)}
        rows={contributionRows}
      />

      <FinalCutSummaryTable rows={finalCutRows} />
    </section>
  );
}
