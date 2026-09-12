import type { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";

type DeskRecordEntryLike = {
  name?: unknown;
  date?: unknown;
  note?: unknown;
  dateKeys?: unknown;
};

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseYearToken(value: string | undefined, fallbackYear: number) {
  if (!value) return fallbackYear;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallbackYear;
  return value.length === 2 ? 2000 + numeric : numeric;
}

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function expandDateRange(startDateKey: string, endDateKey: string) {
  const start = new Date(`${startDateKey}T00:00:00`);
  const end = new Date(`${endDateKey}T00:00:00`);
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const dateKeys: string[] = [];
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    dateKeys.push(toDateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
  }
  return dateKeys;
}

export function parseDeskRecordDateKeysPure(value: string, fallbackYear = 2026) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return [];

  const rangeMatch = compact.match(
    /(?:(\d{2,4})[./-])?(\d{1,2})[./-](\d{1,2})[~\-](?:(\d{2,4})[./-])?(\d{1,2})(?:[./-](\d{1,2}))?/,
  );
  if (rangeMatch) {
    const startYear = parseYearToken(rangeMatch[1], fallbackYear);
    const startMonth = Number(rangeMatch[2]);
    const startDay = Number(rangeMatch[3]);
    const endYear = parseYearToken(rangeMatch[4], startYear);
    const endMonth = rangeMatch[6] ? Number(rangeMatch[5]) : startMonth;
    const endDay = rangeMatch[6] ? Number(rangeMatch[6]) : Number(rangeMatch[5]);

    if (isValidDateParts(startYear, startMonth, startDay) && isValidDateParts(endYear, endMonth, endDay)) {
      return expandDateRange(toDateKey(startYear, startMonth, startDay), toDateKey(endYear, endMonth, endDay));
    }
  }

  const singleMatch = compact.match(/(?:(\d{2,4})[./-])?(\d{1,2})[./-](\d{1,2})/);
  if (!singleMatch) return [];
  const year = parseYearToken(singleMatch[1], fallbackYear);
  const month = Number(singleMatch[2]);
  const day = Number(singleMatch[3]);
  return isValidDateParts(year, month, day) ? [toDateKey(year, month, day)] : [];
}

export function isDeskLeaveRecord(entry: DeskRecordEntryLike) {
  const date = typeof entry.date === "string" ? entry.date : "";
  const note = typeof entry.note === "string" ? entry.note : "";
  return /육아휴직|휴직/.test(`${date} ${note}`);
}

export function buildDeskLeaveNamesByDate(state: unknown, monthKey?: string) {
  if (!state || typeof state !== "object") return {} as Record<string, string[]>;
  const entries = (state as Record<string, unknown>)["long-service-leave"];
  if (!Array.isArray(entries)) return {} as Record<string, string[]>;

  const result: Record<string, string[]> = {};
  entries.forEach((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== "object") return;
    const entry = rawEntry as DeskRecordEntryLike;
    if (!isDeskLeaveRecord(entry)) return;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) return;
    const storedDateKeys = Array.isArray(entry.dateKeys)
      ? entry.dateKeys.filter((dateKey): dateKey is string => typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
      : [];
    const dateKeys = storedDateKeys.length > 0
      ? storedDateKeys
      : parseDeskRecordDateKeysPure(typeof entry.date === "string" ? entry.date : "");
    dateKeys.forEach((dateKey) => {
      if (monthKey && !dateKey.startsWith(`${monthKey}-`)) return;
      result[dateKey] = Array.from(new Set([...(result[dateKey] ?? []), name]));
    });
  });
  return result;
}

function getAssignmentPersonName(category: string, value: string) {
  const trimmed = value.trim();
  if (category !== "휴가") return trimmed;
  const separatorIndex = trimmed.indexOf(":");
  return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
}

export function filterDayForDeskLeave(day: DaySchedule, names: string[]) {
  const blockedNames = new Set(names.map((name) => name.trim()).filter(Boolean));
  if (blockedNames.size === 0) return day;

  const assignments = Object.fromEntries(
    Object.entries(day.assignments ?? {}).map(([category, values]) => [
      category,
      (values ?? []).filter((value) => !blockedNames.has(getAssignmentPersonName(category, value))),
    ]),
  ) as Record<string, string[]>;
  if ((assignments["휴가"] ?? []).length === 0) delete assignments["휴가"];

  const vacations = (day.vacations ?? []).filter((value) => !blockedNames.has(getAssignmentPersonName("휴가", value)));
  const nextDay = {
    ...day,
    headerName: blockedNames.has(day.headerName.trim()) ? "" : day.headerName,
    assignments,
    vacations,
    conflicts: (day.conflicts ?? []).filter((conflict) => !blockedNames.has(conflict.name.trim())),
  };
  nextDay.assignmentNameTags = Object.fromEntries(
    Object.entries(day.assignmentNameTags ?? {}).filter(([key]) => {
      const separatorIndex = key.indexOf("::");
      const category = separatorIndex >= 0 ? key.slice(0, separatorIndex) : "";
      const name = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : "";
      return Boolean(category && name && (assignments[category] ?? []).includes(name));
    }),
  );
  return nextDay;
}

export function filterScheduleForDeskLeave(schedule: GeneratedSchedule, namesByDate: Record<string, string[]>) {
  return {
    ...schedule,
    days: schedule.days.map((day) => filterDayForDeskLeave(day, namesByDate[day.dateKey] ?? [])),
  };
}
