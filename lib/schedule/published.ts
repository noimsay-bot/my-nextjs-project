import type { GeneratedSchedule } from "@/lib/schedule/types";
import { normalizeGeneratedSchedule } from "@/lib/schedule/engine";
import { readStoredScheduleState, refreshScheduleState } from "@/lib/schedule/storage";
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

const E2E_PUBLISHED_SCHEDULES_SEED_KEY = "codex-e2e-published-schedules";
const E2E_PUBLISHED_SCHEDULES_SEED_ENABLED =
  process.env.NEXT_PUBLIC_E2E === "1" || process.env.NODE_ENV !== "production";

let publishedSchedulesCache: PublishedScheduleItem[] = [];
const publishedRefreshPromises = new Map<string, Promise<PublishedScheduleItem[]>>();

interface RefreshPublishedSchedulesOptions {
  monthKeys?: string[];
  repair?: boolean;
}

function cloneItems(items: PublishedScheduleItem[]) {
  return items.map((item) => ({
    ...item,
    schedule: normalizePublishedSchedule(JSON.parse(JSON.stringify(item.schedule)) as GeneratedSchedule),
  }));
}

function createPublishedTitle(schedule: GeneratedSchedule) {
  return `${schedule.year}년 ${schedule.month}월 근무표`;
}

function readE2ePublishedSchedulesSeed() {
  if (!E2E_PUBLISHED_SCHEDULES_SEED_ENABLED || typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(E2E_PUBLISHED_SCHEDULES_SEED_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PublishedScheduleItem>[];
    if (!Array.isArray(parsed)) return null;

    return parsed
      .map((item) => {
        if (!item?.schedule) return null;
        const schedule = normalizePublishedSchedule(JSON.parse(JSON.stringify(item.schedule)) as GeneratedSchedule);
        return {
          monthKey: item.monthKey ?? schedule.monthKey,
          title: item.title ?? createPublishedTitle(schedule),
          publishedAt: item.publishedAt ?? "",
          schedule,
        } satisfies PublishedScheduleItem;
      })
      .filter((item): item is PublishedScheduleItem => Boolean(item))
      .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  } catch {
    return null;
  }
}

function syncE2ePublishedSchedulesSeed() {
  const seededItems = readE2ePublishedSchedulesSeed();
  if (!seededItems) return null;
  publishedSchedulesCache = cloneItems(seededItems);
  return cloneItems(publishedSchedulesCache);
}

function normalizeAssignments(assignments: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(assignments).filter(([, names]) =>
      Array.isArray(names) && names.some((name) => typeof name === "string" && name.trim().length > 0),
    ),
  );
}

function normalizePublishedSchedule(schedule: GeneratedSchedule): GeneratedSchedule {
  const normalizedSchedule = normalizeGeneratedSchedule(schedule);
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

function normalizePublishedMonthKeys(monthKeys?: string[]) {
  return Array.from(new Set((monthKeys ?? []).map((item) => item.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function getRefreshPublishedSchedulesKey(options: RefreshPublishedSchedulesOptions) {
  const monthKeys = normalizePublishedMonthKeys(options.monthKeys);
  return `${options.repair === true ? "repair" : "read"}:${monthKeys.join(",") || "all"}`;
}

function applyPublishedItemsToCache(items: PublishedScheduleItem[], monthKeys?: string[]) {
  const normalizedMonthKeys = normalizePublishedMonthKeys(monthKeys);
  if (normalizedMonthKeys.length === 0) {
    publishedSchedulesCache = cloneItems(items);
    return;
  }

  const monthKeySet = new Set(normalizedMonthKeys);
  const nextMap = new Map(
    publishedSchedulesCache
      .filter((item) => !monthKeySet.has(item.monthKey))
      .map((item) => [item.monthKey, item] as const),
  );

  items.forEach((item) => {
    nextMap.set(item.monthKey, item);
  });

  publishedSchedulesCache = cloneItems(
    Array.from(nextMap.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey)),
  );
}

function normalizeComparableAssignments(assignments: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(assignments ?? {})
      .filter(([category]) => category !== "일반")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, names]) => [category, [...names]]),
  );
}

function canRepairPublishedGeneralAssignments(
  published: GeneratedSchedule,
  generated: GeneratedSchedule,
) {
  if (published.days.length !== generated.days.length) return false;

  return published.days.every((day, index) => {
    const generatedDay = generated.days[index];
    if (!generatedDay || day.dateKey !== generatedDay.dateKey) return false;
    return (
      JSON.stringify(normalizeComparableAssignments(day.assignments ?? {})) ===
      JSON.stringify(normalizeComparableAssignments(generatedDay.assignments ?? {}))
    );
  });
}

async function repairPublishedItems(items: PublishedScheduleItem[]) {
  if (items.length === 0) return { items, changed: false, changedMonthKeys: [] as string[] };

  await refreshScheduleState();
  const generatedMap = new Map(
    readStoredScheduleState().generatedHistory.map((schedule) => [schedule.monthKey, normalizePublishedSchedule(schedule)]),
  );

  let changed = false;
  const changedMonthKeys: string[] = [];
  const nextItems = items.map((item) => {
    const generated = generatedMap.get(item.monthKey);
    if (!generated) return item;
    if (!canRepairPublishedGeneralAssignments(item.schedule, generated)) return item;
    if (JSON.stringify(item.schedule) === JSON.stringify(generated)) return item;
    changed = true;
    changedMonthKeys.push(item.monthKey);
    return {
      ...item,
      title: createPublishedTitle(generated),
      schedule: generated,
    };
  });

  return { items: nextItems, changed, changedMonthKeys };
}

export function getPublishedSchedules(monthKeys?: string[]): PublishedScheduleItem[] {
  syncE2ePublishedSchedulesSeed();
  const normalizedMonthKeys = normalizePublishedMonthKeys(monthKeys);
  const monthKeySet = normalizedMonthKeys.length > 0 ? new Set(normalizedMonthKeys) : null;
  return cloneItems(publishedSchedulesCache).filter((item) => !monthKeySet || monthKeySet.has(item.monthKey));
}

export async function refreshPublishedSchedules(options: RefreshPublishedSchedulesOptions = {}) {
  const refreshKey = getRefreshPublishedSchedulesKey(options);
  const existingPromise = publishedRefreshPromises.get(refreshKey);
  if (existingPromise) {
    return existingPromise;
  }

  const refreshPromise = (async () => {
    const seededItems = syncE2ePublishedSchedulesSeed();
    if (seededItems) {
      emitPublishedSchedulesEvent();
      return getPublishedSchedules(options.monthKeys);
    }

    const session = await getPortalSession();
    if (!session?.approved) {
      publishedSchedulesCache = [];
      emitPublishedSchedulesEvent();
      return [];
    }

    const supabase = await getPortalSupabaseClient();
    const monthKeys = normalizePublishedMonthKeys(options.monthKeys);
    let query = supabase
      .from("schedule_months")
      .select("month_key, published_state, published_at")
      .not("published_state", "is", null)
      .order("month_key", { ascending: true });

    if (monthKeys.length === 1) {
      query = query.eq("month_key", monthKeys[0]);
    } else if (monthKeys.length > 1) {
      query = query.in("month_key", monthKeys);
    }

    const { data, error } = await query.returns<ScheduleMonthPublishRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "schedule_months"));
        publishedSchedulesCache = [];
        emitPublishedSchedulesEvent();
        return [];
      }

      throw new Error(error.message);
    }

    const repaired = options.repair === true
      ? await repairPublishedItems(rowsToItems(data ?? []))
      : { items: rowsToItems(data ?? []), changed: false, changedMonthKeys: [] as string[] };
    applyPublishedItemsToCache(repaired.items, monthKeys);
    emitPublishedSchedulesEvent();
    if (repaired.changed) {
      await Promise.all(
        repaired.items
          .filter((item) => repaired.changedMonthKeys.includes(item.monthKey))
          .map((item) =>
          persistPublishedItem(item.monthKey, {
            published_state: item.schedule,
            published_at: item.publishedAt || new Date().toISOString(),
          }),
        ),
      );
    }
    return getPublishedSchedules(monthKeys);
  })().finally(() => {
    publishedRefreshPromises.delete(refreshKey);
  });

  publishedRefreshPromises.set(refreshKey, refreshPromise);
  return refreshPromise;
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
