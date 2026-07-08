import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type ProfileRow = {
  id: string;
  approved: boolean;
};

type ScheduleAssignmentDisplayRow = {
  month_key: string;
  entries: unknown;
  rows: unknown;
};

const MAX_MONTH_KEYS = 240;

function jsonWithUsageDebug(request: Request, startedAt: number, payload: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  logRouteUsageDebug(request, {
    status,
    startedAt,
    responseBytes: getJsonResponseByteLength(payload),
  });
  return NextResponse.json(payload, init);
}

function normalizeMonthKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => /^\d{4}-\d{2}$/.test(item)),
    ),
  )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_MONTH_KEYS);
}

function sanitizeDisplayEntries(value: unknown) {
  if (!value || typeof value !== "object") return {};

  const entries: Array<[string, Record<string, unknown>]> = [];
  Object.entries(value as Record<string, unknown>).forEach(([rowKey, rawEntry]) => {
    if (!rawEntry || typeof rawEntry !== "object") return;
    const entry = rawEntry as Record<string, unknown>;
    const travelType = typeof entry.travelType === "string" ? entry.travelType : "";
    const tripTagId = typeof entry.tripTagId === "string" ? entry.tripTagId : "";
    const tripTagLabel = typeof entry.tripTagLabel === "string" ? entry.tripTagLabel : "";
    const tripTagPhase = typeof entry.tripTagPhase === "string" ? entry.tripTagPhase : "";
    const schedules = Array.isArray(entry.schedules)
      ? entry.schedules.filter((item): item is string => typeof item === "string")
      : [];

    if (!travelType && !tripTagId && !tripTagLabel && !tripTagPhase && schedules.length === 0) return;

    entries.push([
      rowKey,
      {
        travelType,
        tripTagId,
        tripTagLabel,
        tripTagPhase,
        schedules,
      },
    ]);
  });

  return Object.fromEntries(entries);
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    if (!hasSupabaseAdminEnv()) {
      return jsonWithUsageDebug(request, startedAt, { message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const body = (await request.json().catch(() => ({}))) as { monthKeys?: unknown };
    const monthKeys = normalizeMonthKeys(body.monthKeys);
    if (monthKeys.length === 0) {
      return jsonWithUsageDebug(request, startedAt, { rows: [] });
    }

    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonWithUsageDebug(request, startedAt, { message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, approved")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (profileError || !profile || !profile.approved) {
      return jsonWithUsageDebug(request, startedAt, { message: "승인된 계정이 필요합니다." }, { status: 403 });
    }

    const { data, error } = await admin
      .from("team_lead_schedule_assignments")
      .select("month_key, entries, rows")
      .in("month_key", monthKeys)
      .returns<ScheduleAssignmentDisplayRow[]>();

    if (error) {
      throw new Error("일정배정 표시 정보를 불러오지 못했습니다.");
    }

    return jsonWithUsageDebug(request, startedAt, {
      rows: (data ?? []).map((row) => ({
        month_key: row.month_key,
        entries: sanitizeDisplayEntries(row.entries),
        rows: row.rows ?? {},
      })),
    });
  } catch (error) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      { message: error instanceof Error ? error.message : "일정배정 표시 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
