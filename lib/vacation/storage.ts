"use client";

import { getSession, isReadOnlyPortalRole } from "@/lib/auth/storage";
import {
  getAssignmentDisplayRank,
  getScheduleCategoryLabel,
} from "@/lib/schedule/constants";
import {
  formatVacationEntry,
  getMonthKey,
  isDeskPriorityVacationEntry,
  parseVacationMap,
  parseVacationEntry,
} from "@/lib/schedule/engine";
import { getPublishedSchedules } from "@/lib/schedule/published";
import { readStoredScheduleState, saveScheduleState } from "@/lib/schedule/storage";
import { DaySchedule, GeneratedSchedule, VacationType } from "@/lib/schedule/types";
import { getDeskPriorityVacationMap } from "@/lib/schedule/desk-records";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
  isSupabaseRequestTimeoutError,
} from "@/lib/supabase/portal";

export const VACATION_STORAGE_KEY = "j-special-force-vacations-v1";
export const VACATION_EVENT = "j-special-force-vacations-changed";
export const VACATION_STATUS_EVENT = "j-special-force-vacations-status";
export const DEFAULT_VACATION_CAPACITY = 5;
const VACATION_SETTINGS_ROW_ID = "vacation_request_access";

export interface VacationRequest {
  id: string;
  requesterId: string | null;
  requesterName: string;
  type: VacationType;
  year: number;
  month: number;
  monthKey: string;
  dates: string[];
  rawDates: string;
  createdAt: string;
}

export interface VacationMonthState {
  monthKey: string;
  year: number;
  month: number;
  managedDateKeys: string[];
  limits: Record<string, number>;
  annualWinners: Record<string, string[]>;
  compensatoryWinners: Record<string, string[]>;
  updatedAt: string;
  appliedAt: string | null;
}

export interface VacationLotteryResult {
  ok: boolean;
  monthState: VacationMonthState | null;
  applicantCount: number;
  winnerCount: number;
  message: string;
}

export interface VacationStore {
  requests: VacationRequest[];
  months: Record<string, VacationMonthState>;
  requestOpen: boolean;
}

interface VacationRequestRow {
  id: string;
  requester_id: string;
  requester_name: string;
  type: VacationType;
  year: number;
  month: number;
  month_key: string;
  requested_dates: string[] | null;
  raw_dates: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface VacationMonthRow {
  month_key: string;
  managed_date_keys: string[] | null;
  limits: Record<string, number> | null;
  annual_winners: Record<string, string[]> | null;
  compensatory_winners: Record<string, string[]> | null;
  applied_at: string | null;
  updated_at: string;
}

interface VacationSettingsRow {
  id: string;
  is_request_open: boolean;
  updated_at: string;
}

let vacationStoreCache = createEmptyStore();
let vacationRefreshPromise: Promise<VacationStore> | null = null;
let vacationPersistPromise: Promise<{ ok: boolean; message?: string }> | null = null;

function nowLabel() {
  return new Date().toLocaleString("ko-KR");
}

function createEmptyStore(): VacationStore {
  return {
    requests: [],
    months: {},
    requestOpen: false,
  };
}

function uniqueNames(names: string[]) {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
}

function uniqueDateKeys(dateKeys: string[]) {
  return Array.from(new Set(dateKeys)).sort((left, right) => left.localeCompare(right));
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getMonthDateKeys(year: number, month: number) {
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => formatDateKey(year, month, index + 1));
}

function isWeekendDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function isMonthDateKey(dateKey: string, year: number, month: number) {
  return dateKey.startsWith(`${getMonthKey(year, month)}-`);
}

function sanitizeManagedDateKeys(dateKeys: string[], year: number, month: number) {
  return uniqueDateKeys(dateKeys).filter((dateKey) => !isWeekendDateKey(dateKey));
}

function sanitizeMonthState(input: Partial<VacationMonthState> | undefined, year: number, month: number): VacationMonthState {
  return {
    monthKey: getMonthKey(year, month),
    year,
    month,
    managedDateKeys: sanitizeManagedDateKeys(Array.isArray(input?.managedDateKeys) ? input.managedDateKeys : [], year, month),
    limits: Object.fromEntries(
      Object.entries(input?.limits ?? {})
        .filter(([dateKey]) => !isWeekendDateKey(dateKey))
        .map(([dateKey, value]) => [dateKey, Math.max(1, Math.min(10, Number(value) || DEFAULT_VACATION_CAPACITY))]),
    ),
    annualWinners: Object.fromEntries(
      Object.entries(input?.annualWinners ?? {})
        .filter(([dateKey]) => !isWeekendDateKey(dateKey))
        .map(([dateKey, names]) => [dateKey, uniqueNames(Array.isArray(names) ? names : [])]),
    ),
    compensatoryWinners: Object.fromEntries(
      Object.entries(input?.compensatoryWinners ?? {})
        .filter(([dateKey]) => !isWeekendDateKey(dateKey))
        .map(([dateKey, names]) => [dateKey, uniqueNames(Array.isArray(names) ? names : [])]),
    ),
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : nowLabel(),
    appliedAt: typeof input?.appliedAt === "string" ? input.appliedAt : null,
  };
}

function sanitizeVacationStore(input?: Partial<VacationStore> | null): VacationStore {
  const requests = Array.isArray(input?.requests)
    ? input.requests
        .map((request) => {
          const year = Number(request.year);
          const month = Number(request.month);
          const monthKey = getMonthKey(year, month);
          const dates = uniqueDateKeys(Array.isArray(request.dates) ? request.dates : []).filter((dateKey) => !isWeekendDateKey(dateKey));
          return {
            id: typeof request.id === "string" ? request.id : crypto.randomUUID(),
            requesterId: typeof request.requesterId === "string" ? request.requesterId : null,
            requesterName: typeof request.requesterName === "string" ? request.requesterName.trim() : "",
            type: request.type === "대휴" ? "대휴" : "연차",
            year,
            month,
            monthKey,
            dates,
            rawDates: typeof request.rawDates === "string" ? request.rawDates : formatRawDates(dates),
            createdAt: typeof request.createdAt === "string" ? request.createdAt : nowLabel(),
          } satisfies VacationRequest;
        })
        .filter((request) => request.requesterName && request.dates.length > 0)
    : [];

  const months = Object.fromEntries(
    Object.entries(input?.months ?? {}).map(([monthKey, value]) => {
      const [yearText, monthText] = monthKey.split("-");
      return [monthKey, sanitizeMonthState(value, Number(yearText), Number(monthText))];
    }),
  );

  return {
    requests,
    months,
    requestOpen: Boolean(input?.requestOpen),
  };
}

function readStore() {
  return sanitizeVacationStore(vacationStoreCache);
}

function emitVacationEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VACATION_EVENT));
}

function emitVacationStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VACATION_STATUS_EVENT, { detail }));
}

function rowToVacationRequest(row: VacationRequestRow): VacationRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    type: row.type,
    year: row.year,
    month: row.month,
    monthKey: row.month_key,
    dates: uniqueDateKeys(Array.isArray(row.requested_dates) ? row.requested_dates : []),
    rawDates: row.raw_dates,
    createdAt: row.created_at,
  };
}

function rowToVacationMonthState(row: VacationMonthRow) {
  const [yearText, monthText] = row.month_key.split("-");
  return sanitizeMonthState(
    {
      monthKey: row.month_key,
      managedDateKeys: row.managed_date_keys ?? [],
      limits: row.limits ?? {},
      annualWinners: row.annual_winners ?? {},
      compensatoryWinners: row.compensatory_winners ?? {},
      appliedAt: row.applied_at,
      updatedAt: row.updated_at,
    },
    Number(yearText),
    Number(monthText),
  );
}

function rowsToVacationStore(input: {
  requestRows?: VacationRequestRow[] | null;
  monthRows?: VacationMonthRow[] | null;
  settingsRows?: VacationSettingsRow[] | null;
  fallbackStore?: VacationStore;
}) {
  const fallbackStore = input.fallbackStore ?? createEmptyStore();
  return sanitizeVacationStore({
    requests: input.requestRows
      ? input.requestRows.map((row) => rowToVacationRequest(row))
      : fallbackStore.requests,
    months: input.monthRows
      ? Object.fromEntries(input.monthRows.map((row) => [row.month_key, rowToVacationMonthState(row)]))
      : fallbackStore.months,
    requestOpen:
      typeof input.settingsRows?.[0]?.is_request_open === "boolean"
        ? Boolean(input.settingsRows[0].is_request_open)
        : fallbackStore.requestOpen,
  });
}

function cloneVacationStore(store: VacationStore) {
  const sanitized = sanitizeVacationStore(store);
  return JSON.parse(JSON.stringify(sanitized)) as VacationStore;
}

async function persistVacationStore(store: VacationStore) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  const canManageVacationMonths =
    session.role === "desk" || session.role === "admin" || session.role === "team_lead";

  const supabase = await getPortalSupabaseClient();
  const sanitized = sanitizeVacationStore(store);

  const ownRequestRows = sanitized.requests
    .filter((request) =>
      request.requesterId === session.id ||
      (!request.requesterId && request.requesterName.trim() === session.username.trim()),
    )
    .map((request) => ({
      id: request.id,
      requester_id: session.id,
      requester_name: request.requesterName,
      type: request.type,
      year: request.year,
      month: request.month,
      month_key: request.monthKey,
      requested_dates: request.dates,
      raw_dates: request.rawDates,
      status: "submitted",
    }));

  const monthRows = Object.values(sanitized.months).map((month) => ({
    month_key: month.monthKey,
    managed_date_keys: month.managedDateKeys,
    limits: month.limits,
    annual_winners: month.annualWinners,
    compensatory_winners: month.compensatoryWinners,
    applied_at: month.appliedAt,
  }));
  const settingsRow = {
    id: VACATION_SETTINGS_ROW_ID,
    is_request_open: sanitized.requestOpen,
  };

  const [
    { data: existingRequests, error: requestSelectError },
    { error: requestUpsertError },
    { error: monthUpsertError },
    { error: settingsUpsertError },
  ] =
    await Promise.all([
      supabase.from("vacation_requests").select("id").eq("requester_id", session.id),
      ownRequestRows.length > 0 ? supabase.from("vacation_requests").upsert(ownRequestRows) : Promise.resolve({ error: null }),
      canManageVacationMonths && monthRows.length > 0
        ? supabase.from("vacation_months").upsert(monthRows)
        : Promise.resolve({ error: null }),
      canManageVacationMonths
        ? supabase.from("vacation_settings").upsert(settingsRow)
        : Promise.resolve({ error: null }),
    ]);

  if (requestSelectError) {
    throw new Error(getSupabaseStorageErrorMessage(requestSelectError, "vacation_requests"));
  }
  if (requestUpsertError) {
    throw new Error(getSupabaseStorageErrorMessage(requestUpsertError, "vacation_requests"));
  }
  if (monthUpsertError) {
    throw new Error(getSupabaseStorageErrorMessage(monthUpsertError, "vacation_months"));
  }
  if (settingsUpsertError) {
    throw new Error(getSupabaseStorageErrorMessage(settingsUpsertError, "vacation_settings"));
  }

  const staleRequestIds = (existingRequests ?? [])
    .map((row) => row.id as string)
    .filter((id) => !ownRequestRows.some((request) => request.id === id));

  if (staleRequestIds.length > 0) {
    const { error: deleteError } = await supabase.from("vacation_requests").delete().in("id", staleRequestIds);
    if (deleteError) {
      throw new Error(getSupabaseStorageErrorMessage(deleteError, "vacation_requests"));
    }
  }

  return cloneVacationStore(sanitized);
}

function writeStore(store: VacationStore) {
  const previous = cloneVacationStore(vacationStoreCache);
  vacationStoreCache = cloneVacationStore(store);
  emitVacationEvent();

  vacationPersistPromise = persistVacationStore(vacationStoreCache)
    .then((persistedStore) => {
      vacationStoreCache = cloneVacationStore(persistedStore);
      emitVacationEvent();
      return { ok: true as const };
    })
    .catch(async (error) => {
      const message =
        error instanceof Error && error.message
          ? `${error.message} DB 기준 상태로 복구합니다.`
          : "휴가 데이터 저장에 실패했습니다. DB 기준 상태로 복구합니다.";
      emitVacationStatus({
        ok: false,
        message,
      });
      vacationStoreCache = previous;
      emitVacationEvent();
      await refreshVacationStore();
      return { ok: false as const, message };
    })
    .finally(() => {
      vacationPersistPromise = null;
    });
}

export async function waitForVacationStoreWrite() {
  return vacationPersistPromise ?? { ok: true as const };
}

export async function refreshVacationStore() {
  if (vacationRefreshPromise) {
    return vacationRefreshPromise;
  }

  vacationRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      vacationStoreCache = createEmptyStore();
      emitVacationEvent();
      return cloneVacationStore(vacationStoreCache);
    }

    const supabase = await getPortalSupabaseClient();
    const [
      { data: requestRows, error: requestError },
      { data: monthRows, error: monthError },
      { data: settingsRows, error: settingsError },
    ] = await Promise.all([
      supabase
        .from("vacation_requests")
        .select("id, requester_id, requester_name, type, year, month, month_key, requested_dates, raw_dates, status, created_at, updated_at")
        .order("created_at", { ascending: false })
        .returns<VacationRequestRow[]>(),
      supabase
        .from("vacation_months")
        .select("month_key, managed_date_keys, limits, annual_winners, compensatory_winners, applied_at, updated_at")
        .returns<VacationMonthRow[]>(),
      supabase
        .from("vacation_settings")
        .select("id, is_request_open, updated_at")
        .eq("id", VACATION_SETTINGS_ROW_ID)
        .returns<VacationSettingsRow[]>(),
    ]);

    if (requestError || monthError || settingsError) {
      const requestOrMonthSchemaError = requestError ?? monthError;
      const settingsSchemaMissing = Boolean(settingsError && isSupabaseSchemaMissingError(settingsError));
      const schemaError = requestOrMonthSchemaError ?? (settingsSchemaMissing ? null : settingsError);
      if (settingsSchemaMissing && !requestOrMonthSchemaError) {
        vacationStoreCache = rowsToVacationStore({
          requestRows,
          monthRows,
          settingsRows,
          fallbackStore: createEmptyStore(),
        });
        emitVacationEvent();
        return cloneVacationStore(vacationStoreCache);
      }
      if (schemaError && isSupabaseSchemaMissingError(schemaError)) {
        console.warn(getSupabaseStorageErrorMessage(schemaError, "vacation_requests / vacation_months / vacation_settings"));
        vacationStoreCache = createEmptyStore();
        emitVacationEvent();
        return cloneVacationStore(vacationStoreCache);
      }

      if ([requestError, monthError, settingsError].some((error) => isSupabaseRequestTimeoutError(error))) {
        console.warn("휴가 데이터를 불러오는 중 일부 요청이 시간 초과되어 캐시 기준으로 표시합니다.");
        vacationStoreCache = rowsToVacationStore({
          requestRows: requestError ? null : requestRows,
          monthRows: monthError ? null : monthRows,
          settingsRows: settingsError ? null : settingsRows,
          fallbackStore: vacationStoreCache,
        });
        emitVacationEvent();
        return cloneVacationStore(vacationStoreCache);
      }

      if (requestError) {
        throw new Error(requestError.message);
      }
      if (monthError) {
        throw new Error(monthError.message);
      }
      throw new Error(settingsError?.message ?? "휴가 데이터를 불러오지 못했습니다.");
    }

    vacationStoreCache = rowsToVacationStore({ requestRows, monthRows, settingsRows });
    emitVacationEvent();
    return cloneVacationStore(vacationStoreCache);
  })().finally(() => {
    vacationRefreshPromise = null;
  });

  return vacationRefreshPromise;
}

function readScheduleState() {
  return readStoredScheduleState();
}

function readPublishedScheduleHistory() {
  return getPublishedSchedules()
    .map((item) => item.schedule)
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

function getPublishedScheduleForMonth(year: number, month: number, schedules = readPublishedScheduleHistory()) {
  const monthKey = getMonthKey(year, month);
  return schedules.find((item) => item.monthKey === monthKey) ?? null;
}

function getDateKeyBefore(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return formatDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function getEffectiveScheduleDateKeys(schedule: GeneratedSchedule | null, schedules: GeneratedSchedule[] = []) {
  if (!schedule) return [];
  const history = [...schedules];
  if (!history.some((item) => item.monthKey === schedule.monthKey)) {
    history.push(schedule);
    history.sort((left, right) => left.monthKey.localeCompare(right.monthKey));
  }
  const scheduleIndex = history.findIndex((item) => item.monthKey === schedule.monthKey);
  const previousSchedule = scheduleIndex > 0 ? history[scheduleIndex - 1] ?? null : null;
  const startDateKey = previousSchedule?.nextStartDate ?? schedule.days[0]?.dateKey ?? schedule.nextStartDate;
  const endDateKey = getDateKeyBefore(schedule.nextStartDate);
  return uniqueDateKeys(
    schedule.days
      .map((day) => day.dateKey)
      .filter((dateKey) => dateKey >= startDateKey && dateKey <= endDateKey),
  );
}

function getManagedDateKeysFromSchedule(schedule: GeneratedSchedule | null, schedules: GeneratedSchedule[] = []) {
  if (!schedule) return [];
  const dayMap = new Map(schedule.days.map((day) => [day.dateKey, day] as const));
  return getEffectiveScheduleDateKeys(schedule, schedules).filter((dateKey) => {
    if (isWeekendDateKey(dateKey)) return false;
    const day = dayMap.get(dateKey);
    return !(day?.isWeekdayHoliday || day?.isCustomHoliday);
  });
}

function getDisplayDateKeysFromSchedule(schedule: GeneratedSchedule | null, schedules: GeneratedSchedule[] = []) {
  return getEffectiveScheduleDateKeys(schedule, schedules);
}

function shuffleList<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

function shuffleNames(names: string[]) {
  return shuffleList(names);
}

function formatRawDates(dateKeys: string[]) {
  return dateKeys
    .map((dateKey) => String(Number(dateKey.split("-")[2])))
    .join(",");
}

export function parseRequestedVacationDates(year: number, month: number, rawInput: string) {
  const tokens = rawInput
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  const monthDays = daysInMonth(year, month);

  tokens.forEach((token) => {
    if (/^\d{1,2}$/.test(token)) {
      const day = Number(token);
      if (day < 1 || day > monthDays) {
        invalid.push(token);
        return;
      }
      const dateKey = formatDateKey(year, month, day);
      if (isWeekendDateKey(dateKey)) {
        invalid.push(token);
        return;
      }
      valid.push(dateKey);
      return;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
      if (!isWeekendDateKey(token)) {
        valid.push(token);
      } else {
        invalid.push(token);
      }
      return;
    }

    invalid.push(token);
  });

  return {
    valid: uniqueDateKeys(valid),
    invalid,
  };
}

function ensureMonthState(store: VacationStore, year: number, month: number) {
  const monthKey = getMonthKey(year, month);
  if (!store.months[monthKey]) {
    store.months[monthKey] = sanitizeMonthState(undefined, year, month);
  }
  return store.months[monthKey];
}

function pruneMonthRequestsToManagedDates(store: VacationStore, monthKey: string, managedDateKeys: string[]) {
  const managedDateSet = new Set(managedDateKeys);
  let changed = false;

  store.requests = store.requests.flatMap((request) => {
    if (request.monthKey !== monthKey) return [request];
    const nextDates = request.dates.filter((dateKey) => managedDateSet.has(dateKey));
    if (nextDates.length === 0) {
      changed = true;
      return [];
    }
    if (nextDates.length !== request.dates.length) {
      changed = true;
      return [{ ...request, dates: nextDates, rawDates: formatRawDates(nextDates) }];
    }
    return [request];
  });

  return changed;
}

function syncMonthStateToManagedDates(
  store: VacationStore,
  year: number,
  month: number,
  managedDateKeys: string[],
  generated: GeneratedSchedule | null,
) {
  if (managedDateKeys.length === 0) {
    return {
      monthState: null,
      managedDateKeys,
      generated,
      changed: false,
    };
  }

  const monthState = ensureMonthState(store, year, month);
  const managedDateSet = new Set(managedDateKeys);
  let changed = false;

  if (monthState.managedDateKeys.join("|") !== managedDateKeys.join("|")) {
    monthState.managedDateKeys = managedDateKeys;
    changed = true;
  }

  const nextLimits = Object.fromEntries(
    Object.entries(monthState.limits).filter(([dateKey]) => managedDateSet.has(dateKey)),
  );
  if (JSON.stringify(nextLimits) !== JSON.stringify(monthState.limits)) {
    monthState.limits = nextLimits;
    changed = true;
  }

  const nextAnnualWinners = Object.fromEntries(
    managedDateKeys.map((dateKey) => [dateKey, uniqueNames(monthState.annualWinners[dateKey] ?? [])]),
  );
  if (JSON.stringify(nextAnnualWinners) !== JSON.stringify(monthState.annualWinners)) {
    monthState.annualWinners = nextAnnualWinners;
    changed = true;
  }

  const nextCompensatoryWinners = Object.fromEntries(
    managedDateKeys.map((dateKey) => [dateKey, uniqueNames(monthState.compensatoryWinners[dateKey] ?? [])]),
  );
  if (JSON.stringify(nextCompensatoryWinners) !== JSON.stringify(monthState.compensatoryWinners)) {
    monthState.compensatoryWinners = nextCompensatoryWinners;
    changed = true;
  }

  if (pruneMonthRequestsToManagedDates(store, monthState.monthKey, managedDateKeys)) {
    changed = true;
  }

  if (changed) {
    monthState.appliedAt = null;
    monthState.updatedAt = nowLabel();
  }

  return {
    monthState,
    managedDateKeys,
    generated,
    changed,
  };
}

function syncMonthStateToPublishedSchedule(store: VacationStore, year: number, month: number) {
  const publishedSchedules = readPublishedScheduleHistory();
  const published = getPublishedScheduleForMonth(year, month, publishedSchedules);
  const managedDateKeys = getManagedDateKeysFromSchedule(published, publishedSchedules);
  return syncMonthStateToManagedDates(store, year, month, managedDateKeys, published);
}

function getRequestsForMonth(store: VacationStore, monthKey: string) {
  return store.requests.filter((request) => request.monthKey === monthKey);
}

function getApplicantsByType(store: VacationStore, monthKey: string, type: VacationType) {
  const grouped = new Map<string, string[]>();
  getRequestsForMonth(store, monthKey)
    .filter((request) => request.type === type)
    .forEach((request) => {
      request.dates.forEach((dateKey) => {
        if (isWeekendDateKey(dateKey)) return;
        const current = grouped.get(dateKey) ?? [];
        current.push(request.requesterName);
        grouped.set(dateKey, current);
      });
    });

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([dateKey, names]) => [dateKey, uniqueNames(names)]),
  ) as Record<string, string[]>;
}

function getRequestedDatesByName(store: VacationStore, monthKey: string, type: VacationType) {
  const requestedDatesByName = new Map<string, string[]>();
  getRequestsForMonth(store, monthKey)
    .filter((request) => request.type === type)
    .forEach((request) => {
      const current = requestedDatesByName.get(request.requesterName) ?? [];
      requestedDatesByName.set(
        request.requesterName,
        uniqueDateKeys([...current, ...request.dates.filter((dateKey) => !isWeekendDateKey(dateKey))]),
      );
    });
  return requestedDatesByName;
}

function getCompensatoryWeightsByName(store: VacationStore, monthKey: string) {
  const requestedDatesByName = getRequestedDatesByName(store, monthKey, "대휴");
  return getCompensatoryWeightsByRequestedDates(requestedDatesByName);
}

function getCompensatoryWeightsByRequestedDates(requestedDatesByName: Map<string, string[]>) {
  return new Map(
    Array.from(requestedDatesByName.entries()).map(([name, requestedDates]) => [name, 1 / Math.max(1, requestedDates.length)] as const),
  );
}

function getMonthCapacity(monthState: VacationMonthState, dateKey: string) {
  return monthState.limits[dateKey] ?? DEFAULT_VACATION_CAPACITY;
}

function hasLotteryResults(winners: Record<string, string[]>) {
  return Object.values(winners).some((names) => names.length > 0);
}

function countWinnerMapEntries(winners: Record<string, string[]>) {
  return Object.values(winners).reduce((sum, names) => sum + uniqueNames(names ?? []).length, 0);
}

function buildApplicantDatesByName(applicantsByDate: Record<string, string[]>) {
  const applicantDates = new Map<string, string[]>();
  Object.entries(applicantsByDate).forEach(([dateKey, names]) => {
    uniqueNames(names ?? []).forEach((name) => {
      const current = applicantDates.get(name) ?? [];
      current.push(dateKey);
      applicantDates.set(name, uniqueDateKeys(current));
    });
  });
  return applicantDates;
}

function countCompensatoryWinsByName(winners: Record<string, string[]>) {
  const winnerCounts = new Map<string, number>();
  Object.values(winners).forEach((names) => {
    uniqueNames(names ?? []).forEach((name) => {
      winnerCounts.set(name, (winnerCounts.get(name) ?? 0) + 1);
    });
  });
  return winnerCounts;
}

function getWinnerSlotsByNames(winners: Record<string, string[]>, names: string[]) {
  const nameSet = new Set(names);
  return Object.entries(winners).flatMap(([dateKey, winnerNames]) =>
    uniqueNames(winnerNames ?? [])
      .filter((winnerName) => nameSet.has(winnerName))
      .map((winnerName) => ({ dateKey, winnerName })),
  );
}

function pickWeightedNames(names: string[], count: number, weightsByName: Map<string, number>) {
  const pool = uniqueNames(names);
  const winners: string[] = [];
  const targetCount = Math.max(0, Math.min(count, pool.length));

  while (winners.length < targetCount) {
    const totalWeight = pool.reduce((sum, name) => sum + Math.max(weightsByName.get(name) ?? 1, Number.EPSILON), 0);
    if (totalWeight <= 0) {
      winners.push(shuffleNames(pool)[0]);
    } else {
      let threshold = Math.random() * totalWeight;
      let selectedName = pool[pool.length - 1];
      for (const name of pool) {
        threshold -= Math.max(weightsByName.get(name) ?? 1, Number.EPSILON);
        if (threshold <= 0) {
          selectedName = name;
          break;
        }
      }
      winners.push(selectedName);
    }

    const selectedSet = new Set(winners);
    for (let index = pool.length - 1; index >= 0; index -= 1) {
      if (selectedSet.has(pool[index])) {
        pool.splice(index, 1);
      }
    }
  }

  return winners.sort((left, right) => left.localeCompare(right, "ko"));
}

function rebalanceCompensatoryWinners(
  applicantsByDate: Record<string, string[]>,
  winners: Record<string, string[]>,
) {
  const nextWinners = Object.fromEntries(
    Object.entries(winners).map(([dateKey, names]) => [dateKey, uniqueNames(names ?? [])]),
  ) as Record<string, string[]>;
  const applicantDatesByName = buildApplicantDatesByName(applicantsByDate);

  while (true) {
    const winnerCounts = countCompensatoryWinsByName(nextWinners);
    const zeroWinnerApplicants = Array.from(applicantDatesByName.entries())
      .filter(([name, dateKeys]) => dateKeys.length > 0 && (winnerCounts.get(name) ?? 0) === 0)
      .map(([name, dateKeys]) => ({ name, dateKeys }))
      .sort((left, right) => left.name.localeCompare(right.name, "ko"));

    if (zeroWinnerApplicants.length === 0) {
      return nextWinners;
    }

    let reassigned = false;

    for (const applicant of zeroWinnerApplicants) {
      const maxWinnerCount = Math.max(...Array.from(winnerCounts.values()), 0);
      if (maxWinnerCount < 2) {
        continue;
      }

      const topWinnerNames = Array.from(winnerCounts.entries())
        .filter(([name, count]) => name !== applicant.name && count === maxWinnerCount)
        .map(([name]) => name);
      if (topWinnerNames.length === 0) {
        continue;
      }

      const requestedDateSlots = applicant.dateKeys.flatMap((dateKey) =>
        uniqueNames(nextWinners[dateKey] ?? [])
          .filter((winnerName) => topWinnerNames.includes(winnerName))
          .map((winnerName) => ({ dateKey, winnerName })),
      );

      const allTopWinnerSlots = getWinnerSlotsByNames(nextWinners, topWinnerNames);
      const candidateSlots = requestedDateSlots.length > 0 ? requestedDateSlots : allTopWinnerSlots;
      const selectedSlot = candidateSlots.length > 0 ? shuffleList(candidateSlots)[0] : null;
      if (!selectedSlot) {
        continue;
      }

      nextWinners[selectedSlot.dateKey] = uniqueNames([
        ...(nextWinners[selectedSlot.dateKey] ?? []).filter((name) => name !== selectedSlot.winnerName),
        applicant.name,
      ]).sort((left, right) => left.localeCompare(right, "ko"));
      reassigned = true;
      break;
    }

    if (!reassigned) {
      return nextWinners;
    }
  }
}

function buildAnnualLotteryWinners(
  monthState: VacationMonthState,
  annualApplicants: Record<string, string[]>,
  priorityMap: Record<string, string[]>,
) {
  const nextAnnualWinners: Record<string, string[]> = {};

  monthState.managedDateKeys.forEach((dateKey) => {
    const blockedNames = new Set((priorityMap[dateKey] ?? []).map((entry) => parseVacationEntry(entry).name));
    const applicants = (annualApplicants[dateKey] ?? []).filter((name) => !blockedNames.has(name));
    const capacity = Math.max(0, getMonthCapacity(monthState, dateKey) - blockedNames.size);
    if (applicants.length <= capacity) {
      nextAnnualWinners[dateKey] = [...applicants];
      return;
    }
    nextAnnualWinners[dateKey] = shuffleNames(applicants)
      .slice(0, capacity)
      .sort((left, right) => left.localeCompare(right, "ko"));
  });

  return nextAnnualWinners;
}

function buildCompensatoryLotteryWinners(
  monthState: VacationMonthState,
  annualWinners: Record<string, string[]>,
  compensatoryApplicants: Record<string, string[]>,
  priorityMap: Record<string, string[]>,
  compensatoryWeightsByName: Map<string, number>,
) {
  const nextCompensatoryWinners: Record<string, string[]> = {};
  const compensatoryCandidatesByDate: Record<string, string[]> = {};

  monthState.managedDateKeys.forEach((dateKey) => {
    const blockedNames = new Set((priorityMap[dateKey] ?? []).map((entry) => parseVacationEntry(entry).name));
    const annualWinnerNames = uniqueNames(annualWinners[dateKey] ?? []);
    const remainingCapacity = Math.max(0, getMonthCapacity(monthState, dateKey) - blockedNames.size - annualWinnerNames.length);
    const applicants = uniqueNames(
      (compensatoryApplicants[dateKey] ?? []).filter((name) => !annualWinnerNames.includes(name) && !blockedNames.has(name)),
    );
    compensatoryCandidatesByDate[dateKey] = applicants;

    if (remainingCapacity === 0) {
      nextCompensatoryWinners[dateKey] = [];
      return;
    }

    if (applicants.length <= remainingCapacity) {
      nextCompensatoryWinners[dateKey] = [...applicants];
      return;
    }

    nextCompensatoryWinners[dateKey] = pickWeightedNames(applicants, remainingCapacity, compensatoryWeightsByName);
  });

  return {
    compensatoryCandidatesByDate,
    compensatoryWinners: rebalanceCompensatoryWinners(compensatoryCandidatesByDate, nextCompensatoryWinners),
  };
}

function buildVacationLotteryWinnersFromApplicants(
  monthState: VacationMonthState,
  annualApplicants: Record<string, string[]>,
  compensatoryApplicants: Record<string, string[]>,
  compensatoryWeightsByName: Map<string, number>,
) {
  const priorityMap = getDeskPriorityVacationMap(monthState.monthKey);
  const annualWinners = buildAnnualLotteryWinners(monthState, annualApplicants, priorityMap);
  const { compensatoryWinners } = buildCompensatoryLotteryWinners(
    monthState,
    annualWinners,
    compensatoryApplicants,
    priorityMap,
    compensatoryWeightsByName,
  );

  return {
    annualApplicants,
    compensatoryApplicants,
    annualWinners,
    compensatoryWinners,
  };
}

function buildVacationLotteryWinners(store: VacationStore, monthState: VacationMonthState) {
  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const compensatoryApplicants = getApplicantsByType(store, monthState.monthKey, "대휴");
  return buildVacationLotteryWinnersFromApplicants(
    monthState,
    annualApplicants,
    compensatoryApplicants,
    getCompensatoryWeightsByName(store, monthState.monthKey),
  );
}

function buildApplicantsByDateFromRequestedDates(requestedDatesByName: Map<string, string[]>) {
  const applicantsByDate = new Map<string, string[]>();
  requestedDatesByName.forEach((dateKeys, name) => {
    dateKeys.forEach((dateKey) => {
      const current = applicantsByDate.get(dateKey) ?? [];
      applicantsByDate.set(dateKey, uniqueNames([...current, name]));
    });
  });
  return Object.fromEntries(applicantsByDate.entries()) as Record<string, string[]>;
}

function serializeVacationMap(map: Record<string, string[]>) {
  return Object.keys(map)
    .sort((left, right) => left.localeCompare(right))
    .map((dateKey) => {
      const entries = uniqueNames(map[dateKey] ?? []);
      if (entries.length === 0) return null;
      return `${dateKey}:${entries.join(",")}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function applyVacationEntriesToGeneratedSchedule(
  generated: GeneratedSchedule,
  approvedMap: Record<string, string[]>,
  managedDates: Set<string>,
) {
  return {
    ...generated,
    days: generated.days.map((day) => {
      if (!managedDates.has(day.dateKey)) return day;
      const nextEntries = uniqueNames(approvedMap[day.dateKey] ?? []);
      return {
        ...day,
        vacations: [...nextEntries],
        assignments: {
          ...day.assignments,
          휴가: [...nextEntries],
        },
      };
    }),
  };
}

function getApprovedEntriesForMonth(store: VacationStore, monthKey: string) {
  const monthState = store.months[monthKey];
  const priorityMap = getDeskPriorityVacationMap(monthKey);
  if (!monthState) return priorityMap;

  return Object.fromEntries(
    monthState.managedDateKeys.map((dateKey) => {
      const priorityEntries = priorityMap[dateKey] ?? [];
      const priorityNames = new Set(priorityEntries.map((entry) => parseVacationEntry(entry).name));
      return [
        dateKey,
        uniqueNames([
          ...priorityEntries,
          ...(monthState.annualWinners[dateKey] ?? [])
            .filter((name) => !priorityNames.has(name))
            .map((name) => formatVacationEntry("연차", name)),
          ...(monthState.compensatoryWinners[dateKey] ?? [])
            .filter((name) => !priorityNames.has(name))
            .map((name) => formatVacationEntry("대휴", name)),
        ]),
      ];
    }),
  ) as Record<string, string[]>;
}

export function getVacationStore() {
  return readStore();
}

export function isVacationRequestOpen() {
  return readStore().requestOpen;
}

export interface VacationCalendarDateItem {
  dateKey: string;
  blocked: boolean;
  myDutyLabels: string[];
}

function getMyDutyLabels(day: DaySchedule | undefined, username: string) {
  if (!day || !username.trim()) return [] as string[];
  return Object.entries(day.assignments)
    .filter(([, names]) => names.includes(username))
    .sort(([leftCategory], [rightCategory]) => getAssignmentDisplayRank(leftCategory) - getAssignmentDisplayRank(rightCategory))
    .map(([category]) => getScheduleCategoryLabel(category));
}

export function getVacationCalendarDateItems(year: number, month: number, username = ""): VacationCalendarDateItem[] {
  const publishedSchedules = readPublishedScheduleHistory();
  const published = getPublishedScheduleForMonth(year, month, publishedSchedules);
  if (!published) return [];
  const displayDateKeys = getDisplayDateKeysFromSchedule(published, publishedSchedules);
  const dayMap = new Map(published.days.map((day) => [day.dateKey, day] as const));

  return displayDateKeys
    .filter((dateKey) => !isWeekendDateKey(dateKey))
    .map((dateKey) => {
      const day = dayMap.get(dateKey);
      return {
        dateKey,
        blocked: Boolean(day?.isWeekdayHoliday || day?.isCustomHoliday),
        myDutyLabels: getMyDutyLabels(day, username),
      };
    });
}

export function getVacationManagedDateKeys(year: number, month: number) {
  return getVacationCalendarDateItems(year, month)
    .filter((item) => !item.blocked)
    .map((item) => item.dateKey);
}

export function syncVacationMonthSheet(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }
  return {
    ok: Boolean(synced.monthState),
    monthState: synced.monthState,
    managedDateKeys: synced.managedDateKeys,
    message: synced.monthState
      ? `${year}년 ${month}월 홈 게시 근무표 기준으로 휴가 관리 시트를 맞췄습니다.`
      : `${year}년 ${month}월 홈 게시 근무표가 아직 없어 휴가 관리 시트를 만들 수 없습니다.`,
  };
}

export function syncVacationMonthSheetFromGeneratedSchedule(generated: GeneratedSchedule) {
  const store = readStore();
  const managedDateKeys = getManagedDateKeysFromSchedule(generated, [generated]);
  const synced = syncMonthStateToManagedDates(store, generated.year, generated.month, managedDateKeys, generated);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }
  return {
    ok: Boolean(synced.monthState),
    monthState: synced.monthState,
    managedDateKeys: synced.managedDateKeys,
    message: synced.monthState
      ? `${generated.year}년 ${generated.month}월 근무표 초안 기준으로 휴가 관리 시트를 맞췄습니다.`
      : `${generated.year}년 ${generated.month}월 근무표 초안 기준 날짜를 확인할 수 없습니다.`,
  };
}

export function getVacationMonthState(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }
  return synced.monthState;
}

export function getVacationRequests(monthKey?: string) {
  const store = readStore();
  if (!monthKey) return store.requests;
  return getRequestsForMonth(store, monthKey);
}

function validateVacationRequestDates(input: {
  year: number;
  month: number;
  rawDates: string;
}) {
  const calendarDateItems = getVacationCalendarDateItems(input.year, input.month);
  const blockedDateSet = new Set(
    calendarDateItems
      .filter((item) => item.blocked)
      .map((item) => item.dateKey),
  );
  const managedDateKeys = calendarDateItems
    .filter((item) => !item.blocked)
    .map((item) => item.dateKey);
  if (managedDateKeys.length === 0) {
    return {
      ok: false as const,
      message: `${input.year}년 ${input.month}월 홈 게시 근무표가 아직 없어 휴가를 신청할 수 없습니다.`,
    };
  }

  const parsedDates = parseRequestedVacationDates(input.year, input.month, input.rawDates);
  const managedDateSet = new Set(managedDateKeys);
  const blockedDays = parsedDates.valid
    .filter((dateKey) => blockedDateSet.has(dateKey))
    .map((dateKey) => String(Number(dateKey.split("-")[2])));
  const unavailableDays = parsedDates.valid
    .filter((dateKey) => !managedDateSet.has(dateKey) && !blockedDateSet.has(dateKey))
    .map((dateKey) => String(Number(dateKey.split("-")[2])));
  const validDates = parsedDates.valid.filter((dateKey) => managedDateSet.has(dateKey));

  if (validDates.length === 0) {
    return {
      ok: false as const,
      message:
        blockedDays.length > 0
          ? `평일 휴일로 지정된 날짜는 신청할 수 없습니다: ${blockedDays.join(", ")}`
          : unavailableDays.length > 0
          ? `홈에 게시된 근무표 날짜만 신청할 수 있습니다: ${unavailableDays.join(", ")}`
          : parsedDates.invalid.length > 0
            ? `입력한 날짜를 확인해 주세요: ${parsedDates.invalid.join(", ")}`
            : "휴가 날짜를 입력해 주세요.",
    };
  }

  return {
    ok: true as const,
    validDates,
  };
}

function isSameVacationRequester(request: VacationRequest, requesterId: string | null, requesterName: string) {
  if (requesterId && request.requesterId === requesterId) {
    return true;
  }
  return request.requesterName.trim() === requesterName;
}

export function submitVacationRequests(input: {
  requesterId: string | null;
  requesterName: string;
  year: number;
  month: number;
  annualRawDates?: string;
  compensatoryRawDates?: string;
}) {
  const session = getSession();
  if (session && isReadOnlyPortalRole(session.role)) {
    return { ok: false as const, message: "Observer 등급은 휴가 신청을 제출할 수 없습니다." };
  }

  const requesterName = input.requesterName.trim();
  if (!requesterName) {
    return { ok: false as const, message: "로그인한 사용자 이름을 확인할 수 없습니다." };
  }

  if (!isVacationRequestOpen()) {
    return { ok: false as const, message: "현재 휴가 신청이 닫혀 있습니다." };
  }

  const annualValidation = input.annualRawDates
    ? validateVacationRequestDates({ year: input.year, month: input.month, rawDates: input.annualRawDates })
    : null;
  if (annualValidation && !annualValidation.ok) {
    return { ok: false as const, message: `연차: ${annualValidation.message}` };
  }

  const compensatoryValidation = input.compensatoryRawDates
    ? validateVacationRequestDates({ year: input.year, month: input.month, rawDates: input.compensatoryRawDates })
    : null;
  if (compensatoryValidation && !compensatoryValidation.ok) {
    return { ok: false as const, message: `대휴: ${compensatoryValidation.message}` };
  }

  const selectedCount =
    (annualValidation?.ok ? annualValidation.validDates.length : 0) +
    (compensatoryValidation?.ok ? compensatoryValidation.validDates.length : 0);
  if (selectedCount === 0) {
    return { ok: false as const, message: "휴가 날짜를 입력해 주세요." };
  }

  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, input.year, input.month);
  const monthState = synced.monthState;
  if (!monthState) {
    return {
      ok: false as const,
      message: `${input.year}년 ${input.month}월 홈 게시 근무표가 아직 없어 휴가를 신청할 수 없습니다.`,
    };
  }

  store.requests = store.requests.filter(
    (request) => !(request.monthKey === monthState.monthKey && isSameVacationRequester(request, input.requesterId, requesterName)),
  );

  const createdAt = nowLabel();
  const nextRequests: VacationRequest[] = [];
  if (annualValidation?.ok) {
    nextRequests.push({
      id: crypto.randomUUID(),
      requesterId: input.requesterId,
      requesterName,
      type: "연차",
      year: input.year,
      month: input.month,
      monthKey: monthState.monthKey,
      dates: annualValidation.validDates,
      rawDates: formatRawDates(annualValidation.validDates),
      createdAt,
    });
  }

  if (compensatoryValidation?.ok) {
    nextRequests.push({
      id: crypto.randomUUID(),
      requesterId: input.requesterId,
      requesterName,
      type: "대휴",
      year: input.year,
      month: input.month,
      monthKey: monthState.monthKey,
      dates: compensatoryValidation.validDates,
      rawDates: formatRawDates(compensatoryValidation.validDates),
      createdAt,
    });
  }

  store.requests = [
    ...nextRequests,
    ...store.requests,
  ];
  writeStore(store);

  return {
    ok: true as const,
    message: "최신 휴가 신청으로 저장했습니다.",
  };
}

export function getVacationApplicantsOverview(year: number, month: number) {
  const store = readStore();
  const monthKey = getMonthKey(year, month);
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  const publishedSchedules = readPublishedScheduleHistory();
  const published = getPublishedScheduleForMonth(year, month, publishedSchedules);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }

  return {
    monthState: synced.monthState,
    managedDateKeys: synced.managedDateKeys,
    displayDateKeys: getDisplayDateKeysFromSchedule(published, publishedSchedules),
    hasGeneratedSchedule: synced.managedDateKeys.length > 0,
    annualApplicants: synced.monthState ? getApplicantsByType(store, monthKey, "연차") : ({} as Record<string, string[]>),
    compensatoryApplicants: synced.monthState ? getApplicantsByType(store, monthKey, "대휴") : ({} as Record<string, string[]>),
    requests: getRequestsForMonth(store, monthKey),
    requestOpen: store.requestOpen,
  };
}

export function setVacationRequestOpen(nextOpen: boolean) {
  const store = readStore();
  if (store.requestOpen === nextOpen) {
    return {
      ok: true as const,
      requestOpen: nextOpen,
      message: nextOpen ? "휴가 신청이 이미 오픈 중입니다." : "휴가 신청이 이미 닫혀 있습니다.",
    };
  }

  store.requestOpen = nextOpen;
  writeStore(store);
  return {
    ok: true as const,
    requestOpen: nextOpen,
    message: nextOpen ? "휴가 신청을 오픈했습니다." : "휴가 신청을 닫았습니다.",
  };
}

export function setVacationCapacity(year: number, month: number, dateKey: string, limit: number) {
  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState || !monthState.managedDateKeys.includes(dateKey)) return null;
  monthState.limits[dateKey] = Math.max(1, Math.min(10, Math.trunc(limit) || DEFAULT_VACATION_CAPACITY));
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runAnnualVacationLottery(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState) return null;
  if (hasLotteryResults(monthState.annualWinners)) {
    return monthState;
  }

  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const priorityMap = getDeskPriorityVacationMap(monthState.monthKey);
  monthState.annualWinners = buildAnnualLotteryWinners(monthState, annualApplicants, priorityMap);
  monthState.compensatoryWinners = {};
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runCompensatoryVacationLottery(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState) return null;
  if (hasLotteryResults(monthState.compensatoryWinners)) {
    return monthState;
  }

  const compensatoryApplicants = getApplicantsByType(store, monthState.monthKey, "대휴");
  const priorityMap = getDeskPriorityVacationMap(monthState.monthKey);
  const nextAnnualWinners =
    hasLotteryResults(monthState.annualWinners)
      ? monthState.annualWinners
      : buildAnnualLotteryWinners(monthState, getApplicantsByType(store, monthState.monthKey, "연차"), priorityMap);
  const { compensatoryWinners } = buildCompensatoryLotteryWinners(
    monthState,
    nextAnnualWinners,
    compensatoryApplicants,
    priorityMap,
    getCompensatoryWeightsByName(store, monthState.monthKey),
  );

  monthState.annualWinners = nextAnnualWinners;
  monthState.compensatoryWinners = compensatoryWinners;
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runVacationLottery(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToPublishedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState) return null;
  if (hasLotteryResults(monthState.annualWinners) || hasLotteryResults(monthState.compensatoryWinners)) {
    return monthState;
  }

  const { annualWinners, compensatoryWinners } = buildVacationLotteryWinners(store, monthState);
  monthState.annualWinners = annualWinners;
  monthState.compensatoryWinners = compensatoryWinners;
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function applyVacationMonthToSchedule(year: number, month: number) {
  if (typeof window === "undefined") {
    return { ok: false as const, message: "브라우저에서만 근무 반영이 가능합니다." };
  }

  const vacationStore = readStore();
  const synced = syncMonthStateToPublishedSchedule(vacationStore, year, month);
  const monthState = synced.monthState;
  const generated = synced.generated;
  if (!monthState || !generated) {
    return { ok: false as const, message: `${year}년 ${month}월 홈 게시 근무표가 없어 근무 반영을 할 수 없습니다.` };
  }

  const approvedMap = getApprovedEntriesForMonth(vacationStore, monthState.monthKey);
  const scheduleMonthDateSet = new Set(monthState.managedDateKeys);

  const scheduleState = readScheduleState();
  const currentVacationMap = parseVacationMap(scheduleState.vacations);
  const nextVacationMap: Record<string, string[]> = {};

  Object.entries(currentVacationMap).forEach(([dateKey, entries]) => {
    if (scheduleMonthDateSet.has(dateKey)) return;
    nextVacationMap[dateKey] = [...entries];
  });

  Object.entries(approvedMap).forEach(([dateKey, entries]) => {
    const persistedEntries = entries.filter((entry) => !isDeskPriorityVacationEntry(entry));
    if (persistedEntries.length === 0) return;
    nextVacationMap[dateKey] = [...persistedEntries];
  });

  scheduleState.vacations = serializeVacationMap(nextVacationMap);
  scheduleState.generatedHistory = scheduleState.generatedHistory.map((item) =>
    applyVacationEntriesToGeneratedSchedule(item, approvedMap, scheduleMonthDateSet),
  );

  if (scheduleState.generated) {
    const matched = scheduleState.generatedHistory.find((item) => item.monthKey === scheduleState.generated?.monthKey);
    scheduleState.generated = matched
      ? matched
      : applyVacationEntriesToGeneratedSchedule(scheduleState.generated, approvedMap, scheduleMonthDateSet);
  }

  void saveScheduleState(scheduleState).catch((error) => {
    emitVacationStatus({
      ok: false,
      message: error instanceof Error ? error.message : "휴가 반영 후 근무표 저장에 실패했습니다. 다시 불러와 주세요.",
    });
  });

  monthState.appliedAt = nowLabel();
  monthState.updatedAt = nowLabel();
  writeStore(vacationStore);

  return { ok: true as const, message: `${year}년 ${month}월 휴가 결과를 근무표에 반영했습니다.` };
}

export function getVacationWinnersByType(year: number, month: number) {
  const monthState = getVacationMonthState(year, month);
  return {
    annualWinners: monthState?.annualWinners ?? {},
    compensatoryWinners: monthState?.compensatoryWinners ?? {},
  };
}
