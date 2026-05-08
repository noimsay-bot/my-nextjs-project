import "server-only";

import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { GeneratedSchedule } from "@/lib/schedule/types";

export type AssemblyDutyItem = {
  date: string;
  dutyType: "공휴일" | "주말근무";
  memberName: string;
  sourceId?: string;
  sourceUpdatedAt?: string;
};

export type AssemblySyncTriggerType = "hub_publish" | "assembly_webhook";

type AssemblySyncErrorDetail = {
  stage: "config" | "fetch" | "validation" | "profile_match" | "database" | "not_published";
  message: string;
  date?: string;
  dutyType?: string;
  memberName?: string;
  status?: number;
};

type AssemblySyncLogPayload = {
  trigger_type: AssemblySyncTriggerType;
  target_month: string;
  source: string;
  total_source_count: number;
  inserted_count: number;
  updated_count: number;
  deleted_count: number;
  skipped_count: number;
  error_count: number;
  error_details: AssemblySyncErrorDetail[] | null;
};

type ScheduleMonthRow = {
  month_key: string;
  draft_state: GeneratedSchedule | null;
  published_state: GeneratedSchedule | null;
  published_at: string | null;
};

type ProfileRow = {
  id: string;
  name: string;
  approved: boolean;
};

type ParsedAssemblyDutyExport = {
  items: AssemblyDutyItem[];
  errors: AssemblySyncErrorDetail[];
};

const ASSEMBLY_DUTY_TYPES = new Set<AssemblyDutyItem["dutyType"]>(["공휴일", "주말근무"]);
const ASSEMBLY_CATEGORY = "국회";
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidMonth(month: string) {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error("month는 YYYY-MM 형식이어야 합니다.");
  }
}

function isValidDateKey(value: string, month: string) {
  if (!DATE_PATTERN.test(value) || !value.startsWith(`${month}-`)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, monthIndex, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day
  );
}

function getMonthKeyFromDateKey(dateKey: string) {
  return DATE_PATTERN.test(dateKey) ? dateKey.slice(0, 7) : "";
}

function getScheduleDateKeysForAssemblySync(row: ScheduleMonthRow) {
  const dateKeys = new Set<string>();
  [row.draft_state, row.published_state].forEach((schedule) => {
    (schedule?.days ?? []).forEach((day) => {
      if (DATE_PATTERN.test(day.dateKey)) {
        dateKeys.add(day.dateKey);
      }
    });
  });
  return dateKeys;
}

function getSourceMonthsForScheduleDateKeys(dateKeys: Set<string>) {
  return Array.from(
    new Set(
      Array.from(dateKeys)
        .map(getMonthKeyFromDateKey)
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneSchedule(schedule: GeneratedSchedule) {
  return JSON.parse(JSON.stringify(schedule)) as GeneratedSchedule;
}

function areSameNames(left: string[] | undefined, right: string[]) {
  const normalizedLeft = (left ?? []).map((name) => name.trim()).filter(Boolean);
  return JSON.stringify(normalizedLeft) === JSON.stringify(right);
}

function compactDayAssemblyAssignment(day: GeneratedSchedule["days"][number]) {
  const names = (day.assignments[ASSEMBLY_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
  if (names.length > 0) {
    day.assignments[ASSEMBLY_CATEGORY] = Array.from(new Set(names));
    return;
  }

  delete day.assignments[ASSEMBLY_CATEGORY];
  day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== ASSEMBLY_CATEGORY);
}

async function insertAssemblySyncLog(payload: AssemblySyncLogPayload) {
  if (!hasSupabaseAdminEnv()) {
    console.warn("[assembly-sync] DB 로그를 남기려면 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.", {
      triggerType: payload.trigger_type,
      targetMonth: payload.target_month,
      errorCount: payload.error_count,
    });
    return;
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("schedule_assembly_sync_logs").insert(payload as never);
    if (error) {
      console.warn("[assembly-sync] DB 로그 저장에 실패했습니다.", {
        triggerType: payload.trigger_type,
        targetMonth: payload.target_month,
        message: error.message,
      });
    }
  } catch (error) {
    console.warn("[assembly-sync] DB 로그 저장 중 예외가 발생했습니다.", {
      triggerType: payload.trigger_type,
      targetMonth: payload.target_month,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function createBaseLog(
  month: string,
  triggerType: AssemblySyncTriggerType,
  overrides: Partial<AssemblySyncLogPayload> = {},
): AssemblySyncLogPayload {
  const errors = overrides.error_details ?? null;
  return {
    trigger_type: triggerType,
    target_month: month,
    source: "assembly_export_api",
    total_source_count: 0,
    inserted_count: 0,
    updated_count: 0,
    deleted_count: 0,
    skipped_count: 0,
    error_count: errors?.length ?? 0,
    error_details: errors,
    ...overrides,
  };
}

function readAssemblyExportConfig() {
  const apiUrl = process.env.ASSEMBLY_EXPORT_API_URL?.trim();
  const token = process.env.ASSEMBLY_EXPORT_TOKEN?.trim();
  const errors: AssemblySyncErrorDetail[] = [];

  if (!apiUrl) {
    errors.push({
      stage: "config",
      message: "ASSEMBLY_EXPORT_API_URL 서버 환경변수가 설정되지 않았습니다.",
    });
  }

  if (!token) {
    errors.push({
      stage: "config",
      message: "ASSEMBLY_EXPORT_TOKEN 서버 환경변수가 설정되지 않았습니다.",
    });
  }

  if (errors.length > 0) {
    const error = new Error(errors.map((item) => item.message).join(" "));
    (error as Error & { details?: AssemblySyncErrorDetail[] }).details = errors;
    throw error;
  }

  return { apiUrl: apiUrl as string, token: token as string };
}

function parseAssemblyDutyExportPayload(payload: unknown, month: string): ParsedAssemblyDutyExport {
  const rawItems = Array.isArray((payload as { items?: unknown } | null)?.items)
    ? ((payload as { items: unknown[] }).items)
    : [];
  const errors: AssemblySyncErrorDetail[] = [];
  const items: AssemblyDutyItem[] = [];
  const seen = new Set<string>();

  rawItems.forEach((rawItem) => {
    const record = rawItem && typeof rawItem === "object" ? (rawItem as Record<string, unknown>) : {};
    const date = typeof record.date === "string" ? record.date.trim() : "";
    const dutyType = typeof record.dutyType === "string" ? record.dutyType.trim() : "";
    const memberName = normalizeName(record.memberName);

    if (!isValidDateKey(date, month)) {
      errors.push({
        stage: "validation",
        message: "date가 YYYY-MM-DD 형식이 아니거나 요청 월에 속하지 않습니다.",
        date,
        dutyType,
        memberName,
      });
      return;
    }

    if (!ASSEMBLY_DUTY_TYPES.has(dutyType as AssemblyDutyItem["dutyType"])) {
      errors.push({
        stage: "validation",
        message: "dutyType은 공휴일 또는 주말근무만 허용됩니다.",
        date,
        dutyType,
        memberName,
      });
      return;
    }

    if (!memberName) {
      errors.push({
        stage: "validation",
        message: "memberName이 비어 있습니다.",
        date,
        dutyType,
      });
      return;
    }

    const key = `${date}:${dutyType}:${memberName}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      date,
      dutyType: dutyType as AssemblyDutyItem["dutyType"],
      memberName,
      sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
      sourceUpdatedAt: typeof record.sourceUpdatedAt === "string" ? record.sourceUpdatedAt : undefined,
    });
  });

  return { items, errors };
}

async function fetchAssemblyDutyExport(month: string): Promise<ParsedAssemblyDutyExport> {
  assertValidMonth(month);
  const { apiUrl, token } = readAssemblyExportConfig();
  const url = new URL(apiUrl);
  url.searchParams.set("month", month);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    const detail: AssemblySyncErrorDetail = {
      stage: "fetch",
      message: error instanceof Error ? error.message : "국회 export API 호출에 실패했습니다.",
    };
    const fetchError = new Error(detail.message);
    (fetchError as Error & { details?: AssemblySyncErrorDetail[] }).details = [detail];
    throw fetchError;
  }

  if (!response.ok) {
    const detail: AssemblySyncErrorDetail = {
      stage: "fetch",
      message: `국회 export API가 ${response.status} 응답을 반환했습니다.`,
      status: response.status,
    };
    const statusError = new Error(detail.message);
    (statusError as Error & { details?: AssemblySyncErrorDetail[] }).details = [detail];
    throw statusError;
  }

  const payload = await response.json().catch(() => null);
  return parseAssemblyDutyExportPayload(payload, month);
}

async function fetchAssemblyDutyExports(months: string[], targetDateKeys: Set<string>): Promise<ParsedAssemblyDutyExport> {
  const results = await Promise.all(months.map((month) => fetchAssemblyDutyExport(month)));
  return results.reduce(
    (accumulator, result) => {
      accumulator.items.push(...result.items.filter((item) => targetDateKeys.has(item.date)));
      accumulator.errors.push(
        ...result.errors.filter((item) => !item.date || targetDateKeys.has(item.date)),
      );
      return accumulator;
    },
    { items: [] as AssemblyDutyItem[], errors: [] as AssemblySyncErrorDetail[] },
  );
}

export async function getAssemblyHolidayAndWeekendDuties(month: string): Promise<AssemblyDutyItem[]> {
  return (await fetchAssemblyDutyExport(month)).items;
}

async function getScheduleMonthForAssemblySync(month: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("schedule_months")
    .select("month_key, draft_state, published_state, published_at")
    .eq("month_key", month)
    .maybeSingle<ScheduleMonthRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

async function getApprovedProfileNameMap() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, approved")
    .eq("approved", true)
    .returns<ProfileRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  const byName = new Map<string, ProfileRow[]>();
  (data ?? []).forEach((profile) => {
    const name = profile.name.trim();
    if (!name) return;
    byName.set(name, [...(byName.get(name) ?? []), profile]);
  });

  return byName;
}

function buildDesiredAssemblyNamesByDate(
  items: AssemblyDutyItem[],
  profileMap: Map<string, ProfileRow[]>,
  errors: AssemblySyncErrorDetail[],
) {
  const desiredByDate = new Map<string, string[]>();
  const datesWithMatchErrors = new Set<string>();

  items.forEach((item) => {
    const matches = profileMap.get(item.memberName) ?? [];
    if (matches.length !== 1) {
      datesWithMatchErrors.add(item.date);
      errors.push({
        stage: "profile_match",
        message: matches.length === 0 ? "허브 사용자 이름과 매칭되지 않았습니다." : "동명이인으로 인해 안전하게 매칭할 수 없습니다.",
        date: item.date,
        dutyType: item.dutyType,
        memberName: item.memberName,
      });
      return;
    }

    const nextNames = desiredByDate.get(item.date) ?? [];
    nextNames.push(matches[0].name.trim());
    desiredByDate.set(item.date, Array.from(new Set(nextNames)));
  });

  return { desiredByDate, datesWithMatchErrors };
}

function applyAssemblyDutiesToSchedule(
  schedule: GeneratedSchedule,
  targetDateKeys: Set<string>,
  desiredByDate: Map<string, string[]>,
  datesWithMatchErrors: Set<string>,
) {
  const nextSchedule = cloneSchedule(schedule);
  let insertedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;

  nextSchedule.days.forEach((day) => {
    if (!targetDateKeys.has(day.dateKey)) return;

    const currentNames = (day.assignments[ASSEMBLY_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
    const desiredNames = desiredByDate.get(day.dateKey) ?? [];

    if (datesWithMatchErrors.has(day.dateKey)) {
      const safeDesiredNames = Array.from(new Set([...currentNames, ...desiredNames]));
      if (safeDesiredNames.length > 0 && !areSameNames(currentNames, safeDesiredNames)) {
        day.assignments[ASSEMBLY_CATEGORY] = safeDesiredNames;
        compactDayAssemblyAssignment(day);
        if (currentNames.length > 0) updatedCount += 1;
        else insertedCount += 1;
      } else {
        skippedCount += 1;
      }
      return;
    }

    if (desiredNames.length > 0) {
      if (areSameNames(currentNames, desiredNames)) {
        skippedCount += 1;
        return;
      }

      day.assignments[ASSEMBLY_CATEGORY] = desiredNames;
      compactDayAssemblyAssignment(day);
      if (currentNames.length > 0) updatedCount += 1;
      else insertedCount += 1;
      return;
    }

    if (currentNames.length > 0) {
      delete day.assignments[ASSEMBLY_CATEGORY];
      day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== ASSEMBLY_CATEGORY);
      deletedCount += 1;
      return;
    }

    skippedCount += 1;
  });

  return {
    schedule: nextSchedule,
    insertedCount,
    updatedCount,
    deletedCount,
    skippedCount,
    changed: JSON.stringify(schedule) !== JSON.stringify(nextSchedule),
  };
}

function getErrorDetails(error: unknown): AssemblySyncErrorDetail[] {
  const details = (error as { details?: unknown } | null)?.details;
  if (Array.isArray(details)) {
    return details.filter((item): item is AssemblySyncErrorDetail => Boolean(item && typeof item === "object"));
  }

  return [
    {
      stage: "database",
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

export async function syncAssemblyDutiesToHub(month: string, triggerType: AssemblySyncTriggerType) {
  assertValidMonth(month);

  if (!hasSupabaseAdminEnv()) {
    const details: AssemblySyncErrorDetail[] = [
      {
        stage: "config",
        message: "SUPABASE_SERVICE_ROLE_KEY 서버 환경변수가 설정되지 않았습니다.",
      },
    ];
    await insertAssemblySyncLog(createBaseLog(month, triggerType, { error_details: details, error_count: details.length }));
    throw new Error(details[0].message);
  }

  try {
    const row = await getScheduleMonthForAssemblySync(month);
    if (!row?.draft_state && !row?.published_state) {
      const details: AssemblySyncErrorDetail[] = [
        {
          stage: "not_published",
          message: "허브 근무표 초안 또는 게시본이 없어 국회 동기화를 건너뜁니다.",
        },
      ];
      const log = createBaseLog(month, triggerType, {
        skipped_count: 1,
        error_details: details,
        error_count: details.length,
      });
      await insertAssemblySyncLog(log);
      console.info("[assembly-sync] 게시된 근무표가 없어 건너뜁니다.", { month, triggerType });
      return { ok: true as const, ...log, changed: false };
    }

    const targetDateKeys = getScheduleDateKeysForAssemblySync(row);
    const sourceMonths = getSourceMonthsForScheduleDateKeys(targetDateKeys);
    const parsed = await fetchAssemblyDutyExports(sourceMonths.length > 0 ? sourceMonths : [month], targetDateKeys);
    const errors = [...parsed.errors];
    const profileMap = await getApprovedProfileNameMap();
    const { desiredByDate, datesWithMatchErrors } = buildDesiredAssemblyNamesByDate(parsed.items, profileMap, errors);
    const draftResult = row.draft_state
      ? applyAssemblyDutiesToSchedule(row.draft_state, targetDateKeys, desiredByDate, datesWithMatchErrors)
      : null;
    const publishedResult = row.published_state
      ? applyAssemblyDutiesToSchedule(row.published_state, targetDateKeys, desiredByDate, datesWithMatchErrors)
      : null;
    const resultForLog = publishedResult ?? draftResult;
    const changed = Boolean(draftResult?.changed || publishedResult?.changed);

    if (changed) {
      const supabase = createAdminClient();
      const payload: Partial<ScheduleMonthRow> = {};
      if (draftResult?.changed) {
        payload.draft_state = draftResult.schedule;
      }
      if (publishedResult?.changed) {
        payload.published_state = publishedResult.schedule;
      }
      const { error } = await supabase
        .from("schedule_months")
        .update(payload as never)
        .eq("month_key", month);

      if (error) {
        throw new Error(error.message);
      }
    }

    const log = createBaseLog(month, triggerType, {
      total_source_count: parsed.items.length,
      inserted_count: resultForLog?.insertedCount ?? 0,
      updated_count: resultForLog?.updatedCount ?? 0,
      deleted_count: resultForLog?.deletedCount ?? 0,
      skipped_count: resultForLog?.skippedCount ?? 0,
      error_count: errors.length,
      error_details: errors.length > 0 ? errors : null,
    });
    await insertAssemblySyncLog(log);
    console.info("[assembly-sync] 동기화 완료", {
      month,
      triggerType,
      totalSourceCount: log.total_source_count,
      insertedCount: log.inserted_count,
      updatedCount: log.updated_count,
      deletedCount: log.deleted_count,
      skippedCount: log.skipped_count,
      errorCount: log.error_count,
      changed,
    });

    return { ok: true as const, ...log, changed };
  } catch (error) {
    const details = getErrorDetails(error);
    await insertAssemblySyncLog(
      createBaseLog(month, triggerType, {
        error_details: details,
        error_count: details.length,
      }),
    );
    console.warn("[assembly-sync] 동기화 실패", {
      month,
      triggerType,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
