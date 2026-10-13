"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";
import type { UserRole } from "@/lib/auth/storage";

export interface WorkManualWebhard {
  id: string;
  title: string;
  login_id: string;
  password: string;
  note: string;
  url: string;
  sort_order: number;
}

export type WorkManualWebhardDraft = Omit<WorkManualWebhard, "id" | "sort_order">;

const WEBHARD_TABLE = "work_manual_webhards";
const WEBHARD_COLUMNS = "id, title, login_id, password, note, url, sort_order";
const WEBHARD_SCHEMA_MESSAGE =
  "웹하드 테이블이 아직 없습니다. Supabase SQL Editor에서 supabase/incremental_work_manual_webhards.sql을 실행해 주세요.";

export function canManageWorkManualWebhards(role: UserRole | null | undefined) {
  return role === "desk" || role === "team_lead" || role === "admin";
}

function toStorageError(error: unknown) {
  if (isSupabaseSchemaMissingError(error)) {
    return new Error(WEBHARD_SCHEMA_MESSAGE);
  }
  return new Error(getSupabaseStorageErrorMessage(error, WEBHARD_TABLE));
}

function normalizeDraft(draft: WorkManualWebhardDraft): WorkManualWebhardDraft {
  return {
    title: draft.title.trim(),
    login_id: draft.login_id.trim(),
    password: draft.password.trim(),
    note: draft.note.trim(),
    url: draft.url.trim(),
  };
}

export async function listWorkManualWebhards(): Promise<WorkManualWebhard[]> {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from(WEBHARD_TABLE)
    .select(WEBHARD_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw toStorageError(error);
  return (data ?? []) as WorkManualWebhard[];
}

export async function createWorkManualWebhard(draft: WorkManualWebhardDraft, sortOrder: number) {
  const session = await getPortalSession();
  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from(WEBHARD_TABLE).insert({
    ...normalizeDraft(draft),
    sort_order: sortOrder,
    created_by: session?.id ?? null,
    updated_by: session?.id ?? null,
  });

  if (error) throw toStorageError(error);
}

export async function updateWorkManualWebhard(id: string, draft: WorkManualWebhardDraft) {
  const session = await getPortalSession();
  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from(WEBHARD_TABLE)
    .update({ ...normalizeDraft(draft), updated_by: session?.id ?? null })
    .eq("id", id);

  if (error) throw toStorageError(error);
}

export async function deleteWorkManualWebhard(id: string) {
  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from(WEBHARD_TABLE).delete().eq("id", id);

  if (error) throw toStorageError(error);
}
