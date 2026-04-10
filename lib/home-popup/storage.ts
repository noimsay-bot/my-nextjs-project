"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

const HOME_POPUP_NOTICE_ROW_KEY = "active";

export const HOME_POPUP_NOTICE_EVENT = "j-home-popup-notice-updated";
export const HOME_POPUP_NOTICE_STATUS_EVENT = "j-home-popup-notice-status";

export interface HomePopupNotice {
  noticeId: string;
  title: string;
  body: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
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

let noticeCache: HomePopupNotice | null = null;
let applicationCache: HomePopupNoticeApplication[] = [];
let currentUserAppliedCache = false;
let refreshPromise: Promise<{ notice: HomePopupNotice | null; applications: HomePopupNoticeApplication[] }> | null = null;

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

function cloneNotice(notice: HomePopupNotice | null) {
  return notice ? { ...notice } : null;
}

function cloneApplications(applications: HomePopupNoticeApplication[]) {
  return applications.map((application) => ({ ...application }));
}

function rowToNotice(row: HomePopupNoticeStateRow | null | undefined): HomePopupNotice | null {
  if (!row?.notice_id) return null;
  return {
    noticeId: row.notice_id,
    title: row.title ?? "",
    body: row.body ?? "",
    isActive: Boolean(row.is_active) && !isExpired(row.expires_at),
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
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

export function getHomePopupNotice() {
  return cloneNotice(noticeCache);
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

export async function refreshHomePopupNoticeWorkspace() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      noticeCache = null;
      applicationCache = [];
      currentUserAppliedCache = false;
      emitHomePopupNoticeEvent();
      return {
        notice: null,
        applications: [] as HomePopupNoticeApplication[],
      };
    }

    const supabase = await getPortalSupabaseClient();
    const { data: noticeRow, error: noticeError } = await selectHomePopupNoticeRow(supabase);

    if (noticeError) {
      if (isSupabaseSchemaMissingError(noticeError)) {
        console.warn(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
        noticeCache = null;
        applicationCache = [];
        currentUserAppliedCache = false;
        emitHomePopupNoticeEvent();
        return {
          notice: null,
          applications: [] as HomePopupNoticeApplication[],
        };
      }

      throw new Error(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
    }

    noticeCache = rowToNotice(noticeRow ?? null);
    currentUserAppliedCache = false;

    if (noticeCache?.noticeId) {
      const { data: ownApplicationRow, error: ownApplicationError } = await supabase
        .from("home_popup_notice_applications")
        .select("id")
        .eq("notice_id", noticeCache.noticeId)
        .eq("applicant_id", session.id)
        .maybeSingle<{ id: string }>();

      if (ownApplicationError) {
        if (isSupabaseSchemaMissingError(ownApplicationError)) {
          console.warn(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
        } else {
          throw new Error(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
        }
      } else {
        currentUserAppliedCache = Boolean(ownApplicationRow?.id);
      }
    }

    if (noticeCache?.noticeId && isManagerRole(session.role)) {
      const { data: applicationRows, error: applicationError } = await supabase
        .from("home_popup_notice_applications")
        .select("id, notice_id, applicant_id, applicant_name, created_at")
        .eq("notice_id", noticeCache.noticeId)
        .order("created_at", { ascending: false })
        .returns<HomePopupNoticeApplicationRow[]>();

      if (applicationError) {
        if (isSupabaseSchemaMissingError(applicationError)) {
          console.warn(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
          applicationCache = [];
        } else {
          throw new Error(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
        }
      } else {
        applicationCache = (applicationRows ?? []).map(rowToApplication);
      }
    } else {
      applicationCache = [];
    }

    emitHomePopupNoticeEvent();
    return {
      notice: getHomePopupNotice(),
      applications: getHomePopupNoticeApplications(),
    };
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function saveHomePopupNotice(input: { title: string; body: string; expiresAt?: string | null }) {
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

  const supabase = await getPortalSupabaseClient();
  const noticeId = crypto.randomUUID();
  const now = new Date().toISOString();
  let { data, error } = await supabase
    .from("home_popup_notice_state")
    .upsert({
      key: HOME_POPUP_NOTICE_ROW_KEY,
      notice_id: noticeId,
      title,
      body,
      is_active: true,
      expires_at: expiresAt,
      created_at: now,
      updated_at: now,
      created_by: session.id,
      updated_by: session.id,
    })
    .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
    .maybeSingle<HomePopupNoticeStateRow>();

  if (error && (isMissingExpiresAtColumnError(error) || isMissingAuditColumnError(error))) {
    ({ data, error } = await supabase
      .from("home_popup_notice_state")
      .upsert({
        key: HOME_POPUP_NOTICE_ROW_KEY,
        notice_id: noticeId,
        title,
        body,
        is_active: true,
        created_at: now,
        updated_at: now,
      })
      .select("key, notice_id, title, body, is_active, created_at, updated_at")
      .maybeSingle<HomePopupNoticeStateRow>());
  }

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_state"));
  }

  noticeCache = rowToNotice(data ?? null);
  applicationCache = [];
  currentUserAppliedCache = false;
  emitHomePopupNoticeStatus({ ok: true, message: "홈 팝업 공지를 게시했습니다." });
  emitHomePopupNoticeEvent();
  return getHomePopupNotice();
}

export async function closeHomePopupNotice() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  let { data, error } = await supabase
    .from("home_popup_notice_state")
    .update({
      is_active: false,
      updated_by: session.id,
    })
    .eq("key", HOME_POPUP_NOTICE_ROW_KEY)
    .select("key, notice_id, title, body, is_active, created_at, updated_at")
    .maybeSingle<HomePopupNoticeStateRow>();

  if (error && isMissingAuditColumnError(error)) {
    ({ data, error } = await supabase
      .from("home_popup_notice_state")
      .update({
        is_active: false,
      })
      .eq("key", HOME_POPUP_NOTICE_ROW_KEY)
      .select("key, notice_id, title, body, is_active, created_at, updated_at")
      .maybeSingle<HomePopupNoticeStateRow>());
  }

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_state"));
  }

  noticeCache = rowToNotice(data ?? null);
  currentUserAppliedCache = false;
  emitHomePopupNoticeStatus({ ok: true, message: "홈 팝업 공지를 종료했습니다." });
  emitHomePopupNoticeEvent();
  return getHomePopupNotice();
}

export async function clearHomePopupNoticeApplications() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentNotice = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentNotice?.noticeId) {
    applicationCache = [];
    currentUserAppliedCache = false;
    emitHomePopupNoticeEvent();
    return 0;
  }

  const supabase = await getPortalSupabaseClient();
  const { error, count } = await supabase
    .from("home_popup_notice_applications")
    .delete({ count: "exact" })
    .eq("notice_id", currentNotice.noticeId);

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
  }

  applicationCache = [];
  currentUserAppliedCache = false;
  emitHomePopupNoticeStatus({ ok: true, message: "신청 목록을 초기화했습니다." });
  emitHomePopupNoticeEvent();
  return count ?? 0;
}

export async function applyToHomePopupNotice() {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const currentNotice = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentNotice?.isActive) {
    throw new Error("현재 신청 가능한 팝업 공지가 없습니다.");
  }
  if (currentUserAppliedCache) {
    throw new Error("이미 신청한 팝업 공지입니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("home_popup_notice_applications")
    .insert({
      notice_id: currentNotice.noticeId,
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
      throw new Error("이미 신청한 팝업 공지입니다.");
    }
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
  }

  const nextApplication = rowToApplication(data);
  currentUserAppliedCache = true;
  if (noticeCache?.noticeId === nextApplication.noticeId) {
    applicationCache = [nextApplication, ...applicationCache];
  }

  emitHomePopupNoticeStatus({ ok: true, message: "신청 로그를 남겼습니다." });
  emitHomePopupNoticeEvent();
  return nextApplication;
}
