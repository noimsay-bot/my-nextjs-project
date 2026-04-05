import { getUsers } from "@/lib/auth/storage";
import {
  createDefaultScheduleAssignmentEntry,
  createDefaultScheduleAssignmentDayRows,
  getScheduleAssignmentRows,
  getScheduleAssignmentStore,
  getTeamLeadSchedules,
} from "@/lib/team-lead/storage";

export type PressSupportCategory = "assembly" | "prosecution";

export interface PressSupportRow {
  name: string;
  assembly: number;
  prosecution: number;
}

export interface PressSupportPeriod {
  year: number;
  startMonthKey: string;
  endMonthKey: string;
  label: string;
}

function normalizePressSupportRow(value: Partial<PressSupportRow> | null | undefined) {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!name) return null;

  return {
    name,
    assembly: Number.isFinite(Number(value?.assembly)) ? Number(value?.assembly) : 0,
    prosecution: Number.isFinite(Number(value?.prosecution)) ? Number(value?.prosecution) : 0,
  } satisfies PressSupportRow;
}

function getEligibleNames() {
  return Array.from(
    new Set(
      getUsers()
        .filter((user) => user.status === "ACTIVE")
        .filter((user) => user.role !== "team_lead" && user.role !== "desk")
        .map((user) => user.username.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, "ko"));
}

function countMatches(text: string, keyword: string) {
  const normalizedText = text.replace(/\s+/g, "").trim();
  if (!normalizedText) return 0;
  const normalizedKeyword = keyword.replace(/\s+/g, "").trim();
  return normalizedText.includes(normalizedKeyword) ? 1 : 0;
}

function getMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPeriodForYear(year: number): PressSupportPeriod {
  return {
    year,
    startMonthKey: getMonthKey(year - 1, 12),
    endMonthKey: getMonthKey(year, 11),
    label: `${year - 1}년 12월 ~ ${year}년 11월`,
  };
}

export function getPressSupportPeriods() {
  const schedules = getTeamLeadSchedules();
  const years = new Set<number>();

  schedules.forEach((schedule) => {
    const [yearText, monthText] = schedule.monthKey.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isInteger(year) || !Number.isInteger(month)) return;
    years.add(month === 12 ? year + 1 : year);
  });

  if (years.size === 0) {
    years.add(new Date().getFullYear());
  }

  return Array.from(years)
    .sort((left, right) => right - left)
    .map((year) => getPeriodForYear(year));
}

export function getPressSupportRows(periodYear?: number) {
  const totals = new Map<string, PressSupportRow>();
  const selectedPeriod = getPeriodForYear(periodYear ?? new Date().getFullYear());

  getEligibleNames().forEach((name) => {
    totals.set(name, {
      name,
      assembly: 0,
      prosecution: 0,
    });
  });

  const schedules = getTeamLeadSchedules();
  const store = getScheduleAssignmentStore();

  schedules.forEach((monthSchedule) => {
    if (
      monthSchedule.monthKey < selectedPeriod.startMonthKey ||
      monthSchedule.monthKey > selectedPeriod.endMonthKey
    ) {
      return;
    }

    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(
          day,
          monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows(),
        );

        rows.forEach((row) => {
          const name = row.name.trim();
          if (!name) return;

          const entry = monthEntries[row.key] ?? createDefaultScheduleAssignmentEntry();
          const current = totals.get(name) ?? { name, assembly: 0, prosecution: 0 };

          entry.schedules.forEach((schedule) => {
            current.assembly += countMatches(schedule, "국회 지원");
            current.prosecution += countMatches(schedule, "검찰 지원");
          });

          totals.set(name, current);
        });
      });
  });

  return Array.from(totals.values())
    .map((row) => normalizePressSupportRow(row))
    .filter((row): row is PressSupportRow => Boolean(row))
    .filter((row) => row.assembly > 0 || row.prosecution > 0)
    .sort((left, right) => {
      const totalCompare = right.assembly + right.prosecution - (left.assembly + left.prosecution);
      if (totalCompare !== 0) return totalCompare;
      return left.name.localeCompare(right.name, "ko");
    });
}
