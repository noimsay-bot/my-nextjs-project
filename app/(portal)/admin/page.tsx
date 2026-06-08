"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdminProfileItem,
  deleteAdminProfile,
  getAdminWorkspace,
  updateAdminProfileAccess,
} from "@/lib/team-lead/storage";
import { getSession, hasAdminAccess, hasTeamLeadAccess } from "@/lib/auth/storage";
import {
  getElectionActivationState,
  setElectionActivation,
  type ElectionActivationState,
} from "@/lib/election/storage";
import {
  CUSTOMER_SUPPORT_ADMIN_COUNT_EVENT,
  deleteCustomerSupportMessage,
  getAdminCustomerSupportMessages,
  markCustomerSupportMessageProcessed,
  type CustomerSupportMessageWorkspace,
} from "@/lib/portal/customer-support";
import { getMemberLevelMap, type MemberLevelSnapshot } from "@/lib/portal/member-level";
import {
  getAdminPageVisitAnalytics,
  PageVisitAnalytics,
  PageVisitKey,
  PageVisitMetric,
  PageVisitVisitorRank,
  PageVisitRange,
  PageVisitTrendPoint,
} from "@/lib/portal/page-visit-analytics";

const roles = ["member", "outlet", "reviewer", "observer", "partner", "team_lead", "desk", "admin"] as const;
type RoleOption = (typeof roles)[number];

const roleLabels: Record<RoleOption, string> = {
  member: "팀원",
  outlet: "출입처",
  reviewer: "평가자",
  observer: "Observer",
  partner: "파트너",
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
  partner: {
    color: "#ddd6fe",
    border: "1px solid rgba(167,139,250,.42)",
    background: "rgba(139,92,246,.14)",
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
  partner: 5,
  observer: 6,
  member: 7,
};

function notifyCustomerSupportAdminCountChanged() {
  window.dispatchEvent(new Event(CUSTOMER_SUPPORT_ADMIN_COUNT_EVENT));
}

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
    title: "파트너",
    tone: roleToneStyles.partner ?? {},
    lines: [
      "파트너 전용 일정 화면에서 일정별 오디오맨과 수송부 이름만 입력할 수 있습니다.",
      "휴가 신청, 베스트리포트 제출, 근무표, 개인 마이페이지 정보는 볼 수 없습니다.",
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

function formatCustomerSupportRequester(item: CustomerSupportMessageWorkspace["items"][number]) {
  if (!item.requesterName || !item.requesterRole) return "익명 접수";
  return `${roleLabels[item.requesterRole]} ${item.requesterName}`;
}

const emptyPageVisitAnalytics: PageVisitAnalytics = {
  week: [],
  month: [],
  weeklyTrend: [],
  monthlyTrend: [],
  monthlyTopVisitors: [],
  schemaMissing: false,
  message: null,
};

const emptyCustomerSupportWorkspace: CustomerSupportMessageWorkspace = {
  items: [],
  schemaMissing: false,
  message: null,
};

const emptyElectionActivationState: ElectionActivationState = {
  isActive: false,
  eventId: null,
  title: "",
  electionDate: "",
  status: null,
  publishedAt: null,
  message: null,
};

const electionStatusLabels: Record<NonNullable<ElectionActivationState["status"]>, string> = {
  draft: "비활성",
  published: "활성",
  closed: "종료",
};

function getCustomerSupportWorkspaceWithoutHiddenItems(
  workspace: CustomerSupportMessageWorkspace,
  hiddenIds: Set<string>,
): CustomerSupportMessageWorkspace {
  if (hiddenIds.size === 0) return workspace;
  return {
    ...workspace,
    items: workspace.items.filter((item) => !hiddenIds.has(item.id)),
  };
}

function compareCustomerSupportMessageCreatedAtDesc(
  left: CustomerSupportMessageWorkspace["items"][number],
  right: CustomerSupportMessageWorkspace["items"][number],
) {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
  const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : 0;
  return normalizedRightTime - normalizedLeftTime;
}

const visitRangeLabels: Record<PageVisitRange, string> = {
  week: "최근 7일",
  month: "이번 달",
};

const pageVisitLineStyles: Record<PageVisitKey, { color: string; muted: string }> = {
  me: { color: "#38bdf8", muted: "rgba(56,189,248,.16)" },
  community: { color: "#a78bfa", muted: "rgba(167,139,250,.16)" },
  work_schedule: { color: "#34d399", muted: "rgba(52,211,153,.16)" },
  restaurants: { color: "#fbbf24", muted: "rgba(251,191,36,.16)" },
  equipment: { color: "#fb7185", muted: "rgba(251,113,133,.16)" },
  election_internal: { color: "#22c55e", muted: "rgba(34,197,94,.16)" },
  election_external: { color: "#f97316", muted: "rgba(249,115,22,.16)" },
};

const visitAnalyticsPageLabels: Record<PageVisitKey, string> = {
  me: "마이페이지",
  community: "커뮤니티",
  work_schedule: "근무표",
  restaurants: "내 주변 맛집",
  equipment: "TVU/장비",
  election_internal: "선거(내부)",
  election_external: "선거(외부)",
};

const visitAnalyticsPageKeys = Object.keys(pageVisitLineStyles) as PageVisitKey[];

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

function PageVisitTrendChart({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: PageVisitTrendPoint[];
}) {
  const pageSeries = visitAnalyticsPageKeys.map((pageKey) => ({
    pageKey,
    label: visitAnalyticsPageLabels[pageKey],
    visits: rows.map((row) => row.visitsByPage[pageKey] ?? 0),
  }));
  const maxVisits = Math.max(...pageSeries.flatMap((series) => series.visits), 1);
  const totalVisits = rows.reduce((sum, row) => sum + row.visits, 0);
  const svgWidth = 640;
  const svgHeight = 232;
  const chartLeft = 34;
  const chartRight = 18;
  const chartTop = 18;
  const chartBottom = 44;
  const chartWidth = svgWidth - chartLeft - chartRight;
  const chartHeight = svgHeight - chartTop - chartBottom;
  const getX = (index: number) =>
    rows.length <= 1 ? chartLeft + chartWidth / 2 : chartLeft + (chartWidth / (rows.length - 1)) * index;
  const getY = (visits: number) => chartTop + chartHeight - (visits / maxVisits) * chartHeight;
  const gridValues = Array.from(
    new Set([0, Math.ceil(maxVisits / 2), maxVisits].filter((value) => Number.isFinite(value))),
  ).sort((left, right) => left - right);

  return (
    <article
      style={{
        display: "grid",
        gap: 14,
        padding: 16,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.03)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 18 }}>{title}</strong>
          <span className="muted" style={{ fontSize: 12 }}>{subtitle}</span>
        </div>
        <strong style={{ color: "#bae6fd" }}>{totalVisits}회</strong>
      </div>
      <div
        style={{
          display: "grid",
          gap: 12,
          minHeight: 248,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,.08)",
          background: "linear-gradient(180deg, rgba(15,23,42,.16), rgba(15,23,42,.36))",
        }}
      >
        <svg
          role="img"
          aria-label={`${title} 페이지별 꺾은선 그래프, 전체 ${totalVisits}회`}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: 232, display: "block", overflow: "visible" }}
        >
          {gridValues.map((value) => {
            const y = getY(value);
            return (
              <g key={`grid-${value}`}>
                <line x1={chartLeft} y1={y} x2={svgWidth - chartRight} y2={y} stroke="rgba(148,163,184,.22)" strokeWidth="1" />
                <text x={chartLeft - 8} y={y + 4} textAnchor="end" fill="rgba(226,232,240,.72)" fontSize="11" fontWeight="800">
                  {value}
                </text>
              </g>
            );
          })}
          {rows.map((row, index) => (
            <g key={`axis-${row.key}`}>
              <line x1={getX(index)} y1={chartTop} x2={getX(index)} y2={chartTop + chartHeight} stroke="rgba(148,163,184,.12)" strokeWidth="1" />
              <text x={getX(index)} y={svgHeight - 16} textAnchor="middle" fill="rgba(226,232,240,.78)" fontSize="11" fontWeight="800">
                {row.label}
              </text>
            </g>
          ))}
          {pageSeries.map((series) => {
            const style = pageVisitLineStyles[series.pageKey];
            const points = series.visits.map((visits, index) => `${getX(index)},${getY(visits)}`).join(" ");
            return (
              <g key={series.pageKey}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={style.muted}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke={style.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {series.visits.map((visits, index) => (
                  <g key={`${series.pageKey}-${rows[index]?.key ?? index}`}>
                    <circle cx={getX(index)} cy={getY(visits)} r="4" fill="#0f172a" stroke={style.color} strokeWidth="2" />
                    {visits > 0 ? (
                      <text x={getX(index)} y={getY(visits) - 8} textAnchor="middle" fill={style.color} fontSize="10" fontWeight="900">
                        {visits}
                      </text>
                    ) : null}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {pageSeries.map((series) => {
            const style = pageVisitLineStyles[series.pageKey];
            const latestVisits = series.visits[series.visits.length - 1] ?? 0;
            return (
              <span
                key={series.pageKey}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 26,
                  padding: "5px 8px",
                  borderRadius: 999,
                  border: `1px solid ${style.color}`,
                  background: style.muted,
                  color: "#f8fbff",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: style.color }} />
                {series.label} {latestVisits}회
              </span>
            );
          })}
        </div>
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
  const session = getSession();
  const actualRole = session?.actualRole ?? session?.role;
  const canManageRoles = hasTeamLeadAccess(actualRole);
  const canManageElectionActivation = hasAdminAccess(actualRole);
  const [profiles, setProfiles] = useState<AdminProfileItem[]>([]);
  const [memberLevelMap, setMemberLevelMap] = useState<Map<string, MemberLevelSnapshot>>(new Map());
  const [visitAnalytics, setVisitAnalytics] = useState<PageVisitAnalytics>(emptyPageVisitAnalytics);
  const [customerSupport, setCustomerSupport] =
    useState<CustomerSupportMessageWorkspace>(emptyCustomerSupportWorkspace);
  const [electionActivation, setElectionActivationState] =
    useState<ElectionActivationState>(emptyElectionActivationState);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [savingElectionActivation, setSavingElectionActivation] = useState(false);
  const [processingSupportId, setProcessingSupportId] = useState<string | null>(null);
  const [deletingSupportId, setDeletingSupportId] = useState<string | null>(null);
  const [expandedProcessedSupportIds, setExpandedProcessedSupportIds] = useState<Set<string>>(() => new Set());
  const [customerSupportFeedbackDrafts, setCustomerSupportFeedbackDrafts] = useState<Record<string, string>>({});
  const [draftRoles, setDraftRoles] = useState<Record<string, RoleOption>>({});
  const hiddenCustomerSupportIdsRef = useRef<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    try {
      const [workspace, analytics, customerSupportWorkspace, electionActivationState] = await Promise.all([
        getAdminWorkspace(),
        getAdminPageVisitAnalytics(),
        getAdminCustomerSupportMessages(),
        getElectionActivationState(),
      ]);
      const nextMemberLevelMap = await getMemberLevelMap(workspace.profiles.map((profile) => profile.id));
      setProfiles(workspace.profiles);
      setMemberLevelMap(nextMemberLevelMap);
      setVisitAnalytics(analytics);
      setCustomerSupport(getCustomerSupportWorkspaceWithoutHiddenItems(
        customerSupportWorkspace,
        hiddenCustomerSupportIdsRef.current,
      ));
      setElectionActivationState(electionActivationState);
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

  const openCustomerSupportCount = useMemo(
    () => customerSupport.items.filter((item) => item.status !== "processed").length,
    [customerSupport.items],
  );

  function updateCustomerSupportFeedbackDraft(messageId: string, value: string) {
    setCustomerSupportFeedbackDrafts((current) => ({
      ...current,
      [messageId]: value,
    }));
  }

  async function handleCustomerSupportProcessed(messageId: string) {
    setProcessingSupportId(messageId);
    setMessage("");
    const result = await markCustomerSupportMessageProcessed(messageId, customerSupportFeedbackDrafts[messageId] ?? "");
    setProcessingSupportId(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setExpandedProcessedSupportIds((current) => {
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
    setCustomerSupportFeedbackDrafts((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    setMessage(result.message);
    await refresh();
    notifyCustomerSupportAdminCountChanged();
  }

  async function handleCustomerSupportDelete(messageId: string) {
    if (hiddenCustomerSupportIdsRef.current.has(messageId)) return;
    const removedItem = customerSupport.items.find((item) => item.id === messageId) ?? null;
    hiddenCustomerSupportIdsRef.current.add(messageId);
    setDeletingSupportId(messageId);
    setMessage("");
    setCustomerSupport((current) => getCustomerSupportWorkspaceWithoutHiddenItems(
      current,
      hiddenCustomerSupportIdsRef.current,
    ));
    setExpandedProcessedSupportIds((current) => {
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
    setCustomerSupportFeedbackDrafts((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    const result = await deleteCustomerSupportMessage(messageId);
    setDeletingSupportId((current) => (current === messageId ? null : current));
    if (!result.ok) {
      hiddenCustomerSupportIdsRef.current.delete(messageId);
      if (removedItem) {
        setCustomerSupport((current) => {
          if (current.items.some((item) => item.id === messageId)) return current;
          return {
            ...current,
            items: [...current.items, removedItem].sort(compareCustomerSupportMessageCreatedAtDesc),
          };
        });
      } else {
        void refresh();
      }
      setMessage(result.message);
      return;
    }
    setMessage(result.message);
    void refresh();
    notifyCustomerSupportAdminCountChanged();
  }

  function toggleProcessedCustomerSupport(messageId: string) {
    setExpandedProcessedSupportIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  async function handleElectionActivation(nextActive: boolean) {
    setSavingElectionActivation(true);
    setMessage("");
    try {
      const result = await setElectionActivation(nextActive);
      setElectionActivationState(result.state);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "선거 활성화 상태를 변경하지 못했습니다.");
    } finally {
      setSavingElectionActivation(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">고객센터</div>
              <strong style={{ fontSize: 22 }}>접수 내용</strong>
            </div>
            <span className="muted">
              미처리 {openCustomerSupportCount}건 · 최근 접수 {customerSupport.items.length}건
            </span>
          </div>
          {customerSupport.message ? (
            <div className={`status ${customerSupport.schemaMissing ? "warn" : "note"}`}>
              {customerSupport.message}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 10 }}>
            {customerSupport.items.length > 0 ? (
              customerSupport.items.map((item) => {
                const isProcessed = item.status === "processed";
                const isExpanded = !isProcessed || expandedProcessedSupportIds.has(item.id);
                const isDeleting = deletingSupportId === item.id;
                return (
                  <article
                    key={item.id}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 14,
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,.08)",
                      background: "rgba(255,255,255,.03)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <strong>{formatCustomerSupportRequester(item)}</strong>
                        <span className={`customer-support-status customer-support-status--${item.status}`}>
                          {isProcessed ? "처리완료" : "접수"}
                        </span>
                      </div>
                      <span className="muted">{formatDateTime(item.createdAt)}</span>
                    </div>
                    {isExpanded ? (
                      <>
                        <p
                          style={{
                            margin: 0,
                            lineHeight: 1.65,
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {item.body}
                        </p>
                        {item.attachments.length > 0 ? (
                          <div className="customer-support-admin-attachments">
                            {item.attachments.map((attachment) => (
                              <a
                                key={attachment.path}
                                href={attachment.url ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                aria-disabled={!attachment.url}
                              >
                                {attachment.url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={attachment.url} alt={attachment.name} />
                                ) : (
                                  <span>사진을 불러올 수 없습니다.</span>
                                )}
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {isProcessed ? (
                          item.processedFeedback ? (
                            <div className="status ok" style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                              피드백: {item.processedFeedback}
                            </div>
                          ) : null
                        ) : (
                          <label style={{ display: "grid", gap: 6 }}>
                            <span className="muted" style={{ fontSize: 12, fontWeight: 900 }}>
                              처리 피드백
                            </span>
                            <textarea
                              className="field-textarea"
                              value={customerSupportFeedbackDrafts[item.id] ?? ""}
                              maxLength={1000}
                              placeholder="문의자에게 보여줄 처리 내용이나 안내를 작성하세요."
                              style={{ minHeight: 84, lineHeight: 1.55 }}
                              disabled={processingSupportId === item.id || isDeleting}
                              onChange={(event) => updateCustomerSupportFeedbackDraft(item.id, event.target.value)}
                            />
                          </label>
                        )}
                      </>
                    ) : (
                      <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.body}
                      </span>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted">
                        {isProcessed
                          ? `처리 ${item.processedAt ? formatDateTime(item.processedAt) : ""}${item.processedByName ? ` · ${item.processedByName}` : ""}`
                          : "처리 대기"}
                      </span>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {isProcessed ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => toggleProcessedCustomerSupport(item.id)}
                          >
                            {isExpanded ? "접기" : "펼치기"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn"
                          disabled={isDeleting || processingSupportId === item.id}
                          onClick={() => void handleCustomerSupportDelete(item.id)}
                        >
                          {isDeleting ? "삭제 중" : "삭제"}
                        </button>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={isProcessed || processingSupportId === item.id || isDeleting}
                          onClick={() => void handleCustomerSupportProcessed(item.id)}
                        >
                          {isProcessed ? "처리완료됨" : processingSupportId === item.id ? "처리 중" : "처리완료"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="status note">{loading ? "불러오는 중입니다." : "접수된 고객센터 내용이 없습니다."}</div>
            )}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">선거</div>
              <strong style={{ fontSize: 22 }}>선거 페이지 상태</strong>
            </div>
            <strong
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "fit-content",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 13,
                color: electionActivation.isActive ? "#bbf7d0" : "#fecaca",
                border: electionActivation.isActive
                  ? "1px solid rgba(74,222,128,.42)"
                  : "1px solid rgba(248,113,113,.42)",
                background: electionActivation.isActive
                  ? "rgba(34,197,94,.12)"
                  : "rgba(239,68,68,.12)",
              }}
            >
              {electionActivation.isActive ? "활성" : "비활성"}
            </strong>
          </div>
          {electionActivation.message ? <div className="status note">{electionActivation.message}</div> : null}
          <div className="subgrid-2">
            <article
              style={{
                display: "grid",
                gap: 8,
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(255,255,255,.03)",
              }}
            >
              <span className="muted">중계표</span>
              <strong>{electionActivation.title || "등록된 선거 중계표 없음"}</strong>
              <span className="muted">
                {electionActivation.electionDate || "-"} · {electionActivation.status ? electionStatusLabels[electionActivation.status] : "-"}
              </span>
            </article>
            <article
              style={{
                display: "grid",
                gap: 8,
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(255,255,255,.03)",
              }}
            >
              <span className="muted">게시 시각</span>
              <strong>{formatDateTime(electionActivation.publishedAt)}</strong>
              <span className="muted">사이드바 메뉴는 숨김 상태로 유지됩니다.</span>
            </article>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link href="/election" className="btn">
              선거 페이지 열기
            </Link>
            <button
              type="button"
              className="btn"
              disabled={!canManageElectionActivation || savingElectionActivation || !electionActivation.isActive}
              onClick={() => void handleElectionActivation(false)}
            >
              {savingElectionActivation && electionActivation.isActive ? "변경 중" : "비활성화"}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canManageElectionActivation || savingElectionActivation || electionActivation.isActive || !electionActivation.eventId}
              onClick={() => void handleElectionActivation(true)}
            >
              {savingElectionActivation && !electionActivation.isActive ? "변경 중" : "활성화"}
            </button>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          {message ? <div className="status note">{message}</div> : null}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">등급별 권한</div>
            <Link href="/admin/celebrations" className="btn primary">
              축하 현수막 관리
            </Link>
          </div>
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
            <span className="muted">마이페이지 · 커뮤니티 · 근무표 · 내 주변 맛집 · TVU/장비 · 선거(내부/외부)</span>
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
          <div className="subgrid-2">
            <PageVisitTrendChart
              title="주별 방문 그래프"
              subtitle="최근 8주 전체 방문 추이"
              rows={visitAnalytics.weeklyTrend}
            />
            <PageVisitTrendChart
              title="월별 방문 그래프"
              subtitle="최근 6개월 전체 방문 추이"
              rows={visitAnalytics.monthlyTrend}
            />
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
