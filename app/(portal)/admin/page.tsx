"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AdminProfileItem,
  deleteAdminProfile,
  getAdminWorkspace,
  updateAdminProfileAccess,
} from "@/lib/team-lead/storage";
import { getSession, hasTeamLeadAccess } from "@/lib/auth/storage";
import { getMemberLevelMap, type MemberLevelSnapshot } from "@/lib/portal/member-level";
import {
  getAdminPageVisitAnalytics,
  PageVisitAnalytics,
  PageVisitMetric,
  PageVisitVisitorRank,
  PageVisitRange,
} from "@/lib/portal/page-visit-analytics";

const roles = ["member", "outlet", "reviewer", "observer", "team_lead", "desk", "admin"] as const;
type RoleOption = (typeof roles)[number];

const roleLabels: Record<RoleOption, string> = {
  member: "팀원",
  outlet: "출입처",
  reviewer: "평가자",
  observer: "Observer",
  team_lead: "총괄팀장",
  desk: "DESK",
  admin: "관리자",
};

const roleToneStyles: Partial<Record<RoleOption, CSSProperties>> = {
  reviewer: {
    color: "#fff1bf",
    border: "1px solid rgba(250,204,21,.45)",
    background: "rgba(250,204,21,.16)",
  },
  outlet: {
    color: "#bbf7d0",
    border: "1px solid rgba(74,222,128,.42)",
    background: "rgba(34,197,94,.12)",
  },
  observer: {
    color: "#bae6fd",
    border: "1px solid rgba(56,189,248,.42)",
    background: "rgba(14,165,233,.12)",
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
  outlet: 4,
  observer: 5,
  member: 6,
};

const permissionGuides = [
  {
    title: "팀원",
    tone: {} as CSSProperties,
    lines: [
      "홈, 휴가 신청, 베스트리포트 제출 화면을 사용할 수 있습니다.",
      "근무 관리, 총괄팀장 페이지, 관리자 페이지는 들어갈 수 없습니다.",
    ],
  },
  {
    title: "평가자",
    tone: roleToneStyles.reviewer ?? {},
    lines: [
      "기존 팀원 등급은 그대로 유지됩니다.",
      "총괄팀장이 지정하면 베스트리포트 평가 메뉴가 열리고 `/review`에서 평가와 저장이 가능합니다.",
    ],
  },
  {
    title: "출입처",
    tone: roleToneStyles.outlet ?? {},
    lines: [
      "팀원과 같은 메뉴와 신청 권한을 사용할 수 있습니다.",
      "총괄팀장 개인별 점수와 종합점수 명단에는 포함되지 않습니다.",
    ],
  },
  {
    title: "Observer",
    tone: roleToneStyles.observer ?? {},
    lines: [
      "팀원 접근 페이지를 조회만 할 수 있는 읽기 전용 등급입니다.",
      "휴가 신청, 베스트리포트 제출, 댓글 작성 같은 변경 작업은 모두 막힙니다.",
    ],
  },
  {
    title: "총괄팀장",
    tone: roleToneStyles.team_lead ?? {},
    lines: [
      "관리자 페이지를 포함한 전체 메뉴를 사용할 수 있습니다.",
      "홈, 휴가 신청, 베스트리포트 제출·평가, DESK, 총괄팀장 기능과 사용자 관리까지 모두 사용할 수 있습니다.",
    ],
  },
  {
    title: "DESK",
    tone: roleToneStyles.desk ?? {},
    lines: [
      "팀원이 가진 권한에 더해 DESK 페이지의 모든 기능을 사용할 수 있습니다.",
      "리뷰 화면과 총괄팀장/관리자 기능은 사용할 수 없습니다.",
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
      "관리자 페이지와 기본 포털 기능을 사용할 수 있습니다.",
      "DESK는 근무표 관리 페이지만 사용할 수 있고, 총괄팀장 페이지와 권한 변경 기능은 사용할 수 없습니다.",
    ],
  },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

const emptyPageVisitAnalytics: PageVisitAnalytics = {
  week: [],
  month: [],
  monthlyTopVisitors: [],
  schemaMissing: false,
  message: null,
};

const visitRangeLabels: Record<PageVisitRange, string> = {
  week: "최근 7일",
  month: "이번 달",
};

function PageVisitChart({
  title,
  rows,
}: {
  title: string;
  rows: PageVisitMetric[];
}) {
  const maxVisits = Math.max(...rows.map((row) => row.visits), 1);

  return (
    <article
      style={{
        display: "grid",
        gap: 12,
        padding: 16,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.03)",
      }}
    >
      <strong style={{ fontSize: 18 }}>{title}</strong>
      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((row) => {
          const width = `${Math.max(4, Math.round((row.visits / maxVisits) * 100))}%`;
          return (
            <div key={row.pageKey} style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <strong>{row.label}</strong>
                <span className="muted">방문 {row.visits}회</span>
              </div>
              <div
                aria-label={`${row.label} ${title} 방문 ${row.visits}회`}
                style={{
                  position: "relative",
                  height: 16,
                  overflow: "hidden",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: "rgba(15,23,42,.38)",
                }}
              >
                <div
                  style={{
                    width,
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg, rgba(56,189,248,.82), rgba(125,211,252,.96))",
                    boxShadow: row.visits > 0 ? "0 0 14px rgba(56,189,248,.32)" : "none",
                    transition: "width .2s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function MonthlyVisitorRanking({ rows }: { rows: PageVisitVisitorRank[] }) {
  return (
    <article
      style={{
        display: "grid",
        gap: 12,
        padding: 16,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.03)",
      }}
    >
      <strong style={{ fontSize: 18 }}>이번 달 방문 순위</strong>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.length > 0 ? (
          rows.map((row, index) => (
            <div
              key={row.profileId}
              style={{
                display: "grid",
                gridTemplateColumns: "44px minmax(0, 1fr) auto",
                gap: 10,
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(15,23,42,.22)",
              }}
            >
              <strong style={{ color: "#bae6fd" }}>{index + 1}등</strong>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.name}
              </span>
              <strong>{row.visits}회</strong>
            </div>
          ))
        ) : (
          <div className="status note">이번 달 방문 기록이 없습니다.</div>
        )}
      </div>
    </article>
  );
}

export default function AdminPage() {
  const canManageRoles = hasTeamLeadAccess(getSession()?.actualRole ?? getSession()?.role);
  const [profiles, setProfiles] = useState<AdminProfileItem[]>([]);
  const [memberLevelMap, setMemberLevelMap] = useState<Map<string, MemberLevelSnapshot>>(new Map());
  const [visitAnalytics, setVisitAnalytics] = useState<PageVisitAnalytics>(emptyPageVisitAnalytics);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Record<string, RoleOption>>({});

  async function refresh() {
    setLoading(true);
    try {
      const [workspace, analytics] = await Promise.all([
        getAdminWorkspace(),
        getAdminPageVisitAnalytics(),
      ]);
      const nextMemberLevelMap = await getMemberLevelMap(workspace.profiles.map((profile) => profile.id));
      setProfiles(workspace.profiles);
      setMemberLevelMap(nextMemberLevelMap);
      setVisitAnalytics(analytics);
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
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">방문 통계</div>
              <strong style={{ fontSize: 22 }}>주요 페이지 방문 현황</strong>
            </div>
            <span className="muted">커뮤니티 · 근무표 · 내 주변 맛집</span>
          </div>
          {visitAnalytics.message ? (
            <div className={`status ${visitAnalytics.schemaMissing ? "warn" : "note"}`}>
              {visitAnalytics.message}
            </div>
          ) : null}
          <div className="subgrid-2">
            <PageVisitChart title={visitRangeLabels.week} rows={visitAnalytics.week} />
            <PageVisitChart title={visitRangeLabels.month} rows={visitAnalytics.month} />
          </div>
          <MonthlyVisitorRanking rows={visitAnalytics.monthlyTopVisitors} />
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
                <th>레벨</th>
                <th>최근 수정</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => {
                const draftRole = draftRoles[profile.id] ?? profile.role;
                const memberLevel = memberLevelMap.get(profile.id);
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
                        {canManageRoles ? (
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
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <strong>Lv {memberLevel?.level ?? 1}</strong>
                        <span className="muted">{memberLevel?.totalPoints ?? 0}점</span>
                      </div>
                    </td>
                    <td>{formatDateTime(profile.updatedAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {canManageRoles ? (
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
                        ) : null}
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
