import type { GeneratedSchedule } from "@/lib/schedule/types";
import { applyGeneralAssignmentsToSchedule, normalizeGeneratedSchedule } from "@/lib/schedule/engine";
import { readStoredScheduleState } from "@/lib/schedule/storage";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

export interface PublishedScheduleItem {
  monthKey: string;
  title: string;
  publishedAt: string;
  schedule: GeneratedSchedule;
}

interface ScheduleMonthPublishRow {
  month_key: string;
  published_state: GeneratedSchedule | null;
  published_at: string | null;
}

export const PUBLISHED_SCHEDULES_EVENT = "j-special-force-published-schedules-updated";
export const PUBLISHED_SCHEDULES_STATUS_EVENT = "j-special-force-published-schedules-status";

let publishedSchedulesCache: PublishedScheduleItem[] = [];
let publishedRefreshPromise: Promise<PublishedScheduleItem[]> | null = null;

function cloneItems(items: PublishedScheduleItem[]) {
  return items.map((item) => ({
    ...item,
    schedule: normalizePublishedSchedule(JSON.parse(JSON.stringify(item.schedule)) as GeneratedSchedule),
  }));
}

function createPublishedTitle(schedule: GeneratedSchedule) {
  return `${schedule.year}년 ${schedule.month}월 근무표`;
}

function normalizeAssignments(assignments: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(assignments).filter(([, names]) =>
      Array.isArray(names) && names.some((name) => typeof name === "string" && name.trim().length > 0),
    ),
  );
}

function normalizePublishedSchedule(schedule: GeneratedSchedule): GeneratedSchedule {
  const currentState = readStoredScheduleState();
  const normalizedSchedule = applyGeneralAssignmentsToSchedule(
    normalizeGeneratedSchedule(schedule),
    currentState.generalTeamPeople,
    currentState.offPeople,
  );
  return {
    ...normalizedSchedule,
    days: normalizedSchedule.days.map((day) => {
      const assignments = normalizeAssignments(day.assignments ?? {});
      return {
        ...day,
        assignments,
        manualExtras: (day.manualExtras ?? []).filter((category) => Boolean(assignments[category]?.length)),
      };
    }),
  };
}

function emitPublishedSchedulesEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PUBLISHED_SCHEDULES_EVENT));
}

function emitPublishedSchedulesStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PUBLISHED_SCHEDULES_STATUS_EVENT, { detail }));
}

function rowsToItems(rows: ScheduleMonthPublishRow[]) {
  return rows
    .filter((row) => row.published_state)
    .map((row) => ({
      monthKey: row.month_key,
      title: createPublishedTitle(normalizePublishedSchedule(row.published_state as GeneratedSchedule)),
      publishedAt: row.published_at ?? "",
      schedule: normalizePublishedSchedule(row.published_state as GeneratedSchedule),
    }))
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

export function getPublishedSchedules(): PublishedScheduleItem[] {
  return cloneItems(publishedSchedulesCache);
}

export async function refreshPublishedSchedules() {
  if (publishedRefreshPromise) {
    return publishedRefreshPromise;
  }

  publishedRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      publishedSchedulesCache = [];
      emitPublishedSchedulesEvent();
      return [];
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("schedule_months")
      .select("month_key, published_state, published_at")
      .not("published_state", "is", null)
      .order("month_key", { ascending: true })
      .returns<ScheduleMonthPublishRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "schedule_months"));
        publishedSchedulesCache = [];
        emitPublishedSchedulesEvent();
        return [];
      }

      throw new Error(error.message);
    }

    publishedSchedulesCache = cloneItems(rowsToItems(data ?? []));
    emitPublishedSchedulesEvent();
    return getPublishedSchedules();
  })().finally(() => {
    publishedRefreshPromise = null;
  });

  return publishedRefreshPromise;
}

async function persistPublishedItem(monthKey: string, payload: { published_state: GeneratedSchedule | null; published_at: string | null }) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("schedule_months").upsert({
    month_key: monthKey,
    ...payload,
    updated_by: session.id,
  });

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "schedule_months"));
  }
}

export async function savePublishedSchedules(items: PublishedScheduleItem[]) {
  const previous = cloneItems(publishedSchedulesCache);
  publishedSchedulesCache = cloneItems(items).sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  emitPublishedSchedulesEvent();

  try {
    await Promise.all(
      publishedSchedulesCache.map((item) =>
        persistPublishedItem(item.monthKey, {
          published_state: item.schedule,
          published_at: item.publishedAt || new Date().toISOString(),
        }),
      ),
    );
  } catch (error) {
    emitPublishedSchedulesStatus({
      ok: false,
      message: "게시 근무표 저장에 실패했습니다. DB 기준 상태로 복구합니다.",
    });
    publishedSchedulesCache = previous;
    emitPublishedSchedulesEvent();
    await refreshPublishedSchedules();
    throw error;
  }

  return getPublishedSchedules();
}

export async function publishSchedule(schedule: GeneratedSchedule) {
  const nextItem: PublishedScheduleItem = {
    monthKey: schedule.monthKey,
    title: createPublishedTitle(schedule),
    publishedAt: new Date().toISOString(),
    schedule: normalizePublishedSchedule(JSON.parse(JSON.stringify(schedule)) as GeneratedSchedule),
  };

  const previous = cloneItems(publishedSchedulesCache);
  const next = [nextItem, ...previous.filter((item) => item.monthKey !== schedule.monthKey)].sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );

  publishedSchedulesCache = cloneItems(next);
  emitPublishedSchedulesEvent();

  try {
    await persistPublishedItem(schedule.monthKey, {
      published_state: nextItem.schedule,
      published_at: nextItem.publishedAt,
    });
  } catch (error) {
    emitPublishedSchedulesStatus({
      ok: false,
      message: "근무표 게시에 실패했습니다. DB 기준 상태로 복구합니다.",
    });
    publishedSchedulesCache = previous;
    emitPublishedSchedulesEvent();
    await refreshPublishedSchedules();
    throw error;
  }

  return nextItem;
}

export function removePublishedSchedule(monthKey: string) {
  const previous = cloneItems(publishedSchedulesCache);
  publishedSchedulesCache = previous.filter((item) => item.monthKey !== monthKey);
  emitPublishedSchedulesEvent();

  void persistPublishedItem(monthKey, {
    published_state: null,
    published_at: null,
  }).catch(async () => {
    emitPublishedSchedulesStatus({
      ok: false,
      message: "게시 근무표 삭제에 실패했습니다. DB 기준 상태로 복구합니다.",
    });
    publishedSchedulesCache = previous;
    emitPublishedSchedulesEvent();
    await refreshPublishedSchedules();
  });

  return getPublishedSchedules();
}
