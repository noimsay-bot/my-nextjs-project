"use client";

import { getSession, hasAdminAccess } from "@/lib/auth/storage";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";

export type CelebrationIntensity = "light" | "normal" | "strong";

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
  is_active: boolean;
}

const CELEBRATION_COLUMNS =
  "id, title, message, button_label, effect, intensity, is_active, starts_at, ends_at, created_by, created_at, updated_at";

function normalizeIntensity(value: unknown): CelebrationIntensity {
  return value === "light" || value === "strong" ? value : "normal";
}

function normalizeRow(row: CelebrationEvent): CelebrationEvent {
  return {
    ...row,
    intensity: normalizeIntensity(row.intensity),
  };
}

function requireAdminSession() {
  const session = getSession();
  if (!session?.approved || !hasAdminAccess(session.role)) {
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
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<CelebrationEvent>();

  if (error) {
    console.warn("축하 현수막 이벤트를 불러오지 못했습니다.", error);
    return null;
  }

  return data ? normalizeRow(data) : null;
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
}
