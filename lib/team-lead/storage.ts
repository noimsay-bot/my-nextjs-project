"use client";

import { getUsers } from "@/lib/auth/storage";
import { STORAGE_KEY, getScheduleCategoryLabel } from "@/lib/schedule/constants";
import { sanitizeScheduleState } from "@/lib/schedule/engine";
import { getPublishedSchedules } from "@/lib/schedule/published";
import { DaySchedule, GeneratedSchedule, ScheduleState } from "@/lib/schedule/types";

export type AssignmentTimeColor = "" | "red" | "blue" | "yellow";
export type AssignmentTravelType = "" | "국내출장" | "해외출장" | "당일출장";

export interface ScheduleAssignmentEntry {
  clockIn: string;
  clockInColor: AssignmentTimeColor;
  clockInConfirmed: boolean;
  clockOut: string;
  clockOutColor: AssignmentTimeColor;
  clockOutConfirmed: boolean;
  schedules: string[];
  travelType: AssignmentTravelType;
  exclusiveVideo: boolean[];
  coverageScore: number;
  coverageNote: string;
}

export interface ScheduleAssignmentRow {
  key: string;
  name: string;
  duty: string;
  isCustom: boolean;
}

export interface ScheduleAssignmentCustomRow {
  id: string;
  name: string;
  duty: string;
}

export interface ScheduleAssignmentRowOverride {
  name: string;
  duty: string;
}

export interface TeamLeadTripItem {
  monthKey: string;
  dateKey: string;
  duty: string;
  travelType: AssignmentTravelType;
  schedules: string[];
}

export interface TeamLeadTripPersonCard {
  name: string;
  items: TeamLeadTripItem[];
}

export interface ContributionPeriod {
  startMonthKey: string;
  endMonthKey: string;
  startLabel: string;
  endLabel: string;
}

export interface ContributionScoreItem {
  monthKey: string;
  dateKey: string;
  duty: string;
  clockIn: string;
  clockOut: string;
  schedules: string[];
  clockInScore: number;
  clockOutScore: number;
  coverageScore: number;
  coverageNote: string;
  totalScore: number;
}

export interface ContributionManualItem {
  id: string;
  label: string;
  score: number;
}

export interface ContributionPersonCard {
  name: string;
  totalScore: number;
  autoScore: number;
  manualScore: number;
  clockInScore: number;
  clockOutScore: number;
  coverageScore: number;
  itemCount: number;
  items: ContributionScoreItem[];
  manualItems: ContributionManualItem[];
}

export type FinalCutDecision = "" | "circle" | "triangle" | "cross";

export interface FinalCutScheduleItem {
  id: string;
  dateKey: string;
  duty: string;
  schedule: string;
  decision: FinalCutDecision;
}

export interface FinalCutPersonCard {
  name: string;
  items: FinalCutScheduleItem[];
}

export interface ScheduleAssignmentDayRows {
  addedRows: ScheduleAssignmentCustomRow[];
  deletedRowKeys: string[];
  rowOverrides: Record<string, ScheduleAssignmentRowOverride>;
}

export type ScheduleAssignmentMonthStore = Record<string, ScheduleAssignmentEntry>;
export type ScheduleAssignmentStore = Record<string, ScheduleAssignmentMonthStore>;
export type ScheduleAssignmentRowStore = Record<string, Record<string, ScheduleAssignmentDayRows>>;

export interface ScheduleAssignmentDataStore {
  entries: ScheduleAssignmentStore;
  rows: ScheduleAssignmentRowStore;
}

const TEAM_LEAD_SCHEDULE_ASSIGNMENT_KEY = "j-team-lead-schedule-assignment-v1";
export const TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT = "j-team-lead-schedule-assignment-updated";
const TEAM_LEAD_CONTRIBUTION_KEY = "j-team-lead-contribution-v1";
export const TEAM_LEAD_CONTRIBUTION_EVENT = "j-team-lead-contribution-updated";
const TEAM_LEAD_FINAL_CUT_KEY = "j-team-lead-final-cut-v1";
export const TEAM_LEAD_FINAL_CUT_EVENT = "j-team-lead-final-cut-updated";

export function createAssignmentRowKey(dateKey: string, category: string, index: number, name: string) {
  return `${dateKey}::${category}::${index}::${name}`;
}

export function createCustomAssignmentRowKey(dateKey: string, customId: string) {
  return `${dateKey}::custom::${customId}`;
}

export function createDefaultScheduleAssignmentEntry(): ScheduleAssignmentEntry {
  return {
    clockIn: "",
    clockInColor: "",
    clockInConfirmed: false,
    clockOut: "",
    clockOutColor: "",
    clockOutConfirmed: false,
    schedules: [""],
    travelType: "",
    exclusiveVideo: [false],
    coverageScore: 0,
    coverageNote: "",
  };
}

export function createDefaultScheduleAssignmentDayRows(): ScheduleAssignmentDayRows {
  return {
    addedRows: [],
    deletedRowKeys: [],
    rowOverrides: {},
  };
}

function normalizeScheduleAssignmentEntry(
  entry: Partial<ScheduleAssignmentEntry> | undefined,
): ScheduleAssignmentEntry {
  const defaultEntry = createDefaultScheduleAssignmentEntry();
  const schedules =
    entry?.schedules && entry.schedules.length > 0
      ? entry.schedules.map((item) => item ?? "")
      : defaultEntry.schedules;
  const exclusiveVideoSource = Array.isArray(entry?.exclusiveVideo)
    ? entry.exclusiveVideo
    : typeof entry?.exclusiveVideo === "boolean"
      ? [entry.exclusiveVideo]
      : [];
  const exclusiveVideo = schedules.map((_, index) => exclusiveVideoSource[index] ?? false);

  const clockIn =
    entry?.clockIn === "00:00" && !entry.clockInColor ? "" : (entry?.clockIn ?? defaultEntry.clockIn);
  const clockOut =
    entry?.clockOut === "00:00" && !entry.clockOutColor ? "" : (entry?.clockOut ?? defaultEntry.clockOut);

  return {
    clockIn,
    clockInColor: entry?.clockInColor ?? defaultEntry.clockInColor,
    clockInConfirmed: entry?.clockInConfirmed ?? Boolean(clockIn),
    clockOut,
    clockOutColor: entry?.clockOutColor ?? defaultEntry.clockOutColor,
    clockOutConfirmed: entry?.clockOutConfirmed ?? Boolean(clockOut),
    schedules,
    travelType: entry?.travelType ?? defaultEntry.travelType,
    exclusiveVideo,
    coverageScore: [0, 0.5, 1, 2].includes(Number(entry?.coverageScore)) ? Number(entry?.coverageScore) : 0,
    coverageNote: typeof entry?.coverageNote === "string" ? entry.coverageNote : "",
  };
}

function normalizeEntriesStore(store: unknown): ScheduleAssignmentStore {
  if (!store || typeof store !== "object") return {};

  const nextStore: ScheduleAssignmentStore = {};
  for (const [monthKey, monthEntries] of Object.entries(store as Record<string, unknown>)) {
    if (!monthEntries || typeof monthEntries !== "object") continue;

    nextStore[monthKey] = {};
    for (const [rowKey, entry] of Object.entries(monthEntries as Record<string, unknown>)) {
      nextStore[monthKey][rowKey] = normalizeScheduleAssignmentEntry(
        entry as Partial<ScheduleAssignmentEntry> | undefined,
      );
    }
  }

  return nextStore;
}

function normalizeDayRows(dayRows: Partial<ScheduleAssignmentDayRows> | undefined): ScheduleAssignmentDayRows {
  return {
    addedRows: Array.isArray(dayRows?.addedRows)
      ? dayRows.addedRows
          .filter((row): row is ScheduleAssignmentCustomRow => Boolean(row && typeof row.id === "string"))
          .map((row) => ({
            id: row.id,
            name: row.name ?? "",
            duty: row.duty ?? "",
          }))
      : [],
    deletedRowKeys: Array.isArray(dayRows?.deletedRowKeys) ? dayRows.deletedRowKeys.filter(Boolean) : [],
    rowOverrides:
      dayRows?.rowOverrides && typeof dayRows.rowOverrides === "object"
        ? Object.fromEntries(
            Object.entries(dayRows.rowOverrides).map(([rowKey, row]) => [
              rowKey,
              {
                name: row?.name ?? "",
                duty: row?.duty ?? "",
              },
            ]),
          )
        : {},
  };
}

function normalizeRowsStore(store: unknown): ScheduleAssignmentRowStore {
  if (!store || typeof store !== "object") return {};

  const nextStore: ScheduleAssignmentRowStore = {};
  for (const [monthKey, monthRows] of Object.entries(store as Record<string, unknown>)) {
    if (!monthRows || typeof monthRows !== "object") continue;

    nextStore[monthKey] = {};
    for (const [dateKey, dayRows] of Object.entries(monthRows as Record<string, unknown>)) {
      nextStore[monthKey][dateKey] = normalizeDayRows(dayRows as Partial<ScheduleAssignmentDayRows> | undefined);
    }
  }

  return nextStore;
}

function normalizeScheduleAssignmentDataStore(store: unknown): ScheduleAssignmentDataStore {
  if (!store || typeof store !== "object") {
    return { entries: {}, rows: {} };
  }

  if ("entries" in (store as Record<string, unknown>) || "rows" in (store as Record<string, unknown>)) {
    const structured = store as Partial<ScheduleAssignmentDataStore>;
    return {
      entries: normalizeEntriesStore(structured.entries),
      rows: normalizeRowsStore(structured.rows),
    };
  }

  return {
    entries: normalizeEntriesStore(store),
    rows: {},
  };
}

export function getScheduleAssignmentStore(): ScheduleAssignmentDataStore {
  if (typeof window === "undefined") return { entries: {}, rows: {} };
  const raw = window.localStorage.getItem(TEAM_LEAD_SCHEDULE_ASSIGNMENT_KEY);
  if (!raw) return { entries: {}, rows: {} };
  try {
    return normalizeScheduleAssignmentDataStore(JSON.parse(raw));
  } catch {
    return { entries: {}, rows: {} };
  }
}

export function saveScheduleAssignmentStore(store: ScheduleAssignmentDataStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEAM_LEAD_SCHEDULE_ASSIGNMENT_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT));
}

function parseTimeMinutes(value: string) {
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  const [hoursText, minutesText] = trimmed.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function normalizeDutyLabel(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function isWeekendDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function isWeekendDutyDay(day: DaySchedule | null, dateKey: string) {
  if (!day) return isWeekendDateKey(dateKey);
  return day.isWeekend;
}

function getDutyBaseTimes(duty: string, dateKey: string, day: DaySchedule | null) {
  const normalized = normalizeDutyLabel(duty);
  switch (normalized) {
    case "조근":
      return isWeekendDutyDay(day, dateKey)
        ? { clockIn: 9 * 60, clockOut: 18 * 60 }
        : { clockIn: 7 * 60, clockOut: 16 * 60 };
    case "일반":
      return { clockIn: 9 * 60, clockOut: 18 * 60 };
    case "연장":
      return { clockIn: 10 * 60, clockOut: 19 * 60 };
    case "석근":
      return { clockIn: 13 * 60, clockOut: 21 * 60 };
    case "야근":
      return { clockIn: 16 * 60 + 30, clockOut: 7 * 60 + 30 };
    case "뉴스대기":
      return { clockIn: 11 * 60, clockOut: 20 * 60 };
    default:
      return null;
  }
}

function toScoreByHalfHour(minutes: number) {
  if (minutes < 30) return 0;
  return Math.floor(minutes / 30) * 0.1;
}

function roundScore(score: number) {
  return Math.round(score * 10) / 10;
}

function normalizeContributionManualItem(item: Partial<ContributionManualItem> | undefined): ContributionManualItem | null {
  if (!item) return null;
  const label = typeof item.label === "string" ? item.label.trim() : "";
  const score = roundScore(Number(item.score) || 0);
  if (!label) return null;
  return {
    id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    score,
  };
}

function normalizeContributionManualStore(store: unknown) {
  if (!store || typeof store !== "object") return {} as Record<string, ContributionManualItem[]>;
  return Object.fromEntries(
    Object.entries(store as Record<string, unknown>).map(([name, items]) => [
      name,
      Array.isArray(items)
        ? items
            .map((item) => normalizeContributionManualItem(item as Partial<ContributionManualItem> | undefined))
            .filter((item): item is ContributionManualItem => Boolean(item))
        : [],
    ]),
  ) as Record<string, ContributionManualItem[]>;
}

export function getContributionManualStore() {
  if (typeof window === "undefined") return {} as Record<string, ContributionManualItem[]>;
  const raw = window.localStorage.getItem(TEAM_LEAD_CONTRIBUTION_KEY);
  if (!raw) return {} as Record<string, ContributionManualItem[]>;
  try {
    return normalizeContributionManualStore(JSON.parse(raw));
  } catch {
    return {} as Record<string, ContributionManualItem[]>;
  }
}

export function saveContributionManualStore(store: Record<string, ContributionManualItem[]>) {
  if (typeof window === "undefined") return;
  const normalized = normalizeContributionManualStore(store);
  window.localStorage.setItem(TEAM_LEAD_CONTRIBUTION_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(TEAM_LEAD_CONTRIBUTION_EVENT));
}

export function updateContributionManualItems(name: string, items: ContributionManualItem[]) {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const store = getContributionManualStore();
  const next = {
    ...store,
    [trimmedName]: items
      .map((item) => normalizeContributionManualItem(item))
      .filter((item): item is ContributionManualItem => Boolean(item)),
  };
  saveContributionManualStore(next);
}

function normalizeFinalCutDecision(value: unknown): FinalCutDecision {
  return value === "circle" || value === "triangle" || value === "cross" ? value : "";
}

function normalizeFinalCutStore(store: unknown) {
  if (!store || typeof store !== "object") return {} as Record<string, FinalCutDecision>;
  return Object.fromEntries(
    Object.entries(store as Record<string, unknown>).map(([key, value]) => [key, normalizeFinalCutDecision(value)]),
  ) as Record<string, FinalCutDecision>;
}

export function getFinalCutStore() {
  if (typeof window === "undefined") return {} as Record<string, FinalCutDecision>;
  const raw = window.localStorage.getItem(TEAM_LEAD_FINAL_CUT_KEY);
  if (!raw) return {} as Record<string, FinalCutDecision>;
  try {
    return normalizeFinalCutStore(JSON.parse(raw));
  } catch {
    return {} as Record<string, FinalCutDecision>;
  }
}

export function saveFinalCutStore(store: Record<string, FinalCutDecision>) {
  if (typeof window === "undefined") return;
  const normalized = normalizeFinalCutStore(store);
  window.localStorage.setItem(TEAM_LEAD_FINAL_CUT_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(TEAM_LEAD_FINAL_CUT_EVENT));
}

export function updateFinalCutDecision(itemId: string, decision: FinalCutDecision) {
  const trimmedId = itemId.trim();
  if (!trimmedId) return;
  const store = getFinalCutStore();
  const normalizedDecision = normalizeFinalCutDecision(decision);
  const next = { ...store };
  if (!normalizedDecision) {
    delete next[trimmedId];
  } else {
    next[trimmedId] = normalizedDecision;
  }
  saveFinalCutStore(next);
}

export function getContributionPeriod(baseDate = new Date()): ContributionPeriod {
  const year = baseDate.getFullYear();
  const startMonthKey = `${year - 1}-12`;
  const endMonthKey = `${year}-11`;
  return {
    startMonthKey,
    endMonthKey,
    startLabel: `${year - 1}년 12월`,
    endLabel: `${year}년 11월`,
  };
}

function isMonthKeyInContributionPeriod(monthKey: string, period: ContributionPeriod) {
  return monthKey >= period.startMonthKey && monthKey <= period.endMonthKey;
}

function buildContributionItem(
  monthKey: string,
  dateKey: string,
  duty: string,
  entry: ScheduleAssignmentEntry,
  day: DaySchedule | null,
): ContributionScoreItem | null {
  const baseTimes = getDutyBaseTimes(duty, dateKey, day);
  const coverageScore = roundScore(entry.coverageScore ?? 0);
  if (!baseTimes && coverageScore <= 0) return null;

  const clockInMinutes = baseTimes ? parseTimeMinutes(entry.clockIn) : null;
  const clockOutMinutes = baseTimes ? parseTimeMinutes(entry.clockOut) : null;
  const clockInScore =
    !baseTimes || clockInMinutes === null ? 0 : toScoreByHalfHour(Math.max(0, baseTimes.clockIn - clockInMinutes));
  const clockOutScore =
    !baseTimes || clockOutMinutes === null ? 0 : toScoreByHalfHour(Math.max(0, clockOutMinutes - baseTimes.clockOut));
  const totalScore = roundScore(clockInScore + clockOutScore + coverageScore);

  if (totalScore <= 0) return null;

  return {
    monthKey,
    dateKey,
    duty,
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    schedules: entry.schedules.map((item) => item.trim()).filter(Boolean),
    clockInScore: roundScore(clockInScore),
    clockOutScore: roundScore(clockOutScore),
    coverageScore,
    coverageNote: entry.coverageNote.trim(),
    totalScore,
  };
}

function getGeneratedHistorySchedules() {
  if (typeof window === "undefined") return [] as GeneratedSchedule[];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [] as GeneratedSchedule[];
  try {
    const parsed = sanitizeScheduleState(JSON.parse(raw) as Partial<ScheduleState>);
    return parsed.generatedHistory;
  } catch {
    return [] as GeneratedSchedule[];
  }
}

export function getTeamLeadSchedules() {
  const published = getPublishedSchedules().map((item) => item.schedule);
  const generated = getGeneratedHistorySchedules();
  const merged = new Map<string, GeneratedSchedule>();

  published.forEach((schedule) => {
    merged.set(schedule.monthKey, schedule);
  });
  generated.forEach((schedule) => {
    if (!merged.has(schedule.monthKey)) {
      merged.set(schedule.monthKey, schedule);
    }
  });

  return Array.from(merged.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

export function getScheduleAssignmentRows(
  day: DaySchedule,
  dayRows: ScheduleAssignmentDayRows = createDefaultScheduleAssignmentDayRows(),
) {
  const baseRows = Object.entries(day.assignments)
    .filter(([category, names]) => category !== "휴가" && names.length > 0)
    .flatMap(([category, names]) =>
      names.map((name, index) => {
        const key = createAssignmentRowKey(day.dateKey, category, index, name);
        const override = dayRows.rowOverrides[key];
        return {
          key,
          name: override?.name || name,
          duty: override?.duty || getScheduleCategoryLabel(category),
          isCustom: false,
        };
      }),
    )
    .filter((row) => !dayRows.deletedRowKeys.includes(row.key));

  const addedRows = dayRows.addedRows.map((row) => ({
    key: createCustomAssignmentRowKey(day.dateKey, row.id),
    name: row.name,
    duty: row.duty,
    isCustom: true,
  }));

  return [...baseRows, ...addedRows] satisfies ScheduleAssignmentRow[];
}

export function getTeamLeadTripCards(travelTypes: AssignmentTravelType[]) {
  const schedules = getTeamLeadSchedules();
  const store = getScheduleAssignmentStore();
  const personMap = new Map<string, TeamLeadTripItem[]>();

  schedules.forEach((monthSchedule) => {
    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(day, monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows());
        rows.forEach((row) => {
          const entry = monthEntries[row.key];
          if (!entry || !travelTypes.includes(entry.travelType)) return;

          const personName = row.name.trim();
          if (!personName) return;

          const tripItem: TeamLeadTripItem = {
            monthKey: monthSchedule.monthKey,
            dateKey: day.dateKey,
            duty: row.duty,
            travelType: entry.travelType,
            schedules: entry.schedules.map((item) => item.trim()).filter(Boolean),
          };

          const current = personMap.get(personName) ?? [];
          current.push(tripItem);
          personMap.set(personName, current);
        });
      });
  });

  return Array.from(personMap.entries())
    .map(([name, items]) => ({
      name,
      items: [...items].sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

export function getFinalCutCards(monthKey?: string) {
  const schedules = getTeamLeadSchedules().filter((schedule) => !monthKey || schedule.monthKey === monthKey);
  const store = getScheduleAssignmentStore();
  const finalCutStore = getFinalCutStore();
  const personMap = new Map<string, FinalCutScheduleItem[]>();

  schedules.forEach((monthSchedule) => {
    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(day, monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows());
        rows.forEach((row) => {
          const personName = row.name.trim();
          if (!personName) return;
          const entry = monthEntries[row.key];
          if (!entry) return;

          entry.schedules
            .map((schedule) => schedule.trim())
            .filter(Boolean)
            .forEach((schedule, index) => {
              const id = `${monthSchedule.monthKey}::${row.key}::${index}`;
              const item: FinalCutScheduleItem = {
                id,
                dateKey: day.dateKey,
                duty: row.duty,
                schedule,
                decision: finalCutStore[id] ?? "",
              };
              const current = personMap.get(personName) ?? [];
              current.push(item);
              personMap.set(personName, current);
            });
        });
      });
  });

  return Array.from(personMap.entries())
    .map(([name, items]) => ({
      name,
      items: [...items].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.schedule.localeCompare(right.schedule, "ko")),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

export function getContributionCards(baseDate = new Date()) {
  const period = getContributionPeriod(baseDate);
  const schedules = getTeamLeadSchedules().filter((schedule) => isMonthKeyInContributionPeriod(schedule.monthKey, period));
  const store = getScheduleAssignmentStore();
  const manualStore = getContributionManualStore();
  const hiddenNames = new Set(
    getUsers()
      .filter((user) => user.role === "team_lead" || user.role === "desk")
      .map((user) => user.username.trim())
      .filter(Boolean),
  );
  const personMap = new Map<string, ContributionScoreItem[]>();

  schedules.forEach((monthSchedule) => {
    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(day, monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows());
        rows.forEach((row) => {
          const personName = row.name.trim();
          if (!personName) return;
          if (hiddenNames.has(personName)) return;
          const entry = monthEntries[row.key];
          if (!entry) return;
          const item = buildContributionItem(monthSchedule.monthKey, day.dateKey, row.duty, entry, day);
          if (!item) return;
          const current = personMap.get(personName) ?? [];
          current.push(item);
          personMap.set(personName, current);
        });
      });
  });

  const allNames = new Set(
    [...personMap.keys(), ...Object.keys(manualStore).map((name) => name.trim()).filter(Boolean)].filter(
      (name) => !hiddenNames.has(name),
    ),
  );

  return Array.from(allNames)
    .map((name) => {
      const items = personMap.get(name) ?? [];
      const sortedItems = [...items].sort((left, right) =>
        left.dateKey.localeCompare(right.dateKey) || left.duty.localeCompare(right.duty, "ko"),
      );
      const manualItems = [...(manualStore[name] ?? [])];
      const clockInScore = roundScore(sortedItems.reduce((sum, item) => sum + item.clockInScore, 0));
      const clockOutScore = roundScore(sortedItems.reduce((sum, item) => sum + item.clockOutScore, 0));
      const coverageScore = roundScore(sortedItems.reduce((sum, item) => sum + item.coverageScore, 0));
      const autoScore = roundScore(sortedItems.reduce((sum, item) => sum + item.totalScore, 0));
      const manualScore = roundScore(manualItems.reduce((sum, item) => sum + item.score, 0));
      const totalScore = roundScore(autoScore + manualScore);
      return {
        name,
        totalScore,
        autoScore,
        manualScore,
        clockInScore,
        clockOutScore,
        coverageScore,
        itemCount: sortedItems.length,
        items: sortedItems,
        manualItems,
      } satisfies ContributionPersonCard;
    })
    .sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"));
}
