"use client";

import { getSession, hasAdminAccess } from "@/lib/auth/storage";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";

export type CelebrationIntensity = "light" | "normal" | "strong";
export type CelebrationRecurrence = "none" | "yearly";

export interface CelebrationEvent {
  id: string;
  title: string;
  message: string | null;
  button_label: string;
  effect: string;
  intensity: CelebrationIntensity;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  recurrence: CelebrationRecurrence;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CelebrationEventDraft {
  title: string;
  message: string;
  button_label: string;
  intensity: CelebrationIntensity;
  starts_at: string;
  ends_at: string;
  recurrence: CelebrationRecurrence;
  is_active: boolean;
}

const CELEBRATION_COLUMNS =
  "id, title, message, button_label, effect, intensity, is_active, starts_at, ends_at, recurrence, created_by, created_at, updated_at";
export const CELEBRATION_EVENT_CHANGED_EVENT = "portal-celebration-event-changed";

function emitCelebrationEventChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CELEBRATION_EVENT_CHANGED_EVENT));
}

function normalizeIntensity(value: unknown): CelebrationIntensity {
  return value === "light" || value === "strong" ? value : "normal";
}

function normalizeRecurrence(value: unknown): CelebrationRecurrence {
  return value === "yearly" ? "yearly" : "none";
}

function getKstDateParts(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  if (![year, month, day].every(Number.isFinite)) return null;
  return { year, month, day };
}

function getMonthDayStamp(value: Date | string | number) {
  const parts = getKstDateParts(value);
  if (!parts) return null;
  return parts.month * 100 + parts.day;
}

function isYearlyCelebrationInWindow(event: CelebrationEvent, now: Date) {
  if (!event.starts_at) return false;
  const startTime = new Date(event.starts_at).getTime();
  if (Number.isNaN(startTime) || startTime > now.getTime()) return false;

  const today = getMonthDayStamp(now);
  const startDay = getMonthDayStamp(event.starts_at);
  const endDay = event.ends_at ? getMonthDayStamp(event.ends_at) : startDay;
  if (!today || !startDay || !endDay) return false;

  if (startDay <= endDay) {
    return today >= startDay && today <= endDay;
  }

  return today >= startDay || today <= endDay;
}

export function isCelebrationEventCurrentlyVisible(event: CelebrationEvent, now = new Date()) {
  if (!event.is_active) return false;

  if (event.recurrence === "yearly") {
    return isYearlyCelebrationInWindow(event, now);
  }

  const nowTime = now.getTime();
  const startsAt = event.starts_at ? new Date(event.starts_at).getTime() : null;
  const endsAt = event.ends_at ? new Date(event.ends_at).getTime() : null;
  if (startsAt !== null && (Number.isNaN(startsAt) || startsAt > nowTime)) return false;
  if (endsAt !== null && (Number.isNaN(endsAt) || endsAt < nowTime)) return false;
  return true;
}

function normalizeRow(row: CelebrationEvent): CelebrationEvent {
  return {
    ...row,
    intensity: normalizeIntensity(row.intensity),
    recurrence: normalizeRecurrence(row.recurrence),
  };
}

function requireAdminSession() {
  const session = getSession();
  if (!session?.approved || !hasAdminAccess(session.actualRole)) {
    throw new Error("관리자 권한이 필요합니다.");
  }

  return session;
}

function toNullableDateTime(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function getActiveCelebrationEvent() {
  if (!hasSupabaseEnv()) return null;

  const now = new Date().toISOString();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("portal_celebration_events")
    .select(CELEBRATION_COLUMNS)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<CelebrationEvent[]>();

  if (error) {
    console.warn("축하 현수막 이벤트를 불러오지 못했습니다.", error);
    return null;
  }

  return (data ?? []).map(normalizeRow).find((event) => isCelebrationEventCurrentlyVisible(event, new Date(now))) ?? null;
}

export async function getRecentCelebrationEvents() {
  requireAdminSession();
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("portal_celebration_events")
    .select(CELEBRATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<CelebrationEvent[]>();

  if (error) {
    throw new Error(error.message || "축하 현수막 목록을 불러오지 못했습니다.");
  }

  return (data ?? []).map(normalizeRow);
}

export async function createCelebrationEvent(
  draft: CelebrationEventDraft,
  options: { deactivateExisting: boolean },
) {
  const session = requireAdminSession();
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }

  const supabase = createClient();
  const payload = {
    title: draft.title.trim(),
    message: draft.message.trim() || null,
    button_label: draft.button_label.trim() || "확인하고 닫기",
    effect: "confetti",
    intensity: draft.intensity,
    is_active: draft.is_active,
    starts_at: toNullableDateTime(draft.starts_at),
    ends_at: toNullableDateTime(draft.ends_at),
    recurrence: draft.recurrence,
    created_by: session.id,
  };

  if (!payload.title) {
    throw new Error("제목을 입력해 주세요.");
  }

  const { data, error } = await supabase
    .from("portal_celebration_events")
    .insert(payload)
    .select(CELEBRATION_COLUMNS)
    .single<CelebrationEvent>();

  if (error) {
    throw new Error(error.message || "축하 현수막 게시에 실패했습니다.");
  }

  if (options.deactivateExisting && data?.id) {
    const { error: updateError } = await supabase
      .from("portal_celebration_events")
      .update({ is_active: false })
      .eq("is_active", true)
      .neq("id", data.id);

    if (updateError) {
      throw new Error(updateError.message || "기존 활성 이벤트 비활성화에 실패했습니다.");
    }
  }

  emitCelebrationEventChanged();
  return normalizeRow(data);
}

export async function updateCelebrationEventActive(id: string, isActive: boolean) {
  requireAdminSession();
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("portal_celebration_events")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    throw new Error(error.message || "축하 현수막 상태 변경에 실패했습니다.");
  }

  emitCelebrationEventChanged();
}

export async function deleteCelebrationEvent(id: string) {
  requireAdminSession();
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("portal_celebration_events")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message || "축하 현수막 삭제에 실패했습니다.");
  }

  emitCelebrationEventChanged();
}
