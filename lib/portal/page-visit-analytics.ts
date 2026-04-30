"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

export type PageVisitKey = "community" | "work_schedule" | "restaurants";
export type PageVisitRange = "week" | "month";

export interface PageVisitMetric {
  pageKey: PageVisitKey;
  label: string;
  visits: number;
}

export interface PageVisitVisitorRank {
  profileId: string;
  name: string;
  visits: number;
}

export interface PageVisitAnalytics {
  week: PageVisitMetric[];
  month: PageVisitMetric[];
  monthlyTopVisitors: PageVisitVisitorRank[];
  schemaMissing: boolean;
  message: string | null;
}

interface PageVisitEventRow {
  profile_id: string;
  page_key: PageVisitKey;
  visited_at: string;
}

interface PageVisitProfileRow {
  id: string;
  name: string | null;
  login_id: string | null;
  email: string | null;
  role: string | null;
}

const PAGE_VISIT_TABLE = "page_visit_events";
const PAGE_VISIT_THROTTLE_MS = 5 * 60 * 1000;
const PAGE_VISIT_META: Record<PageVisitKey, { label: string; pathPrefixes: string[] }> = {
  community: {
    label: "커뮤니티",
    pathPrefixes: ["/community", "/notices"],
  },
  work_schedule: {
    label: "근무표",
    pathPrefixes: ["/work-schedule"],
  },
  restaurants: {
    label: "내 주변 맛집",
    pathPrefixes: ["/restaurants"],
  },
};

function resolvePageVisitKey(pathname: string): PageVisitKey | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const match = Object.entries(PAGE_VISIT_META).find(([, meta]) =>
    meta.pathPrefixes.some((prefix) => normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`)),
  );
  return (match?.[0] as PageVisitKey | undefined) ?? null;
}

function getThrottleStorageKey(profileId: string, pageKey: PageVisitKey) {
  return `jtbc-page-visit:${profileId}:${pageKey}`;
}

export async function recordPageVisit(pathname: string) {
  const pageKey = resolvePageVisitKey(pathname);
  if (!pageKey || typeof window === "undefined") return;

  const session = await getPortalSession();
  if (!session?.approved) return;

  const storageKey = getThrottleStorageKey(session.id, pageKey);
  const lastRecordedAt = Number(window.sessionStorage.getItem(storageKey));
  if (Number.isFinite(lastRecordedAt) && Date.now() - lastRecordedAt < PAGE_VISIT_THROTTLE_MS) {
    return;
  }

  window.sessionStorage.setItem(storageKey, String(Date.now()));

  try {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from(PAGE_VISIT_TABLE).insert({
      profile_id: session.id,
      page_key: pageKey,
      path: pathname,
    });

    if (error && !isSupabaseSchemaMissingError(error)) {
      console.warn("페이지 방문 기록 저장에 실패했습니다.", error);
    }
  } catch (error) {
    console.warn("페이지 방문 기록 저장에 실패했습니다.", error);
  }
}

function getRangeStartDate(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date;
}

function getCurrentMonthStartDate() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildMetrics(rows: PageVisitEventRow[], rangeStart: Date) {
  const rangeRows = rows.filter((row) => new Date(row.visited_at) >= rangeStart);
  const metrics = Object.entries(PAGE_VISIT_META).map(([pageKey, meta]) => {
    const pageRows = rangeRows.filter((row) => row.page_key === pageKey);
    return {
      pageKey: pageKey as PageVisitKey,
      label: meta.label,
      visits: pageRows.length,
    } satisfies PageVisitMetric;
  });

  return metrics;
}

function buildMonthlyTopVisitors(rows: PageVisitEventRow[], monthStart: Date, profileMap: Map<string, PageVisitProfileRow>) {
  const countMap = new Map<string, number>();

  rows
    .filter((row) => new Date(row.visited_at) >= monthStart)
    .filter((row) => {
      const role = profileMap.get(row.profile_id)?.role;
      return role !== "admin" && role !== "team_lead" && role !== "desk";
    })
    .forEach((row) => {
      countMap.set(row.profile_id, (countMap.get(row.profile_id) ?? 0) + 1);
    });

  return Array.from(countMap.entries())
    .map(([profileId, visits]) => {
      const profile = profileMap.get(profileId);
      return {
        profileId,
        name: profile?.name?.trim() || profile?.login_id?.trim() || profile?.email?.trim() || profileId,
        visits,
      } satisfies PageVisitVisitorRank;
    })
    .sort((left, right) => right.visits - left.visits || left.name.localeCompare(right.name, "ko"))
    .slice(0, 10);
}

export async function getAdminPageVisitAnalytics(): Promise<PageVisitAnalytics> {
  const session = await getPortalSession();
  if (!session?.approved || (session.role !== "admin" && session.role !== "team_lead")) {
    return {
      week: [],
      month: [],
      monthlyTopVisitors: [],
      schemaMissing: false,
      message: "방문 통계 조회 권한이 없습니다.",
    };
  }

  const monthStart = getCurrentMonthStartDate();
  const weekStart = getRangeStartDate(7);
  const queryStart = weekStart < monthStart ? weekStart : monthStart;

  try {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from(PAGE_VISIT_TABLE)
      .select("profile_id, page_key, visited_at")
      .gte("visited_at", queryStart.toISOString())
      .order("visited_at", { ascending: false })
      .returns<PageVisitEventRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        return {
          week: buildMetrics([], weekStart),
          month: buildMetrics([], monthStart),
          monthlyTopVisitors: [],
          schemaMissing: true,
          message: getSupabaseStorageErrorMessage(error, PAGE_VISIT_TABLE),
        };
      }
      throw new Error(error.message);
    }

    const rows = data ?? [];
    const profileIds = Array.from(new Set(rows.map((row) => row.profile_id)));
    const { data: profiles } =
      profileIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, name, login_id, email, role")
            .in("id", profileIds)
            .returns<PageVisitProfileRow[]>()
        : { data: [] as PageVisitProfileRow[] };
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile] as const));

    return {
      week: buildMetrics(rows, weekStart),
      month: buildMetrics(rows, monthStart),
      monthlyTopVisitors: buildMonthlyTopVisitors(rows, monthStart, profileMap),
      schemaMissing: false,
      message: null,
    };
  } catch (error) {
    return {
      week: buildMetrics([], weekStart),
      month: buildMetrics([], monthStart),
      monthlyTopVisitors: [],
      schemaMissing: false,
      message: error instanceof Error ? error.message : "방문 통계를 불러오지 못했습니다.",
    };
  }
}
