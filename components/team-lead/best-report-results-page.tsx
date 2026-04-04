"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeToReviewWorkspaceChanges } from "@/lib/portal/data";
import { refreshScoreboardState } from "@/lib/team-lead/scoreboard";
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
  return `${score.toFixed(1)}점`;
}

export function BestReportResultsPage() {
  const [reviewers, setReviewers] = useState<TeamLeadBestReportReviewer[]>([]);
  const [rows, setRows] = useState<TeamLeadBestReportResultsRow[]>([]);
  const [reviewerDetails, setReviewerDetails] = useState<TeamLeadBestReportReviewerDetailRow[]>([]);
  const [savedQuarters, setSavedQuarters] = useState<TeamLeadBestReportQuarterSnapshot[]>([]);
  const [nextQuarterLabel, setNextQuarterLabel] = useState("1분기");
  const [selectedResultKey, setSelectedResultKey] = useState("current");
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingQuarter, setSavingQuarter] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getTeamLeadBestReportResultsWorkspace();
      setReviewers(workspace.reviewers);
      setRows(workspace.rows);
      setReviewerDetails(workspace.reviewerDetails);
      setSavedQuarters(workspace.savedQuarters);
      setNextQuarterLabel(`${workspace.nextQuarter.quarter}분기`);
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
        text: error instanceof Error ? error.message : "베스트리포트 평가 결과를 불러오지 못했습니다.",
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

  const selectedQuarter = useMemo(
    () => savedQuarters.find((quarter) => quarter.key === selectedResultKey) ?? null,
    [savedQuarters, selectedResultKey],
  );

  const displayedReviewers = selectedQuarter?.reviewers ?? reviewers;
  const displayedRows = selectedQuarter?.rows ?? rows;
  const displayedReviewerDetails = selectedQuarter?.reviewerDetails ?? reviewerDetails;
  const selectedResultLabel = selectedQuarter ? selectedQuarter.label : "현재 결과";

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

  const completedRowCount = useMemo(
    () => displayedRows.filter((row) => row.reviewerScores.some((score) => score.score !== null)).length,
    [displayedRows],
  );

  const canSaveQuarter = selectedResultKey === "current" && completedRowCount > 0 && !loading && !savingQuarter;

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
          <div className="chip">베스트리포트 평가 결과</div>
          <strong style={{ fontSize: 24 }}>{selectedResultLabel} 평가 결과 매트릭스</strong>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn primary"
              disabled={!canSaveQuarter}
              onClick={async () => {
                setSavingQuarter(true);
                try {
                  const result = await saveCurrentBestReportResultsAsNextQuarter();
                  if (result.ok) {
                    setSelectedResultKey(result.savedQuarter.key);
                    await refreshScoreboardState();
                    await refresh();
                    setMessage({ tone: "ok", text: result.message });
                  } else {
                    setMessage({ tone: "warn", text: result.message });
                  }
                } finally {
                  setSavingQuarter(false);
                }
              }}
            >
              {savingQuarter ? `${nextQuarterLabel} 저장 중...` : `${nextQuarterLabel} 결과 저장`}
            </button>
            <span className="muted">
              {selectedResultKey === "current"
                ? `저장하면 현재 결과를 ${nextQuarterLabel} 스냅샷으로 보관하고, 결과 페이지는 비워져 다음 분기 데이터를 새로 받습니다.`
                : "저장된 분기 결과를 보고 있는 중입니다. 다시 누르면 현재 결과로 돌아갑니다."}
            </span>
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
          <strong style={{ fontSize: 22 }}>저장된 베스트리포트 결과</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            </button>
            {savedQuarters.length > 0 ? (
              [...savedQuarters]
                .sort((left, right) => right.year - left.year || right.quarter - left.quarter)
                .map((quarter) => (
                  <button
                    key={quarter.key}
                    type="button"
                    onClick={() =>
                      setSelectedResultKey((current) => (current === quarter.key ? "current" : quarter.key))
                    }
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
              <div className="status note">아직 저장된 분기 결과가 없습니다.</div>
            )}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">평가자 명단</div>
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
                    minWidth: 150,
                    padding: "12px 14px",
                    borderRadius: 18,
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
                  <span className="muted" style={{ fontSize: 12 }}>{reviewer.email}</span>
                  <span className="muted" style={{ fontSize: 12 }}>점수 입력 행 {reviewer.scoredCount}건</span>
                </button>
              ))
            ) : (
              <div className="status note">{loading ? "평가자 명단을 불러오는 중입니다." : "평가자 지정에 저장된 명단이 없습니다."}</div>
            )}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">선택 평가자 상세</div>
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
              {loading
                ? "평가 상세를 불러오는 중입니다."
                : selectedReviewer
                  ? "이 평가자가 제출한 완료 평가가 없습니다."
                  : "평가자 명단에서 이름카드를 선택해 주세요."}
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
                {displayedRows.map((row) => (
                  <tr key={row.authorId}>
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
                            <span className="muted" style={{ fontSize: 12 }}>최고 {score.reportCount}건 중 1건</span>
                          ) : score.reportCount === 1 ? (
                            <span className="muted" style={{ fontSize: 12 }}>1건 완료</span>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>-</span>
                          )}
                        </div>
                      </td>
                    ))}
                    <td style={{ textAlign: "center" }}>
                      <strong style={{ color: row.trimmedAverage === null ? "#9bb0c7" : "#fde68a" }}>{formatScore(row.trimmedAverage)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!displayedRows.length ? (
            <div className="status note">{loading ? "결과 표를 불러오는 중입니다." : "표시할 제출 데이터가 없습니다."}</div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
