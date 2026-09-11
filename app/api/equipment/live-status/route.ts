import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

const LIVE_STATUS_MANAGER_ROLES = new Set(["desk", "team_lead", "admin"]);

interface ProfileRow {
  id: string;
  name: string;
  role: string;
  approved: boolean;
}

interface LiveStatusPayloadEntry {
  equipmentItemId?: unknown;
  trs?: unknown;
  cameraReporter?: unknown;
  audioMan?: unknown;
  location?: unknown;
  note?: unknown;
}

interface NormalizedLiveStatusEntry {
  equipment_item_id: string;
  live_trs: string | null;
  live_camera_reporter: string | null;
  live_audio_man: string | null;
  live_location: string | null;
  live_note: string | null;
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeNullableText(value: unknown, maxLength: number) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function parseTrsValues(value: string | null) {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function normalizeEntry(entry: LiveStatusPayloadEntry): NormalizedLiveStatusEntry | null {
  const equipmentItemId = normalizeText(entry.equipmentItemId, 80);
  if (!equipmentItemId) return null;
  return {
    equipment_item_id: equipmentItemId,
    live_trs: normalizeNullableText(entry.trs, 120),
    live_camera_reporter: normalizeNullableText(entry.cameraReporter, 120),
    live_audio_man: normalizeNullableText(entry.audioMan, 120),
    live_location: normalizeNullableText(entry.location, 160),
    live_note: normalizeNullableText(entry.note, 240),
  };
}

function assertUniqueTrs(entries: NormalizedLiveStatusEntry[]) {
  const ownerByTrs = new Map<string, string>();

  entries.forEach((entry) => {
    parseTrsValues(entry.live_trs).forEach((trs) => {
      const existingOwner = ownerByTrs.get(trs);
      if (existingOwner && existingOwner !== entry.equipment_item_id) {
        throw new Error(`이미 다른 라이브장비에 입력된 TRS입니다: ${trs}`);
      }
      ownerByTrs.set(trs, entry.equipment_item_id);
    });
  });
}

async function requireLiveStatusManager() {
  if (!hasSupabaseAdminEnv()) {
    return {
      response: NextResponse.json(
        { message: "Supabase 관리자 환경변수가 없어 라이브장비 현황판을 저장할 수 없습니다." },
        { status: 500 },
      ),
      admin: null,
      profile: null,
    };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      response: NextResponse.json({ message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 }),
      admin: null,
      profile: null,
    };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, name, role, approved")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError || !profile || !profile.approved || !LIVE_STATUS_MANAGER_ROLES.has(profile.role)) {
    return {
      response: NextResponse.json({ message: "라이브장비 현황판 저장 권한이 없습니다." }, { status: 403 }),
      admin: null,
      profile: null,
    };
  }

  return { response: null, admin, profile };
}

export async function POST(request: Request) {
  try {
    const auth = await requireLiveStatusManager();
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as { entries?: unknown } | null;
    const entries = Array.isArray(body?.entries)
      ? body.entries
          .map((entry) => normalizeEntry((entry ?? {}) as LiveStatusPayloadEntry))
          .filter((entry): entry is NormalizedLiveStatusEntry => Boolean(entry))
      : [];

    if (entries.length === 0) {
      return NextResponse.json({ message: "저장할 라이브장비 현황이 없습니다." }, { status: 400 });
    }

    if (entries.length > 1000 || entries.length !== (body?.entries as unknown[]).length ||
        entries.some((entry) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.equipment_item_id)) ||
        new Set(entries.map((entry) => entry.equipment_item_id.toLowerCase())).size !== entries.length) {
      return NextResponse.json({ message: "장비 목록이 올바르지 않거나 중복된 장비가 있습니다." }, { status: 400 });
    }

    assertUniqueTrs(entries);

    const { error } = await auth.admin.rpc("save_live_equipment_status_atomic", {
      p_actor_id: auth.profile.id,
      p_entries: entries,
    });
    if (error) {
      const message = error.code === "PGRST202" || error.code === "42883"
        ? "라이브장비 안전 저장 기능이 아직 적용되지 않았습니다. Supabase SQL Editor에서 supabase/incremental_atomic_news_and_live_status.sql을 적용해 주세요."
        : error.message;
      throw new Error(message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "라이브장비 현황판 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}
