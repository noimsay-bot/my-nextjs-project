"use client";

import { getSession, isReadOnlyPortalRole } from "@/lib/auth/storage";
import { formatVacationEntry, parseHolidaySet, parseVacationMap, syncGeneralAssignments } from "@/lib/schedule/engine";
import {
  getPublishedSchedules,
  refreshPublishedSchedules,
  savePublishedSchedules,
} from "@/lib/schedule/published";
import { readStoredScheduleState, saveScheduleState } from "@/lib/schedule/storage";
import type { GeneratedSchedule, ScheduleState, VacationType } from "@/lib/schedule/types";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
  isSupabaseRequestTimeoutError,
} from "@/lib/supabase/portal";

// ── Public constants ──────────────────────────────────────────────────────────

export const EXTRA_VACATION_EVENT = "j-special-force-extra-vacations-changed";
export const EXTRA_VACATION_STATUS_EVENT = "j-special-force-extra-vacations-status";
export const DEFAULT_EXTRA_VACATION_CAPACITY = 2;

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface VacationExtraUnit {
  id: string;
  label: string;
  targetYear: number;
  targetMonth: number;
  dateKeys: string[];
  limits: Record<string, number>;
  annualWinners: Record<string, string[]>;
  compensatoryWinners: Record<string, string[]>;
  isOpen: boolean;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VacationExtraRequest {
  id: string;
  unitId: string;
  requesterId: string;
  requesterName: string;
  type: VacationType;
  dates: string[];
  rawDates: string;
  createdAt: string;
}

export interface VacationExtraStore {
  units: VacationExtraUnit[];
  requests: VacationExtraRequest[];
}

export interface VacationExtraLotteryResult {
  ok: boolean;
  unit: VacationExtraUnit | null;
  applicantCount: number;
  winnerCount: number;
  message: string;
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface ExtraUnitRow {
  id: string;
  label: string;
  target_year: number;
  target_month: number;
  date_keys: string[] | null;
  limits: Record<string, number> | null;
  annual_winners: Record<string, string[]> | null;
  compensatory_winners: Record<string, string[]> | null;
  is_open: boolean;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExtraRequestRow {
  id: string;
  unit_id: string;
  requester_id: string;
  requester_name: string;
  type: string;
  requested_dates: string[] | null;
  raw_dates: string;
  created_at: string;
  updated_at: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let extraStoreCache: VacationExtraStore = { units: [], requests: [] };
let extraRefreshPromise: Promise<VacationExtraStore> | null = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function nowLabel() {
  return new Date().toLocaleString("ko-KR");
}

function uniqueNames(names: string[]) {
  return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
}

function uniqueDateKeys(dateKeys: string[]) {
  return Array.from(new Set(dateKeys)).sort((a, b) => a.localeCompare(b));
}

function isWeekendDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const dow = new Date(year, month - 1, day).getDay();
  return dow === 0 || dow === 6;
}

export function getExtraVacationHolidayDateSet(targetYear: number, targetMonth: number): Set<string> {
  const monthKey = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  const scheduleState = readStoredScheduleState();
  const holidaySet = parseHolidaySet(scheduleState.extraHolidays, targetYear, targetMonth);

  const draft = scheduleState.generatedHistory.find((item) => item.monthKey === monthKey);
  draft?.days.forEach((day) => {
    if (day.isHoliday || day.isCustomHoliday || day.isWeekdayHoliday) {
      holidaySet.add(day.dateKey);
    }
  });

  const published = getPublishedSchedules([monthKey]).find((item) => item.monthKey === monthKey);
  published?.schedule.days.forEach((day) => {
    if (day.isHoliday || day.isCustomHoliday || day.isWeekdayHoliday) {
      holidaySet.add(day.dateKey);
    }
  });

  return holidaySet;
}

export function normalizeExtraVacationDateKeys(
  dateKeys: string[],
  targetYear: number,
  targetMonth: number,
): string[] {
  const holidaySet = getExtraVacationHolidayDateSet(targetYear, targetMonth);
  return uniqueDateKeys(dateKeys.filter((dk) => !isWeekendDateKey(dk) && !holidaySet.has(dk)));
}

function formatRawDates(dateKeys: string[]) {
  return dateKeys.map((dk) => String(Number(dk.split("-")[2]))).join(",");
}

function serializeVacationMapCompact(map: Record<string, string[]>): string {
  return Object.keys(map)
    .sort((a, b) => a.localeCompare(b))
    .map((dateKey) => {
      const entries = uniqueNames(map[dateKey] ?? []);
      if (entries.length === 0) return null;
      return `${dateKey}:${entries.join(",")}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

// ── Row converters ────────────────────────────────────────────────────────────

function rowToUnit(row: ExtraUnitRow): VacationExtraUnit {
  const dateKeys = normalizeExtraVacationDateKeys(
    (Array.isArray(row.date_keys) ? row.date_keys : []).filter((dk) => typeof dk === "string"),
    row.target_year,
    row.target_month,
  );
  const allowedDateSet = new Set(dateKeys);
  const limits = Object.fromEntries(
    Object.entries(row.limits ?? {})
      .filter(([dk]) => allowedDateSet.has(dk))
      .map(([dk, v]) => [dk, Math.max(1, Math.min(20, Number(v) || DEFAULT_EXTRA_VACATION_CAPACITY))]),
  );
  const annualWinners = Object.fromEntries(
    Object.entries(row.annual_winners ?? {})
      .filter(([dk]) => allowedDateSet.has(dk))
      .map(([dk, names]) => [dk, uniqueNames(Array.isArray(names) ? names : [])]),
  );
  const compensatoryWinners = Object.fromEntries(
    Object.entries(row.compensatory_winners ?? {})
      .filter(([dk]) => allowedDateSet.has(dk))
      .map(([dk, names]) => [dk, uniqueNames(Array.isArray(names) ? names : [])]),
  );
  return {
    id: row.id,
    label: row.label,
    targetYear: row.target_year,
    targetMonth: row.target_month,
    dateKeys,
    limits,
    annualWinners,
    compensatoryWinners,
    isOpen: row.is_open,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRequest(row: ExtraRequestRow): VacationExtraRequest {
  return {
    id: row.id,
    unitId: row.unit_id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    type: row.type === "대휴" ? "대휴" : "연차",
    dates: uniqueDateKeys(Array.isArray(row.requested_dates) ? row.requested_dates : []),
    rawDates: row.raw_dates,
    createdAt: row.created_at,
  };
}

// ── Events ────────────────────────────────────────────────────────────────────

function emitExtraEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EXTRA_VACATION_EVENT));
}

function emitExtraStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EXTRA_VACATION_STATUS_EVENT, { detail }));
}

// ── Store access ──────────────────────────────────────────────────────────────

export async function refreshExtraStore(): Promise<VacationExtraStore> {
  if (extraRefreshPromise) return extraRefreshPromise;

  extraRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      extraStoreCache = { units: [], requests: [] };
      emitExtraEvent();
      return { ...extraStoreCache };
    }

    const supabase = await getPortalSupabaseClient();
    const [
      { data: unitRows, error: unitError },
      { data: requestRows, error: requestError },
    ] = await Promise.all([
      supabase
        .from("vacation_extra_units")
        .select(
          "id, label, target_year, target_month, date_keys, limits, annual_winners, compensatory_winners, is_open, applied_at, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .returns<ExtraUnitRow[]>(),
      supabase
        .from("vacation_extra_requests")
        .select(
          "id, unit_id, requester_id, requester_name, type, requested_dates, raw_dates, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .returns<ExtraRequestRow[]>(),
    ]);

    const anyError = unitError ?? requestError;
    if (anyError) {
      if (isSupabaseSchemaMissingError(anyError)) {
        extraStoreCache = { units: [], requests: [] };
        emitExtraEvent();
        return { ...extraStoreCache };
      }
      if (isSupabaseRequestTimeoutError(anyError)) {
        emitExtraEvent();
        return { ...extraStoreCache };
      }
      throw new Error(anyError.message ?? "추가 휴가 데이터를 불러오지 못했습니다.");
    }

    extraStoreCache = {
      units: (unitRows ?? []).map(rowToUnit),
      requests: (requestRows ?? []).map(rowToRequest),
    };
    emitExtraEvent();
    return { ...extraStoreCache };
  })().finally(() => {
    extraRefreshPromise = null;
  });

  return extraRefreshPromise;
}

export function getExtraStore(): VacationExtraStore {
  return { units: [...extraStoreCache.units], requests: [...extraStoreCache.requests] };
}

export function getExtraUnits(): VacationExtraUnit[] {
  return extraStoreCache.units.slice();
}

export function getExtraRequestsForUnit(unitId: string): VacationExtraRequest[] {
  return extraStoreCache.requests.filter((r) => r.unitId === unitId);
}

export function getOpenExtraUnits(): VacationExtraUnit[] {
  return extraStoreCache.units.filter((u) => u.isOpen);
}

export function getExtraUnitById(unitId: string): VacationExtraUnit | null {
  return extraStoreCache.units.find((u) => u.id === unitId) ?? null;
}

// ── Desk management: create ───────────────────────────────────────────────────

export async function createExtraUnit(input: {
  label: string;
  targetYear: number;
  targetMonth: number;
  dateKeys: string[];
}): Promise<{ ok: boolean; unit?: VacationExtraUnit; message: string }> {
  const session = await getPortalSession();
  if (!session?.approved || !["desk", "admin", "team_lead"].includes(session.role)) {
    return { ok: false, message: "권한이 없습니다." };
  }

  const dateKeys = normalizeExtraVacationDateKeys(
    input.dateKeys,
    input.targetYear,
    input.targetMonth,
  );
  if (dateKeys.length === 0) {
    return { ok: false, message: "평일 날짜를 하나 이상 선택해야 합니다." };
  }

  const label =
    input.label.trim() || `${input.targetYear}년 ${input.targetMonth}월 추가 신청`;

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("vacation_extra_units")
    .insert({
      label,
      target_year: input.targetYear,
      target_month: input.targetMonth,
      date_keys: dateKeys,
      limits: {},
      annual_winners: {},
      compensatory_winners: {},
      is_open: false,
    })
    .select(
      "id, label, target_year, target_month, date_keys, limits, annual_winners, compensatory_winners, is_open, applied_at, created_at, updated_at",
    )
    .single<ExtraUnitRow>();

  if (error) {
    return { ok: false, message: getSupabaseStorageErrorMessage(error, "vacation_extra_units") };
  }

  const unit = rowToUnit(data);
  extraStoreCache = { ...extraStoreCache, units: [unit, ...extraStoreCache.units] };
  emitExtraEvent();
  return { ok: true, unit, message: "추가 신청 단위를 생성했습니다." };
}

// ── Desk management: update date keys ─────────────────────────────────────────

export async function updateExtraUnitDateKeys(
  unitId: string,
  dateKeys: string[],
): Promise<{ ok: boolean; message: string }> {
  const session = await getPortalSession();
  if (!session?.approved || !["desk", "admin", "team_lead"].includes(session.role)) {
    return { ok: false, message: "권한이 없습니다." };
  }

  const unit = extraStoreCache.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, message: "단위를 찾을 수 없습니다." };

  const cleanKeys = normalizeExtraVacationDateKeys(dateKeys, unit.targetYear, unit.targetMonth);

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("vacation_extra_units")
    .update({
      date_keys: cleanKeys,
      annual_winners: {},
      compensatory_winners: {},
      applied_at: null,
    })
    .eq("id", unitId);

  if (error) {
    return { ok: false, message: getSupabaseStorageErrorMessage(error, "vacation_extra_units") };
  }

  extraStoreCache = {
    ...extraStoreCache,
    units: extraStoreCache.units.map((u) =>
      u.id === unitId
        ? { ...u, dateKeys: cleanKeys, annualWinners: {}, compensatoryWinners: {}, appliedAt: null }
        : u,
    ),
  };
  emitExtraEvent();
  return { ok: true, message: "날짜를 업데이트했습니다." };
}

// ── Desk management: open / close ─────────────────────────────────────────────

export async function setExtraUnitOpen(
  unitId: string,
  isOpen: boolean,
): Promise<{ ok: boolean; message: string }> {
  const session = await getPortalSession();
  if (!session?.approved || !["desk", "admin", "team_lead"].includes(session.role)) {
    return { ok: false, message: "권한이 없습니다." };
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("vacation_extra_units")
    .update({ is_open: isOpen })
    .eq("id", unitId);

  if (error) {
    return { ok: false, message: getSupabaseStorageErrorMessage(error, "vacation_extra_units") };
  }

  extraStoreCache = {
    ...extraStoreCache,
    units: extraStoreCache.units.map((u) => (u.id === unitId ? { ...u, isOpen } : u)),
  };
  emitExtraEvent();
  return {
    ok: true,
    message: isOpen ? "추가 신청을 오픈했습니다." : "추가 신청을 마감했습니다.",
  };
}

// ── Desk management: per-date limit ──────────────────────────────────────────

export async function setExtraUnitLimit(
  unitId: string,
  dateKey: string,
  limit: number,
): Promise<{ ok: boolean; message: string }> {
  const session = await getPortalSession();
  if (!session?.approved || !["desk", "admin", "team_lead"].includes(session.role)) {
    return { ok: false, message: "권한이 없습니다." };
  }

  const unit = extraStoreCache.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, message: "단위를 찾을 수 없습니다." };

  const nextLimits = {
    ...unit.limits,
    [dateKey]: Math.max(1, Math.min(20, Math.trunc(limit) || DEFAULT_EXTRA_VACATION_CAPACITY)),
  };

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("vacation_extra_units")
    .update({ limits: nextLimits })
    .eq("id", unitId);

  if (error) {
    return { ok: false, message: getSupabaseStorageErrorMessage(error, "vacation_extra_units") };
  }

  extraStoreCache = {
    ...extraStoreCache,
    units: extraStoreCache.units.map((u) =>
      u.id === unitId ? { ...u, limits: nextLimits } : u,
    ),
  };
  emitExtraEvent();
  return { ok: true, message: "정원을 설정했습니다." };
}

// ── Employee: submit request ──────────────────────────────────────────────────

export async function submitExtraRequest(input: {
  unitId: string;
  requesterName: string;
  type: VacationType;
  dates: string[];
}): Promise<{ ok: boolean; message: string }> {
  const clientSession = getSession();
  if (clientSession && isReadOnlyPortalRole(clientSession.role)) {
    return { ok: false, message: "Observer 등급은 신청할 수 없습니다." };
  }

  const requesterName = input.requesterName.trim();
  if (!requesterName) return { ok: false, message: "신청자 이름을 확인할 수 없습니다." };

  const unit = extraStoreCache.units.find((u) => u.id === input.unitId);
  if (!unit) return { ok: false, message: "추가 신청 단위를 찾을 수 없습니다." };
  if (!unit.isOpen) return { ok: false, message: "현재 추가 신청이 마감되었습니다." };

  const unitDateSet = new Set(unit.dateKeys);
  const validDates = normalizeExtraVacationDateKeys(
    input.dates.filter((dk) => unitDateSet.has(dk)),
    unit.targetYear,
    unit.targetMonth,
  );
  if (validDates.length === 0) {
    return { ok: false, message: "유효한 날짜가 없습니다. 신청 가능 날짜를 확인해 주세요." };
  }

  const session = await getPortalSession();
  if (!session?.approved) return { ok: false, message: "승인된 로그인 세션이 필요합니다." };

  const supabase = await getPortalSupabaseClient();

  // dedup: unit_id + requester_id + type → delete existing before inserting
  const staleIds = extraStoreCache.requests
    .filter(
      (r) =>
        r.unitId === input.unitId &&
        r.requesterId === session.id &&
        r.type === input.type,
    )
    .map((r) => r.id);

  if (staleIds.length > 0) {
    await supabase.from("vacation_extra_requests").delete().in("id", staleIds);
  }

  const { data, error } = await supabase
    .from("vacation_extra_requests")
    .insert({
      unit_id: input.unitId,
      requester_id: session.id,
      requester_name: requesterName,
      type: input.type,
      requested_dates: validDates,
      raw_dates: formatRawDates(validDates),
    })
    .select(
      "id, unit_id, requester_id, requester_name, type, requested_dates, raw_dates, created_at, updated_at",
    )
    .single<ExtraRequestRow>();

  if (error) {
    return { ok: false, message: getSupabaseStorageErrorMessage(error, "vacation_extra_requests") };
  }

  const newRequest = rowToRequest(data);
  extraStoreCache = {
    ...extraStoreCache,
    requests: [
      newRequest,
      ...extraStoreCache.requests.filter(
        (r) =>
          !(
            r.unitId === input.unitId &&
            r.requesterId === session.id &&
            r.type === input.type
          ),
      ),
    ],
  };
  emitExtraEvent();
  return { ok: true, message: "추가 신청을 완료했습니다." };
}

// ── Lottery ───────────────────────────────────────────────────────────────────

function shuffleList<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function pickWeightedNames(
  names: string[],
  count: number,
  weights: Map<string, number>,
): string[] {
  const pool = uniqueNames(names);
  const winners: string[] = [];
  const target = Math.max(0, Math.min(count, pool.length));
  while (winners.length < target) {
    const total = pool.reduce(
      (s, n) => s + Math.max(weights.get(n) ?? 1, Number.EPSILON),
      0,
    );
    let threshold = Math.random() * total;
    let selected = pool[pool.length - 1];
    for (const n of pool) {
      threshold -= Math.max(weights.get(n) ?? 1, Number.EPSILON);
      if (threshold <= 0) {
        selected = n;
        break;
      }
    }
    winners.push(selected);
    const winSet = new Set(winners);
    for (let i = pool.length - 1; i >= 0; i--) {
      if (winSet.has(pool[i])) pool.splice(i, 1);
    }
  }
  return winners.sort((a, b) => a.localeCompare(b, "ko"));
}

function getApplicantsByDateForUnit(
  requests: VacationExtraRequest[],
  unitId: string,
  type: VacationType,
): Record<string, string[]> {
  const grouped = new Map<string, string[]>();
  requests
    .filter((r) => r.unitId === unitId && r.type === type)
    .forEach((r) => {
      r.dates.forEach((dk) => {
        const cur = grouped.get(dk) ?? [];
        cur.push(r.requesterName);
        grouped.set(dk, cur);
      });
    });
  return Object.fromEntries(
    Array.from(grouped.entries()).map(([dk, names]) => [dk, uniqueNames(names)]),
  );
}

function getCompensatoryWeightsForUnit(
  requests: VacationExtraRequest[],
  unitId: string,
): Map<string, number> {
  const datesByName = new Map<string, string[]>();
  requests
    .filter((r) => r.unitId === unitId && r.type === "대휴")
    .forEach((r) => {
      const cur = datesByName.get(r.requesterName) ?? [];
      datesByName.set(r.requesterName, uniqueDateKeys([...cur, ...r.dates]));
    });
  return new Map(
    Array.from(datesByName.entries()).map(([n, ds]) => [n, 1 / Math.max(1, ds.length)]),
  );
}

export function hasExtraLotteryResults(unit: VacationExtraUnit) {
  return (
    Object.values(unit.annualWinners).some((ns) => ns.length > 0) ||
    Object.values(unit.compensatoryWinners).some((ns) => ns.length > 0)
  );
}

export function buildExtraLotteryResultsForUnit(
  unit: VacationExtraUnit,
  requests: VacationExtraRequest[],
) {
  const annualApplicants = getApplicantsByDateForUnit(requests, unit.id, "연차");
  const compensatoryApplicants = getApplicantsByDateForUnit(requests, unit.id, "대휴");
  const compensatoryWeights = getCompensatoryWeightsForUnit(requests, unit.id);

  const annualWinners: Record<string, string[]> = {};
  const compensatoryWinners: Record<string, string[]> = {};

  normalizeExtraVacationDateKeys(unit.dateKeys, unit.targetYear, unit.targetMonth).forEach((dk) => {
    const cap = unit.limits[dk] ?? DEFAULT_EXTRA_VACATION_CAPACITY;

    // Annual: random selection up to cap
    const annualPool = uniqueNames(annualApplicants[dk] ?? []);
    annualWinners[dk] =
      annualPool.length <= cap
        ? [...annualPool].sort((a, b) => a.localeCompare(b, "ko"))
        : shuffleList(annualPool).slice(0, cap).sort((a, b) => a.localeCompare(b, "ko"));

    // Compensatory: weighted selection for remaining slots
    const annualWon = annualWinners[dk].length;
    const remaining = Math.max(0, cap - annualWon);
    const annualWonSet = new Set(annualWinners[dk]);
    const compPool = uniqueNames(
      (compensatoryApplicants[dk] ?? []).filter((n) => !annualWonSet.has(n)),
    );
    compensatoryWinners[dk] =
      compPool.length <= remaining
        ? [...compPool].sort((a, b) => a.localeCompare(b, "ko"))
        : pickWeightedNames(compPool, remaining, compensatoryWeights);
  });

  const allApplicantNames = new Set([
    ...Object.values(annualApplicants).flat(),
    ...Object.values(compensatoryApplicants).flat(),
  ]);
  const winnerCount =
    Object.values(annualWinners).flat().length +
    Object.values(compensatoryWinners).flat().length;

  return {
    annualApplicants,
    compensatoryApplicants,
    annualWinners,
    compensatoryWinners,
    applicantCount: allApplicantNames.size,
    winnerCount,
  };
}

export async function runExtraLottery(unitId: string): Promise<VacationExtraLotteryResult> {
  const unit = extraStoreCache.units.find((u) => u.id === unitId);
  if (!unit) {
    return { ok: false, unit: null, applicantCount: 0, winnerCount: 0, message: "단위를 찾을 수 없습니다." };
  }

  if (hasExtraLotteryResults(unit)) {
    return {
      ok: false,
      unit,
      applicantCount: 0,
      winnerCount: 0,
      message: "이미 추첨이 완료되었습니다. 재추첨하려면 초기화 후 진행하세요.",
    };
  }

  const {
    annualWinners,
    compensatoryWinners,
    applicantCount,
    winnerCount,
  } = buildExtraLotteryResultsForUnit(unit, extraStoreCache.requests);

  const session = await getPortalSession();
  if (!session?.approved) {
    return { ok: false, unit, applicantCount: 0, winnerCount: 0, message: "권한이 없습니다." };
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("vacation_extra_units")
    .update({ annual_winners: annualWinners, compensatory_winners: compensatoryWinners })
    .eq("id", unitId);

  if (error) {
    return {
      ok: false,
      unit,
      applicantCount: 0,
      winnerCount: 0,
      message: getSupabaseStorageErrorMessage(error, "vacation_extra_units"),
    };
  }

  const updatedUnit: VacationExtraUnit = { ...unit, annualWinners, compensatoryWinners };
  extraStoreCache = {
    ...extraStoreCache,
    units: extraStoreCache.units.map((u) => (u.id === unitId ? updatedUnit : u)),
  };
  emitExtraEvent();

  return {
    ok: true,
    unit: updatedUnit,
    applicantCount,
    winnerCount,
    message: "추첨이 완료되었습니다.",
  };
}

export async function resetExtraLottery(unitId: string): Promise<{ ok: boolean; message: string }> {
  const session = await getPortalSession();
  if (!session?.approved || !["desk", "admin", "team_lead"].includes(session.role)) {
    return { ok: false, message: "권한이 없습니다." };
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("vacation_extra_units")
    .update({ annual_winners: {}, compensatory_winners: {}, applied_at: null })
    .eq("id", unitId);

  if (error) {
    return { ok: false, message: getSupabaseStorageErrorMessage(error, "vacation_extra_units") };
  }

  extraStoreCache = {
    ...extraStoreCache,
    units: extraStoreCache.units.map((u) =>
      u.id === unitId
        ? { ...u, annualWinners: {}, compensatoryWinners: {}, appliedAt: null }
        : u,
    ),
  };
  emitExtraEvent();
  return { ok: true, message: "추첨 결과를 초기화했습니다. 재추첨할 수 있습니다." };
}

// ── Apply: union / append-only ─────────────────────────────────────────────────
//
// This function NEVER replaces existing vacation entries. It unions extra winners
// on top of whatever is already in the schedule. 1차 vacations are fully preserved.

function mergeExtraVacationEntriesToGeneratedSchedule(
  generated: GeneratedSchedule,
  scheduleState: ScheduleState,
  extraMap: Record<string, string[]>,
  extraDateSet: Set<string>,
): GeneratedSchedule {
  const next = JSON.parse(JSON.stringify(generated)) as GeneratedSchedule;
  let changed = false;

  next.days = next.days.map((day) => {
    if (!extraDateSet.has(day.dateKey)) return day;
    const extra = uniqueNames(extraMap[day.dateKey] ?? []);
    if (extra.length === 0) return day;
    const existing = uniqueNames(day.vacations ?? []);
    const merged = uniqueNames([...existing, ...extra]);
    if (merged.length === existing.length && merged.every((e, i) => e === existing[i])) return day;
    changed = true;
    const nextAssignments = { ...day.assignments };
    if (merged.length > 0) {
      nextAssignments["휴가"] = [...merged];
    } else {
      delete nextAssignments["휴가"];
    }
    return { ...day, vacations: [...merged], assignments: nextAssignments };
  });

  if (changed) {
    syncGeneralAssignments(scheduleState, next.days, scheduleState.generalTeamPeople);
  }

  return next;
}

function collectExtraApplicableDateKeys(
  scheduleState: ScheduleState,
  publishedItems: Array<{ monthKey: string; schedule: GeneratedSchedule }>,
  targetMonthKey: string,
): Set<string> {
  const dateKeys = new Set<string>();
  scheduleState.generatedHistory
    .filter((item) => item.monthKey === targetMonthKey)
    .forEach((item) => item.days.forEach((day) => dateKeys.add(day.dateKey)));
  if (scheduleState.generated?.monthKey === targetMonthKey) {
    scheduleState.generated.days.forEach((day) => dateKeys.add(day.dateKey));
  }
  publishedItems
    .filter((item) => item.monthKey === targetMonthKey)
    .forEach((item) => item.schedule.days.forEach((day) => dateKeys.add(day.dateKey)));
  return dateKeys;
}

export function buildExtraApprovedMapForUnit(
  unit: VacationExtraUnit,
  applicableDateSet: Set<string>,
): Record<string, string[]> {
  const extraApprovedMap: Record<string, string[]> = {};
  normalizeExtraVacationDateKeys(unit.dateKeys, unit.targetYear, unit.targetMonth).forEach((dk) => {
    if (!applicableDateSet.has(dk)) return;
    const annual = (unit.annualWinners[dk] ?? []).map((name) =>
      formatVacationEntry("연차", name),
    );
    const compensatory = (unit.compensatoryWinners[dk] ?? []).map((name) =>
      formatVacationEntry("대휴", name),
    );
    const entries = uniqueNames([...annual, ...compensatory]);
    if (entries.length > 0) extraApprovedMap[dk] = entries;
  });
  return extraApprovedMap;
}

export function applyExtraUnitToScheduleSnapshot<T extends { monthKey: string; schedule: GeneratedSchedule }>(
  scheduleStateInput: ScheduleState,
  publishedItemsInput: T[],
  unit: VacationExtraUnit,
) {
  const scheduleState = JSON.parse(JSON.stringify(scheduleStateInput)) as ScheduleState;
  const publishedItems = JSON.parse(JSON.stringify(publishedItemsInput)) as T[];
  const targetMonthKey = `${unit.targetYear}-${String(unit.targetMonth).padStart(2, "0")}`;
  const applicableDateSet = collectExtraApplicableDateKeys(scheduleState, publishedItems, targetMonthKey);
  const extraApprovedMap = buildExtraApprovedMapForUnit(unit, applicableDateSet);
  const extraDateSet = new Set(Object.keys(extraApprovedMap));

  if (extraDateSet.size === 0) {
    return {
      scheduleState,
      publishedItems,
      extraApprovedMap,
      targetMonthKey,
      shouldSavePublished: false,
    };
  }

  const currentVacationMap = parseVacationMap(scheduleState.vacations);
  const nextVacationMap: Record<string, string[]> = { ...currentVacationMap };
  Object.entries(extraApprovedMap).forEach(([dk, extraEntries]) => {
    const existing = currentVacationMap[dk] ?? [];
    nextVacationMap[dk] = uniqueNames([...existing, ...extraEntries]);
  });
  scheduleState.vacations = serializeVacationMapCompact(nextVacationMap);

  scheduleState.generatedHistory = scheduleState.generatedHistory.map((item) =>
    mergeExtraVacationEntriesToGeneratedSchedule(
      item,
      scheduleState,
      extraApprovedMap,
      extraDateSet,
    ),
  );

  if (scheduleState.generated) {
    const matched = scheduleState.generatedHistory.find(
      (item) => item.monthKey === scheduleState.generated?.monthKey,
    );
    scheduleState.generated = matched
      ? matched
      : mergeExtraVacationEntriesToGeneratedSchedule(
          scheduleState.generated,
          scheduleState,
          extraApprovedMap,
          extraDateSet,
        );
  }

  const nextPublishedItems = publishedItems.map((item): T =>
    item.monthKey === targetMonthKey
      ? {
          ...item,
          schedule: mergeExtraVacationEntriesToGeneratedSchedule(
            item.schedule,
            scheduleState,
            extraApprovedMap,
            extraDateSet,
          ),
        }
      : item,
  );

  return {
    scheduleState,
    publishedItems: nextPublishedItems,
    extraApprovedMap,
    targetMonthKey,
    shouldSavePublished: JSON.stringify(publishedItems) !== JSON.stringify(nextPublishedItems),
  };
}

export async function applyExtraUnitToSchedule(
  unitId: string,
): Promise<{ ok: boolean; message: string }> {
  if (typeof window === "undefined") {
    return { ok: false, message: "브라우저에서만 근무 반영이 가능합니다." };
  }

  const unit = extraStoreCache.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, message: "추가 신청 단위를 찾을 수 없습니다." };

  if (!hasExtraLotteryResults(unit)) {
    return {
      ok: false,
      message: "추첨 결과가 없습니다. 먼저 추첨을 진행해 주세요.",
    };
  }

  const scheduleState = readStoredScheduleState();
  const publishedItems = getPublishedSchedules();
  const {
    scheduleState: nextScheduleState,
    publishedItems: nextPublishedItems,
    extraApprovedMap,
    targetMonthKey,
    shouldSavePublished,
  } = applyExtraUnitToScheduleSnapshot(
    scheduleState,
    publishedItems,
    unit,
  );

  if (Object.keys(extraApprovedMap).length === 0) {
    return { ok: false, message: "반영할 당첨자가 없습니다." };
  }

  try {
    await saveScheduleState(nextScheduleState);
    if (shouldSavePublished) {
      await savePublishedSchedules(nextPublishedItems);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "근무표 저장에 실패했습니다. 다시 불러와 주세요.";
    emitExtraStatus({ ok: false, message });
    return { ok: false, message };
  }

  if (shouldSavePublished) {
    refreshPublishedSchedules({ monthKeys: [targetMonthKey], repair: false }).catch((err) => {
      emitExtraStatus({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : "휴가 반영 후 게시 근무표를 다시 불러오지 못했습니다.",
      });
    });
  }

  // Mark unit as applied
  const session = await getPortalSession();
  if (session?.approved) {
    const appliedAt = nowLabel();
    const supabase = await getPortalSupabaseClient();
    await supabase
      .from("vacation_extra_units")
      .update({ applied_at: appliedAt })
      .eq("id", unitId);
    extraStoreCache = {
      ...extraStoreCache,
      units: extraStoreCache.units.map((u) =>
        u.id === unitId ? { ...u, appliedAt } : u,
      ),
    };
    emitExtraEvent();
  }

  return {
    ok: true,
    message: `${unit.targetYear}년 ${unit.targetMonth}월 추가 당첨자를 근무표에 반영했습니다. (기존 휴가 보존)`,
  };
}

// ── Helpers for UI ────────────────────────────────────────────────────────────

export function getExtraApplicantsOverview(unitId: string) {
  const unit = extraStoreCache.units.find((u) => u.id === unitId);
  if (!unit) return null;

  const requests = extraStoreCache.requests.filter((r) => r.unitId === unitId);
  const annualApplicants = getApplicantsByDateForUnit(requests, unitId, "연차");
  const compensatoryApplicants = getApplicantsByDateForUnit(requests, unitId, "대휴");

  return {
    unit,
    requests,
    annualApplicants,
    compensatoryApplicants,
    hasLotteryResults:
      Object.values(unit.annualWinners).some((ns) => ns.length > 0) ||
      Object.values(unit.compensatoryWinners).some((ns) => ns.length > 0),
  };
}
