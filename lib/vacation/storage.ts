"use client";

import {
  formatVacationEntry,
  getMonthKey,
  getUniquePeople,
  parseVacationMap,
} from "@/lib/schedule/engine";
import { readStoredScheduleState, saveScheduleState } from "@/lib/schedule/storage";
import { GeneratedSchedule, VacationType } from "@/lib/schedule/types";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

export const VACATION_STORAGE_KEY = "j-special-force-vacations-v1";
export const VACATION_EVENT = "j-special-force-vacations-changed";
export const VACATION_STATUS_EVENT = "j-special-force-vacations-status";
export const DEFAULT_VACATION_CAPACITY = 5;

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

  return { requests, months };
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

function cloneVacationStore(store: VacationStore) {
  const sanitized = sanitizeVacationStore(store);
  return JSON.parse(JSON.stringify(sanitized)) as VacationStore;
}

async function persistVacationStore(store: VacationStore) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const sanitized = sanitizeVacationStore(store);

  const requestRows = sanitized.requests.map((request) => ({
    id: request.id,
    requester_id: request.requesterId ?? session.id,
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

  const [{ data: existingRequests, error: requestSelectError }, { error: requestUpsertError }, { error: monthUpsertError }] =
    await Promise.all([
      supabase.from("vacation_requests").select("id"),
      requestRows.length > 0 ? supabase.from("vacation_requests").upsert(requestRows) : Promise.resolve({ error: null }),
      monthRows.length > 0 ? supabase.from("vacation_months").upsert(monthRows) : Promise.resolve({ error: null }),
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

  const staleRequestIds = (existingRequests ?? [])
    .map((row) => row.id as string)
    .filter((id) => !requestRows.some((request) => request.id === id));

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
    .catch(async () => {
      const message = "휴가 데이터 저장에 실패했습니다. DB 기준 상태로 복구합니다.";
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
    const [{ data: requestRows, error: requestError }, { data: monthRows, error: monthError }] = await Promise.all([
      supabase
        .from("vacation_requests")
        .select("id, requester_id, requester_name, type, year, month, month_key, requested_dates, raw_dates, status, created_at, updated_at")
        .order("created_at", { ascending: false })
        .returns<VacationRequestRow[]>(),
      supabase
        .from("vacation_months")
        .select("month_key, managed_date_keys, limits, annual_winners, compensatory_winners, applied_at, updated_at")
        .returns<VacationMonthRow[]>(),
    ]);

    if (requestError || monthError) {
      const schemaError = requestError ?? monthError;
      if (isSupabaseSchemaMissingError(schemaError)) {
        console.warn(getSupabaseStorageErrorMessage(schemaError, "vacation_requests / vacation_months"));
        vacationStoreCache = createEmptyStore();
        emitVacationEvent();
        return cloneVacationStore(vacationStoreCache);
      }

      if (requestError) {
        throw new Error(requestError.message);
      }
      throw new Error(monthError?.message ?? "휴가 데이터를 불러오지 못했습니다.");
    }

    vacationStoreCache = sanitizeVacationStore({
      requests: (requestRows ?? []).map((row) => rowToVacationRequest(row)),
      months: Object.fromEntries((monthRows ?? []).map((row) => [row.month_key, rowToVacationMonthState(row)])),
    });
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

function getGeneratedScheduleForMonth(year: number, month: number, scheduleState = readScheduleState()) {
  const monthKey = getMonthKey(year, month);
  return (
    scheduleState.generatedHistory.find((item) => item.monthKey === monthKey) ??
    (scheduleState.generated?.monthKey === monthKey ? scheduleState.generated : null)
  );
}

function getDateKeyBefore(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return formatDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function getEffectiveGeneratedDateKeys(generated: GeneratedSchedule | null, scheduleState = readScheduleState()) {
  if (!generated) return [];
  const history = scheduleState.generatedHistory;
  const generatedIndex = history.findIndex((item) => item.monthKey === generated.monthKey);
  const previousGenerated = generatedIndex > 0 ? history[generatedIndex - 1] ?? null : null;
  const startDateKey = previousGenerated?.nextStartDate ?? generated.days[0]?.dateKey ?? generated.nextStartDate;
  const endDateKey = getDateKeyBefore(generated.nextStartDate);
  return uniqueDateKeys(
    generated.days
      .map((day) => day.dateKey)
      .filter((dateKey) => dateKey >= startDateKey && dateKey <= endDateKey),
  );
}

function getManagedDateKeysFromGeneratedSchedule(generated: GeneratedSchedule | null, scheduleState = readScheduleState()) {
  return getEffectiveGeneratedDateKeys(generated, scheduleState).filter((dateKey) => !isWeekendDateKey(dateKey));
}

function getDisplayDateKeysFromGeneratedSchedule(generated: GeneratedSchedule | null, scheduleState = readScheduleState()) {
  return getEffectiveGeneratedDateKeys(generated, scheduleState);
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
  const monthKey = getMonthKey(year, month);
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
      if (token.startsWith(`${monthKey}-`) && !isWeekendDateKey(token)) {
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

function syncMonthStateToGeneratedSchedule(store: VacationStore, year: number, month: number) {
  const generated = getGeneratedScheduleForMonth(year, month);
  const managedDateKeys = getManagedDateKeysFromGeneratedSchedule(generated);
  return syncMonthStateToManagedDates(store, year, month, managedDateKeys, generated);
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

function getMonthCapacity(monthState: VacationMonthState, dateKey: string) {
  return monthState.limits[dateKey] ?? DEFAULT_VACATION_CAPACITY;
}

function hasLotteryResults(winners: Record<string, string[]>) {
  return Object.values(winners).some((names) => names.length > 0);
}

function countWinnerMapEntries(winners: Record<string, string[]>) {
  return Object.values(winners).reduce((sum, names) => sum + uniqueNames(names ?? []).length, 0);
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
  if (!monthState) return {} as Record<string, string[]>;

  return Object.fromEntries(
    monthState.managedDateKeys.map((dateKey) => [
      dateKey,
      uniqueNames([
        ...(monthState.annualWinners[dateKey] ?? []).map((name) => formatVacationEntry("연차", name)),
        ...(monthState.compensatoryWinners[dateKey] ?? []).map((name) => formatVacationEntry("대휴", name)),
      ]),
    ]),
  ) as Record<string, string[]>;
}

export function getVacationStore() {
  return readStore();
}

export function getVacationManagedDateKeys(year: number, month: number) {
  return getManagedDateKeysFromGeneratedSchedule(getGeneratedScheduleForMonth(year, month));
}

export function syncVacationMonthSheet(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }
  return {
    ok: Boolean(synced.monthState),
    monthState: synced.monthState,
    managedDateKeys: synced.managedDateKeys,
    message: synced.monthState
      ? `${year}년 ${month}월 근무표 기준으로 휴가 관리 시트를 맞췄습니다.`
      : `${year}년 ${month}월 DESK 근무표가 아직 없어 휴가 관리 시트를 만들 수 없습니다.`,
  };
}

export function syncVacationMonthSheetFromGeneratedSchedule(generated: GeneratedSchedule) {
  const store = readStore();
  const managedDateKeys = getManagedDateKeysFromGeneratedSchedule(generated);
  const synced = syncMonthStateToManagedDates(store, generated.year, generated.month, managedDateKeys, generated);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }
  return {
    ok: Boolean(synced.monthState),
    monthState: synced.monthState,
    managedDateKeys: synced.managedDateKeys,
    message: synced.monthState
      ? `${generated.year}년 ${generated.month}월 근무표 기준으로 휴가 관리 시트를 맞췄습니다.`
      : `${generated.year}년 ${generated.month}월 DESK 근무표가 아직 없어 휴가 관리 시트를 만들 수 없습니다.`,
  };
}

export function getVacationMonthState(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
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

export function createVacationRequest(input: {
  requesterId: string | null;
  requesterName: string;
  type: VacationType;
  year: number;
  month: number;
  rawDates: string;
}) {
  const requesterName = input.requesterName.trim();
  if (!requesterName) {
    return { ok: false as const, message: "로그인한 사용자 이름을 확인할 수 없습니다." };
  }

  const managedDateKeys = getVacationManagedDateKeys(input.year, input.month);
  if (managedDateKeys.length === 0) {
    return {
      ok: false as const,
      message: `${input.year}년 ${input.month}월 DESK 근무표가 아직 작성되지 않아 휴가를 신청할 수 없습니다.`,
    };
  }

  const parsedDates = parseRequestedVacationDates(input.year, input.month, input.rawDates);
  const managedDateSet = new Set(managedDateKeys);
  const unavailableDays = parsedDates.valid
    .filter((dateKey) => !managedDateSet.has(dateKey))
    .map((dateKey) => String(Number(dateKey.split("-")[2])));
  const validDates = parsedDates.valid.filter((dateKey) => managedDateSet.has(dateKey));

  if (validDates.length === 0) {
    return {
      ok: false as const,
      message:
        unavailableDays.length > 0
          ? `DESK 근무표에 작성된 날짜만 신청할 수 있습니다: ${unavailableDays.join(", ")}`
          : parsedDates.invalid.length > 0
            ? `입력한 날짜를 확인해 주세요: ${parsedDates.invalid.join(", ")}`
            : "휴가 날짜를 입력해 주세요.",
    };
  }

  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, input.year, input.month);
  const monthState = synced.monthState;
  if (!monthState) {
    return {
      ok: false as const,
      message: `${input.year}년 ${input.month}월 DESK 근무표가 아직 작성되지 않아 휴가를 신청할 수 없습니다.`,
    };
  }

  store.requests = [
    {
      id: crypto.randomUUID(),
      requesterId: input.requesterId,
      requesterName,
      type: input.type,
      year: input.year,
      month: input.month,
      monthKey: monthState.monthKey,
      dates: validDates,
      rawDates: formatRawDates(validDates),
      createdAt: nowLabel(),
    },
    ...store.requests,
  ];
  writeStore(store);

  return {
    ok: true as const,
    message:
      parsedDates.invalid.length > 0 || unavailableDays.length > 0
        ? `휴가 신청을 제출했습니다. 제외된 입력: ${[...parsedDates.invalid, ...unavailableDays].join(", ")}`
        : "휴가 신청을 제출했습니다.",
  };
}

export function seedVacationSimulationRequests(year: number, month: number) {
  if (typeof window === "undefined") {
    return { ok: false as const, message: "브라우저에서만 시뮬레이션 신청자를 만들 수 있습니다." };
  }

  const scheduleState = readScheduleState();
  const people = getUniquePeople(scheduleState);
  if (people.length === 0) {
    return { ok: false as const, message: "근무표에서 사용할 이름을 찾지 못했습니다." };
  }

  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState || synced.managedDateKeys.length === 0) {
    return { ok: false as const, message: `${year}년 ${month}월 DESK 근무표가 없어 시뮬레이션을 만들 수 없습니다.` };
  }

  const applicantMap = new Map<string, { type: VacationType; dates: Set<string> }>();

  synced.managedDateKeys.forEach((dateKey) => {
    const shuffledNames = shuffleList(people);
    const annualCount = Math.min(randomBetween(1, 5), shuffledNames.length);
    const annualNames = shuffledNames.slice(0, annualCount);
    const remainingNames = shuffledNames.filter((name) => !annualNames.includes(name));
    const compensatoryCount = Math.min(10, remainingNames.length);
    const compensatoryNames = remainingNames.slice(0, compensatoryCount);

    annualNames.forEach((name) => {
      const mapKey = `${name}::연차`;
      const current = applicantMap.get(mapKey) ?? { type: "연차" as const, dates: new Set<string>() };
      current.dates.add(dateKey);
      applicantMap.set(mapKey, current);
    });

    compensatoryNames.forEach((name) => {
      const mapKey = `${name}::대휴`;
      const current = applicantMap.get(mapKey) ?? { type: "대휴" as const, dates: new Set<string>() };
      current.dates.add(dateKey);
      applicantMap.set(mapKey, current);
    });
  });

  const createdAt = nowLabel();
  const simulatedRequests = Array.from(applicantMap.entries())
    .map(([mapKey, value]) => {
      const [requesterName] = mapKey.split("::");
      const dates = uniqueDateKeys(Array.from(value.dates));
      return {
        id: crypto.randomUUID(),
        requesterId: null,
        requesterName,
        type: value.type,
        year,
        month,
        monthKey: monthState.monthKey,
        dates,
        rawDates: formatRawDates(dates),
        createdAt,
      } satisfies VacationRequest;
    })
    .sort((left, right) => left.requesterName.localeCompare(right.requesterName) || left.type.localeCompare(right.type));

  store.requests = [
    ...simulatedRequests,
    ...store.requests.filter((request) => request.monthKey !== monthState.monthKey),
  ];
  monthState.annualWinners = {};
  monthState.compensatoryWinners = {};
  monthState.appliedAt = null;
  monthState.updatedAt = nowLabel();
  writeStore(store);

  const annualRequestCount = simulatedRequests.filter((request) => request.type === "연차").length;
  const compensatoryRequestCount = simulatedRequests.filter((request) => request.type === "대휴").length;

  return {
    ok: true as const,
    message: `${year}년 ${month}월 근무표 날짜 기준으로 시뮬레이션 신청자를 채웠습니다. 연차 ${annualRequestCount}건, 대휴 ${compensatoryRequestCount}건입니다.`,
  };
}

export function getVacationApplicantsOverview(year: number, month: number) {
  const store = readStore();
  const monthKey = getMonthKey(year, month);
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  if (synced.changed && synced.monthState) {
    writeStore(store);
  }

  return {
    monthState: synced.monthState,
    managedDateKeys: synced.managedDateKeys,
    displayDateKeys: getDisplayDateKeysFromGeneratedSchedule(synced.generated),
    hasGeneratedSchedule: synced.managedDateKeys.length > 0,
    annualApplicants: synced.monthState ? getApplicantsByType(store, monthKey, "연차") : ({} as Record<string, string[]>),
    compensatoryApplicants: synced.monthState ? getApplicantsByType(store, monthKey, "대휴") : ({} as Record<string, string[]>),
    requests: getRequestsForMonth(store, monthKey),
  };
}

export function setVacationCapacity(year: number, month: number, dateKey: string, limit: number) {
  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState || !monthState.managedDateKeys.includes(dateKey)) return null;
  monthState.limits[dateKey] = Math.max(1, Math.min(10, Math.trunc(limit) || DEFAULT_VACATION_CAPACITY));
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runAnnualVacationLottery(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState) return null;
  if (hasLotteryResults(monthState.annualWinners)) {
    return monthState;
  }

  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const nextAnnualWinners: Record<string, string[]> = {};

  monthState.managedDateKeys.forEach((dateKey) => {
    const applicants = annualApplicants[dateKey] ?? [];
    const capacity = getMonthCapacity(monthState, dateKey);
    if (applicants.length <= capacity) {
      nextAnnualWinners[dateKey] = [...applicants];
      return;
    }
    nextAnnualWinners[dateKey] = shuffleNames(applicants)
      .slice(0, capacity)
      .sort((left, right) => left.localeCompare(right));
  });

  monthState.annualWinners = nextAnnualWinners;
  monthState.compensatoryWinners = {};
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runCompensatoryVacationLottery(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState) return null;
  if (hasLotteryResults(monthState.compensatoryWinners)) {
    return monthState;
  }

  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const compensatoryApplicants = getApplicantsByType(store, monthState.monthKey, "대휴");
  const nextAnnualWinners =
    hasLotteryResults(monthState.annualWinners) ? monthState.annualWinners : runAnnualVacationLottery(year, month)?.annualWinners ?? {};
  const nextCompensatoryWinners: Record<string, string[]> = {};

  monthState.managedDateKeys.forEach((dateKey) => {
    const annualWinners = uniqueNames(nextAnnualWinners[dateKey] ?? []);
    const remainingCapacity = Math.max(0, getMonthCapacity(monthState, dateKey) - annualWinners.length);
    const applicants = uniqueNames((compensatoryApplicants[dateKey] ?? []).filter((name) => !annualWinners.includes(name)));

    if (remainingCapacity === 0) {
      nextCompensatoryWinners[dateKey] = [];
      return;
    }

    if (applicants.length <= remainingCapacity) {
      nextCompensatoryWinners[dateKey] = [...applicants];
      return;
    }

    nextCompensatoryWinners[dateKey] = shuffleNames(applicants)
      .slice(0, remainingCapacity)
      .sort((left, right) => left.localeCompare(right));
  });

  monthState.annualWinners = nextAnnualWinners;
  monthState.compensatoryWinners = nextCompensatoryWinners;
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runVacationLottery(year: number, month: number) {
  const store = readStore();
  const synced = syncMonthStateToGeneratedSchedule(store, year, month);
  const monthState = synced.monthState;
  if (!monthState) return null;
  if (hasLotteryResults(monthState.annualWinners) || hasLotteryResults(monthState.compensatoryWinners)) {
    return monthState;
  }

  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const compensatoryApplicants = getApplicantsByType(store, monthState.monthKey, "대휴");
  const nextAnnualWinners: Record<string, string[]> = {};
  const nextCompensatoryWinners: Record<string, string[]> = {};

  monthState.managedDateKeys.forEach((dateKey) => {
    const annualCandidates = uniqueNames(annualApplicants[dateKey] ?? []);
    const capacity = getMonthCapacity(monthState, dateKey);

    const annualWinners =
      annualCandidates.length <= capacity
        ? [...annualCandidates]
        : shuffleNames(annualCandidates)
            .slice(0, capacity)
            .sort((left, right) => left.localeCompare(right));

    nextAnnualWinners[dateKey] = annualWinners;

    const remainingCapacity = Math.max(0, capacity - annualWinners.length);
    const compensatoryCandidates = uniqueNames((compensatoryApplicants[dateKey] ?? []).filter((name) => !annualWinners.includes(name)));

    if (remainingCapacity === 0) {
      nextCompensatoryWinners[dateKey] = [];
      return;
    }

    nextCompensatoryWinners[dateKey] =
      compensatoryCandidates.length <= remainingCapacity
        ? [...compensatoryCandidates]
        : shuffleNames(compensatoryCandidates)
            .slice(0, remainingCapacity)
            .sort((left, right) => left.localeCompare(right));
  });

  monthState.annualWinners = nextAnnualWinners;
  monthState.compensatoryWinners = nextCompensatoryWinners;
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function applyVacationMonthToSchedule(year: number, month: number) {
  if (typeof window === "undefined") {
    return { ok: false as const, message: "브라우저에서만 근무 반영이 가능합니다." };
  }

  const vacationStore = readStore();
  const synced = syncMonthStateToGeneratedSchedule(vacationStore, year, month);
  const monthState = synced.monthState;
  const generated = synced.generated;
  if (!monthState || !generated) {
    return { ok: false as const, message: `${year}년 ${month}월 DESK 근무표가 없어 근무 반영을 할 수 없습니다.` };
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
    if (entries.length === 0) return;
    nextVacationMap[dateKey] = [...entries];
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
