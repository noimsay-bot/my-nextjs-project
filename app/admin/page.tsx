"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AdminProfileItem,
  deleteAdminProfile,
  getAdminWorkspace,
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

const adminRoleOrder: Record<RoleOption, number> = {
  team_lead: 0,
  desk: 1,
  admin: 2,
  reviewer: 3,
  member: 4,
};

const permissionGuides = [
  {
    title: "멤버",
    tone: {} as CSSProperties,
    lines: [
      "홈, 휴가 신청, 베스트리포트 제출 화면을 사용할 수 있습니다.",
      "근무 관리, 팀장 페이지, 관리자 페이지는 들어갈 수 없습니다.",
    ],
  },
  {
    title: "평가자",
    tone: roleToneStyles.reviewer ?? {},
    lines: [
      "기존 멤버 등급은 그대로 유지됩니다.",
      "팀장이 지정하면 베스트리포트 평가 메뉴가 열리고 `/review`에서 평가와 저장이 가능합니다.",
    ],
  },
  {
    title: "팀장",
    tone: roleToneStyles.team_lead ?? {},
    lines: [
      "관리자 페이지를 제외한 모든 메뉴를 사용할 수 있습니다.",
      "홈, 휴가 신청, 베스트리포트 제출·평가, DESK, 팀장 기능 전체를 사용할 수 있습니다.",
    ],
  },
  {
    title: "DESK",
    tone: roleToneStyles.desk ?? {},
    lines: [
      "멤버가 가진 권한에 더해 DESK 페이지의 모든 기능을 사용할 수 있습니다.",
      "리뷰 화면과 팀장/관리자 기능은 사용할 수 없습니다.",
    ],
  },
  {
    title: "관리자",
    tone: {
      color: "#dbeafe",
      border: "1px solid rgba(255,255,255,.18)",
      background: "rgba(255,255,255,.08)",
    } as CSSProperties,
    lines: [
      "모든 메뉴 접근과 사용자 role/승인 관리가 가능합니다.",
      "베스트리포트 평가, 팀장 기능, DESK 기능을 모두 사용할 수 있습니다.",
    ],
  },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<AdminProfileItem[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Record<string, RoleOption>>({});

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getAdminWorkspace();
      setProfiles(workspace.profiles);
      setDraftRoles(
        Object.fromEntries(workspace.profiles.map((profile) => [profile.id, profile.role])),
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
    const visibleProfiles = !keyword
      ? profiles
      : profiles.filter((profile) =>
          [profile.name, profile.loginId, profile.email, profile.role]
            .join(" ")
            .toLowerCase()
            .includes(keyword),
        );

    return [...visibleProfiles].sort((left, right) => {
      const leftRank = adminRoleOrder[left.role] ?? Number.MAX_SAFE_INTEGER;
      const rightRank = adminRoleOrder[right.role] ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name, "ko");
    });
  }, [profiles, query]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          {message ? <div className="status note">{message}</div> : null}
          <div className="chip">등급별 권한</div>
          <div className="subgrid-2">
            {permissionGuides.map((guide) => (
              <article
                key={guide.title}
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 16,
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: "rgba(255,255,255,.03)",
                }}
              >
                <strong
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "fit-content",
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    color: "#f8fbff",
                    border: "1px solid rgba(255,255,255,.14)",
                    background: "rgba(255,255,255,.06)",
                    ...(guide.tone ?? {}),
                  }}
                >
                  {guide.title}
                </strong>
                <div style={{ display: "grid", gap: 6 }}>
                  {guide.lines.map((line) => (
                    <div key={line} className="muted" style={{ lineHeight: 1.6 }}>
                      {line}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div className="chip">사용자 목록</div>
              <span className="muted">전체 사용자 {profiles.length}명</span>
            </div>
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
                <th>최근 수정</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => {
                const draftRole = draftRoles[profile.id] ?? profile.role;
                const dirty = draftRole !== profile.role;

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
                    <td>{formatDateTime(profile.updatedAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!dirty || savingProfileId === profile.id}
                          onClick={async () => {
                            setSavingProfileId(profile.id);
                            const result = await updateAdminProfileAccess(profile.id, {
                              role: draftRole,
                              approved: profile.approved,
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
                        <button
                          type="button"
                          className="btn"
                          disabled={savingProfileId === profile.id}
                          onClick={async () => {
                            const confirmed = window.confirm("탈퇴 처리하시겠습니까?");
                            if (!confirmed) return;
                            setSavingProfileId(profile.id);
                            const result = await deleteAdminProfile(profile.id);
                            setMessage(result.message);
                            if (result.ok) {
                              await refresh();
                            }
                            setSavingProfileId(null);
                          }}
                        >
                          탈퇴
                        </button>
                      </div>
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
    </section>
  );
}
