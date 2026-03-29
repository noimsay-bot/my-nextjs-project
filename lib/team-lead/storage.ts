"use client";

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
  const source = published.length > 0 ? published : getGeneratedHistorySchedules();
  return [...source].sort((left, right) => left.monthKey.localeCompare(right.monthKey));
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
