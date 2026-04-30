"use client";

import { useEffect, useMemo, useState } from "react";
import { useTeamLeadEvaluationYear } from "@/components/team-lead/use-team-lead-evaluation-year";
import { subscribeToReviewWorkspaceChanges } from "@/lib/portal/data";
import { getTeamLeadEvaluationYear } from "@/lib/team-lead/evaluation-year";
import { escapeTeamLeadPrintHtml, printTeamLeadDocument } from "@/lib/team-lead/print";
import {
  getTeamLeadBestReportResultsWorkspace,
  saveCurrentBestReportResultsAsNextQuarter,
  TeamLeadBestReportQuarterSnapshot,
  TeamLeadBestReportReviewerDetailRow,
  TeamLeadBestReportResultsRow,
  TeamLeadBestReportReviewer,
} from "@/lib/team-lead/storage";

function formatScore(score: number | null) {
  if (score === null) return "-";
  return score.toFixed(1);
}

function buildBestReportPrintBody(reviewers: TeamLeadBestReportReviewer[], rows: TeamLeadBestReportResultsRow[]) {
  const headerCells = reviewers
    .map((reviewer) => `<th>${escapeTeamLeadPrintHtml(reviewer.name)}</th>`)
    .join("");

  const bodyRows = rows
    .map((row) => {
      const reviewerCells = row.reviewerScores
        .map(
          (score) => `
            <td>
              <strong>${escapeTeamLeadPrintHtml(formatScore(score.score))}</strong><br />
              <span>${escapeTeamLeadPrintHtml(score.reportCount > 0 ? `${score.reportCount}건` : "-")}</span>
            </td>`,
        )
        .join("");

      return `
        <tr>
          <td><strong>${escapeTeamLeadPrintHtml(row.authorName)}</strong></td>
          ${reviewerCells}
          <td><strong>${escapeTeamLeadPrintHtml(formatScore(row.trimmedAverage))}</strong></td>
        </tr>`;
    })
    .join("");

  return `
    <table class="team-lead-print-table">
      <thead>
        <tr>
          <th>피평가자</th>
          ${headerCells}
          <th>최고/최저 제외 평균</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

export function BestReportResultsPage() {
  const evaluationYear = useTeamLeadEvaluationYear();
  const currentEvaluationYear = getTeamLeadEvaluationYear();
  const isCurrentEvaluationYear = evaluationYear === currentEvaluationYear;
  const [reviewers, setReviewers] = useState<TeamLeadBestReportReviewer[]>([]);
  const [rows, setRows] = useState<TeamLeadBestReportResultsRow[]>([]);
  const [reviewerDetails, setReviewerDetails] = useState<TeamLeadBestReportReviewerDetailRow[]>([]);
  const [savedQuarters, setSavedQuarters] = useState<TeamLeadBestReportQuarterSnapshot[]>([]);
  const [selectedResultKey, setSelectedResultKey] = useState("current");
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getTeamLeadBestReportResultsWorkspace();
      setReviewers(workspace.reviewers);
      setRows(workspace.rows);
      setReviewerDetails(workspace.reviewerDetails);
      setSavedQuarters(workspace.savedQuarters);
      setSelectedResultKey((current) =>
        current === "current" || workspace.savedQuarters.some((quarter) => quarter.key === current) ? current : "current",
      );
      setSelectedReviewerId((current) => {
        if (!current) return "";
        return workspace.reviewers.some((reviewer) => reviewer.id === current) ? current : "";
      });
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "영상평가 결과를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    void refresh();
    void subscribeToReviewWorkspaceChanges(() => {
      if (!active) return;
      void refresh();
    }).then((nextUnsubscribe) => {
      if (!active) {
        nextUnsubscribe();
        return;
      }

      unsubscribe = nextUnsubscribe;
    });

    const handleFocus = () => {
      if (!active) return;
      void refresh();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const visibleSavedQuarters = useMemo(
    () => savedQuarters.filter((quarter) => quarter.year === evaluationYear),
    [evaluationYear, savedQuarters],
  );

  useEffect(() => {
    setSelectedResultKey((current) => {
      if (isCurrentEvaluationYear) {
        if (current === "current") return current;
        if (visibleSavedQuarters.some((quarter) => quarter.key === current)) return current;
        return "current";
      }
      return visibleSavedQuarters.some((quarter) => quarter.key === current)
        ? current
        : (visibleSavedQuarters[0]?.key ?? "current");
    });
  }, [isCurrentEvaluationYear, visibleSavedQuarters]);

  const selectedQuarter = useMemo(
    () => visibleSavedQuarters.find((quarter) => quarter.key === selectedResultKey) ?? null,
    [selectedResultKey, visibleSavedQuarters],
  );

  const displayedReviewers =
    selectedQuarter?.reviewers ?? (isCurrentEvaluationYear && selectedResultKey === "current" ? reviewers : []);
  const displayedRows =
    selectedQuarter?.rows ?? (isCurrentEvaluationYear && selectedResultKey === "current" ? rows : []);
  const displayedReviewerDetails =
    selectedQuarter?.reviewerDetails ??
    (isCurrentEvaluationYear && selectedResultKey === "current" ? reviewerDetails : []);
  const selectedResultLabel = selectedQuarter
    ? selectedQuarter.label
    : isCurrentEvaluationYear && selectedResultKey === "current"
      ? "현재 영상평가 결과"
      : `${evaluationYear}년 저장 결과`;

  useEffect(() => {
    setSelectedReviewerId((current) => {
      if (!current) return "";
      return displayedReviewers.some((reviewer) => reviewer.id === current) ? current : "";
    });
  }, [displayedReviewers]);

  const reviewerCards = useMemo(
    () =>
      displayedReviewers.map((reviewer) => ({
        ...reviewer,
        scoredCount: displayedRows.filter((row) =>
          row.reviewerScores.some((score) => score.reviewerId === reviewer.id && score.score !== null),
        ).length,
      })),
    [displayedReviewers, displayedRows],
  );

  const selectedReviewer = useMemo(
    () => displayedReviewers.find((reviewer) => reviewer.id === selectedReviewerId) ?? null,
    [displayedReviewers, selectedReviewerId],
  );

  const selectedReviewerRows = useMemo(
    () =>
      displayedReviewerDetails
        .filter((row) => row.reviewerId === selectedReviewerId)
        .sort((left, right) => left.authorName.localeCompare(right.authorName, "ko")),
    [displayedReviewerDetails, selectedReviewerId],
  );
  const sortedDisplayedRows = useMemo(
    () =>
      [...displayedRows].sort((left, right) => {
        const rightScore = right.trimmedAverage ?? Number.NEGATIVE_INFINITY;
        const leftScore = left.trimmedAverage ?? Number.NEGATIVE_INFINITY;
        if (rightScore !== leftScore) return rightScore - leftScore;
        return left.authorName.localeCompare(right.authorName, "ko");
      }),
    [displayedRows],
  );
  const scoredDisplayedRowCount = useMemo(
    () => sortedDisplayedRows.filter((row) => row.trimmedAverage !== null).length,
    [sortedDisplayedRows],
  );

  const completedRowCount = useMemo(
    () => displayedRows.filter((row) => row.reviewerScores.some((score) => score.score !== null)).length,
    [displayedRows],
  );

  const handlePrint = () => {
    const ok = printTeamLeadDocument("영상평가 결과", [
      {
        title: `${selectedResultLabel} 영상평가 결과`,
        bodyHtml: buildBestReportPrintBody(displayedReviewers, sortedDisplayedRows),
        size: displayedReviewers.length >= 6 ? "compact" : "dense",
      },
    ]);

    if (!ok) {
      setMessage({ tone: "warn", text: "인쇄 화면을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  const handleConfirmResults = async () => {
    if (confirming) return;
    const ok = window.confirm("현재 영상평가 결과를 확정하고 평가자 권한을 해제하시겠습니까?");
    if (!ok) return;

    setConfirming(true);
    const result = await saveCurrentBestReportResultsAsNextQuarter();
    setConfirming(false);

    if (!result.ok) {
      setMessage({ tone: "warn", text: result.message });
      return;
    }

    setMessage({ tone: "ok", text: `${result.message} 평가자 권한을 초기화했습니다.` });
    await refresh();
    setSelectedResultKey(result.savedQuarter.key);
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section className="subgrid-3">
        <article className="kpi">
          <div className="kpi-label">선택된 평가자</div>
          <div className="kpi-value" style={{ fontSize: selectedReviewer ? 24 : 32 }}>
            {selectedReviewer?.name ?? "-"}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">피평가자</div>
          <div className="kpi-value">{displayedRows.length}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">점수 반영 행</div>
          <div className="kpi-value">{completedRowCount}</div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">영상평가 결과</div>
          <strong style={{ fontSize: 24 }}>{selectedResultLabel} 영상평가 결과</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            {evaluationYear - 1}년 12월 ~ {evaluationYear}년 11월 기준
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn" onClick={handlePrint} disabled={loading || displayedRows.length === 0}>
              인쇄
            </button>
            {isCurrentEvaluationYear && selectedResultKey === "current" ? (
              <button
                type="button"
                className="btn"
                onClick={handleConfirmResults}
                disabled={loading || confirming || displayedRows.length === 0}
              >
                {confirming ? "확정 중..." : "평가 확정"}
              </button>
            ) : null}
            <span className="muted">{`${evaluationYear}년 저장 결과를 보고 있는 중입니다.`}</span>
          </div>
          <div className="status note">
            세로축은 피평가자, 가로축은 평가자입니다. 각 칸에는 해당 평가자가 1~3개 리포트에 입력한 점수 중 최고점만 표시하고,
            마지막 열에는 최고점과 최저점 각 1개를 제외한 평균을 표시합니다. 평균은 3명 이상 점수가 있어야 계산합니다.
          </div>
          <div className="status note">
            아래 평가자 이름카드를 누르면 해당 평가자가 누구에게 어떤 리포트를 몇 점 줬는지 볼 수 있습니다.
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">저장된 분기</div>
          <strong style={{ fontSize: 22 }}>저장된 영상평가 결과</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isCurrentEvaluationYear ? (
              <button
                type="button"
                onClick={() => setSelectedResultKey("current")}
                style={{
                  display: "grid",
                  gap: 4,
                  minWidth: 160,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border:
                    selectedResultKey === "current"
                      ? "1px solid rgba(56,189,248,.55)"
                      : "1px solid rgba(255,255,255,.08)",
                  background:
                    selectedResultKey === "current"
                      ? "rgba(14,165,233,.16)"
                      : "rgba(255,255,255,.04)",
                  color: "#f8fbff",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <strong>현재 결과</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  피평가자 {rows.length}명
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  확정 전
                </span>
              </button>
            ) : null}
            {visibleSavedQuarters.length > 0 ? (
              [...visibleSavedQuarters]
                .sort((left, right) => right.year - left.year || right.quarter - left.quarter)
                .map((quarter) => (
                  <button
                    key={quarter.key}
                    type="button"
                    onClick={() => setSelectedResultKey(quarter.key)}
                    style={{
                      display: "grid",
                      gap: 4,
                      minWidth: 160,
                      padding: "12px 14px",
                      borderRadius: 16,
                      border:
                        selectedResultKey === quarter.key
                          ? "1px solid rgba(56,189,248,.55)"
                          : "1px solid rgba(255,255,255,.08)",
                      background:
                        selectedResultKey === quarter.key
                          ? "rgba(14,165,233,.16)"
                          : "rgba(255,255,255,.04)",
                      color: "#f8fbff",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong>{quarter.label}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      피평가자 {quarter.rows.length}명
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      저장 {new Date(quarter.savedAt).toLocaleString("ko-KR")}
                    </span>
                  </button>
                ))
            ) : (
              <div className="status note">{evaluationYear}년 저장된 분기 결과가 없습니다.</div>
            )}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">평가자 선택</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {reviewerCards.length > 0 ? (
              reviewerCards.map((reviewer) => (
                <button
                  key={reviewer.id}
                  type="button"
                  onClick={() =>
                    setSelectedReviewerId((current) => (current === reviewer.id ? "" : reviewer.id))
                  }
                  style={{
                    display: "grid",
                    gap: 4,
                    minWidth: 120,
                    padding: "10px 12px",
                    borderRadius: 16,
                    border:
                      reviewer.id === selectedReviewerId
                        ? "1px solid rgba(56,189,248,.55)"
                        : "1px solid rgba(255,255,255,.08)",
                    background:
                      reviewer.id === selectedReviewerId
                        ? "rgba(14,165,233,.16)"
                        : "rgba(255,255,255,.04)",
                    color: "#f8fbff",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <strong>{reviewer.name}</strong>
                </button>
              ))
            ) : (
              <div className="status note">{loading ? "평가자 명단을 불러오는 중입니다." : "평가자 지정에 저장된 명단이 없습니다."}</div>
            )}
          </div>
          <strong style={{ fontSize: 22 }}>
            {selectedReviewer ? `${selectedReviewer.name} 평가 상세` : "평가자를 선택해 주세요"}
          </strong>
          {selectedReviewerRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table-like" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 120 }}>피평가자</th>
                    <th>리포트별 점수</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedReviewerRows.map((row) => (
                    <tr key={`${row.reviewerId}-${row.authorId}`}>
                      <td>
                        <strong>{row.authorName}</strong>
                      </td>
                      <td>
                        <div style={{ display: "grid", gap: 8 }}>
                          {row.reports.map((report) => (
                            <div
                              key={report.submissionId}
                              style={{
                                display: "grid",
                                gap: 6,
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(255,255,255,.08)",
                                background: "rgba(15,23,42,.18)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span>
                                  [{report.reportType || "-"}] {report.reportTitle || "(제목 없음)"}
                                </span>
                                <strong>{formatScore(report.score)}</strong>
                              </div>
                              {typeof report.comment === "string" && report.comment.trim() ? (
                                <div style={{ display: "grid", gap: 4 }}>
                                  <span className="muted" style={{ fontSize: 12 }}>가점 의견</span>
                                  <span style={{ whiteSpace: "pre-wrap" }}>{report.comment.trim()}</span>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="status note">
              {selectedReviewer
                  ? "이 평가자가 제출한 완료 평가가 없습니다."
                  : "평가자를 선택해 주세요."}
            </div>
          )}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">결과 표</div>
          <div style={{ overflowX: "auto" }}>
            <table className="table-like" style={{ minWidth: Math.max(760, 220 + displayedReviewers.length * 140) }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>피평가자</th>
                  {displayedReviewers.map((reviewer) => (
                    <th key={reviewer.id} style={{ minWidth: 120, textAlign: "center" }}>{reviewer.name}</th>
                  ))}
                  <th style={{ minWidth: 140, textAlign: "center" }}>최고/최저 제외 평균</th>
                </tr>
              </thead>
              <tbody>
                {sortedDisplayedRows.map((row, index) => {
                  const hasAverageScore = row.trimmedAverage !== null;
                  const isTopRank = hasAverageScore && index < 3;
                  const isBottomRank =
                    hasAverageScore && !isTopRank && index >= Math.max(0, scoredDisplayedRowCount - 3);
                  const rankHighlightStyle = isTopRank
                    ? {
                        background: "rgba(134,239,172,.14)",
                      }
                    : isBottomRank
                      ? {
                          background: "rgba(252,165,165,.14)",
                        }
                      : undefined;

                  return (
                    <tr key={row.authorId} style={rankHighlightStyle}>
                      <td>
                        <strong>{row.authorName}</strong>
                      </td>
                      {row.reviewerScores.map((score) => (
                        <td key={`${row.authorId}-${score.reviewerId}`} style={{ textAlign: "center" }}>
                          <div
                            title={
                              score.reportCount > 0
                                ? `리포트 점수: ${score.reportScores.map((item) => item.toFixed(1)).join(", ")}`
                                : `${score.reviewerName} 평가 없음`
                            }
                            style={{ display: "grid", gap: 4, justifyItems: "center" }}
                          >
                            <strong style={{ color: score.score === null ? "#9bb0c7" : "#f8fbff" }}>{formatScore(score.score)}</strong>
                            {score.reportCount > 1 ? (
                              <span className="muted" style={{ fontSize: 12 }}>
                                최고 {score.reportCount}건 중 1건
                              </span>
                            ) : null}
                          </div>
                        </td>
                      ))}
                      <td style={{ textAlign: "center" }}>
                        <strong
                          className={row.trimmedAverage === null ? undefined : "best-report-trimmed-average-score"}
                          style={{ color: row.trimmedAverage === null ? "#9bb0c7" : undefined }}
                        >
                          {formatScore(row.trimmedAverage)}
                        </strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!sortedDisplayedRows.length ? (
            <div className="status note">{loading ? "결과 표를 불러오는 중입니다." : "표시할 제출 데이터가 없습니다."}</div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
