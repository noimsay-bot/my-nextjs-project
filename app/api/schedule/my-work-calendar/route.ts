import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { getAssignmentDisplayRank, getDayCategoryDisplayLabel } from "@/lib/schedule/constants";
import { normalizeGeneratedSchedule } from "@/lib/schedule/engine";
import type { GeneratedSchedule } from "@/lib/schedule/types";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type ProfileRow = {
  id: string;
  name: string | null;
  approved: boolean;
};

type ScheduleMonthPublishRow = {
  month_key: string;
  published_state: GeneratedSchedule | null;
  published_at: string | null;
};

type MyWorkCalendarEvent = {
  id: string;
  dateKey: string;
  category: string;
  label: string;
  name: string;
};

type MyWorkCalendarDay = {
  dateKey: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isCustomHoliday: boolean;
  isWeekdayHoliday: boolean;
};

function jsonWithUsageDebug(request: Request, startedAt: number, payload: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  logRouteUsageDebug(request, {
    status,
    startedAt,
    responseBytes: getJsonResponseByteLength(payload),
  });
  return NextResponse.json(payload, init);
}

function isValidMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function normalizeAssignmentNames(names: string[] | undefined) {
  return Array.from(
    new Set((names ?? []).map((name) => (typeof name === "string" ? name.trim() : "")).filter(Boolean)),
  );
}

function normalizeAssignments(assignments: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(assignments)
      .map(([category, names]) => [category, normalizeAssignmentNames(names)] as const)
      .filter(([, names]) => names.length > 0),
  );
}

function normalizePublishedSchedule(schedule: GeneratedSchedule): GeneratedSchedule {
  const normalizedSchedule = normalizeGeneratedSchedule(schedule);
  return {
    ...normalizedSchedule,
    days: normalizedSchedule.days.map((day) => {
      const baseAssignments = normalizeAssignments(day.assignments ?? {});
      const vacationEntries = normalizeAssignmentNames([...(day.vacations ?? []), ...(baseAssignments["휴가"] ?? [])]);
      const assignments = normalizeAssignments({
        ...baseAssignments,
        휴가: vacationEntries,
      });
      if (vacationEntries.length === 0) {
        delete assignments["휴가"];
      }
      return {
        ...day,
        vacations: vacationEntries,
        assignments,
        manualExtras: (day.manualExtras ?? []).filter((category) => Boolean(assignments[category]?.length)),
      };
    }),
  };
}

function normalizeActorName(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function getComparableAssignmentName(category: string, value: string) {
  const trimmed = value.trim();
  if (category !== "휴가") return trimmed;
  const matched = /^(연차|대휴|etc|기타|공가|근속휴가|건강검진|경조)\s*:(.+)$/.exec(trimmed);
  return matched ? matched[2].trim() : trimmed;
}

function isSameActorName(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeActorName(left);
  const normalizedRight = normalizeActorName(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isRedScheduleDay(day: { isWeekend: boolean; isHoliday: boolean; isCustomHoliday: boolean; isWeekdayHoliday: boolean }) {
  return day.isWeekend || day.isHoliday || day.isCustomHoliday || day.isWeekdayHoliday;
}

function buildMyWorkCalendarSummary(schedule: GeneratedSchedule, username: string) {
  const events: MyWorkCalendarEvent[] = [];
  const days: MyWorkCalendarDay[] = [];
  const normalized = normalizePublishedSchedule(schedule);

  normalized.days
    .filter((day) => day.dateKey.startsWith(`${normalized.monthKey}-`))
    .forEach((day) => {
      days.push({
        dateKey: day.dateKey,
        isWeekend: day.isWeekend,
        isHoliday: day.isHoliday,
        isCustomHoliday: day.isCustomHoliday,
        isWeekdayHoliday: day.isWeekdayHoliday,
      });

      if (isSameActorName(day.headerName, username)) {
        events.push({
          id: `${day.dateKey}:header`,
          dateKey: day.dateKey,
          category: "데스크",
          label: "데스크",
          name: day.headerName,
        });
      }

      Object.entries(day.assignments ?? {}).forEach(([category, names]) => {
        names.forEach((name, index) => {
          const comparableName = getComparableAssignmentName(category, name);
          if (!isSameActorName(comparableName, username)) return;
          const label = getDayCategoryDisplayLabel(day, category);
          if (label === "일반" && !isRedScheduleDay(day)) return;
          events.push({
            id: `${day.dateKey}:${category}:${index}:${name}`,
            dateKey: day.dateKey,
            category,
            label,
            name: comparableName,
          });
        });
      });
    });

  return {
    days,
    events: events.sort((left, right) => (
      left.dateKey.localeCompare(right.dateKey) ||
      getAssignmentDisplayRank(left.category) - getAssignmentDisplayRank(right.category) ||
      left.label.localeCompare(right.label)
    )),
  };
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    if (!hasSupabaseAdminEnv()) {
      return jsonWithUsageDebug(request, startedAt, { message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const monthKey = new URL(request.url).searchParams.get("monthKey")?.trim() ?? "";
    if (!isValidMonthKey(monthKey)) {
      return jsonWithUsageDebug(request, startedAt, { message: "조회할 월을 확인해 주세요." }, { status: 400 });
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
      .select("id, name, approved")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (profileError || !profile || !profile.approved) {
      return jsonWithUsageDebug(request, startedAt, { message: "승인된 계정이 필요합니다." }, { status: 403 });
    }

    const { data: row, error: scheduleError } = await admin
      .from("schedule_months")
      .select("month_key, published_state, published_at")
      .eq("month_key", monthKey)
      .not("published_state", "is", null)
      .maybeSingle<ScheduleMonthPublishRow>();

    if (scheduleError) {
      throw new Error("게시 근무표를 불러오지 못했습니다.");
    }

    if (!row?.published_state) {
      return jsonWithUsageDebug(request, startedAt, {
        monthKey,
        publishedAt: "",
        events: [],
        days: [],
      });
    }

    const summary = buildMyWorkCalendarSummary(row.published_state, profile.name ?? "");
    return jsonWithUsageDebug(request, startedAt, {
      monthKey,
      publishedAt: row.published_at ?? "",
      ...summary,
    });
  } catch (error) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      { message: error instanceof Error ? error.message : "내 근무 캘린더를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
