import "server-only";

import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { GeneratedSchedule } from "@/lib/schedule/types";
import {
  applyAssemblyDutiesToSchedule,
  parseAssemblyExportPayload,
  type AssemblyDutyItem,
  type AssemblyLeaveItem,
  type AssemblySyncErrorDetail,
  type ParsedAssemblyExport,
} from "@/lib/schedule/assembly-sync-core";
import { buildAssemblySyncRetryState, detectScheduleMonthConflict } from "@/lib/schedule/optimistic-lock";

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
  updated_at: string | null;
};

type ProfileRow = {
  id: string;
  name: string;
  approved: boolean;
};

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

export async function getAssemblyHolidayAndWeekendDuties(month: string): Promise<AssemblyDutyItem[]> {
  return (await fetchAssemblyExport(month)).duties;
}

async function getScheduleMonthForAssemblySync(month: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("schedule_months")
    .select("month_key, draft_state, published_state, published_at, updated_at")
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

function buildAssemblyDutyWriteAttempt(
  row: ScheduleMonthRow,
  dutySync: ReturnType<typeof buildDesiredAssemblyNamesByDate> | null,
  targetDateKeys: Set<string>,
  dutyDateKeysWithSyncErrors: Set<string>,
) {
  const draftDutyResult = row.draft_state && dutySync
    ? applyAssemblyDutiesToSchedule(row.draft_state, targetDateKeys, dutySync.desiredByDate, dutyDateKeysWithSyncErrors)
    : null;
  const publishedDutyResult = row.published_state && dutySync
    ? applyAssemblyDutiesToSchedule(row.published_state, targetDateKeys, dutySync.desiredByDate, dutyDateKeysWithSyncErrors)
    : null;
  const writePayload: Partial<ScheduleMonthRow> = {};

  if (draftDutyResult?.changed && draftDutyResult.schedule) {
    writePayload.draft_state = draftDutyResult.schedule;
  }
  if (publishedDutyResult?.changed && publishedDutyResult.schedule) {
    writePayload.published_state = publishedDutyResult.schedule;
  }

  return {
    draftDutyResult,
    publishedDutyResult,
    writePayload,
    changed: Object.keys(writePayload).length > 0,
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
    const parsed = await fetchAssemblyExports(sourceMonths.length > 0 ? sourceMonths : [month], targetDateKeys);
    const errors = parsed.errors.filter(
      (error) =>
        !error.leaveType &&
        !error.assignmentCategory &&
        !error.message.includes("휴가 동기화"),
    );
    const profileMap = await getApprovedProfileNameMap();
    const dutySync = parsed.hasItemsField
      ? buildDesiredAssemblyNamesByDate(parsed.duties, profileMap, errors)
      : null;
    const dutyDateKeysWithSyncErrors = new Set([
      ...(dutySync?.datesWithMatchErrors ?? []),
      ...getDutyDateKeysWithSyncErrors(errors, targetDateKeys),
    ]);
    const initialWriteAttempt = buildAssemblyDutyWriteAttempt(
      row,
      dutySync,
      targetDateKeys,
      dutyDateKeysWithSyncErrors,
    );
    const resultForLog = row.published_state
      ? sumApplyCounts(initialWriteAttempt.publishedDutyResult)
      : sumApplyCounts(initialWriteAttempt.draftDutyResult);
    let changed = initialWriteAttempt.changed;

    if (changed) {
      const ASSEMBLY_SYNC_DELAY_BASE_MS = 100;
      let attempt = 0;

      for (;;) {
        const freshRow = await getScheduleMonthForAssemblySync(month);
        if (!freshRow?.draft_state && !freshRow?.published_state) {
          console.warn("[assembly-sync] 최신 허브 근무표가 없어 웹훅 쓰기를 중단합니다.", { month, triggerType });
          changed = false;
          break;
        }

        const writeAttempt = buildAssemblyDutyWriteAttempt(
          freshRow,
          dutySync,
          targetDateKeys,
          dutyDateKeysWithSyncErrors,
        );
        if (!writeAttempt.changed) {
          changed = false;
          break;
        }

        if (!freshRow.updated_at) {
          // updated_at을 모르는 경우에도 최초 스냅샷이 아니라 최신 행에 국회 칸만 재적용한다.
          const supabase = createAdminClient();
          const { error } = await supabase
            .from("schedule_months")
            .update(writeAttempt.writePayload as never)
            .eq("month_key", month);
          if (error) throw new Error(error.message);
          break;
        }

        const retryState = buildAssemblySyncRetryState(freshRow.updated_at, attempt);
        if (retryState.exhausted) {
          console.warn("[assembly-sync] optimistic lock: 최대 재시도 초과, 웹훅이 허브에 양보합니다.", {
            month,
            triggerType,
          });
          changed = false;
          break;
        }

        const delayMs = retryState.delayMs(ASSEMBLY_SYNC_DELAY_BASE_MS);
        if (delayMs > 0) {
          await new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
        }

        const supabase = createAdminClient();
        const { data: updatedRows, error: updateError } = await supabase
          .from("schedule_months")
          .update(writeAttempt.writePayload as never)
          .eq("month_key", month)
          .eq("updated_at", retryState.readUpdatedAt)
          .select("month_key");

        if (updateError) {
          throw new Error(updateError.message);
        }

        if (!detectScheduleMonthConflict(updatedRows)) break;

        attempt += 1;
      }
    }

    const log = createBaseLog(month, triggerType, {
      total_source_count: parsed.duties.length,
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
