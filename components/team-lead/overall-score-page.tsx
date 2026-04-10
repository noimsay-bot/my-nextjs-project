"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refreshUsers } from "@/lib/auth/storage";
import { escapeTeamLeadPrintHtml, printTeamLeadDocument } from "@/lib/team-lead/print";
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
  TEAM_LEAD_CONTRIBUTION_EVENT,
  TEAM_LEAD_FINAL_CUT_EVENT,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
  refreshTeamLeadState,
} from "@/lib/team-lead/storage";

const FOCUS_REFRESH_THROTTLE_MS = 60_000;

function formatScore(score: number) {
  return score.toFixed(1);
}

function formatPercent(score: number) {
  return `${score.toFixed(1)}%`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function maskName(name: string, selectedName: string) {
  return name === selectedName ? name : "";
}

function buildOverallScorePagePrintBody(cards: TeamLeadOverallScoreCard[]) {
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

  return `
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
    </table>`;
}

function getPrintEvaluationMeta(baseDate = new Date()) {
  const month = baseDate.getMonth() + 1;
  const year = baseDate.getFullYear();

  if (month >= 6 && month <= 10) {
    return {
      label: `${year}년 중간 평가`,
    };
  }

  return {
    label: `${month <= 5 ? year - 1 : year}년 최종 평가`,
  };
}

function formatPrintDateLabel(value = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function renderPrintRankingTable(cards: TeamLeadOverallScoreCard[], selectedName: string, printedAt: string) {
  const rows = [...cards]
    .sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"))
    .map(
      (card, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(maskName(card.name, selectedName))}</td>
          <td>${formatScore(card.totalScore)}점</td>
          <td>${formatScore(card.finalCutScore)}점</td>
          <td>${formatScore(card.videoReviewScore)}점</td>
          <td>${formatScore(card.contributionScore)}점</td>
          <td>${formatScore(card.broadcastAccidentScore)}점</td>
          <td>${formatScore(card.liveSafetyScore)}점</td>
        </tr>`,
    )
    .join("");

  return `
    <section class="print-page print-page--ranking">
      <h1>종합점수 - 전체 순위</h1>
      <div class="print-date">출력일시 ${escapeHtml(printedAt)}</div>
      <table>
        <thead>
          <tr>
            <th>순위</th>
            <th>이름</th>
            <th>총점</th>
            <th>정제본</th>
            <th>평가 평균</th>
            <th>팀 기여도</th>
            <th>장비/인적 사고</th>
            <th>라이브 무사고</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderPrintWeightedTable(
  title: string,
  rows: TeamLeadWeightedQuarterSummaryRow[],
  selectedName: string,
  midValueLabel: string,
  getMidValue: (row: TeamLeadWeightedQuarterSummaryRow) => number,
  printedAt: string,
) {
  const body = rows
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(maskName(row.name, selectedName))}</td>
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

  return `
    <section class="print-page print-page--weighted">
      <h1>${escapeHtml(title)}</h1>
      <div class="print-date">출력일시 ${escapeHtml(printedAt)}</div>
      <table>
        <thead>
          <tr>
            <th>순위</th>
            <th>이름</th>
            <th>12-2월</th>
            <th>3-5월</th>
            <th>${escapeHtml(midValueLabel)}</th>
            <th>6-8월</th>
            <th>9-11월</th>
            <th>합산</th>
            <th>환산</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderPrintFinalCutTable(rows: TeamLeadFinalCutSummaryRow[], selectedName: string, printedAt: string) {
  const body = rows
    .map((row, index) => {
      const halfItemCount = row.quarterScores.slice(0, 2).reduce((sum, item) => sum + item.itemCount, 0);
      const halfEarnedScore = row.quarterScores.slice(0, 2).reduce((sum, item) => sum + item.earnedScore, 0);
      const halfRate = halfItemCount > 0 ? (halfEarnedScore / halfItemCount) * 100 : 0;

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(maskName(row.name, selectedName))}</td>
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

  return `
    <section class="print-page print-page--final-cut">
      <h1>정제본 제작</h1>
      <div class="print-date">출력일시 ${escapeHtml(printedAt)}</div>
      <table>
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
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderPrintCoverPage(selectedName: string, evaluationLabel: string, printedAt: string) {
  return `
    <section class="print-page print-cover">
      <div class="cover-wrap">
        <h1>${escapeHtml(evaluationLabel)}</h1>
        <strong class="cover-name">${escapeHtml(selectedName)}</strong>
        <div class="print-date">출력일시 ${escapeHtml(printedAt)}</div>
      </div>
    </section>`;
}

function buildPrintHtml(
  selectedName: string,
  cards: TeamLeadOverallScoreCard[],
  videoReviewRows: TeamLeadWeightedQuarterSummaryRow[],
  contributionRows: TeamLeadWeightedQuarterSummaryRow[],
  finalCutRows: TeamLeadFinalCutSummaryRow[],
) {
  const evaluationMeta = getPrintEvaluationMeta();
  const printedAt = formatPrintDateLabel();

  return `<!doctype html>
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <title></title>
      <style>
        @page {
          size: A4 landscape;
          margin: 12mm;
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
          color: #111827;
          background: #ffffff;
        }
        h1 {
          margin: 0 0 6px;
          font-size: 16px;
          text-align: center;
          line-height: 1.2;
        }
        .print-date {
          font-size: 10px;
          color: #475569;
          text-align: right;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 9px;
        }
        th, td {
          border: 1px solid #cbd5e1;
          padding: 3px 4px;
          text-align: center;
          word-break: break-word;
          line-height: 1.15;
        }
        th {
          background: #f8fafc;
          font-weight: 700;
        }
        .print-page {
          width: 100%;
          min-height: 180mm;
          height: 180mm;
          page-break-after: always;
          display: grid;
          align-content: start;
          gap: 6px;
          overflow: hidden;
        }
        .print-page:last-child {
          page-break-after: auto;
        }
        .print-page table,
        .print-page tr,
        .print-page td,
        .print-page th {
          page-break-inside: avoid;
        }
        .print-page--ranking table {
          font-size: 9.5px;
        }
        .print-page--weighted table {
          font-size: 9px;
        }
        .print-page--final-cut table {
          font-size: 7.1px;
        }
        .print-page--final-cut th,
        .print-page--final-cut td {
          padding: 2px 2px;
        }
        .print-cover {
          align-content: start;
          justify-items: center;
          padding-top: 22mm;
        }
        .cover-wrap {
          display: grid;
          gap: 16px;
          justify-items: center;
          text-align: center;
        }
        .cover-name {
          font-size: 34px;
          font-weight: 800;
        }
      </style>
    </head>
    <body>
      ${renderPrintCoverPage(selectedName, evaluationMeta.label, printedAt)}
      ${renderPrintRankingTable(cards, selectedName, printedAt)}
      ${renderPrintWeightedTable("영상평가", videoReviewRows, selectedName, "중간 합계", (row) => ((row.quarterScores[0]?.score ?? 0) + (row.quarterScores[1]?.score ?? 0)) * 0.2, printedAt)}
      ${renderPrintWeightedTable("팀 기여도", contributionRows, selectedName, "중간 합계", (row) => (row.quarterScores[0]?.score ?? 0) + (row.quarterScores[1]?.score ?? 0), printedAt)}
      ${renderPrintFinalCutTable(finalCutRows, selectedName, printedAt)}
    </body>
  </html>`;
}

export function OverallScorePage() {
  const [cards, setCards] = useState<TeamLeadOverallScoreCard[]>([]);
  const [videoReviewRows, setVideoReviewRows] = useState<TeamLeadWeightedQuarterSummaryRow[]>([]);
  const [contributionRows, setContributionRows] = useState<TeamLeadWeightedQuarterSummaryRow[]>([]);
  const [finalCutRows, setFinalCutRows] = useState<TeamLeadFinalCutSummaryRow[]>([]);
  const [expandedNames, setExpandedNames] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const lastFocusRefreshAtRef = useRef(0);

  const syncFromCache = useCallback(() => {
    setCards(getOverallScoreCards());
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
    const onFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      void refresh();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };

    void refresh().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
    });
    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    window.addEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_FINAL_CUT_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_SCOREBOARD_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);

    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
      window.removeEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_FINAL_CUT_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_SCOREBOARD_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    };
  }, [syncFromCache]);

  const toggleExpanded = (name: string) => {
    setExpandedNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const printPayloadReady = useMemo(
    () => cards.length > 0 && videoReviewRows.length > 0 && contributionRows.length > 0 && finalCutRows.length > 0,
    [cards, contributionRows, finalCutRows, videoReviewRows],
  );

  const handlePagePrint = () => {
    const ok = printTeamLeadDocument("개인별 점수", [
      {
        title: "개인별 점수",
        bodyHtml: buildOverallScorePagePrintBody(cards),
        size: "dense",
      },
    ]);

    if (!ok) {
      setMessage({ tone: "warn", text: "인쇄 화면을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  const handlePrint = (selectedName: string) => {
    if (!printPayloadReady) {
      setMessage({ tone: "warn", text: "출력용 데이터를 아직 불러오는 중입니다. 잠시 후 다시 시도해 주세요." });
      return;
    }

    const existingFrame = document.getElementById("overall-score-print-frame");
    if (existingFrame) {
      existingFrame.remove();
    }

    const frame = document.createElement("iframe");
    frame.id = "overall-score-print-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);

    const printWindow = frame.contentWindow;
    if (!printWindow) {
      frame.remove();
      setMessage({ tone: "warn", text: "출력 화면을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      return;
    }

    const html = buildPrintHtml(selectedName, cards, videoReviewRows, contributionRows, finalCutRows);
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    const cleanup = () => {
      window.setTimeout(() => {
        frame.remove();
      }, 300);
    };

    printWindow.onafterprint = cleanup;
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      window.setTimeout(cleanup, 2000);
    }, 250);
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">개인별 점수</div>
          <strong style={{ fontSize: 24 }}>개인별 점수</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={handlePagePrint} disabled={cards.length === 0}>
              인쇄
            </button>
          </div>
          <div className="status note">
            활성 사용자 기준으로 개인별 기여도, 베스트리포트 평가 평균, 정제본, 장비/인적 사고, 라이브 무사고 점수를 합산합니다.
            정제본 점수는 현재까지 반영된 수행 결과를 기준으로 계산합니다.
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <section
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          alignItems: "start",
        }}
      >
        {cards.map((card, index) => (
          <article key={`${card.name}-${index}`} className="panel" style={{ alignSelf: "start" }}>
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
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => handlePrint(card.name)}
                    style={{ justifySelf: "start" }}
                  >
                    출력
                  </button>

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
                    <span className="muted" style={{ fontSize: 14 }}>
                      현재까지 반영된 정제본 점수입니다.
                    </span>
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
                    <strong>베스트리포트 평가 평균</strong>
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
                    <strong>팀 기여도</strong>
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
                    <strong>장비/인적 사고</strong>
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
                    <strong>라이브 무사고</strong>
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
