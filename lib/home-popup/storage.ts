"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

const HOME_POPUP_NOTICE_ROW_KEY = "active";
const HOME_NOTICE_STORE_VERSION = 2;

export const HOME_POPUP_NOTICE_EVENT = "j-home-popup-notice-updated";
export const HOME_POPUP_NOTICE_STATUS_EVENT = "j-home-popup-notice-status";

export type HomeNoticeKind = "general" | "popup";
export type HomeNoticeTone = "normal" | "urgent";

export interface HomeNotice {
  id: string;
  title: string;
  body: string;
  kind: HomeNoticeKind;
  tone: HomeNoticeTone;
  isActive: boolean;
  applicationEnabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomePopupNotice extends HomeNotice {
  kind: "popup";
}

export interface HomePopupNoticeApplication {
  id: string;
  noticeId: string;
  applicantId: string;
  applicantName: string;
  createdAt: string;
}

interface HomePopupNoticeStateRow {
  key: string;
  notice_id: string;
  title: string;
  body: string;
  is_active: boolean;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface HomePopupNoticeApplicationRow {
  id: string;
  notice_id: string;
  applicant_id: string;
  applicant_name: string;
  created_at: string;
}

interface HomeNoticeStorePayload {
  version: number;
  notices: HomeNotice[];
}

type RefreshResult = {
  notice: HomePopupNotice | null;
  notices: HomeNotice[];
  applications: HomePopupNoticeApplication[];
};

let noticeCache: HomePopupNotice | null = null;
let noticeListCache: HomeNotice[] = [];
let applicationCache: HomePopupNoticeApplication[] = [];
let currentUserAppliedCache = false;
let refreshPromise: Promise<RefreshResult> | null = null;

function isManagerRole(role: string | null | undefined) {
  return role === "desk" || role === "admin" || role === "team_lead";
}

function emitHomePopupNoticeEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HOME_POPUP_NOTICE_EVENT));
}

function emitHomePopupNoticeStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HOME_POPUP_NOTICE_STATUS_EVENT, { detail }));
}

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return false;
  return time <= Date.now();
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";
  const hint = typeof record.hint === "string" ? record.hint : "";
  const combined = `${message}\n${details}\n${hint}`.toLowerCase();
  return combined.includes(columnName.toLowerCase()) && combined.includes("does not exist");
}

function isMissingExpiresAtColumnError(error: unknown) {
  return isMissingColumnError(error, "expires_at");
}

function isMissingAuditColumnError(error: unknown) {
  return isMissingColumnError(error, "created_by") || isMissingColumnError(error, "updated_by");
}

function clonePopupNotice(notice: HomePopupNotice | null) {
  return notice ? { ...notice } : null;
}

function cloneNoticeList(notices: HomeNotice[]) {
  return notices.map((notice) => ({ ...notice }));
}

function cloneApplications(applications: HomePopupNoticeApplication[]) {
  return applications.map((application) => ({ ...application }));
}

function normalizeTone(value: unknown): HomeNoticeTone {
  return value === "urgent" ? "urgent" : "normal";
}

function normalizeKind(value: unknown): HomeNoticeKind {
  return value === "general" ? "general" : "popup";
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function normalizeHomeNotice(input: Partial<HomeNotice> & { id: string; title: string; body: string }): HomeNotice {
  const fallbackDate = new Date().toISOString();
  const kind = normalizeKind(input.kind);
  const expiresAt =
    typeof input.expiresAt === "string" && input.expiresAt.trim()
      ? normalizeIsoDate(input.expiresAt, "")
      : null;

  return {
    id: input.id,
    title: input.title.trim(),
    body: input.body.trim(),
    kind,
    tone: normalizeTone(input.tone),
    isActive: kind === "popup" ? Boolean(input.isActive) && !isExpired(expiresAt) : true,
    applicationEnabled: kind === "popup" ? Boolean(input.applicationEnabled) : false,
    expiresAt,
    createdAt: normalizeIsoDate(input.createdAt, fallbackDate),
    updatedAt: normalizeIsoDate(input.updatedAt, fallbackDate),
  };
}

function sortNotices(notices: HomeNotice[]) {
  return [...notices].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function getActivePopupNotice(notices: HomeNotice[]) {
  const popup = notices.find((notice) => notice.kind === "popup" && notice.isActive && !isExpired(notice.expiresAt));
  return popup ? ({ ...popup, kind: "popup" } as HomePopupNotice) : null;
}

function rowToLegacyNotice(row: HomePopupNoticeStateRow | null | undefined) {
  if (!row?.notice_id || !row.title.trim() || !row.body.trim()) return [] as HomeNotice[];
  return [
    normalizeHomeNotice({
      id: row.notice_id,
      title: row.title,
      body: row.body,
      kind: "popup",
      tone: "normal",
      isActive: row.is_active,
      applicationEnabled: true,
      expiresAt: row.expires_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  ];
}

function parseStoreBody(row: HomePopupNoticeStateRow | null | undefined) {
  const raw = row?.body?.trim();
  if (!raw) return rowToLegacyNotice(row);

  try {
    const parsed = JSON.parse(raw) as Partial<HomeNoticeStorePayload>;
    if (parsed?.version !== HOME_NOTICE_STORE_VERSION || !Array.isArray(parsed.notices)) {
      return rowToLegacyNotice(row);
    }

    return sortNotices(
      parsed.notices
        .filter((item): item is HomeNotice => Boolean(item && typeof item.id === "string"))
        .map((item) =>
          normalizeHomeNotice({
            ...item,
            id: item.id,
            title: item.title,
            body: item.body,
          }),
        )
        .filter((item) => item.title && item.body),
    );
  } catch {
    return rowToLegacyNotice(row);
  }
}

function rowToApplication(row: HomePopupNoticeApplicationRow): HomePopupNoticeApplication {
  return {
    id: row.id,
    noticeId: row.notice_id,
    applicantId: row.applicant_id,
    applicantName: row.applicant_name,
    createdAt: row.created_at,
  };
}

function buildStorePayload(notices: HomeNotice[]) {
  return JSON.stringify({
    version: HOME_NOTICE_STORE_VERSION,
    notices: sortNotices(notices),
  } satisfies HomeNoticeStorePayload);
}

function buildRowPayload(notices: HomeNotice[], sessionId: string) {
  const sortedNotices = sortNotices(notices);
  const activePopup = getActivePopupNotice(sortedNotices);
  const latestNotice = sortedNotices[0] ?? null;
  const now = new Date().toISOString();

  return {
    key: HOME_POPUP_NOTICE_ROW_KEY,
    notice_id: activePopup?.id ?? latestNotice?.id ?? crypto.randomUUID(),
    title: activePopup?.title ?? latestNotice?.title ?? "",
    body: buildStorePayload(sortedNotices),
    is_active: Boolean(activePopup),
    expires_at: activePopup?.expiresAt ?? null,
    created_at: now,
    updated_at: now,
    created_by: sessionId,
    updated_by: sessionId,
  };
}

function syncCaches(notices: HomeNotice[], applications: HomePopupNoticeApplication[], ownApplied = false) {
  noticeListCache = cloneNoticeList(sortNotices(notices));
  noticeCache = clonePopupNotice(getActivePopupNotice(noticeListCache));
  applicationCache = cloneApplications(applications);
  currentUserAppliedCache = ownApplied;
}

export function getHomePopupNotice() {
  return clonePopupNotice(noticeCache);
}

export function getHomeNotices() {
  return cloneNoticeList(noticeListCache);
}

export function getHomePopupNoticeApplications() {
  return cloneApplications(applicationCache);
}

export function hasAppliedToCurrentHomePopupNotice() {
  return currentUserAppliedCache;
}

async function selectHomePopupNoticeRow(supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>) {
  const preferred = await supabase
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
    .eq("key", HOME_POPUP_NOTICE_ROW_KEY)
    .maybeSingle<HomePopupNoticeStateRow>();

  if (!preferred.error || !isMissingExpiresAtColumnError(preferred.error)) {
    return preferred;
  }

  return supabase
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body, is_active, created_at, updated_at")
    .eq("key", HOME_POPUP_NOTICE_ROW_KEY)
    .maybeSingle<HomePopupNoticeStateRow>();
}

async function persistNotices(
  notices: HomeNotice[],
  sessionId: string,
  supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>,
) {
  const payload = buildRowPayload(notices, sessionId);

  let { data, error } = await supabase
    .from("home_popup_notice_state")
    .upsert(payload)
    .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
    .maybeSingle<HomePopupNoticeStateRow>();

  if (error && (isMissingExpiresAtColumnError(error) || isMissingAuditColumnError(error))) {
    const fallbackPayload = {
      key: payload.key,
      notice_id: payload.notice_id,
      title: payload.title,
      body: payload.body,
      is_active: payload.is_active,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
    };

    ({ data, error } = await supabase
      .from("home_popup_notice_state")
      .upsert(fallbackPayload)
      .select("key, notice_id, title, body, is_active, created_at, updated_at")
      .maybeSingle<HomePopupNoticeStateRow>());
  }

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_state"));
  }

  return parseStoreBody(data ?? null);
}

export async function refreshHomePopupNoticeWorkspace() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      syncCaches([], [], false);
      emitHomePopupNoticeEvent();
      return {
        notice: null,
        notices: [],
        applications: [],
      };
    }

    const supabase = await getPortalSupabaseClient();
    const { data: noticeRow, error: noticeError } = await selectHomePopupNoticeRow(supabase);

    if (noticeError) {
      if (isSupabaseSchemaMissingError(noticeError)) {
        console.warn(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
        syncCaches([], [], false);
        emitHomePopupNoticeEvent();
        return {
          notice: null,
          notices: [],
          applications: [],
        };
      }

      throw new Error(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
    }

    const notices = parseStoreBody(noticeRow ?? null);
    const activePopup = getActivePopupNotice(notices);
    let ownApplied = false;
    let applications: HomePopupNoticeApplication[] = [];

    if (activePopup?.applicationEnabled) {
      const { data: ownApplicationRow, error: ownApplicationError } = await supabase
        .from("home_popup_notice_applications")
        .select("id")
        .eq("notice_id", activePopup.id)
        .eq("applicant_id", session.id)
        .maybeSingle<{ id: string }>();

      if (ownApplicationError) {
        if (isSupabaseSchemaMissingError(ownApplicationError)) {
          console.warn(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
        } else {
          throw new Error(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
        }
      } else {
        ownApplied = Boolean(ownApplicationRow?.id);
      }

      if (isManagerRole(session.role)) {
        const { data: applicationRows, error: applicationError } = await supabase
          .from("home_popup_notice_applications")
          .select("id, notice_id, applicant_id, applicant_name, created_at")
          .eq("notice_id", activePopup.id)
          .order("created_at", { ascending: false })
          .returns<HomePopupNoticeApplicationRow[]>();

        if (applicationError) {
          if (isSupabaseSchemaMissingError(applicationError)) {
            console.warn(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
          } else {
            throw new Error(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
          }
        } else {
          applications = (applicationRows ?? []).map(rowToApplication);
        }
      }
    }

    syncCaches(notices, applications, ownApplied);
    emitHomePopupNoticeEvent();
    return {
      notice: getHomePopupNotice(),
      notices: getHomeNotices(),
      applications: getHomePopupNoticeApplications(),
    };
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function saveHomeNotice(input: {
  title: string;
  body: string;
  kind: HomeNoticeKind;
  tone: HomeNoticeTone;
  expiresAt?: string | null;
  applicationEnabled?: boolean;
}) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  const expiresAt = input.expiresAt?.trim() ? new Date(input.expiresAt).toISOString() : null;
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    throw new Error("종료일 형식을 다시 확인해 주세요.");
  }

  const existingNotices = noticeListCache.length > 0 ? getHomeNotices() : (await refreshHomePopupNoticeWorkspace()).notices;
  const now = new Date().toISOString();
  const nextNotice = normalizeHomeNotice({
    id: crypto.randomUUID(),
    title,
    body,
    kind: input.kind,
    tone: input.tone,
    isActive: input.kind === "popup",
    applicationEnabled: input.kind === "popup" ? Boolean(input.applicationEnabled) : false,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const nextNotices = sortNotices([
    nextNotice,
    ...existingNotices.map((notice) =>
      input.kind === "popup" && notice.kind === "popup"
        ? { ...notice, isActive: false }
        : notice,
    ),
  ]);

  const supabase = await getPortalSupabaseClient();
  const persistedNotices = await persistNotices(nextNotices, session.id, supabase);
  syncCaches(persistedNotices, [], false);
  emitHomePopupNoticeStatus({
    ok: true,
    message: input.kind === "popup" ? "팝업 공지를 게시했습니다." : "일반 공지를 등록했습니다.",
  });
  emitHomePopupNoticeEvent();
  return nextNotice;
}

export async function saveHomePopupNotice(input: { title: string; body: string; expiresAt?: string | null }) {
  return saveHomeNotice({
    title: input.title,
    body: input.body,
    kind: "popup",
    tone: "normal",
    expiresAt: input.expiresAt,
    applicationEnabled: true,
  });
}

export async function closeHomePopupNotice() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentPopup = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentPopup) {
    syncCaches(getHomeNotices(), [], false);
    emitHomePopupNoticeEvent();
    return null;
  }

  const nextNotices = getHomeNotices().filter((notice) => notice.id !== currentPopup.id);
  const supabase = await getPortalSupabaseClient();
  const persistedNotices = await persistNotices(nextNotices, session.id, supabase);
  syncCaches(persistedNotices, [], false);
  emitHomePopupNoticeStatus({ ok: true, message: "팝업 종료를 반영했습니다." });
  emitHomePopupNoticeEvent();
  return getHomePopupNotice();
}

export async function clearHomePopupNoticeApplications() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentPopup = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentPopup?.id) {
    applicationCache = [];
    currentUserAppliedCache = false;
    emitHomePopupNoticeEvent();
    return 0;
  }

  const supabase = await getPortalSupabaseClient();
  const { error, count } = await supabase
    .from("home_popup_notice_applications")
    .delete({ count: "exact" })
    .eq("notice_id", currentPopup.id);

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
  }

  applicationCache = [];
  currentUserAppliedCache = false;
  emitHomePopupNoticeStatus({ ok: true, message: "신청 목록을 초기화했습니다." });
  emitHomePopupNoticeEvent();
  return count ?? 0;
}

export async function closeHomePopupNoticeApplications() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentPopup = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentPopup?.id) {
    applicationCache = [];
    currentUserAppliedCache = false;
    emitHomePopupNoticeEvent();
    return null;
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("home_popup_notice_applications")
    .delete()
    .eq("notice_id", currentPopup.id);

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
  }

  const nextNotices = getHomeNotices().map((notice) =>
    notice.id === currentPopup.id
      ? normalizeHomeNotice({
          ...notice,
          applicationEnabled: false,
          updatedAt: new Date().toISOString(),
        })
      : notice,
  );
  const persistedNotices = await persistNotices(nextNotices, session.id, supabase);
  syncCaches(persistedNotices, [], false);
  emitHomePopupNoticeStatus({ ok: true, message: "신청을 마감했습니다." });
  emitHomePopupNoticeEvent();
  return getHomePopupNotice();
}

export async function applyToHomePopupNotice() {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const currentNotice = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentNotice?.isActive) {
    throw new Error("현재 신청 가능한 공지가 없습니다.");
  }
  if (!currentNotice.applicationEnabled) {
    throw new Error("신청 기능이 없는 공지입니다.");
  }
  if (currentUserAppliedCache) {
    throw new Error("이미 신청한 공지입니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("home_popup_notice_applications")
    .insert({
      notice_id: currentNotice.id,
      applicant_id: session.id,
      applicant_name: session.username,
    })
    .select("id, notice_id, applicant_id, applicant_name, created_at")
    .single<HomePopupNoticeApplicationRow>();

  if (error) {
    const message = getSupabaseStorageErrorMessage(error, "home_popup_notice_applications");
    if (message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique")) {
      currentUserAppliedCache = true;
      emitHomePopupNoticeEvent();
      throw new Error("이미 신청한 공지입니다.");
    }
    throw new Error(message);
  }

  const nextApplication = rowToApplication(data);
  currentUserAppliedCache = true;
  if (noticeCache?.id === nextApplication.noticeId) {
    applicationCache = [nextApplication, ...applicationCache];
  }

  emitHomePopupNoticeStatus({ ok: true, message: "신청 로그를 남겼습니다." });
  emitHomePopupNoticeEvent();
  return nextApplication;
}
