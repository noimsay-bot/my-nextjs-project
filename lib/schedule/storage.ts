import { defaultScheduleState } from "@/lib/schedule/constants";
import { getMonthKey, sanitizeScheduleState } from "@/lib/schedule/engine";
import { presetScheduleMonths } from "@/lib/schedule/preset-schedules.generated";
import type { GeneratedSchedule, ScheduleState } from "@/lib/schedule/types";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

export const SCHEDULE_STATE_EVENT = "j-special-force-schedule-state-updated";
export const SCHEDULE_PERSIST_STATUS_EVENT = "j-special-force-schedule-state-persist-status";

const SCHEDULE_SETTINGS_KEY = "global";
const E2E_SCHEDULE_STATE_SEED_KEY = "codex-e2e-schedule-state";
const E2E_SCHEDULE_STATE_SEED_ENABLED = process.env.NEXT_PUBLIC_E2E === "1";

interface ScheduleSettingsRow {
  key: string;
  state: Partial<ScheduleState> | null;
}

interface ScheduleMonthRow {
  month_key: string;
  draft_state: GeneratedSchedule | null;
}

let scheduleStateCache = sanitizeScheduleState(defaultScheduleState);
let scheduleMonthKeyCache = new Set<string>();
let scheduleRefreshPromise: Promise<ScheduleState> | null = null;
let scheduledPersistTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledPersistState: ScheduleState | null = null;
let scheduledPersistMonthKeys = new Set<string>();
let scheduledPersistPromise: Promise<ScheduleState> | null = null;
let scheduledPersistResolve: ((state: ScheduleState) => void) | null = null;
let scheduledPersistReject: ((error: unknown) => void) | null = null;

export function emitScheduleStateEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SCHEDULE_STATE_EVENT));
}

function emitSchedulePersistStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCHEDULE_PERSIST_STATUS_EVENT, { detail }));
}

function cloneScheduleStateValue(state: ScheduleState) {
  return sanitizeScheduleState(JSON.parse(JSON.stringify(state)) as Partial<ScheduleState>);
}

function readE2eScheduleStateSeed() {
  if (!E2E_SCHEDULE_STATE_SEED_ENABLED || typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(E2E_SCHEDULE_STATE_SEED_KEY);
  if (!raw) return null;
  try {
    return sanitizeScheduleState(JSON.parse(raw) as Partial<ScheduleState>);
  } catch {
    return null;
  }
}

function writeE2eScheduleStateSeed(state: ScheduleState) {
  if (!E2E_SCHEDULE_STATE_SEED_ENABLED || typeof window === "undefined") return;
  window.localStorage.setItem(E2E_SCHEDULE_STATE_SEED_KEY, JSON.stringify(state));
}

function buildSettingsState(state: ScheduleState): Partial<ScheduleState> {
  return {
    year: state.year,
    month: state.month,
    jcheckCount: state.jcheckCount,
    extraHolidays: state.extraHolidays,
    vacations: state.vacations,
    generalTeamPeople: state.generalTeamPeople,
    globalOffPool: state.globalOffPool,
    offPeople: state.offPeople,
    offByCategory: state.offByCategory,
    offExcludeByCategory: state.offExcludeByCategory,
    orders: state.orders,
    pointers: state.pointers,
    monthStartPointers: state.monthStartPointers,
    monthStartNames: state.monthStartNames,
    pendingSnapshotMonthKey: state.pendingSnapshotMonthKey,
    snapshots: state.snapshots,
    currentUser: state.currentUser,
    showMyWork: state.showMyWork,
  };
}

function mergeScheduleRows(
  settingsRow: ScheduleSettingsRow | null,
  monthRows: ScheduleMonthRow[],
  currentUser?: string,
) {
  const base = sanitizeScheduleState(settingsRow?.state ?? defaultScheduleState);
  const storedMonths = monthRows
    .map((row) => row.draft_state)
    .filter((row): row is GeneratedSchedule => Boolean(row))
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  const generatedHistory = Array.from(
    [...presetScheduleMonths, ...storedMonths].reduce((map, schedule) => {
      map.set(schedule.monthKey, schedule);
      return map;
    }, new Map<string, GeneratedSchedule>()).values(),
  ).sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  const targetMonthKey = getMonthKey(base.year, base.month);
  const generated =
    generatedHistory.find((item) => item.monthKey === targetMonthKey) ??
    generatedHistory[generatedHistory.length - 1] ??
    null;

  return sanitizeScheduleState({
    ...base,
    currentUser: currentUser ?? base.currentUser,
    generated,
    generatedHistory,
    editDateKey: null,
    editingMonthKey: null,
    selectedPerson: null,
  });
}

function collectDirtyScheduleMonthKeys(previous: ScheduleState, next: ScheduleState) {
  const previousMap = new Map(previous.generatedHistory.map((item) => [item.monthKey, item] as const));
  const nextMap = new Map(next.generatedHistory.map((item) => [item.monthKey, item] as const));
  const dirtyMonthKeys = new Set<string>();

  for (const monthKey of new Set([...previousMap.keys(), ...nextMap.keys()])) {
    const previousMonth = previousMap.get(monthKey) ?? null;
    const nextMonth = nextMap.get(monthKey) ?? null;
    if (JSON.stringify(previousMonth) !== JSON.stringify(nextMonth)) {
      dirtyMonthKeys.add(monthKey);
    }
  }

  return Array.from(dirtyMonthKeys);
}

async function loadScheduleStateFromDb() {
  const seededState = readE2eScheduleStateSeed();
  if (seededState) {
    scheduleMonthKeyCache = new Set(seededState.generatedHistory.map((item) => item.monthKey));
    return cloneScheduleStateValue(seededState);
  }

  const session = await getPortalSession();
  if (!session?.approved) {
    scheduleMonthKeyCache = new Set();
    return sanitizeScheduleState(defaultScheduleState);
  }

  const supabase = await getPortalSupabaseClient();
  const [{ data: settingsRow, error: settingsError }, { data: monthRows, error: monthError }] = await Promise.all([
    supabase.from("schedule_settings").select("key, state").eq("key", SCHEDULE_SETTINGS_KEY).maybeSingle<ScheduleSettingsRow>(),
    supabase.from("schedule_months").select("month_key, draft_state").order("month_key", { ascending: true }).returns<ScheduleMonthRow[]>(),
  ]);

  if (settingsError || monthError) {
    const schemaError = settingsError ?? monthError;
    if (isSupabaseSchemaMissingError(schemaError)) {
      console.warn(getSupabaseStorageErrorMessage(schemaError, "schedule_settings / schedule_months"));
      scheduleMonthKeyCache = new Set();
      return sanitizeScheduleState({
        ...defaultScheduleState,
        currentUser: session.username,
      });
    }

    throw new Error((settingsError ?? monthError)?.message ?? "근무표 데이터를 불러오지 못했습니다.");
  }

  scheduleMonthKeyCache = new Set((monthRows ?? []).map((row) => row.month_key));
  return mergeScheduleRows(settingsRow ?? null, monthRows ?? [], session.username);
}

async function persistScheduleStateNow(state: ScheduleState, dirtyMonthKeys: string[] = []) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const nextState = cloneScheduleStateValue(state);
  const nextMonthKeySet = new Set(nextState.generatedHistory.map((item) => item.monthKey));
  const nextMonthMap = new Map(nextState.generatedHistory.map((item) => [item.monthKey, item] as const));
  const monthRows = Array.from(new Set(dirtyMonthKeys.filter((monthKey) => nextMonthKeySet.has(monthKey))))
    .map((monthKey) => nextMonthMap.get(monthKey))
    .filter((item): item is GeneratedSchedule => Boolean(item))
    .map((item) => ({
      month_key: item.monthKey,
      draft_state: item,
      updated_by: session.id,
    }));
  const removedMonthKeys = Array.from(scheduleMonthKeyCache).filter((monthKey) => !nextMonthKeySet.has(monthKey));

  const { error: settingsError } = await supabase.from("schedule_settings").upsert({
    key: SCHEDULE_SETTINGS_KEY,
    state: buildSettingsState(nextState),
    updated_by: session.id,
  });
  if (settingsError) {
    throw new Error(getSupabaseStorageErrorMessage(settingsError, "schedule_settings"));
  }

  if (monthRows.length > 0) {
    const { error: upsertError } = await supabase.from("schedule_months").upsert(monthRows);
    if (upsertError) {
      throw new Error(getSupabaseStorageErrorMessage(upsertError, "schedule_months"));
    }
  }

  if (removedMonthKeys.length > 0) {
    const { error: deleteError } = await supabase.from("schedule_months").delete().in("month_key", removedMonthKeys);
    if (deleteError) {
      throw new Error(getSupabaseStorageErrorMessage(deleteError, "schedule_months"));
    }
  }

  scheduleMonthKeyCache = nextMonthKeySet;
  return nextState;
}

function schedulePersist(state: ScheduleState, dirtyMonthKeys: string[] = []) {
  scheduledPersistState = cloneScheduleStateValue(state);
  dirtyMonthKeys.filter(Boolean).forEach((monthKey) => scheduledPersistMonthKeys.add(monthKey));

  if (!scheduledPersistPromise) {
    scheduledPersistPromise = new Promise<ScheduleState>((resolve, reject) => {
      scheduledPersistResolve = resolve;
      scheduledPersistReject = reject;
    });
  }

  if (scheduledPersistTimer) {
    clearTimeout(scheduledPersistTimer);
  }

  scheduledPersistTimer = setTimeout(() => {
    const nextState = scheduledPersistState ? cloneScheduleStateValue(scheduledPersistState) : cloneScheduleStateValue(scheduleStateCache);
    const nextDirtyMonthKeys = Array.from(scheduledPersistMonthKeys);
    scheduledPersistTimer = null;
    scheduledPersistState = null;
    scheduledPersistMonthKeys.clear();

    // Persist only months that actually changed so draft_state JSONB is not rewritten on every keystroke.
    void persistScheduleStateNow(nextState, nextDirtyMonthKeys)
      .then((persisted) => {
        scheduleStateCache = cloneScheduleStateValue(persisted);
        emitScheduleStateEvent();
        scheduledPersistResolve?.(scheduleStateCache);
      })
      .catch(async (error) => {
        try {
          const restored = await refreshScheduleState();
          emitSchedulePersistStatus({
            ok: false,
            message: error instanceof Error ? error.message : "근무표 저장에 실패했습니다. DB 기준 상태로 복구했습니다.",
          });
          scheduledPersistReject?.(
            error instanceof Error ? new Error(`${error.message} (DB 기준 상태로 복구했습니다.)`) : error,
          );
          return restored;
        } finally {
          scheduledPersistPromise = null;
          scheduledPersistResolve = null;
          scheduledPersistReject = null;
        }
      })
      .finally(() => {
        if (scheduledPersistPromise) {
          scheduledPersistPromise = null;
          scheduledPersistResolve = null;
          scheduledPersistReject = null;
        }
      });
  }, 300);

  return scheduledPersistPromise;
}

export function readStoredScheduleState() {
  return cloneScheduleStateValue(scheduleStateCache);
}

export async function refreshScheduleState() {
  if (scheduleRefreshPromise) {
    return scheduleRefreshPromise;
  }

  scheduleRefreshPromise = loadScheduleStateFromDb()
    .then((state) => {
      scheduleStateCache = cloneScheduleStateValue(state);
      emitScheduleStateEvent();
      return readStoredScheduleState();
    })
    .finally(() => {
      scheduleRefreshPromise = null;
    });

  return scheduleRefreshPromise;
}

export function saveScheduleState(state: ScheduleState) {
  const previousState = readStoredScheduleState();
  scheduleStateCache = cloneScheduleStateValue(state);
  emitScheduleStateEvent();
  if (E2E_SCHEDULE_STATE_SEED_ENABLED) {
    writeE2eScheduleStateSeed(scheduleStateCache);
    return Promise.resolve(readStoredScheduleState());
  }
  return schedulePersist(scheduleStateCache, collectDirtyScheduleMonthKeys(previousState, scheduleStateCache));
}
