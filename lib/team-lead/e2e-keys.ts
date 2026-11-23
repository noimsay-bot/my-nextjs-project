"use client";

// 총괄팀장 보안 열쇠 관리의 실제 저장소 연결(Supabase + 이 브라우저 IndexedDB).
// 로직은 e2e-key-manager.ts에 있다. 여기서는 데이터 입출력만 한다.

import { getPortalSession, getPortalSupabaseClient } from "@/lib/supabase/portal";
import {
  deleteTeamLeadDeviceKey,
  getTeamLeadDeviceKey,
  saveTeamLeadDeviceKey,
} from "@/lib/team-lead/e2e-device-key-store";
import {
  createTeamLeadE2eKeyManager,
  TEAM_LEAD_CRYPTO_META_STATE_KEY,
  type TeamLeadCryptoMeta,
  type TeamLeadE2eKeyBackend,
  type TeamLeadKeyEnvelopeRow,
  type TeamLeadKeyHolderRow,
  type TeamLeadProtectedStateRow,
} from "@/lib/team-lead/e2e-key-manager";

const HOLDER_COLUMNS =
  "id, kind, profile_id, label, public_key, fingerprint, wrapped_private_key, kdf, status, created_at, approved_by, approved_at, revoked_at, owner:profiles!team_lead_key_holders_profile_id_fkey(name)";

type HolderQueryRow = Omit<TeamLeadKeyHolderRow, "owner_name"> & {
  owner: { name: string | null } | { name: string | null }[] | null;
};

function toHolderRow(row: HolderQueryRow): TeamLeadKeyHolderRow {
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  const { owner: _owner, ...rest } = row;
  void _owner;
  return { ...rest, owner_name: owner?.name ?? null };
}

function throwIfError(error: { message: string } | null, fallback: string) {
  if (error) {
    throw new Error(error.message || fallback);
  }
}

function normalizeCryptoMeta(value: unknown): TeamLeadCryptoMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.currentKeyVersion !== "number" || !Number.isInteger(candidate.currentKeyVersion)) return null;
  return {
    enabled: candidate.enabled === true,
    currentKeyVersion: candidate.currentKeyVersion,
    setupAt: typeof candidate.setupAt === "string" ? candidate.setupAt : "",
    setupBy: typeof candidate.setupBy === "string" ? candidate.setupBy : "",
    ...(typeof candidate.enabledAt === "string" ? { enabledAt: candidate.enabledAt } : {}),
  };
}

const supabaseBackend: TeamLeadE2eKeyBackend = {
  async getSession() {
    const session = await getPortalSession();
    if (!session) return null;
    // 화면 체험 등급(role)이 아니라 DB에 저장된 실제 등급(actualRole)으로 판단한다. RLS도 실제 등급을 본다.
    return { id: session.id, name: session.username, role: session.actualRole, approved: session.approved };
  },

  async loadCryptoMeta() {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_state")
      .select("state")
      .eq("key", TEAM_LEAD_CRYPTO_META_STATE_KEY)
      .maybeSingle<{ state: unknown }>();
    throwIfError(error, "보안 열쇠 설정을 불러오지 못했습니다.");
    return normalizeCryptoMeta(data?.state);
  },

  async saveCryptoMeta(meta) {
    const session = await getPortalSession();
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("team_lead_state").upsert({
      key: TEAM_LEAD_CRYPTO_META_STATE_KEY,
      state: meta,
      updated_by: session?.id ?? null,
    });
    throwIfError(error, "보안 열쇠 설정을 저장하지 못했습니다.");
  },

  async listHolders() {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_key_holders")
      .select(HOLDER_COLUMNS)
      .order("created_at", { ascending: true })
      .returns<HolderQueryRow[]>();
    throwIfError(error, "열쇠 목록을 불러오지 못했습니다.");
    return (data ?? []).map(toHolderRow);
  },

  async insertHolder(input) {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_key_holders")
      .insert(input)
      .select(HOLDER_COLUMNS)
      .single<HolderQueryRow>();
    throwIfError(error, "열쇠를 등록하지 못했습니다.");
    if (!data) throw new Error("열쇠를 등록하지 못했습니다.");
    return toHolderRow(data);
  },

  async updateHolder(id, patch) {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("team_lead_key_holders").update(patch).eq("id", id);
    throwIfError(error, "열쇠 상태를 바꾸지 못했습니다.");
  },

  async deleteHolder(id) {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("team_lead_key_holders").delete().eq("id", id);
    throwIfError(error, "열쇠를 삭제하지 못했습니다.");
  },

  async getEnvelope(holderId, keyVersion) {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_key_envelopes")
      .select("holder_id, key_version, wrapped_dek")
      .eq("holder_id", holderId)
      .eq("key_version", keyVersion)
      .maybeSingle<TeamLeadKeyEnvelopeRow>();
    throwIfError(error, "감싼 데이터 키를 불러오지 못했습니다.");
    return data ?? null;
  },

  async upsertEnvelope(input) {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase
      .from("team_lead_key_envelopes")
      .upsert(input, { onConflict: "holder_id,key_version" });
    throwIfError(error, "감싼 데이터 키를 저장하지 못했습니다.");
  },

  async deleteEnvelopesForHolder(holderId) {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("team_lead_key_envelopes").delete().eq("holder_id", holderId);
    throwIfError(error, "감싼 데이터 키를 지우지 못했습니다.");
  },

  async loadProtectedStateRows(keys) {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_state")
      .select("key, state, updated_at")
      .in("key", [...keys])
      .returns<TeamLeadProtectedStateRow[]>();
    throwIfError(error, "총괄팀장 데이터를 불러오지 못했습니다.");
    return data ?? [];
  },

  async replaceProtectedState(key, expectedUpdatedAt, state) {
    const session = await getPortalSession();
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_state")
      .update({ state, updated_by: session?.id ?? null })
      .eq("key", key)
      .eq("updated_at", expectedUpdatedAt)
      .select("key");
    throwIfError(error, "총괄팀장 데이터를 암호문으로 바꾸지 못했습니다.");
    return (data?.length ?? 0) > 0;
  },

  getDeviceKey: getTeamLeadDeviceKey,
  saveDeviceKey: saveTeamLeadDeviceKey,
  deleteDeviceKey: deleteTeamLeadDeviceKey,

  now() {
    return new Date().toISOString();
  },
};

/** 앱 전체에서 하나만 쓰는 보안 열쇠 관리자. 열린 데이터 키는 이 탭의 메모리에만 있다. */
export const teamLeadE2eKeys = createTeamLeadE2eKeyManager(supabaseBackend);

/** crypto_meta_v1 읽기(비밀값 없음). 보호 데이터 저장 시 암호화 여부 판단에 쓴다. */
export function loadTeamLeadCryptoMeta() {
  return supabaseBackend.loadCryptoMeta();
}
