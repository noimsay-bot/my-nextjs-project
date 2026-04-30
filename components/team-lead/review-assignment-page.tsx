"use client";

import { useEffect, useMemo, useState } from "react";
import {
  assignReviewerToSubmission,
  getTeamLeadReviewManagementWorkspace,
  resetSubmissionAssignment,
  ReviewManagementItem,
  ReviewerCandidate,
} from "@/lib/team-lead/storage";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function getCurrentReview(item: ReviewManagementItem) {
  if (item.reviewerId) {
    const assignedReview = item.reviews.find((review) => review.reviewerId === item.reviewerId);
    if (assignedReview) return assignedReview;
  }

  return item.reviews[0] ?? null;
}

function getReviewStatusLabel(item: ReviewManagementItem) {
  const currentReview = getCurrentReview(item);

  if (!item.reviewerId) return "미배정";
  if (!currentReview) return "대기";
  if (currentReview.completedAt) return "완료";
  return "진행 중";
}

export function ReviewAssignmentPage() {
  const [items, setItems] = useState<ReviewManagementItem[]>([]);
  const [candidates, setCandidates] = useState<ReviewerCandidate[]>([]);
  const [draftReviewerIds, setDraftReviewerIds] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busySubmissionId, setBusySubmissionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getTeamLeadReviewManagementWorkspace();
      setItems(workspace.items);
      setCandidates(workspace.candidates);
      setDraftReviewerIds(
        Object.fromEntries(
          workspace.items.map((item) => [item.submissionId, item.reviewerId ?? ""]),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "team_lead 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;

    return items.filter((item) =>
      [
        item.authorName,
        item.title,
        item.type,
        item.reviewerName,
        item.notes,
        item.link,
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [items, query]);

  const summary = useMemo(() => {
    const assigned = items.filter((item) => Boolean(item.reviewerId)).length;
    const completed = items.filter((item) => getCurrentReview(item)?.completedAt).length;
    return {
      total: items.length,
      assigned,
      pending: items.length - assigned,
      completed,
    };
  }, [items]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section className="subgrid-4">
        <article className="kpi">
          <div className="kpi-label">제출 수</div>
          <div className="kpi-value">{summary.total}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">배정 완료</div>
          <div className="kpi-value">{summary.assigned}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">미배정</div>
          <div className="kpi-value">{summary.pending}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">평가 완료</div>
          <div className="kpi-value">{summary.completed}</div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">평가 배정</div>
          <strong style={{ fontSize: 24 }}>제출 / 배정 / 평가 현황</strong>
          <div className="status note">
            submission 단위로 reviewer를 지정하거나 초기화할 수 있습니다. 현재 assignment와 리뷰 저장 상태는 모두 Supabase DB를 기준으로 표시됩니다.
          </div>
          {message ? <div className="status note">{message}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">assignment manager</div>
            <input
              className="field-input"
              style={{ width: 280 }}
              placeholder="제출자, 제목, 평가자 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <table className="table-like">
            <thead>
              <tr>
                <th>제출자</th>
                <th>제출 정보</th>
                <th>현재 배정</th>
                <th>리뷰 상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const currentReview = getCurrentReview(item);
                const draftReviewerId = draftReviewerIds[item.submissionId] ?? "";
                const hasReviewerChange = draftReviewerId !== (item.reviewerId ?? "");

                return (
                  <tr key={item.submissionId}>
                    <td>
                      <div style={{ display: "grid", gap: 6 }}>
                        <strong>{item.authorName}</strong>
                        <span className="muted">{formatDateTime(item.updatedAt)}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                        <strong>{item.title || "(제목 없음)"}</strong>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span className="muted">{item.type}</span>
                          <span className="muted">{item.date || "-"}</span>
                        </div>
                        {item.notes ? <div className="muted">{item.notes}</div> : null}
                        {item.link ? (
                          <a href={item.link} target="_blank" rel="noreferrer" className="muted">
                            {item.link}
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 8, minWidth: 180 }}>
                        <strong>{item.reviewerName || "미배정"}</strong>
                        <span className="muted">배정 시각 {formatDateTime(item.assignedAt)}</span>
                        <select
                          className="field-select"
                          value={draftReviewerId}
                          onChange={(event) =>
                            setDraftReviewerIds((current) => ({
                              ...current,
                              [item.submissionId]: event.target.value,
                            }))
                          }
                        >
                          <option value="">평가자 선택</option>
                          {candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name} ({candidate.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 8, minWidth: 180 }}>
                        <strong>{getReviewStatusLabel(item)}</strong>
                        {currentReview ? (
                          <>
                            <span className="muted">평가자 {currentReview.reviewerName}</span>
                            <span className="muted">총점 {currentReview.total ?? 0}</span>
                            <span className="muted">완료 시각 {formatDateTime(currentReview.completedAt)}</span>
                          </>
                        ) : (
                          <span className="muted">아직 저장된 review가 없습니다.</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 8, minWidth: 170 }}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!draftReviewerId || !hasReviewerChange || busySubmissionId === item.submissionId}
                          onClick={async () => {
                            setBusySubmissionId(item.submissionId);
                            const result = await assignReviewerToSubmission(item.submissionId, draftReviewerId);
                            setMessage(result.message);
                            if (result.ok) {
                              await refresh();
                            }
                            setBusySubmissionId(null);
                          }}
                        >
                          {item.reviewerId ? "배정 변경" : "배정 저장"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={!item.reviewerId || busySubmissionId === item.submissionId}
                          onClick={async () => {
                            setBusySubmissionId(item.submissionId);
                            const result = await resetSubmissionAssignment(item.submissionId);
                            setMessage(result.message);
                            if (result.ok) {
                              await refresh();
                            }
                            setBusySubmissionId(null);
                          }}
                        >
                          assignment reset
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!filteredItems.length ? (
            <div className="status note">{loading ? "불러오는 중입니다." : "조회할 submission이 없습니다."}</div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
