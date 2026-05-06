import { parseVacationEntry } from "@/lib/schedule/engine";
import {
  getGeneralTeamOffPeopleForDate,
} from "@/lib/schedule/engine";
import { getPublishedSchedules, refreshPublishedSchedules } from "@/lib/schedule/published";
import { readStoredScheduleState, refreshScheduleState } from "@/lib/schedule/storage";
import type { DaySchedule } from "@/lib/schedule/types";

export type EngScheduleBadge = "휴가" | "제크" | "야퇴" | "기본오프";
export type EngScheduleHighlightMap = Map<string, EngScheduleBadge[]>;

function normalizePersonName(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function getPreviousDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
}

function findPublishedDay(dateKey: string): DaySchedule | null {
  for (const item of getPublishedSchedules()) {
    const day = item.schedule.days.find((candidate) => candidate.dateKey === dateKey);
    if (day) {
      return day;
    }
  }
  return null;
}

function pushBadge(map: EngScheduleHighlightMap, name: string, badge: EngScheduleBadge) {
  const key = normalizePersonName(name);
  if (!key) return;
  const existing = map.get(key) ?? [];
  if (!existing.includes(badge)) {
    map.set(key, [...existing, badge]);
  }
}

function addVacationBadges(map: EngScheduleHighlightMap, day: DaySchedule | null) {
  if (!day) return;
  const entries = [...(day.vacations ?? []), ...(day.assignments["휴가"] ?? [])];
  entries.forEach((entry) => {
    const parsed = parseVacationEntry(entry);
    pushBadge(map, parsed.name || entry, "휴가");
  });
}

export async function loadEngScheduleHighlights(dateKey: string) {
  const previousDateKey = getPreviousDateKey(dateKey);
  await Promise.all([
    refreshPublishedSchedules({ monthKeys: Array.from(new Set([toMonthKey(dateKey), toMonthKey(previousDateKey)])) }),
    refreshScheduleState(),
  ]);

  const today = findPublishedDay(dateKey);
  const previousDay = findPublishedDay(previousDateKey);
  const map: EngScheduleHighlightMap = new Map();

  addVacationBadges(map, today);
  (today?.assignments["제크"] ?? []).forEach((name) => pushBadge(map, name, "제크"));
  (previousDay?.assignments["야근"] ?? []).forEach((name) => pushBadge(map, name, "야퇴"));

  const state = readStoredScheduleState();
  getGeneralTeamOffPeopleForDate(state, dateKey).forEach((name) => pushBadge(map, name, "기본오프"));

  return map;
}

export function getEngScheduleBadges(highlights: EngScheduleHighlightMap, name: string) {
  return highlights.get(normalizePersonName(name)) ?? [];
}

