"use client";

import type { SessionUser } from "@/lib/auth/storage";
import { getPortalSupabaseClient } from "@/lib/supabase/portal";

type PortalUsageEventType = "visit" | "page_view";

type PortalUsageFeatureDescriptor = {
  featureKey: string;
  featureLabel: string;
};

const PORTAL_USAGE_VISIT_KEY_PREFIX = "jtbc-portal-usage-visit";
const PORTAL_USAGE_PAGE_VIEW_KEY_PREFIX = "jtbc-portal-usage-page-view";
const VISIT_COOLDOWN_MS = 30 * 60_000;
const PAGE_VIEW_DEDUP_MS = 10_000;

const featureRules: Array<{
  match: (pathname: string) => boolean;
  featureKey: string;
  featureLabel: string;
}> = [
  { match: (pathname) => pathname === "/", featureKey: "home", featureLabel: "홈" },
  { match: (pathname) => pathname.startsWith("/community"), featureKey: "community", featureLabel: "커뮤니티" },
  { match: (pathname) => pathname.startsWith("/notices"), featureKey: "notices", featureLabel: "공지" },
  { match: (pathname) => pathname === "/vacation", featureKey: "vacation", featureLabel: "휴가 신청" },
  { match: (pathname) => pathname === "/submissions", featureKey: "submissions", featureLabel: "베스트리포트 제출" },
  { match: (pathname) => pathname.startsWith("/restaurants/new"), featureKey: "restaurants-new", featureLabel: "맛집 등록" },
  { match: (pathname) => /^\/restaurants\/[^/]+$/.test(pathname), featureKey: "restaurants-detail", featureLabel: "맛집 상세" },
  { match: (pathname) => pathname.startsWith("/restaurants"), featureKey: "restaurants", featureLabel: "내 주변 맛집" },
  { match: (pathname) => pathname === "/review", featureKey: "review", featureLabel: "베스트리포트 평가" },
  { match: (pathname) => pathname === "/admin", featureKey: "admin", featureLabel: "관리자" },
  { match: (pathname) => pathname.startsWith("/admin/news"), featureKey: "admin-news", featureLabel: "관리자 > 홈뉴스" },
  { match: (pathname) => pathname === "/team-lead", featureKey: "team-lead", featureLabel: "팀장" },
  { match: (pathname) => pathname.startsWith("/team-lead/overall-score-summary"), featureKey: "team-lead-overall-score-summary", featureLabel: "팀장 > 종합 점수 요약" },
  { match: (pathname) => pathname.startsWith("/team-lead/overall-score"), featureKey: "team-lead-overall-score", featureLabel: "팀장 > 종합 점수" },
  { match: (pathname) => pathname.startsWith("/team-lead/contribution"), featureKey: "team-lead-contribution", featureLabel: "팀장 > 기여도" },
  { match: (pathname) => pathname.startsWith("/team-lead/reviewer-management"), featureKey: "team-lead-reviewer-management", featureLabel: "팀장 > 평가자 관리" },
  { match: (pathname) => pathname.startsWith("/team-lead/reference-notes"), featureKey: "team-lead-reference-notes", featureLabel: "팀장 > 참고 메모" },
  { match: (pathname) => pathname.startsWith("/team-lead/schedule-assignment"), featureKey: "team-lead-schedule-assignment", featureLabel: "팀장 > 일정 배정" },
  { match: (pathname) => pathname.startsWith("/team-lead/domestic-trip"), featureKey: "team-lead-domestic-trip", featureLabel: "팀장 > 국내출장" },
  { match: (pathname) => pathname.startsWith("/team-lead/international-trip"), featureKey: "team-lead-international-trip", featureLabel: "팀장 > 해외출장" },
  { match: (pathname) => pathname.startsWith("/team-lead/final-cut"), featureKey: "team-lead-final-cut", featureLabel: "팀장 > 파이널컷" },
  { match: (pathname) => pathname.startsWith("/team-lead/special-report"), featureKey: "team-lead-special-report", featureLabel: "팀장 > 특종보고" },
  { match: (pathname) => pathname.startsWith("/team-lead/live-safety"), featureKey: "team-lead-live-safety", featureLabel: "팀장 > 생방안전" },
  { match: (pathname) => pathname.startsWith("/team-lead/broadcast-accident"), featureKey: "team-lead-broadcast-accident", featureLabel: "팀장 > 방송사고" },
  { match: (pathname) => pathname === "/schedule", featureKey: "schedule", featureLabel: "DESK" },
  { match: (pathname) => pathname.startsWith("/schedule/write"), featureKey: "schedule-write", featureLabel: "DESK > 일정 작성" },
  { match: (pathname) => pathname.startsWith("/schedule/schedule-assignment"), featureKey: "schedule-assignment", featureLabel: "DESK > 일정 배정" },
  { match: (pathname) => pathname.startsWith("/schedule/vacations"), featureKey: "schedule-vacations", featureLabel: "DESK > 휴가 현황" },
  { match: (pathname) => pathname.startsWith("/schedule/domestic-trip"), featureKey: "schedule-domestic-trip", featureLabel: "DESK > 국내출장" },
  { match: (pathname) => pathname.startsWith("/schedule/international-trip"), featureKey: "schedule-international-trip", featureLabel: "DESK > 해외출장" },
  { match: (pathname) => pathname.startsWith("/schedule/press-support"), featureKey: "schedule-press-support", featureLabel: "DESK > 지원" },
  { match: (pathname) => pathname.startsWith("/schedule/final-cut"), featureKey: "schedule-final-cut", featureLabel: "DESK > 파이널컷" },
  { match: (pathname) => pathname.startsWith("/schedule/health-checks"), featureKey: "schedule-health-checks", featureLabel: "DESK > 건강검진" },
  { match: (pathname) => pathname.startsWith("/schedule/long-service-leave"), featureKey: "schedule-long-service-leave", featureLabel: "DESK > 장기근속" },
];

function normalizePathname(pathname: string) {
  if (!pathname) return "/";
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "") || "/";
}

function readStorageNumber(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolvePortalUsageFeature(pathname: string): PortalUsageFeatureDescriptor {
  const normalizedPathname = normalizePathname(pathname);
  const matchedRule = featureRules.find((rule) => rule.match(normalizedPathname));
  if (matchedRule) {
    return {
      featureKey: matchedRule.featureKey,
      featureLabel: matchedRule.featureLabel,
    };
  }

  return {
    featureKey: `route:${normalizedPathname}`,
    featureLabel: normalizedPathname,
  };
}

function buildUsagePayload(session: SessionUser, pathname: string, eventType: PortalUsageEventType) {
  const normalizedPathname = normalizePathname(pathname);
  const feature = resolvePortalUsageFeature(normalizedPathname);

  return {
    user_id: session.id,
    user_name: session.username,
    user_login_id: session.loginId,
    user_role: session.actualRole ?? session.role,
    event_type: eventType,
    feature_key: feature.featureKey,
    feature_label: feature.featureLabel,
    route_path: normalizedPathname,
    day_key: formatPortalUsageDayKey(),
  };
}

async function insertPortalUsageEvent(session: SessionUser, pathname: string, eventType: PortalUsageEventType) {
  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("portal_usage_events").insert(buildUsagePayload(session, pathname, eventType));
  if (error) {
    throw error;
  }
}

export function formatPortalUsageDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function trackPortalVisit(session: SessionUser, pathname: string) {
  if (typeof window === "undefined" || !session.approved) return;

  const now = Date.now();
  const storageKey = `${PORTAL_USAGE_VISIT_KEY_PREFIX}:${session.id}`;
  const lastTrackedAt = readStorageNumber(window.localStorage, storageKey);
  if (now - lastTrackedAt < VISIT_COOLDOWN_MS) return;

  window.localStorage.setItem(storageKey, String(now));

  try {
    await insertPortalUsageEvent(session, pathname, "visit");
  } catch (error) {
    console.warn("portal usage visit tracking failed", error);
  }
}

export async function trackPortalPageView(session: SessionUser, pathname: string) {
  if (typeof window === "undefined" || !session.approved) return;

  const normalizedPathname = normalizePathname(pathname);
  const now = Date.now();
  const storageKey = `${PORTAL_USAGE_PAGE_VIEW_KEY_PREFIX}:${session.id}:${normalizedPathname}`;
  const lastTrackedAt = readStorageNumber(window.sessionStorage, storageKey);
  if (now - lastTrackedAt < PAGE_VIEW_DEDUP_MS) return;

  window.sessionStorage.setItem(storageKey, String(now));

  try {
    await insertPortalUsageEvent(session, normalizedPathname, "page_view");
  } catch (error) {
    console.warn("portal usage page view tracking failed", error);
  }
}
