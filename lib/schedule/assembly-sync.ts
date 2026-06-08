import "server-only";

import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { defaultScheduleState } from "@/lib/schedule/constants";
import { sanitizeScheduleState, syncGeneralAssignments } from "@/lib/schedule/engine";
import type { GeneratedSchedule, ScheduleState } from "@/lib/schedule/types";
import {
  applyAssemblyDutiesToSchedule,
  applyAssemblyLeavesToSchedule,
  createAssemblyLeaveMatchErrorKey,
  mapAssemblyLeaveToHubAssignment,
  parseAssemblyExportPayload,
  type AssemblyDutyItem,
  type AssemblyLeaveItem,
  type AssemblySyncErrorDetail,
  type HubAssemblyLeaveAssignment,
  type ParsedAssemblyExport,
} from "@/lib/schedule/assembly-sync-core";

export type { AssemblyDutyItem, AssemblyLeaveItem } from "@/lib/schedule/assembly-sync-core";

export type AssemblySyncTriggerType = "hub_publish" | "assembly_webhook";

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

type ScheduleSettingsRow = {
  key: string;
  state: Partial<ScheduleState> | null;
};

type ProfileRow = {
  id: string;
  name: string;
  approved: boolean;
};

const SCHEDULE_SETTINGS_KEY = "global";
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidMonth(month: string) {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error("month는 YYYY-MM 형식이어야 합니다.");
  }
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

function cloneSchedule(schedule: GeneratedSchedule) {
  return JSON.parse(JSON.stringify(schedule)) as GeneratedSchedule;
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

async function fetchAssemblyExport(month: string): Promise<ParsedAssemblyExport> {
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
  return parseAssemblyExportPayload(payload, month);
}

async function fetchAssemblyExports(months: string[], targetDateKeys: Set<string>): Promise<ParsedAssemblyExport> {
  const results = await Promise.all(months.map((month) => fetchAssemblyExport(month)));
  return results.reduce(
    (accumulator, result) => {
      accumulator.duties.push(...result.duties.filter((item) => targetDateKeys.has(item.date)));
      accumulator.leaves.push(...result.leaves.filter((item) => targetDateKeys.has(item.date)));
      accumulator.hasItemsField = accumulator.hasItemsField && result.hasItemsField;
      accumulator.hasLeavesField = accumulator.hasLeavesField && result.hasLeavesField;
      accumulator.errors.push(
        ...result.errors.filter((item) => !item.date || targetDateKeys.has(item.date)),
      );
      return accumulator;
    },
    {
      duties: [] as AssemblyDutyItem[],
      leaves: [] as AssemblyLeaveItem[],
      hasItemsField: true,
      hasLeavesField: true,
      errors: [] as AssemblySyncErrorDetail[],
    },
  );
}

function isTargetDateKey(dateKey: string | undefined, targetDateKeys: Set<string>) {
  return Boolean(dateKey && DATE_PATTERN.test(dateKey) && targetDateKeys.has(dateKey));
}

function getDutyDateKeysWithSyncErrors(errors: AssemblySyncErrorDetail[], targetDateKeys: Set<string>) {
  return new Set(
    errors
      .filter((error) => isTargetDateKey(error.date, targetDateKeys))
      .filter((error) => Boolean(error.dutyType) || (!error.leaveType && error.stage === "profile_match"))
      .map((error) => error.date as string),
  );
}

function getLeaveCategoriesForError(error: AssemblySyncErrorDetail): HubAssemblyLeaveAssignment[] {
  if (error.assignmentCategory === "연차" || error.assignmentCategory === "제크" || error.assignmentCategory === "기타") {
    return [error.assignmentCategory];
  }
  if (error.leaveType === "대휴") return [];
  if (error.leaveType === "연차") {
    if (error.leaveVariant === "blue") return ["제크"];
    if (error.leaveVariant === "normal") return ["연차"];
    return ["연차", "제크"];
  }
  if (error.leaveType === "공가" || error.leaveType === "검진" || error.leaveType === "경조") {
    return ["기타"];
  }
  return error.leaveType ? ["연차", "제크", "기타"] : [];
}

function getLeaveDateCategoryKeysWithSyncErrors(errors: AssemblySyncErrorDetail[], targetDateKeys: Set<string>) {
  const keys = new Set<string>();
  errors.forEach((error) => {
    if (!isTargetDateKey(error.date, targetDateKeys)) return;
    getLeaveCategoriesForError(error).forEach((category) => {
      keys.add(createAssemblyLeaveMatchErrorKey(error.date as string, category));
    });
  });
  return keys;
}

export async function getAssemblyHolidayAndWeekendDuties(month: string): Promise<AssemblyDutyItem[]> {
  return (await fetchAssemblyExport(month)).duties;
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

async function getScheduleSettingsStateForAssemblySync() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("schedule_settings")
    .select("key, state")
    .eq("key", SCHEDULE_SETTINGS_KEY)
    .maybeSingle<ScheduleSettingsRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data?.state ?? null;
}

function syncGeneralAssignmentsForAssemblySchedule(
  schedule: GeneratedSchedule,
  settingsState: Partial<ScheduleState> | null,
) {
  const clonedSchedule = cloneSchedule(schedule);
  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    ...(settingsState ?? {}),
    year: clonedSchedule.year,
    month: clonedSchedule.month,
    generated: clonedSchedule,
    generatedHistory: [clonedSchedule],
  });
  const targetSchedule =
    state.generatedHistory.find((item) => item.monthKey === clonedSchedule.monthKey) ??
    state.generated ??
    clonedSchedule;

  syncGeneralAssignments(state, targetSchedule.days, state.generalTeamPeople, {
    bigEvents: targetSchedule.big_events,
    previousBigEvents: targetSchedule.big_events,
    scheduleYear: targetSchedule.year,
    scheduleMonth: targetSchedule.month,
  });

  return targetSchedule;
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

function buildDesiredAssemblyLeaveNamesByDateCategory(
  leaves: AssemblyLeaveItem[],
  profileMap: Map<string, ProfileRow[]>,
  errors: AssemblySyncErrorDetail[],
) {
  const desiredByDateCategory = new Map<string, Map<HubAssemblyLeaveAssignment, string[]>>();
  const dateCategoryWithMatchErrors = new Set<string>();

  leaves.forEach((leave) => {
    const assignmentCategory = mapAssemblyLeaveToHubAssignment(leave);
    if (!assignmentCategory) return;

    const matches = profileMap.get(leave.memberName) ?? [];
    if (matches.length !== 1) {
      dateCategoryWithMatchErrors.add(createAssemblyLeaveMatchErrorKey(leave.date, assignmentCategory));
      errors.push({
        stage: "profile_match",
        message: matches.length === 0 ? "허브 사용자 이름과 매칭되지 않았습니다." : "동명이인으로 인해 안전하게 매칭할 수 없습니다.",
        date: leave.date,
        leaveType: leave.leaveType,
        leaveVariant: leave.leaveVariant,
        assignmentCategory,
        memberName: leave.memberName,
      });
      return;
    }

    const nextByCategory = desiredByDateCategory.get(leave.date) ?? new Map<HubAssemblyLeaveAssignment, string[]>();
    const nextNames = nextByCategory.get(assignmentCategory) ?? [];
    nextNames.push(matches[0].name.trim());
    nextByCategory.set(assignmentCategory, Array.from(new Set(nextNames)));
    desiredByDateCategory.set(leave.date, nextByCategory);
  });

  return { desiredByDateCategory, dateCategoryWithMatchErrors };
}

type ApplyCounts = {
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
};

function sumApplyCounts(...results: Array<ApplyCounts | null | undefined>): ApplyCounts {
  const total: ApplyCounts = {
    insertedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    skippedCount: 0,
  };

  results.forEach((result) => {
    if (!result) return;
    total.insertedCount += result.insertedCount;
    total.updatedCount += result.updatedCount;
    total.deletedCount += result.deletedCount;
    total.skippedCount += result.skippedCount;
  });

  return total;
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

    const settingsState = await getScheduleSettingsStateForAssemblySync();
    const targetDateKeys = getScheduleDateKeysForAssemblySync(row);
    const sourceMonths = getSourceMonthsForScheduleDateKeys(targetDateKeys);
    const parsed = await fetchAssemblyExports(sourceMonths.length > 0 ? sourceMonths : [month], targetDateKeys);
    const errors = [...parsed.errors];
    const profileMap = await getApprovedProfileNameMap();
    const dutySync = parsed.hasItemsField
      ? buildDesiredAssemblyNamesByDate(parsed.duties, profileMap, errors)
      : null;
    const leaveSync = parsed.hasLeavesField
      ? buildDesiredAssemblyLeaveNamesByDateCategory(parsed.leaves, profileMap, errors)
      : null;
    const dutyDateKeysWithSyncErrors = new Set([
      ...(dutySync?.datesWithMatchErrors ?? []),
      ...getDutyDateKeysWithSyncErrors(errors, targetDateKeys),
    ]);
    const leaveDateCategoryKeysWithSyncErrors = new Set([
      ...(leaveSync?.dateCategoryWithMatchErrors ?? []),
      ...getLeaveDateCategoryKeysWithSyncErrors(errors, targetDateKeys),
    ]);
    const draftDutyResult = row.draft_state
      && dutySync
      ? applyAssemblyDutiesToSchedule(row.draft_state, targetDateKeys, dutySync.desiredByDate, dutyDateKeysWithSyncErrors)
      : null;
    const publishedDutyResult = row.published_state
      && dutySync
      ? applyAssemblyDutiesToSchedule(row.published_state, targetDateKeys, dutySync.desiredByDate, dutyDateKeysWithSyncErrors)
      : null;
    const draftScheduleForLeaveSync = draftDutyResult?.schedule ?? row.draft_state;
    const publishedScheduleForLeaveSync = publishedDutyResult?.schedule ?? row.published_state;
    const draftLeaveResult = leaveSync && draftScheduleForLeaveSync
      ? applyAssemblyLeavesToSchedule(
        draftScheduleForLeaveSync,
        targetDateKeys,
        leaveSync.desiredByDateCategory,
        leaveDateCategoryKeysWithSyncErrors,
      )
      : null;
    const publishedLeaveResult = leaveSync && publishedScheduleForLeaveSync
      ? applyAssemblyLeavesToSchedule(
        publishedScheduleForLeaveSync,
        targetDateKeys,
        leaveSync.desiredByDateCategory,
        leaveDateCategoryKeysWithSyncErrors,
      )
      : null;
    const draftFinalSchedule = draftLeaveResult?.schedule ?? draftDutyResult?.schedule ?? null;
    const publishedFinalSchedule = publishedLeaveResult?.schedule ?? publishedDutyResult?.schedule ?? null;
    const draftSyncedSchedule = draftFinalSchedule
      ? syncGeneralAssignmentsForAssemblySchedule(draftFinalSchedule, settingsState)
      : null;
    const publishedSyncedSchedule = publishedFinalSchedule
      ? syncGeneralAssignmentsForAssemblySchedule(publishedFinalSchedule, settingsState)
      : null;
    const resultForLog = row.published_state
      ? sumApplyCounts(publishedDutyResult, publishedLeaveResult)
      : sumApplyCounts(draftDutyResult, draftLeaveResult);
    const draftChanged = Boolean(
      draftSyncedSchedule && row.draft_state && JSON.stringify(row.draft_state) !== JSON.stringify(draftSyncedSchedule),
    );
    const publishedChanged = Boolean(
      publishedSyncedSchedule &&
        row.published_state &&
        JSON.stringify(row.published_state) !== JSON.stringify(publishedSyncedSchedule),
    );
    const changed = draftChanged || publishedChanged;

    if (changed) {
      const supabase = createAdminClient();
      const payload: Partial<ScheduleMonthRow> = {};
      if (draftChanged && draftSyncedSchedule) {
        payload.draft_state = draftSyncedSchedule;
      }
      if (publishedChanged && publishedSyncedSchedule) {
        payload.published_state = publishedSyncedSchedule;
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
      total_source_count: parsed.duties.length + (parsed.hasLeavesField ? parsed.leaves.length : 0),
      inserted_count: resultForLog.insertedCount,
      updated_count: resultForLog.updatedCount,
      deleted_count: resultForLog.deletedCount,
      skipped_count: resultForLog.skippedCount,
      error_count: errors.length,
      error_details: errors.length > 0 ? errors : null,
    });
    await insertAssemblySyncLog(log);
    console.info("[assembly-sync] 동기화 완료", {
      month,
      triggerType,
      totalSourceCount: log.total_source_count,
      hasLeavesField: parsed.hasLeavesField,
      hasItemsField: parsed.hasItemsField,
      insertedCount: log.inserted_count,
      updatedCount: log.updated_count,
      deletedCount: log.deleted_count,
      skippedCount: log.skipped_count,
      errorCount: log.error_count,
      changed,
    });

    return { ok: true as const, ...log, hasItemsField: parsed.hasItemsField, hasLeavesField: parsed.hasLeavesField, changed };
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
