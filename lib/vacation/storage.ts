"use client";

import { defaultScheduleState, STORAGE_KEY } from "@/lib/schedule/constants";
import {
  formatVacationEntry,
  getMonthKey,
  parseVacationMap,
  sanitizeScheduleState,
} from "@/lib/schedule/engine";
import { GeneratedSchedule, ScheduleState, VacationType } from "@/lib/schedule/types";

export const VACATION_STORAGE_KEY = "j-special-force-vacations-v1";
export const VACATION_EVENT = "j-special-force-vacations-changed";
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
  limits: Record<string, number>;
  annualWinners: Record<string, string[]>;
  compensatoryWinners: Record<string, string[]>;
  updatedAt: string;
  appliedAt: string | null;
}

export interface VacationStore {
  requests: VacationRequest[];
  months: Record<string, VacationMonthState>;
}

function nowLabel() {
  return new Date().toLocaleString("ko-KR");
}

function createEmptyStore(): VacationStore {
  return {
    requests: [],
    months: {},
  };
}

function readStore(): VacationStore {
  if (typeof window === "undefined") return createEmptyStore();
  const raw = window.localStorage.getItem(VACATION_STORAGE_KEY);
  if (!raw) return createEmptyStore();

  try {
    const parsed = JSON.parse(raw) as Partial<VacationStore>;
    return sanitizeVacationStore(parsed);
  } catch {
    return createEmptyStore();
  }
}

function writeStore(store: VacationStore) {
  if (typeof window === "undefined") return;
  const sanitized = sanitizeVacationStore(store);
  window.localStorage.setItem(VACATION_STORAGE_KEY, JSON.stringify(sanitized));
  window.dispatchEvent(new Event(VACATION_EVENT));
}

function uniqueNames(names: string[]) {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
}

function uniqueDateKeys(dateKeys: string[]) {
  return Array.from(new Set(dateKeys)).sort((left, right) => left.localeCompare(right));
}

function sanitizeMonthState(input: Partial<VacationMonthState> | undefined, year: number, month: number): VacationMonthState {
  const monthKey = getMonthKey(year, month);
  return {
    monthKey,
    year,
    month,
    limits: Object.fromEntries(
      Object.entries(input?.limits ?? {}).map(([dateKey, value]) => [
        dateKey,
        Math.max(1, Math.min(10, Number(value) || DEFAULT_VACATION_CAPACITY)),
      ]),
    ),
    annualWinners: Object.fromEntries(
      Object.entries(input?.annualWinners ?? {}).map(([dateKey, names]) => [dateKey, uniqueNames(Array.isArray(names) ? names : [])]),
    ),
    compensatoryWinners: Object.fromEntries(
      Object.entries(input?.compensatoryWinners ?? {}).map(([dateKey, names]) => [dateKey, uniqueNames(Array.isArray(names) ? names : [])]),
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
          return {
            id: typeof request.id === "string" ? request.id : crypto.randomUUID(),
            requesterId: typeof request.requesterId === "string" ? request.requesterId : null,
            requesterName: typeof request.requesterName === "string" ? request.requesterName.trim() : "",
            type: request.type === "대휴" ? "대휴" : "연차",
            year,
            month,
            monthKey,
            dates: uniqueDateKeys(Array.isArray(request.dates) ? request.dates : []),
            rawDates: typeof request.rawDates === "string" ? request.rawDates : "",
            createdAt: typeof request.createdAt === "string" ? request.createdAt : nowLabel(),
          } satisfies VacationRequest;
        })
        .filter((request) => request.requesterName && request.dates.length > 0)
    : [];

  const months = Object.fromEntries(
    Object.entries(input?.months ?? {}).map(([monthKey, value]) => {
      const [yearText, monthText] = monthKey.split("-");
      const year = Number(yearText);
      const month = Number(monthText);
      return [monthKey, sanitizeMonthState(value, year, month)];
    }),
  );

  return { requests, months };
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
      if (day >= 1 && day <= monthDays) {
        valid.push(formatDateKey(year, month, day));
      } else {
        invalid.push(token);
      }
      return;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
      if (token.startsWith(`${monthKey}-`)) {
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

function shuffleNames(names: string[]) {
  const next = [...names];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = next[index];
    next[index] = next[randomIndex];
    next[randomIndex] = current;
  }
  return next;
}

function ensureMonthState(store: VacationStore, year: number, month: number) {
  const monthKey = getMonthKey(year, month);
  if (!store.months[monthKey]) {
    store.months[monthKey] = sanitizeMonthState(undefined, year, month);
  }
  return store.months[monthKey];
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
  const approvedMap: Record<string, string[]> = {};

  getMonthDateKeys(monthState.year, monthState.month).forEach((dateKey) => {
    const entries = [
      ...(monthState.annualWinners[dateKey] ?? []).map((name) => formatVacationEntry("연차", name)),
      ...(monthState.compensatoryWinners[dateKey] ?? []).map((name) => formatVacationEntry("대휴", name)),
    ];
    approvedMap[dateKey] = uniqueNames(entries);
  });

  return approvedMap;
}

export function getVacationStore() {
  return readStore();
}

export function getVacationMonthState(year: number, month: number) {
  const store = readStore();
  const monthKey = getMonthKey(year, month);
  const hasMonthState = Boolean(store.months[monthKey]);
  const monthState = ensureMonthState(store, year, month);
  if (!hasMonthState) {
    writeStore(store);
  }
  return monthState;
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

  const parsedDates = parseRequestedVacationDates(input.year, input.month, input.rawDates);
  if (parsedDates.valid.length === 0) {
    return {
      ok: false as const,
      message: parsedDates.invalid.length > 0 ? `입력한 날짜를 확인해 주세요: ${parsedDates.invalid.join(", ")}` : "휴가 날짜를 입력해 주세요.",
    };
  }

  const store = readStore();
  const monthState = ensureMonthState(store, input.year, input.month);
  store.requests = [
    {
      id: crypto.randomUUID(),
      requesterId: input.requesterId,
      requesterName,
      type: input.type,
      year: input.year,
      month: input.month,
      monthKey: monthState.monthKey,
      dates: parsedDates.valid,
      rawDates: input.rawDates.trim(),
      createdAt: nowLabel(),
    },
    ...store.requests,
  ];
  writeStore(store);

  return {
    ok: true as const,
    message:
      parsedDates.invalid.length > 0
        ? `휴가 신청을 제출했습니다. 제외된 입력: ${parsedDates.invalid.join(", ")}`
        : "휴가 신청을 제출했습니다.",
  };
}

export function getVacationApplicantsOverview(year: number, month: number) {
  const store = readStore();
  const monthKey = getMonthKey(year, month);
  const hasMonthState = Boolean(store.months[monthKey]);
  const monthState = ensureMonthState(store, year, month);
  const annualApplicants = getApplicantsByType(store, monthKey, "연차");
  const compensatoryApplicants = getApplicantsByType(store, monthKey, "대휴");
  if (!hasMonthState) {
    writeStore(store);
  }

  return {
    monthState,
    annualApplicants,
    compensatoryApplicants,
    requests: getRequestsForMonth(store, monthKey),
  };
}

export function setVacationCapacity(year: number, month: number, dateKey: string, limit: number) {
  const store = readStore();
  const monthState = ensureMonthState(store, year, month);
  monthState.limits[dateKey] = Math.max(1, Math.min(10, Math.trunc(limit) || DEFAULT_VACATION_CAPACITY));
  monthState.updatedAt = nowLabel();
  writeStore(store);
  return monthState;
}

export function runAnnualVacationLottery(year: number, month: number) {
  const store = readStore();
  const monthState = ensureMonthState(store, year, month);
  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const nextAnnualWinners: Record<string, string[]> = {};

  getMonthDateKeys(year, month).forEach((dateKey) => {
    const applicants = annualApplicants[dateKey] ?? [];
    const capacity = getMonthCapacity(monthState, dateKey);
    if (applicants.length <= capacity) {
      nextAnnualWinners[dateKey] = [...applicants];
      return;
    }
    nextAnnualWinners[dateKey] = shuffleNames(applicants).slice(0, capacity).sort((left, right) => left.localeCompare(right));
  });

  monthState.annualWinners = nextAnnualWinners;
  monthState.compensatoryWinners = {};
  monthState.updatedAt = nowLabel();
  writeStore(store);

  return monthState;
}

export function runCompensatoryVacationLottery(year: number, month: number) {
  const store = readStore();
  const monthState = ensureMonthState(store, year, month);
  const annualApplicants = getApplicantsByType(store, monthState.monthKey, "연차");
  const compensatoryApplicants = getApplicantsByType(store, monthState.monthKey, "대휴");

  const nextAnnualWinners =
    Object.keys(monthState.annualWinners).length > 0
      ? monthState.annualWinners
      : runAnnualVacationLottery(year, month).annualWinners;
  const nextCompensatoryWinners: Record<string, string[]> = {};

  getMonthDateKeys(year, month).forEach((dateKey) => {
    const annualWinners = uniqueNames(nextAnnualWinners[dateKey] ?? annualApplicants[dateKey] ?? []);
    const remainingCapacity = Math.max(0, getMonthCapacity(monthState, dateKey) - annualWinners.length);
    const applicants = compensatoryApplicants[dateKey] ?? [];

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

export function applyVacationMonthToSchedule(year: number, month: number) {
  if (typeof window === "undefined") {
    return { ok: false as const, message: "브라우저에서만 근무 반영이 가능합니다." };
  }

  const vacationStore = readStore();
  const monthKey = getMonthKey(year, month);
  const approvedMap = getApprovedEntriesForMonth(vacationStore, monthKey);
  const managedDates = new Set(getMonthDateKeys(year, month));

  const rawState = window.localStorage.getItem(STORAGE_KEY);
  const scheduleState = sanitizeScheduleState(
    rawState ? (JSON.parse(rawState) as Partial<ScheduleState>) : defaultScheduleState,
  );
  const currentVacationMap = parseVacationMap(scheduleState.vacations);
  const nextVacationMap: Record<string, string[]> = {};

  Object.entries(currentVacationMap).forEach(([dateKey, entries]) => {
    if (managedDates.has(dateKey)) return;
    nextVacationMap[dateKey] = [...entries];
  });

  Object.entries(approvedMap).forEach(([dateKey, entries]) => {
    if (entries.length === 0) return;
    nextVacationMap[dateKey] = [...entries];
  });

  scheduleState.vacations = serializeVacationMap(nextVacationMap);
  scheduleState.generatedHistory = scheduleState.generatedHistory.map((generated) =>
    applyVacationEntriesToGeneratedSchedule(generated, approvedMap, managedDates),
  );

  if (scheduleState.generated) {
    const synced = scheduleState.generatedHistory.find((item) => item.monthKey === scheduleState.generated?.monthKey);
    if (synced) {
      scheduleState.generated = synced;
    } else {
      scheduleState.generated = applyVacationEntriesToGeneratedSchedule(scheduleState.generated, approvedMap, managedDates);
    }
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduleState));

  const monthState = ensureMonthState(vacationStore, year, month);
  monthState.appliedAt = nowLabel();
  monthState.updatedAt = nowLabel();
  writeStore(vacationStore);

  return { ok: true as const, message: `${year}년 ${month}월 휴가 결과를 근무표에 반영했습니다.` };
}

export function getVacationWinnersByType(year: number, month: number) {
  const monthState = getVacationMonthState(year, month);
  return {
    annualWinners: monthState.annualWinners,
    compensatoryWinners: monthState.compensatoryWinners,
  };
}
