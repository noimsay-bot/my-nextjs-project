"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AdminProfileItem,
  getAdminWorkspace,
  ReviewManagementItem,
  updateAdminProfileAccess,
} from "@/lib/team-lead/storage";

const roles = ["member", "reviewer", "team_lead", "desk", "admin"] as const;
type RoleOption = (typeof roles)[number];

const roleLabels: Record<RoleOption, string> = {
  member: "멤버",
  reviewer: "리뷰어",
  team_lead: "팀장",
  desk: "DESK",
  admin: "관리자",
};

const roleToneStyles: Partial<Record<RoleOption, CSSProperties>> = {
  reviewer: {
    color: "#fff1bf",
    border: "1px solid rgba(250,204,21,.45)",
    background: "rgba(250,204,21,.16)",
  },
  team_lead: {
    color: "#fbcfe8",
    border: "1px solid rgba(244,114,182,.42)",
    background: "rgba(244,114,182,.14)",
  },
  desk: {
    color: "#bfdbfe",
    border: "1px solid rgba(96,165,250,.45)",
    background: "rgba(59,130,246,.14)",
  },
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function getReviewStatus(item: ReviewManagementItem) {
  const currentReview = item.reviewerId
    ? item.reviews.find((review) => review.reviewerId === item.reviewerId) ?? item.reviews[0]
    : item.reviews[0];

  if (!item.reviewerId) return "미배정";
  if (!currentReview) return "대기";
  if (currentReview.completedAt) return "완료";
  return "진행 중";
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<AdminProfileItem[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewManagementItem[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Record<string, RoleOption>>({});
  const [draftApproved, setDraftApproved] = useState<Record<string, boolean>>({});

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getAdminWorkspace();
      setProfiles(workspace.profiles);
      setReviewItems(workspace.reviewManagement.items);
      setDraftRoles(
        Object.fromEntries(workspace.profiles.map((profile) => [profile.id, profile.role])),
      );
      setDraftApproved(
        Object.fromEntries(workspace.profiles.map((profile) => [profile.id, profile.approved])),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "admin 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredProfiles = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return profiles;

    return profiles.filter((profile) =>
      [profile.name, profile.loginId, profile.email, profile.role, profile.approved ? "approved" : "pending"]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [profiles, query]);

  const userSummary = useMemo(() => {
    return {
      total: profiles.length,
      approved: profiles.filter((profile) => profile.approved).length,
      pending: profiles.filter((profile) => !profile.approved).length,
      admins: profiles.filter((profile) => profile.role === "admin").length,
    };
  }, [profiles]);

  const reviewSummary = useMemo(() => {
    return {
      submissions: reviewItems.length,
      assigned: reviewItems.filter((item) => Boolean(item.reviewerId)).length,
      completed: reviewItems.filter((item) => getReviewStatus(item) === "완료").length,
      reviews: reviewItems.reduce((sum, item) => sum + item.reviews.length, 0),
    };
  }, [reviewItems]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section className="subgrid-4">
        <article className="kpi">
          <div className="kpi-label">전체 사용자</div>
          <div className="kpi-value">{userSummary.total}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">승인 완료</div>
          <div className="kpi-value">{userSummary.approved}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">승인 대기</div>
          <div className="kpi-value">{userSummary.pending}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">관리자</div>
          <div className="kpi-value">{userSummary.admins}</div>
        </article>
      </section>

      <section className="subgrid-4">
        <article className="kpi">
          <div className="kpi-label">제출 수</div>
          <div className="kpi-value">{reviewSummary.submissions}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">배정 완료</div>
          <div className="kpi-value">{reviewSummary.assigned}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">평가 완료</div>
          <div className="kpi-value">{reviewSummary.completed}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">저장된 review</div>
          <div className="kpi-value">{reviewSummary.reviews}</div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">admin</div>
          <strong style={{ fontSize: 24 }}>사용자 권한 및 승인 관리</strong>
          <div className="status note">
            이 화면은 `profiles`를 source of truth로 사용합니다. role 변경과 approved 토글은 모두 Supabase RLS 정책을 통과한 update로 반영됩니다.
          </div>
          {message ? <div className="status note">{message}</div> : null}
        </div>
      </article>

      <section className="subgrid-2">
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div className="chip">사용자 목록</div>
              <input
                className="field-input"
                style={{ width: 260 }}
                placeholder="이름, login_id, email 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <table className="table-like">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>login_id</th>
                  <th>email</th>
                  <th>role</th>
                  <th>approved</th>
                  <th>최근 수정</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => {
                  const draftRole = draftRoles[profile.id] ?? profile.role;
                  const draftApprovedValue = draftApproved[profile.id] ?? profile.approved;
                  const dirty =
                    draftRole !== profile.role || draftApprovedValue !== profile.approved;

                  return (
                    <tr key={profile.id}>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <strong>{profile.name}</strong>
                          <span className="muted">{profile.id}</span>
                        </div>
                      </td>
                      <td>{profile.loginId || "-"}</td>
                      <td>{profile.email}</td>
                      <td>
                        <div style={{ display: "grid", gap: 8 }}>
                          <strong
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "fit-content",
                              padding: "4px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              lineHeight: 1.2,
                              color: "#f8fbff",
                              border: "1px solid rgba(255,255,255,.14)",
                              background: "rgba(255,255,255,.06)",
                              ...(roleToneStyles[draftRole] ?? {}),
                            }}
                          >
                            {roleLabels[draftRole]}
                          </strong>
                          <select
                            className="field-select"
                            value={draftRole}
                            onChange={(event) =>
                              setDraftRoles((current) => ({
                                ...current,
                                [profile.id]: event.target.value as RoleOption,
                              }))
                            }
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {roleLabels[role]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td>
                        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={draftApprovedValue}
                            onChange={(event) =>
                              setDraftApproved((current) => ({
                                ...current,
                                [profile.id]: event.target.checked,
                              }))
                            }
                          />
                          <span>{draftApprovedValue ? "승인" : "대기"}</span>
                        </label>
                      </td>
                      <td>{formatDateTime(profile.updatedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!dirty || savingProfileId === profile.id}
                          onClick={async () => {
                            setSavingProfileId(profile.id);
                            const result = await updateAdminProfileAccess(profile.id, {
                              role: draftRole,
                              approved: draftApprovedValue,
                            });
                            setMessage(result.message);
                            if (result.ok) {
                              await refresh();
                            }
                            setSavingProfileId(null);
                          }}
                        >
                          저장
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!filteredProfiles.length ? (
              <div className="status note">{loading ? "불러오는 중입니다." : "표시할 사용자가 없습니다."}</div>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div className="chip">review 운영 현황</div>
            <table className="table-like">
              <thead>
                <tr>
                  <th>제출자</th>
                  <th>제출</th>
                  <th>assignment</th>
                  <th>review</th>
                </tr>
              </thead>
              <tbody>
                {reviewItems.slice(0, 20).map((item) => {
                  const currentReview =
                    item.reviewerId
                      ? item.reviews.find((review) => review.reviewerId === item.reviewerId) ?? item.reviews[0]
                      : item.reviews[0];

                  return (
                    <tr key={item.submissionId}>
                      <td>{item.authorName}</td>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <strong>{item.title || "(제목 없음)"}</strong>
                          <span className="muted">{item.type}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <strong>{item.reviewerName || "미배정"}</strong>
                          <span className="muted">{formatDateTime(item.assignedAt)}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "grid", gap: 6 }}>
                          <strong>{getReviewStatus(item)}</strong>
                          <span className="muted">총점 {currentReview?.total ?? 0}</span>
                          <span className="muted">{formatDateTime(currentReview?.completedAt)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!reviewItems.length ? (
              <div className="status note">{loading ? "불러오는 중입니다." : "review 데이터가 없습니다."}</div>
            ) : null}
          </div>
        </article>
      </section>
    </section>
  );
}
