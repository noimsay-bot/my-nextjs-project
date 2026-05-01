﻿﻿﻿"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FittedNameText } from "@/components/schedule/fitted-name-text";
import {
  getSession,
  subscribeToAuth,
} from "@/lib/auth/storage";
import { printHtmlDocument } from "@/lib/print";
import {
  buildScheduleAssignmentNameTagKey,
  getAssignmentDisplayRank,
  getDayCategoryDisplayLabel,
  getDayDuplicateNameSet,
  getScheduleCategoryLabel,
  getVisibleAssignmentDisplayRank,
  isGeneralAssignmentCategory,
  scheduleAssignmentNameTagColors,
  scheduleAssignmentNameTagLabels,
} from "@/lib/schedule/constants";
import { renderSchedulePrintHtml } from "@/lib/schedule/print-layout";
import {
  CHANGE_REQUESTS_EVENT,
  CHANGE_REQUESTS_STATUS_EVENT,
  createScheduleChangeRequest,
  deleteScheduleChangeRequest,
  getScheduleChangeRequests,
  getRequestRoute,
  isPendingRef,
  refreshScheduleChangeRequests,
} from "@/lib/schedule/change-requests";
import { parseVacationEntry } from "@/lib/schedule/engine";
import {
  getPublishedSchedules,
  PUBLISHED_SCHEDULES_EVENT,
  PUBLISHED_SCHEDULES_STATUS_EVENT,
  PublishedScheduleItem,
  refreshPublishedSchedules,
} from "@/lib/schedule/published";
import { readStoredScheduleState, refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import { vacationLegendOrder, vacationStyleTones, vacationTypeLabels } from "@/lib/schedule/vacation-styles";
import { DaySchedule, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef, VacationType } from "@/lib/schedule/types";
import {
  applyScheduleAssignmentNameTagsToSchedule,
  formatScheduleAssignmentDisplayName,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER,
  getScheduleAssignmentStore,
  getScheduleAssignmentVisibleTripTagMap,
  refreshTeamLeadAssignmentMonths,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
} from "@/lib/team-lead/storage";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const MAX_ROUTE_SIZE = 3;
const TOUCH_SCHEDULE_ZOOM_MIN = 1;
const TOUCH_SCHEDULE_ZOOM_MAX = 3;
const TOUCH_SCHEDULE_ZOOM_STEP = 0.25;
const FOCUS_REFRESH_THROTTLE_MS = 60_000;
const VISUAL_VIEWPORT_PINCH_ZOOM_EPSILON = 0.01;
type PublishedScheduleLayoutMode = "desktop" | "tablet" | "mobile";

function isVisualViewportPinchZoomActive() {
  if (typeof window === "undefined") return false;
  const scale = window.visualViewport?.scale ?? 1;
  return scale > 1 + VISUAL_VIEWPORT_PINCH_ZOOM_EPSILON;
}

function getWeekdayLabel(dow: number) {
  return weekdayLabels[(dow + 6) % 7] ?? "";
}

function getAssignmentChipTag(category: string, name: string, day: DaySchedule) {
  const key = buildScheduleAssignmentNameTagKey(category, name);
  return day.assignmentNameTags?.[key] ?? null;
}

function getAssignmentChipText(name: string, tag: "gov" | "law" | null) {
  return tag ? `${name}${scheduleAssignmentNameTagLabels[tag]}` : name;
}

function getPublishedScheduleLayoutMode(
  viewportWidth: number,
  viewportHeight: number,
  hasCoarsePointer: boolean,
): PublishedScheduleLayoutMode {
  const shortSide = Math.min(viewportWidth, viewportHeight);
  if (viewportWidth <= 820 || shortSide <= 420) return "mobile";
  if (viewportWidth <= 1180 || shortSide <= 900 || (hasCoarsePointer && viewportWidth <= 1400)) return "tablet";
  return "desktop";
}

const vacationLegendStyles = vacationStyleTones;

const displayVacationLabels = vacationTypeLabels;

const displayVacationOrder: VacationType[] = ["연차", "대휴", "기타"];

const dutyLegendStyles = {
  조근: {
    background: "rgba(250, 204, 21, 0.14)",
    border: "1px solid #eab308",
    color: "#ffffff",
  },
} as const;

function VacationLegendChips() {
  return (
    <>
      {displayVacationOrder.map((type) => (
        <span
          key={type}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "5px 12px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.2,
            ...vacationLegendStyles[type as keyof typeof vacationLegendStyles],
          }}
        >
          {displayVacationLabels[type as keyof typeof displayVacationLabels]}
        </span>
      ))}
    </>
  );
}

type DisplayDay = DaySchedule & {
  ownerMonthKey: string;
};

type ScheduleDisplaySource = {
  monthKey: string;
  schedule: {
    days: DaySchedule[];
  };
};

type PublishedSchedulesPanelMode = "home" | "page";
type MobileSchedulePageViewMode = "full" | "three-day";

type PublishedSchedulesPanelProps = {
  mode?: PublishedSchedulesPanelMode;
};

function getAssignmentDisplay(category: string, value: string) {
  if (category !== "휴가") {
    const label = getScheduleCategoryLabel(category);
    return {
      name: value,
      chipStyle: label === "조근" ? dutyLegendStyles.조근 : null,
      isVacation: false,
    };
  }
  const parsed = parseVacationEntry(value);
  // 호환성 로직: 기존 데이터(etc, 경조, 공가)를 "기타"로 매핑
  const type = (parsed.type as string) === "etc" || (parsed.type as string) === "경조" || (parsed.type as string) === "공가"
    ? "기타"
    : parsed.type;

  return {
    name: parsed.name,
    chipStyle: vacationLegendStyles[type as keyof typeof vacationLegendStyles],
    isVacation: true,
  };
}

function dayBadge(item: { isCustomHoliday: boolean; isWeekdayHoliday: boolean; isHoliday: boolean; isWeekend: boolean }) {
  if (item.isCustomHoliday || item.isWeekdayHoliday) return "평일 휴일";
  if (item.isHoliday) return "휴일";
  return "";
}

function getCenteredDayLabel(day: DaySchedule) {
  if (day.isWeekend) return "";
  return dayBadge(day);
}

function getCategoryDisplayLabel(day: DaySchedule, category: string) {
  const label = getDayCategoryDisplayLabel(day, category);
  return label === "뉴스대기" ? "뉴스\n대기" : label;
}

function getDayCardStyle(day: DaySchedule, sameSheet: boolean) {
  const useOverflowTone = day.isOverflowMonth && !sameSheet;
  const isRedDay = day.isWeekend || day.isWeekdayHoliday;
  if (isRedDay) {
    return {
      background: useOverflowTone ? "rgba(248,113,113,.24)" : "rgba(248,113,113,.4)",
      border: "1px solid rgba(252,165,165,.5)",
    };
  }
  return {
    background: useOverflowTone ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.22)",
    border: "1px solid rgba(255,255,255,.22)",
  };
}

function compactAssignments(item: PublishedScheduleItem, currentUser: string) {
  return item.schedule.days
    .filter((day) =>
      Object.entries(day.assignments).some(([category, names]) =>
        names.some((name) => isSameScheduleActorName(getComparableAssignmentName(category, name), currentUser)),
      ),
    )
    .map((day) => {
      const categories = Object.entries(day.assignments)
        .filter(([category, names]) =>
          names.some((name) => isSameScheduleActorName(getComparableAssignmentName(category, name), currentUser)),
        )
        .sort(([leftCategory], [rightCategory]) => getAssignmentDisplayRank(leftCategory) - getAssignmentDisplayRank(rightCategory))
        .map(([category]) => getScheduleCategoryLabel(category))
        .join(", ");
      return `${day.month}/${day.day} - ${categories}`;
    });
}

function normalizeScheduleActorName(value: string | null | undefined) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, "").trim();
}

function isSameScheduleActorName(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeScheduleActorName(left);
  const normalizedRight = normalizeScheduleActorName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

function dayContainsUser(day: DaySchedule, username: string) {
  if (!username) return false;
  if (isSameScheduleActorName(day.headerName, username)) return true;
  return Object.entries(day.assignments).some(([category, names]) =>
    names.some((name) => isSameScheduleActorName(getComparableAssignmentName(category, name), username)),
  );
}

function getCurrentMonthKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function getHiddenPublishedScheduleStorageKey(sessionId?: string | null, username?: string | null) {
  const actorKey = sessionId?.trim() || username?.trim() || "anonymous";
  return `j-special-force-hidden-published-schedules:${actorKey}`;
}

function readHiddenPublishedMonthKeys(sessionId?: string | null, username?: string | null) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getHiddenPublishedScheduleStorageKey(sessionId, username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => /^\d{4}-\d{2}$/.test(item)),
      ),
    ).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function writeHiddenPublishedMonthKeys(monthKeys: string[], sessionId?: string | null, username?: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getHiddenPublishedScheduleStorageKey(sessionId, username),
    JSON.stringify(
      Array.from(new Set(monthKeys.filter((item) => /^\d{4}-\d{2}$/.test(item)))).sort((left, right) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function getCoveredDateRange(
  item: PublishedScheduleItem,
  previousItem?: PublishedScheduleItem | null,
) {
  const startDateKey = previousItem?.schedule.nextStartDate ?? item.schedule.days[0]?.dateKey ?? item.schedule.nextStartDate;
  const endDateKey = getPreviousDateKey(item.schedule.nextStartDate);
  return { startDateKey, endDateKey };
}

function getPreferredPublishedMonthKey(
  items: PublishedScheduleItem[],
  todayDateKey = getTodayDateKey(),
  currentMonthKey = getCurrentMonthKey(),
) {
  if (items.length === 0) return null;
  const matchedTodayCoverage = items.find((item, index) => {
    const previousItem = index > 0 ? items[index - 1] ?? null : null;
    const { startDateKey, endDateKey } = getCoveredDateRange(item, previousItem);
    return todayDateKey >= startDateKey && todayDateKey <= endDateKey;
  });
  if (matchedTodayCoverage) return matchedTodayCoverage.monthKey;
  const matchedCurrentMonth = items.find((item) => item.monthKey === currentMonthKey);
  if (matchedCurrentMonth) return matchedCurrentMonth.monthKey;
  return items[items.length - 1]?.monthKey ?? null;
}

function formatPublishedAt(value: string) {
  if (!value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function buildDisplayDays(
  item: PublishedScheduleItem,
  previousItem?: ScheduleDisplaySource | null,
) {
  const days: DisplayDay[] = item.schedule.days.map((day) => ({
    ...day,
    ownerMonthKey: item.monthKey,
  }));
  if (days.length === 0) return days;

  const first = days[0];
  if (first.month !== item.schedule.month) return days;

  const firstDate = new Date(first.year, first.month - 1, first.day);
  const firstDow = firstDate.getDay();
  const mondayOffset = firstDow === 0 ? 6 : firstDow - 1;
  if (mondayOffset === 0) return days;

  const leading: DisplayDay[] = [];
  for (let offset = mondayOffset; offset >= 1; offset -= 1) {
    const date = new Date(firstDate);
    date.setDate(firstDate.getDate() - offset);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const matched = previousItem?.schedule.days.find((candidate) => candidate.dateKey === dateKey);
    if (matched) {
      const ownerMonthKey = previousItem?.monthKey ?? item.monthKey;
      leading.push({
        ...matched,
        isOverflowMonth: true,
        ownerMonthKey,
      });
      continue;
    }
    leading.push({
      dateKey,
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      dow: date.getDay(),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      isHoliday: false,
      isCustomHoliday: false,
      isWeekdayHoliday: false,
      isOverflowMonth: true,
      vacations: [],
      assignments: {},
      manualExtras: [],
      headerName: "",
      conflicts: [],
      ownerMonthKey: previousItem?.monthKey ?? item.monthKey,
    });
  }

  return [...leading, ...days];
}

function sameRef(left: SchedulePersonRef | null, right: SchedulePersonRef | null) {
  if (!left || !right) return false;
  return (
    left.monthKey === right.monthKey &&
    left.dateKey === right.dateKey &&
    left.category === right.category &&
    left.index === right.index &&
    left.name === right.name
  );
}

function getRefKey(ref: SchedulePersonRef) {
  return `${ref.monthKey}:${ref.dateKey}:${ref.category}:${ref.index}:${ref.name}`;
}

function isAutoManagedGeneralCategory(category: string) {
  return getScheduleCategoryLabel(category) === "일반";
}

function isGeneralAssistRoute(route: SchedulePersonRef[]) {
  if (route.length !== 2) return false;
  const generalCount = route.filter((ref) => isAutoManagedGeneralCategory(ref.category)).length;
  return generalCount === 1;
}

function getComparableAssignmentName(category: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return category === "휴가" ? parseVacationEntry(trimmed).name.trim() : trimmed;
}

function routeIncludes(route: SchedulePersonRef[], ref: SchedulePersonRef) {
  return route.some((candidate) => sameRef(candidate, ref));
}

function findOwnPendingRequestForRef(
  requests: ScheduleChangeRequest[],
  ref: SchedulePersonRef,
  requesterId: string | null | undefined,
) {
  if (!requesterId) return null;
  return (
    requests.find(
      (item) =>
        item.status === "pending" &&
        item.requesterId === requesterId &&
        getRequestRoute(item).some((candidate) => sameRef(candidate, ref)),
    ) ?? null
  );
}

function hasCompatibleVacationType(left: SchedulePersonRef, right: SchedulePersonRef) {
  if (left.category !== "휴가" || right.category !== "휴가") return true;
  return parseVacationEntry(left.name).type === parseVacationEntry(right.name).type;
}

function buildScheduleMap(items: PublishedScheduleItem[], monthKeys: Set<string>) {
  return new Map(
    items
      .filter((item) => monthKeys.has(item.monthKey))
      .map((item) => [item.monthKey, JSON.parse(JSON.stringify(item.schedule)) as PublishedScheduleItem["schedule"]]),
  );
}

function findRefSlot(
  scheduleMap: Map<string, PublishedScheduleItem["schedule"]>,
  ref: SchedulePersonRef,
) {
  const schedule = scheduleMap.get(ref.monthKey);
  const day = schedule?.days.find((item) => item.dateKey === ref.dateKey);
  if (!day) return null;
  const list = day.assignments[ref.category];
  if (!list) return null;
  const index = list[ref.index] === ref.name ? ref.index : list.findIndex((name) => name === ref.name);
  if (index < 0) return null;
  return { day, list, index };
}

function rotateRoutePreview(items: PublishedScheduleItem[], route: SchedulePersonRef[]) {
  const monthKeys = new Set(route.map((ref) => ref.monthKey));
  const scheduleMap = buildScheduleMap(items, monthKeys);
  if (applyGeneralAssistPreview(scheduleMap, route)) {
    return scheduleMap;
  }
  const slots = route.map((ref) => findRefSlot(scheduleMap, ref));
  if (slots.some((slot) => !slot)) return null;
  const resolvedSlots = slots as NonNullable<(typeof slots)[number]>[];
  const originalNames = resolvedSlots.map((slot) => slot.list[slot.index]);

  resolvedSlots.forEach((slot, index) => {
    slot.list[slot.index] = originalNames[(index + 1) % originalNames.length];
  });

  route.forEach((ref, index) => {
    if (ref.category !== "휴가") return;
    resolvedSlots[index].day.vacations = [...resolvedSlots[index].list];
  });

  return scheduleMap;
}

function applyGeneralAssistPreview(
  scheduleMap: Map<string, PublishedScheduleItem["schedule"]>,
  route: SchedulePersonRef[],
) {
  if (!isGeneralAssistRoute(route)) return false;

  const workRef = route.find((ref) => !isAutoManagedGeneralCategory(ref.category)) ?? null;
  const generalRef = route.find((ref) => isAutoManagedGeneralCategory(ref.category)) ?? null;
  if (!workRef || !generalRef) return false;
  if (workRef.category === "휴가" || generalRef.category === "휴가") return false;

  const workSlot = findRefSlot(scheduleMap, workRef);
  const generalSlot = findRefSlot(scheduleMap, generalRef);
  if (!workSlot || !generalSlot) return false;

  const promotedName = generalSlot.list[generalSlot.index]?.trim();
  if (!promotedName) return false;

  workSlot.list.splice(workSlot.index, 1);
  generalSlot.list.splice(generalSlot.index, 1);
  generalSlot.day.assignments[generalRef.category] = [...generalSlot.list];
  generalSlot.day.assignments[workRef.category] = [
    ...(generalSlot.day.assignments[workRef.category] ?? []),
    promotedName,
  ];

  return true;
}

function hasAssignmentElsewhereOnDay(day: DaySchedule | undefined, ref: SchedulePersonRef, name: string) {
  if (!day) return false;
  const comparableName = getComparableAssignmentName(ref.category, name);
  if (!comparableName) return false;
  return Object.entries(day.assignments).some(([category, names]) =>
    !isAutoManagedGeneralCategory(category) &&
    names.some((currentName, index) => {
      if (getComparableAssignmentName(category, currentName) !== comparableName) return false;
      return !(category === ref.category && index === ref.index);
    }),
  );
}

function routeWouldCreateConflict(items: PublishedScheduleItem[], route: SchedulePersonRef[]) {
  if (route.length < 2) return false;
  const previewMap = rotateRoutePreview(items, route);
  if (!previewMap) return true;
  const sourceDayIndex = buildDayIndex(items);

  if (isGeneralAssistRoute(route)) {
    const allDays = Array.from(previewMap.values())
      .flatMap((schedule) => schedule.days)
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey));

    if (allDays.some((day) => getDayDuplicateNameSet(day).size > 0)) {
      return true;
    }

    let previousNight =
      allDays.length > 0
        ? getPreviousNightNames(sourceDayIndex, allDays[0].dateKey)
        : [];
    for (const day of allDays) {
      const hasNightConflict = Object.entries(day.assignments).some(([category, names]) =>
        category !== "휴가" &&
        !isAutoManagedGeneralCategory(category) &&
        names.some((name) => previousNight.includes(name.trim())),
      );
      if (hasNightConflict) return true;
      previousNight = (day.assignments["야근"] ?? []).map((name) => name.trim()).filter(Boolean);
    }

    return false;
  }

  const dayIndex = new Map<string, DaySchedule>();
  previewMap.forEach((schedule) => {
    schedule.days.forEach((day) => {
      dayIndex.set(day.dateKey, day);
    });
  });

  return route.some((ref) => {
    const day = dayIndex.get(ref.dateKey);
    const schedule = previewMap.get(ref.monthKey);
    const previewDay = schedule?.days.find((item) => item.dateKey === ref.dateKey);
    const name = previewDay?.assignments[ref.category]?.[ref.index];
    if (!name) return true;
    if (hasAssignmentElsewhereOnDay(day, ref, name)) return true;
    if (hadNightShiftPreviousDay(dayIndex, name, ref.dateKey, sourceDayIndex)) return true;
    if (ref.category === "야근" && hasWorkAfterNightShift(dayIndex, name, ref.dateKey)) return true;
    return false;
  });
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDateKey() {
  return toDateKey(new Date());
}

function getWeekDateRange(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    startDateKey: toDateKey(monday),
    endDateKey: toDateKey(sunday),
  };
}

function getWeeklyPreviewDays(days: DisplayDay[], todayKey: string) {
  if (days.length === 0) return [];
  const anchorDay =
    days.find((day) => day.dateKey === todayKey && !day.isOverflowMonth) ??
    days.find((day) => day.dateKey === todayKey) ??
    days.find((day) => !day.isOverflowMonth) ??
    days[0];
  if (!anchorDay) return [];
  const { startDateKey, endDateKey } = getWeekDateRange(anchorDay.dateKey);
  const previewDays = days.filter((day) => day.dateKey >= startDateKey && day.dateKey <= endDateKey);
  return previewDays.length > 0 ? previewDays : days;
}

function getHomeMobilePreviewDays(days: DisplayDay[], todayKey: string) {
  if (days.length === 0) return [];

  const anchorIndex = days.findIndex(
    (day) => day.dateKey === todayKey && !day.isOverflowMonth,
  );
  const resolvedAnchorIndex =
    anchorIndex >= 0
      ? anchorIndex
      : days.findIndex((day) => day.dateKey === todayKey) >= 0
        ? days.findIndex((day) => day.dateKey === todayKey)
        : days.findIndex((day) => !day.isOverflowMonth) >= 0
          ? days.findIndex((day) => !day.isOverflowMonth)
          : 0;

  return days.slice(resolvedAnchorIndex, resolvedAnchorIndex + 6);
}

function getPreviousDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
}

function getNextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return toDateKey(date);
}

function buildDayIndex(items: PublishedScheduleItem[]) {
  const index = new Map<string, DaySchedule>();
  items.forEach((item) => {
    item.schedule.days.forEach((day) => {
      index.set(day.dateKey, day);
    });
  });
  return index;
}

function hasAssignmentOnDay(day: DaySchedule | undefined, name: string, category = "") {
  if (!day) return false;
  const comparableName = getComparableAssignmentName(category, name);
  if (!comparableName) return false;
  return Object.entries(day.assignments).some(([category, names]) =>
    !isAutoManagedGeneralCategory(category) &&
    names.some((currentName) => getComparableAssignmentName(category, currentName) === comparableName),
  );
}

function isHolidayLikeDay(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const day = dayIndex.get(dateKey);
  return Boolean(day && (day.isWeekend || day.isHoliday));
}

function isWeekdayHolidayDay(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const day = dayIndex.get(dateKey);
  return Boolean(day && !day.isWeekend && (day.isCustomHoliday || day.isWeekdayHoliday || day.isHoliday));
}

function usesWeekdayHolidayGrouping(category: string) {
  return !["휴가", "주말조근", "주말일반근무", "뉴스대기"].includes(category);
}

function getNightShiftGroup(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const day = dayIndex.get(dateKey);
  if (!day) return "";
  if (day.dow === 5) return "friday";
  if (day.dow === 6) return "saturday";
  if (day.dow === 0) return "sunday";
  return "weekday";
}

function hasWorkAfterNightShift(dayIndex: Map<string, DaySchedule>, name: string, dateKey: string) {
  const nextDay = dayIndex.get(getNextDateKey(dateKey));
  return hasAssignmentOnDay(nextDay, name);
}

function getPreviousNightNames(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const previousDay = dayIndex.get(getPreviousDateKey(dateKey));
  return (previousDay?.assignments["야근"] ?? []).map((item) => item.trim()).filter(Boolean);
}

function hadNightShiftPreviousDay(
  dayIndex: Map<string, DaySchedule>,
  name: string,
  dateKey: string,
  fallbackDayIndex?: Map<string, DaySchedule>,
) {
  const previousNightNames = getPreviousNightNames(dayIndex, dateKey);
  if (previousNightNames.includes(name)) return true;
  if (!fallbackDayIndex) return false;
  return getPreviousNightNames(fallbackDayIndex, dateKey).includes(name);
}

function isSwapCandidateValid(
  source: SchedulePersonRef,
  target: SchedulePersonRef,
  dayIndex: Map<string, DaySchedule>,
  todayKey: string,
) {
  const categoryLabel = getScheduleCategoryLabel(source.category);
  if (isAutoManagedGeneralCategory(source.category)) return false;
  if (isAutoManagedGeneralCategory(target.category)) return false;
  if (!hasCompatibleVacationType(source, target)) return false;
  if (source.name === target.name) return false;
  if (source.dateKey <= todayKey || target.dateKey <= todayKey) return false;
  if (source.dateKey === target.dateKey) return false;
  if (source.category !== target.category) return false;
  if (
    usesWeekdayHolidayGrouping(source.category) &&
    isWeekdayHolidayDay(dayIndex, source.dateKey) !== isWeekdayHolidayDay(dayIndex, target.dateKey)
  ) {
    return false;
  }
  if (categoryLabel === "조근" && isHolidayLikeDay(dayIndex, source.dateKey) !== isHolidayLikeDay(dayIndex, target.dateKey)) {
    return false;
  }
  if (categoryLabel === "야근" && getNightShiftGroup(dayIndex, source.dateKey) !== getNightShiftGroup(dayIndex, target.dateKey)) {
    return false;
  }
  if (hasAssignmentOnDay(dayIndex.get(source.dateKey), target.name, target.category)) return false;
  if (hasAssignmentOnDay(dayIndex.get(target.dateKey), source.name, source.category)) return false;
  if (hadNightShiftPreviousDay(dayIndex, target.name, source.dateKey)) return false;
  if (hadNightShiftPreviousDay(dayIndex, source.name, target.dateKey)) return false;
  if (categoryLabel === "야근") {
    if (hasWorkAfterNightShift(dayIndex, target.name, source.dateKey)) return false;
    if (hasWorkAfterNightShift(dayIndex, source.name, target.dateKey)) return false;
  }
  return true;
}

export function PublishedSchedulesPanel({ mode = "page" }: PublishedSchedulesPanelProps) {
  const isHomePreview = mode === "home";
  const [items, setItems] = useState<PublishedScheduleItem[]>(() =>
    getPublishedSchedules().map((item) => ({
      ...item,
      schedule: applyScheduleAssignmentNameTagsToSchedule(item.schedule),
    })),
  );
  const [itemsLoading, setItemsLoading] = useState(() => getPublishedSchedules().length === 0);
  const [scheduleHistory, setScheduleHistory] = useState<ScheduleDisplaySource[]>([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [hideMode, setHideMode] = useState(false);
  const [hiddenPublishedMonthKeys, setHiddenPublishedMonthKeys] = useState<string[]>([]);
  const [draftHiddenPublishedMonthKeys, setDraftHiddenPublishedMonthKeys] = useState<string[]>([]);
  const [scheduleLayoutMode, setScheduleLayoutMode] = useState<PublishedScheduleLayoutMode>("desktop");
  const [mobilePageViewMode, setMobilePageViewMode] = useState<MobileSchedulePageViewMode>("full");
  const [selectedRoute, setSelectedRoute] = useState<SchedulePersonRef[]>([]);
  const [isRecommendationPopoverOpen, setIsRecommendationPopoverOpen] = useState(false);
  const [inlineRecommendationConfirmRef, setInlineRecommendationConfirmRef] = useState<SchedulePersonRef | null>(null);
  const [confirmConflictRequest, setConfirmConflictRequest] = useState(false);
  const [requests, setRequests] = useState<ScheduleChangeRequest[]>([]);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestMessageTone, setRequestMessageTone] = useState<"ok" | "warn" | "note">("ok");
  const [compactMonthCardHeight, setCompactMonthCardHeight] = useState<number | null>(null);
  const [scheduleScale, setScheduleScale] = useState(1);
  const [scheduleZoomFactor, setScheduleZoomFactor] = useState(1);
  const [scheduleContentSize, setScheduleContentSize] = useState({ width: 0, height: 0 });
  const [session, setSession] = useState(() => getSession());
  const printableScheduleRef = useRef<HTMLDivElement | null>(null);
  const scheduleScrollRef = useRef<HTMLDivElement | null>(null);
  const scheduleZoomRef = useRef<HTMLDivElement | null>(null);
  const compactMonthCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastFocusRefreshAtRef = useRef(0);
  const isViewportPinchZoomActiveRef = useRef(false);
  const canHidePublishedSchedules = Boolean(session?.approved && session?.id);
  const username = session?.username ?? "";
  const scheduleAssignmentStore = useMemo(() => getScheduleAssignmentStore(), [items, scheduleHistory]);
  const visibleTripTagMap = useMemo(() => getScheduleAssignmentVisibleTripTagMap(), [items, scheduleHistory]);

  useEffect(() => {
    return subscribeToAuth((nextSession) => {
      setSession(nextSession);
    });
  }, []);

  useEffect(() => {
    const nextHidden = readHiddenPublishedMonthKeys(session?.id, session?.username);
    setHiddenPublishedMonthKeys(nextHidden);
    setDraftHiddenPublishedMonthKeys(nextHidden);
  }, [session?.id, session?.username]);

  const syncItemsFromCache = () => {
    setItems(
      getPublishedSchedules().map((item) => ({
        ...item,
        schedule: applyScheduleAssignmentNameTagsToSchedule(item.schedule),
      })),
    );
  };

  const syncRequestsFromCache = () => {
    setRequests(getScheduleChangeRequests());
  };

  const loadItems = async () => {
    setItemsLoading(true);
    try {
      const publishedItems = await refreshPublishedSchedules();
      await refreshTeamLeadAssignmentMonths(publishedItems.map((item) => item.monthKey));
      syncItemsFromCache();
    } finally {
      setItemsLoading(false);
    }
  };

  const loadRequests = async () => {
    await refreshScheduleChangeRequests({
      statuses: ["pending"],
    });
    syncRequestsFromCache();
  };

  const syncScheduleHistory = () => {
    const nextHistory = readStoredScheduleState().generatedHistory.map((schedule) => ({
      monthKey: schedule.monthKey,
      schedule: applyScheduleAssignmentNameTagsToSchedule(schedule),
    }));
    setScheduleHistory(nextHistory);
  };

  const loadScheduleHistory = async () => {
    const nextState = await refreshScheduleState();
    await refreshTeamLeadAssignmentMonths(nextState.generatedHistory.map((schedule) => schedule.monthKey));
    syncScheduleHistory();
  };

  useEffect(() => {
    let cancelled = false;
    let deferredHandle = 0;

    void loadItems().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
    });

    const runDeferredLoads = () => {
      if (cancelled) return;
      void loadScheduleHistory();
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      const idleHandle = window.requestIdleCallback(() => {
        runDeferredLoads();
      }, { timeout: 1200 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleHandle);
      };
    }

    deferredHandle = window.setTimeout(runDeferredLoads, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(deferredHandle);
    };
  }, []);

  useEffect(() => {
    if (!editMode) return;
    void loadRequests();
  }, [editMode]);

  useEffect(() => {
    const refreshVisibleData = () => {
      void loadItems();
      if (editMode) {
        void loadRequests();
      }
    };
    const onFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      refreshVisibleData();
    };
    const onScheduleStateRefresh = () => {
      syncItemsFromCache();
      syncScheduleHistory();
    };
    const onPublishedRefresh = () => {
      syncItemsFromCache();
    };
    const onRequestRefresh = () => {
      syncRequestsFromCache();
    };
    const onAssignmentRefresh = () => {
      syncItemsFromCache();
      syncScheduleHistory();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setRequestMessage(detail.message);
      setRequestMessageTone("warn");
    };
    window.addEventListener("storage", refreshVisibleData);
    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, onPublishedRefresh);
    window.addEventListener(CHANGE_REQUESTS_EVENT, onRequestRefresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, onAssignmentRefresh);
    window.addEventListener(SCHEDULE_STATE_EVENT, onScheduleStateRefresh);
    window.addEventListener(PUBLISHED_SCHEDULES_STATUS_EVENT, onStatus);
    window.addEventListener(CHANGE_REQUESTS_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener("storage", refreshVisibleData);
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, onPublishedRefresh);
      window.removeEventListener(CHANGE_REQUESTS_EVENT, onRequestRefresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, onAssignmentRefresh);
      window.removeEventListener(SCHEDULE_STATE_EVENT, onScheduleStateRefresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_STATUS_EVENT, onStatus);
      window.removeEventListener(CHANGE_REQUESTS_STATUS_EVENT, onStatus);
    };
  }, [editMode]);

  useEffect(() => {
    setSelectedRoute([]);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  }, [editMode]);

  useEffect(() => {
    if (!hideMode) return;
    setDraftHiddenPublishedMonthKeys(hiddenPublishedMonthKeys);
  }, [hiddenPublishedMonthKeys, hideMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarsePointerMediaQuery = window.matchMedia("(any-pointer: coarse)");
    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      isViewportPinchZoomActiveRef.current = isVisualViewportPinchZoomActive();
      if (isViewportPinchZoomActiveRef.current) return;
      const viewportWidth = Math.round(window.innerWidth);
      const viewportHeight = Math.round(window.innerHeight);
      setScheduleLayoutMode(
        getPublishedScheduleLayoutMode(viewportWidth, viewportHeight, coarsePointerMediaQuery.matches),
      );
    };
    const syncViewportByOrientation = () => {
      syncViewport();
    };
    const handleVisualViewportChange = () => {
      const wasPinching = isViewportPinchZoomActiveRef.current;
      const isPinching = isVisualViewportPinchZoomActive();
      isViewportPinchZoomActiveRef.current = isPinching;
      if (wasPinching && !isPinching) {
        syncViewport();
      }
    };
    syncViewport();
    coarsePointerMediaQuery.addEventListener?.("change", syncViewport);
    coarsePointerMediaQuery.addListener?.(syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewportByOrientation);
    visualViewport?.addEventListener("resize", handleVisualViewportChange);
    visualViewport?.addEventListener("scroll", handleVisualViewportChange);
    return () => {
      coarsePointerMediaQuery.removeEventListener?.("change", syncViewport);
      coarsePointerMediaQuery.removeListener?.(syncViewport);
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewportByOrientation);
      visualViewport?.removeEventListener("resize", handleVisualViewportChange);
      visualViewport?.removeEventListener("scroll", handleVisualViewportChange);
    };
  }, []);

  useEffect(() => {
    const shouldAutoFitSchedule = scheduleLayoutMode !== "desktop";
    if (!shouldAutoFitSchedule) {
      setScheduleZoomFactor(1);
    }
  }, [scheduleLayoutMode]);

  const activeHiddenMonthKeys = hideMode ? draftHiddenPublishedMonthKeys : hiddenPublishedMonthKeys;
  const activeItems = useMemo(() => {
    if (isHomePreview) return items;
    if (hideMode) return items;
    const hiddenMonthKeySet = new Set(hiddenPublishedMonthKeys);
    return items.filter((item) => !hiddenMonthKeySet.has(item.monthKey));
  }, [hiddenPublishedMonthKeys, hideMode, isHomePreview, items]);

  useEffect(() => {
    setSelectedMonthKey((current) => {
      if (current && activeItems.some((item) => item.monthKey === current)) return current;
      return getPreferredPublishedMonthKey(activeItems);
    });
  }, [activeItems]);

  const selectedItem = useMemo(() => {
    if (activeItems.length === 0) return null;
    return activeItems.find((item) => item.monthKey === selectedMonthKey) ?? activeItems[activeItems.length - 1];
  }, [activeItems, selectedMonthKey]);

  const previousSelectedItem = useMemo(() => {
    if (!selectedItem) return null;
    const index = activeItems.findIndex((item) => item.monthKey === selectedItem.monthKey);
    if (index <= 0) return null;
    return activeItems[index - 1] ?? null;
  }, [activeItems, selectedItem]);

  const previousDisplaySource = useMemo(() => {
    if (!selectedItem) return null;
    if (previousSelectedItem) return previousSelectedItem;
    const selectedHistoryIndex = scheduleHistory.findIndex((item) => item.monthKey === selectedItem.monthKey);
    if (selectedHistoryIndex <= 0) return null;
    return scheduleHistory[selectedHistoryIndex - 1] ?? null;
  }, [previousSelectedItem, scheduleHistory, selectedItem]);

  const nextSelectedItem = useMemo(() => {
    if (!selectedItem) return null;
    const index = activeItems.findIndex((item) => item.monthKey === selectedItem.monthKey);
    if (index < 0) return null;
    return activeItems[index + 1] ?? null;
  }, [activeItems, selectedItem]);

  const selectedIndex = selectedItem ? activeItems.findIndex((item) => item.monthKey === selectedItem.monthKey) : -1;
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const isHomeMobileThreeDayView = isHomePreview && scheduleLayoutMode === "mobile";
  const isPageMobileThreeDayView = !isHomePreview && scheduleLayoutMode === "mobile" && mobilePageViewMode === "three-day";
  const isMobileThreeDayView = isHomeMobileThreeDayView || isPageMobileThreeDayView;
  const allPendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);
  const publishedDayIndex = useMemo(() => buildDayIndex(activeItems), [activeItems]);
  const displayDays = useMemo(
    () => (selectedItem ? buildDisplayDays(selectedItem, previousDisplaySource) : []),
    [previousDisplaySource, selectedItem],
  );
  const homeMobileDisplayDays = useMemo(() => {
    if (!isHomePreview || !selectedItem) return displayDays;
    if (!nextSelectedItem) return displayDays;

    const merged = new Map<string, DisplayDay>();
    [...displayDays, ...buildDisplayDays(nextSelectedItem, selectedItem)].forEach((day) => {
      if (!merged.has(day.dateKey)) {
        merged.set(day.dateKey, day);
      }
    });

    return Array.from(merged.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  }, [displayDays, isHomePreview, nextSelectedItem, selectedItem]);
  const visibleDisplayDays = useMemo(
    () =>
      isHomePreview
        ? isHomeMobileThreeDayView
          ? getHomeMobilePreviewDays(homeMobileDisplayDays, todayKey)
          : getWeeklyPreviewDays(displayDays, todayKey)
        : displayDays,
    [displayDays, homeMobileDisplayDays, isHomeMobileThreeDayView, isHomePreview, todayKey],
  );
  const mobileThreeDayDisplayDays = useMemo(() => {
    if (!isMobileThreeDayView) return [] as DisplayDay[];
    if (isHomeMobileThreeDayView) return getHomeMobilePreviewDays(homeMobileDisplayDays, todayKey);
    return visibleDisplayDays;
  }, [homeMobileDisplayDays, isHomeMobileThreeDayView, isMobileThreeDayView, todayKey, visibleDisplayDays]);
  const mobileThreeDayRows = useMemo(() => {
    if (!isMobileThreeDayView) return [];

    const rows: DisplayDay[][] = [];
    for (let index = 0; index < mobileThreeDayDisplayDays.length; index += 3) {
      rows.push(mobileThreeDayDisplayDays.slice(index, index + 3));
    }
    return rows;
  }, [isMobileThreeDayView, mobileThreeDayDisplayDays]);
  const homePreviewTitle = selectedItem
    ? `${String(selectedItem.schedule.year).slice(-2)}년 ${selectedItem.schedule.month}월 이번주 근무표`
    : "이번주 근무표";
  const homePreviewRangeLabel =
    visibleDisplayDays.length > 0
      ? isHomeMobileThreeDayView
        ? `오늘 기준 ${visibleDisplayDays.length}일`
        : `${visibleDisplayDays[0]?.month}/${visibleDisplayDays[0]?.day} - ${visibleDisplayDays[visibleDisplayDays.length - 1]?.month}/${visibleDisplayDays[visibleDisplayDays.length - 1]?.day}`
      : null;
  const firstSelectedRef = selectedRoute[0] ?? null;
  const hasConflictWarning = useMemo(
    () => routeWouldCreateConflict(activeItems, selectedRoute),
    [activeItems, selectedRoute],
  );

  const recommendedCandidates = useMemo(() => {
    if (!editMode || !firstSelectedRef) return [];
    return activeItems
      .flatMap((day) =>
        day.schedule.days.flatMap((scheduleDay) =>
          Object.entries(scheduleDay.assignments).flatMap(([category, names]) =>
            names.map((name, index) => ({
              monthKey: day.monthKey,
              dateKey: scheduleDay.dateKey,
              category,
              index,
              name,
            })),
          ),
        ),
      )
      .filter((ref) => ref.dateKey > todayKey)
      .filter((ref) =>
        activeItems.some((item) => item.monthKey === ref.monthKey && item.schedule.days.some((day) => day.dateKey === ref.dateKey)),
      )
      .filter((ref) => !sameRef(firstSelectedRef, ref))
      .filter((ref) => !isPendingRef(allPendingRequests, ref))
      .filter((ref) => isSwapCandidateValid(firstSelectedRef, ref, publishedDayIndex, todayKey))
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.name.localeCompare(right.name));
  }, [activeItems, allPendingRequests, editMode, firstSelectedRef, publishedDayIndex, todayKey]);
  const recommendedCandidateKeys = useMemo(
    () => new Set(recommendedCandidates.map((candidate) => getRefKey(candidate))),
    [recommendedCandidates],
  );
  const routeScopeLabel = useMemo(() => {
    if (activeItems.length === 0) return "게시된 근무표";
    const first = activeItems[0];
    const last = activeItems[activeItems.length - 1];
    if (first.monthKey === last.monthKey) {
      return `${first.schedule.year}년 ${first.schedule.month}월 게시 근무표`;
    }
    return `${first.schedule.year}년 ${first.schedule.month}월 ~ ${last.schedule.year}년 ${last.schedule.month}월 게시 근무표`;
  }, [activeItems]);

  const toggleEditMode = () => {
    setEditMode((current) => !current);
    setHideMode(false);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const toggleHideTarget = (monthKey: string) => {
    setDraftHiddenPublishedMonthKeys((current) =>
      current.includes(monthKey)
        ? current.filter((item) => item !== monthKey)
        : [...current, monthKey].sort((left, right) => left.localeCompare(right)),
    );
    setSelectedMonthKey(monthKey);
  };

  const toggleHideMode = async () => {
    if (!canHidePublishedSchedules) return;

    if (!hideMode) {
      setEditMode(false);
      setHideMode(true);
      setDraftHiddenPublishedMonthKeys(hiddenPublishedMonthKeys);
      setRequestMessage("숨길 근무표 월 버튼을 선택한 뒤 숨김 완료를 누르세요.");
      setRequestMessageTone("note");
      return;
    }

    writeHiddenPublishedMonthKeys(draftHiddenPublishedMonthKeys, session?.id, session?.username);
    setHiddenPublishedMonthKeys(draftHiddenPublishedMonthKeys);
    setHideMode(false);
    setRequestMessage("내 홈 근무표 숨김 상태를 저장했습니다.");
    setRequestMessageTone("ok");
  };

  const isCompactMonthlyView = false;
  const isCompactDailyView = false;
  const isCompactDailyLandscapeView = false;
  const shouldAutoFitSchedule = scheduleLayoutMode !== "desktop";
  const schedulePanelLayoutClassName =
    scheduleLayoutMode === "mobile"
      ? "schedule-published-panel--fit schedule-published-panel--mobile-layout"
      : scheduleLayoutMode === "tablet"
        ? "schedule-published-panel--fit schedule-published-panel--mobile-layout"
        : "schedule-published-panel--desktop schedule-published-panel--desktop-layout";
  const appliedScheduleScale = shouldAutoFitSchedule ? scheduleScale * scheduleZoomFactor : 1;
  const scaledScheduleWidth = scheduleContentSize.width > 0 ? scheduleContentSize.width * appliedScheduleScale : 0;
  const scaledScheduleHeight = scheduleContentSize.height > 0 ? scheduleContentSize.height * appliedScheduleScale : 0;
  const canControlScheduleZoom = false;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedItem) return;

    let frameId = 0;
    const visualViewport = window.visualViewport;
    const measureSchedule = () => {
      if (isViewportPinchZoomActiveRef.current) return;
      const scrollNode = scheduleScrollRef.current;
      const zoomNode = scheduleZoomRef.current;
      if (!scrollNode || !zoomNode) return;
      const nextWidth = Math.ceil(zoomNode.offsetWidth);
      const nextHeight = Math.ceil(zoomNode.offsetHeight);
      if (nextWidth <= 0 || nextHeight <= 0) return;
      setScheduleContentSize((current) =>
        current.width === nextWidth && current.height === nextHeight ? current : { width: nextWidth, height: nextHeight },
      );

      const containerWidth = scrollNode.clientWidth;
      const widthFitScale = containerWidth > 0 ? containerWidth / nextWidth : 1;
      const nextFitScale = shouldAutoFitSchedule ? Math.min(1, Math.max(0.15, widthFitScale)) : 1;
      setScheduleScale((current) => (Math.abs(current - nextFitScale) < 0.01 ? current : nextFitScale));
    };

    const queueMeasure = () => {
      cancelAnimationFrame(frameId);
      if (isViewportPinchZoomActiveRef.current) return;
      frameId = window.requestAnimationFrame(measureSchedule);
    };

    const handleVisualViewportChange = () => {
      const wasPinching = isViewportPinchZoomActiveRef.current;
      const isPinching = isVisualViewportPinchZoomActive();
      isViewportPinchZoomActiveRef.current = isPinching;
      if (wasPinching && !isPinching) {
        queueMeasure();
      }
    };

    queueMeasure();
    window.addEventListener("resize", queueMeasure);
    window.addEventListener("orientationchange", queueMeasure);
    visualViewport?.addEventListener("resize", handleVisualViewportChange);
    visualViewport?.addEventListener("scroll", handleVisualViewportChange);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", queueMeasure);
      window.removeEventListener("orientationchange", queueMeasure);
      visualViewport?.removeEventListener("resize", handleVisualViewportChange);
      visualViewport?.removeEventListener("scroll", handleVisualViewportChange);
    };
  }, [
    compactMonthCardHeight,
    visibleDisplayDays,
    editMode,
    requests,
    selectedItem,
    selectedRoute,
    shouldAutoFitSchedule,
    showMine,
    username,
    isCompactMonthlyView,
    isHomePreview,
    isMobileThreeDayView,
    mobileThreeDayRows.length,
  ]);

  useEffect(() => {
    if (!isCompactMonthlyView) {
      setCompactMonthCardHeight(null);
      compactMonthCardRefs.current = {};
      return;
    }

    let frameId = 0;
    const measureCardHeight = () => {
      const cards = Object.values(compactMonthCardRefs.current).filter((node): node is HTMLElement => Boolean(node));
      if (cards.length === 0) return;
      cards.forEach((card) => {
        card.style.height = "auto";
      });
      const nextHeight = Math.ceil(
        cards.reduce((maxHeight, card) => Math.max(maxHeight, card.getBoundingClientRect().height), 0),
      );
      setCompactMonthCardHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureCardHeight);
    };

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("orientationchange", scheduleMeasure);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("orientationchange", scheduleMeasure);
    };
  }, [editMode, isCompactMonthlyView, requests, selectedRoute, showMine, visibleDisplayDays]);

  const printSelectedSchedule = () => {
    if (!selectedItem) return;
    const printTitle = `${selectedItem.schedule.month}월 근무표`;
    printHtmlDocument({
      title: printTitle,
      bodyHtml: renderSchedulePrintHtml({
        title: printTitle,
        days: visibleDisplayDays,
        highlightedName: showMine ? username : null,
      }),
    });
  };

  const zoomOutSchedule = () => {
    setScheduleZoomFactor((current) =>
      Math.max(TOUCH_SCHEDULE_ZOOM_MIN, Number((current - TOUCH_SCHEDULE_ZOOM_STEP).toFixed(2))),
    );
  };

  const zoomInSchedule = () => {
    setScheduleZoomFactor((current) =>
      Math.min(TOUCH_SCHEDULE_ZOOM_MAX, Number((current + TOUCH_SCHEDULE_ZOOM_STEP).toFixed(2))),
    );
  };

  const removeRouteEntry = (index: number) => {
    setSelectedRoute((current) => {
      if (index < 0 || index >= current.length) return current;
      if (index === 0) return [];
      return current.filter((_, entryIndex) => entryIndex !== index);
    });
    setInlineRecommendationConfirmRef(null);
    if (index === 0) {
      setIsRecommendationPopoverOpen(false);
    }
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const appendRouteCandidate = (candidate: SchedulePersonRef) => {
    setSelectedRoute((current) => {
      if (routeIncludes(current, candidate) || current.length >= MAX_ROUTE_SIZE) return current;
      const lastSelectedRef = current[current.length - 1];
      if (lastSelectedRef && !hasCompatibleVacationType(lastSelectedRef, candidate)) return current;
      return [...current, candidate];
    });
    setIsRecommendationPopoverOpen(false);
    setInlineRecommendationConfirmRef(candidate);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const handleNameClick = async (person: ScheduleNameObject) => {
    if (!editMode || !username) return;

    if (isAutoManagedGeneralCategory(person.ref.category)) {
      setRequestMessage("일반 근무는 교환 후보가 아닙니다. 실제 근무가 변경되면 일반 근무는 그 날짜 기준으로 자동 다시 계산됩니다.");
      setRequestMessageTone("warn");
      return;
    }

    if (person.pending) {
      const ownPendingRequest = findOwnPendingRequestForRef(allPendingRequests, person.ref, session?.id);
      if (!ownPendingRequest) return;

      const confirmed = window.confirm("변경요청을 취소하시겠습니까?");
      if (!confirmed) return;

      const result = await deleteScheduleChangeRequest(ownPendingRequest.id);
      if (!result.ok) {
        setRequestMessage("근무 변경 요청을 취소하지 못했습니다.");
        setRequestMessageTone("warn");
        return;
      }

      clearRoute();
      await loadRequests();
      setRequestMessage("근무 변경 요청을 취소했습니다.");
      setRequestMessageTone("ok");
      return;
    }

    const existingIndex = selectedRoute.findIndex((ref) => sameRef(ref, person.ref));
    if (existingIndex >= 0) {
      if (existingIndex === 0 && selectedRoute.length === 1 && !isRecommendationPopoverOpen) {
        setIsRecommendationPopoverOpen(true);
        setConfirmConflictRequest(false);
        setRequestMessage("");
        setRequestMessageTone("ok");
        return;
      }
      removeRouteEntry(existingIndex);
      return;
    }

    if (person.ref.dateKey <= todayKey) {
      setRequestMessage("오늘 이후 근무만 변경 요청할 수 있습니다.");
      setRequestMessageTone("warn");
      return;
    }

    if (selectedRoute.length === 0) {
      if (!isSameScheduleActorName(person.name, username)) {
        setRequestMessage("먼저 내 근무를 선택해 주세요. 계정 이름과 근무표 이름이 다르면 교환 요청을 시작할 수 없습니다.");
        setRequestMessageTone("warn");
        return;
      }
      setSelectedRoute([person.ref]);
      setIsRecommendationPopoverOpen(true);
      setInlineRecommendationConfirmRef(null);
      setConfirmConflictRequest(false);
      setRequestMessage("");
      setRequestMessageTone("ok");
      return;
    }

    if (isSameScheduleActorName(person.name, username)) {
      setSelectedRoute([person.ref]);
      setIsRecommendationPopoverOpen(true);
      setInlineRecommendationConfirmRef(null);
      setConfirmConflictRequest(false);
      setRequestMessage("");
      setRequestMessageTone("ok");
      return;
    }

    if (selectedRoute.length >= MAX_ROUTE_SIZE) {
      setRequestMessage("게시 근무표 요청은 최대 3명 경로까지 등록할 수 있습니다.");
      setRequestMessageTone("warn");
      return;
    }

    const lastSelectedRef = selectedRoute[selectedRoute.length - 1];
    if (lastSelectedRef && !hasCompatibleVacationType(lastSelectedRef, person.ref)) {
      setRequestMessage("휴가 교환은 같은 유형끼리만 가능합니다. 연차, 대휴, 기타는 서로 다른 유형끼리 바꿀 수 없습니다.");
      setRequestMessageTone("warn");
      return;
    }

    setSelectedRoute([...selectedRoute, person.ref]);
    setIsRecommendationPopoverOpen(false);
    setInlineRecommendationConfirmRef(null);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const renderInlineRecommendedCandidates = (anchorRef: SchedulePersonRef) => {
    if (!sameRef(firstSelectedRef, anchorRef)) return null;

    const openToRight = scheduleLayoutMode !== "mobile";
    const inlineConfirmVisible =
      Boolean(inlineRecommendationConfirmRef) &&
      selectedRoute.length === 2 &&
      sameRef(selectedRoute[selectedRoute.length - 1] ?? null, inlineRecommendationConfirmRef);

    if (!isRecommendationPopoverOpen && !inlineConfirmVisible) return null;

    return (
      <div
        style={{
          position: "absolute",
          top: openToRight ? "50%" : "calc(100% + 8px)",
          left: openToRight ? "calc(100% + 8px)" : 0,
          transform: openToRight ? "translateY(-50%)" : undefined,
          zIndex: 60,
          minWidth: openToRight ? 220 : 180,
          maxWidth: openToRight ? 280 : "min(280px, calc(100vw - 48px))",
          maxHeight: 240,
          overflowY: "auto",
          padding: 10,
          borderRadius: 14,
          border: "1px solid rgba(147,197,253,.82)",
          background: "rgba(219,234,254,.96)",
          boxShadow: "0 16px 38px rgba(59,130,246,.18)",
          display: "grid",
          gap: 8,
        }}
      >
        {inlineConfirmVisible ? (
          <>
            <span className="muted" style={{ fontSize: 12, color: "#1d4ed8" }}>
              근무 변경을 요청하시겠습니까?
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" onClick={onConfirmRequest}>
                확인
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setSelectedRoute((current) => current.slice(0, 1));
                  setInlineRecommendationConfirmRef(null);
                  setIsRecommendationPopoverOpen(true);
                  setConfirmConflictRequest(false);
                  setRequestMessage("");
                  setRequestMessageTone("ok");
                }}
              >
                취소
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="muted" style={{ fontSize: 12, color: "#1d4ed8" }}>
              추천 직접 교환 후보
            </span>
            {recommendedCandidates.length > 0 ? (
              recommendedCandidates.map((candidate) => (
                <button
                  key={`${candidate.monthKey}-${candidate.dateKey}-${candidate.category}-${candidate.index}-${candidate.name}`}
                  type="button"
                  className="btn"
                  style={{ justifyContent: "flex-start", textAlign: "left" }}
                  onClick={() => appendRouteCandidate(candidate)}
                >
                  {candidate.dateKey} {getScheduleCategoryLabel(candidate.category)} {candidate.name}
                </button>
              ))
            ) : (
              <span style={{ fontSize: 12, lineHeight: 1.5, color: "#1e3a8a" }}>
                추천 후보가 없습니다.
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  const handleSchedulePanelClickCapture = (event: React.MouseEvent<HTMLElement>) => {
    if (!firstSelectedRef || selectedRoute.length !== 1 || !isRecommendationPopoverOpen) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('[data-swap-recommendation-root="true"]')) return;
    setIsRecommendationPopoverOpen(false);
    event.preventDefault();
    event.stopPropagation();
  };

  const clearRoute = () => {
    setSelectedRoute([]);
    setIsRecommendationPopoverOpen(false);
    setInlineRecommendationConfirmRef(null);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const submitRequest = async () => {
    if (!session || !selectedItem || selectedRoute.length < 2) return;
    try {
      await createScheduleChangeRequest({
        monthKey: selectedItem.monthKey,
        requesterId: session.id,
        requesterName: session.username,
        source: selectedRoute[0],
        target: selectedRoute[selectedRoute.length - 1],
        route: selectedRoute,
        hasConflictWarning,
      });
      await loadRequests();
      setRequestMessage(
        selectedRoute.length === 2
          ? "근무 변경 요청을 등록했습니다."
          : "삼각 트레이드 요청을 등록했습니다.",
      );
      setRequestMessageTone("ok");
      setConfirmConflictRequest(false);
      setSelectedRoute([]);
      setInlineRecommendationConfirmRef(null);
    } catch (error) {
      setRequestMessage(error instanceof Error ? error.message : "근무 변경 요청을 저장하지 못했습니다.");
      setRequestMessageTone("warn");
    }
  };

  const onConfirmRequest = () => {
    if (hasConflictWarning) {
      setConfirmConflictRequest(true);
      return;
    }
    void submitRequest();
  };

  const hasInlineRecommendationConfirm =
    Boolean(inlineRecommendationConfirmRef) &&
    selectedRoute.length === 2 &&
    sameRef(selectedRoute[selectedRoute.length - 1] ?? null, inlineRecommendationConfirmRef);

  if (itemsLoading && items.length === 0) {
    return (
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="status note">게시 근무표를 불러오는 중입니다.</div>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="status note">게시된 근무표가 없습니다.</div>
        </div>
      </section>
    );
  }

  if (activeItems.length === 0 && !hideMode) {
    return (
      <section className={`panel schedule-published-panel ${schedulePanelLayoutClassName}`}>
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          {!isHomePreview ? (
            <div className="schedule-published-hero">
              <div className="schedule-published-hero__left">
                <div className="muted schedule-published-hero__published">숨김 처리된 게시 근무표만 있습니다.</div>
              </div>
              <div className="schedule-published-hero__right">
                <div className="schedule-toolbar-actions schedule-published-hero__user">
                  {canHidePublishedSchedules ? (
                    <button className={`btn ${hideMode ? "white" : ""}`} onClick={() => void toggleHideMode()}>
                      {hideMode ? "숨김 완료" : "근무표 숨김"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {!isHomePreview && requestMessage ? <div className={`status ${requestMessageTone}`}>{requestMessage}</div> : null}
          {isHomePreview ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div className="status note" style={{ margin: 0, flex: "1 1 280px" }}>
                현재 홈에 표시할 주간 근무표가 없습니다.
              </div>
              <Link href="/work-schedule" className="btn primary">
                근무표 전체 보기
              </Link>
            </div>
          ) : (
            <div className="status note">현재 홈에 보이는 게시 근무표가 없습니다.</div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`panel schedule-published-panel ${schedulePanelLayoutClassName}`}
      onClickCapture={handleSchedulePanelClickCapture}
    >
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        {!isHomePreview && editMode && username ? (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 18,
              padding: 14,
              background: "rgba(255,255,255,.04)",
              display: "grid",
              gap: 10,
            }}
          >
            {selectedRoute.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span className="muted">선택된 인원 {selectedRoute.length}명</span>
                <button type="button" className="btn" onClick={clearRoute}>
                  선택 초기화
                </button>
              </div>
            ) : (
              <div className="muted">먼저 내 이름을 누른 뒤, {routeScopeLabel} 전체에서 미래 날짜의 교환 또는 삼각 트레이드 상대를 선택하세요. 달을 바꿔도 선택 경로는 유지됩니다.</div>
            )}

            {selectedRoute.length >= 2 && !hasInlineRecommendationConfirm ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" onClick={onConfirmRequest}>
                  {selectedRoute.length === 2 ? "교환 요청" : "삼각 트레이드 요청"}
                </button>
                <button className="btn" onClick={clearRoute}>선택 초기화</button>
              </div>
            ) : null}

            {confirmConflictRequest ? (
              <div className="status warn" style={{ display: "grid", gap: 10 }}>
                <span>변경시 충돌이 발생합니다. 그래도 변경하시겠습니까?</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn primary" onClick={() => void submitRequest()}>확인</button>
                  <button className="btn" onClick={() => setConfirmConflictRequest(false)}>취소</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isHomePreview && editMode && username ? (
          <div className="status note">처음 시작은 로그인한 본인 이름으로만 가능합니다. 이후에는 {routeScopeLabel} 전체에서 미래 날짜 근무를 요청 경로에 넣을 수 있습니다.</div>
        ) : null}
        {!isHomePreview && requestMessage ? <div className={`status ${requestMessageTone}`}>{requestMessage}</div> : null}

        {selectedItem ? (
          <>
            <div ref={printableScheduleRef} data-print-frame="true" style={{ display: "grid", gap: 12 }}>
              <div data-print-only="true" style={{ display: "none" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <strong style={{ fontSize: 22 }}>{selectedItem.title}</strong>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <VacationLegendChips />
                  </div>
                  <div className="muted">게시 {formatPublishedAt(selectedItem.publishedAt)}</div>
                </div>
              </div>
              {isHomePreview ? (
                <div
                  style={{
                    display: "grid",
                    gap: 4,
                    borderRadius: 20,
                    border: "1px solid rgba(255,255,255,.08)",
                    background: "rgba(255,255,255,.03)",
                    padding: "14px 18px 10px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <strong style={{ fontSize: 20, lineHeight: 1.25 }}>{homePreviewTitle}</strong>
                      <span className="muted">게시 {formatPublishedAt(selectedItem.publishedAt)}</span>
                    </div>
                    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                      {homePreviewRangeLabel ? <span className="chip">{homePreviewRangeLabel}</span> : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <VacationLegendChips />
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginLeft: "auto" }}>
                      <button className={`btn ${showMine ? "white" : ""}`} disabled={!username} onClick={() => setShowMine((current) => !current)}>
                        {showMine ? "전체 보기" : "내 근무 보기"}
                      </button>
                      <Link href="/work-schedule" className="btn primary">
                        근무표 전체 보기
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="schedule-published-hero">
                  <div className="schedule-published-hero__left">
                    <div className="muted schedule-published-hero__published">게시 {formatPublishedAt(selectedItem.publishedAt)}</div>
                    <div className="schedule-toolbar-actions schedule-published-hero__months">
                      {activeItems.map((item) => {
                        const isHiddenTarget = activeHiddenMonthKeys.includes(item.monthKey);
                        const isSelected = selectedItem?.monthKey === item.monthKey;
                        return (
                          <button
                            key={item.monthKey}
                            className={`btn ${isSelected ? "white" : ""}`}
                            onClick={() => {
                              if (hideMode) {
                                toggleHideTarget(item.monthKey);
                                return;
                              }
                              setSelectedMonthKey(item.monthKey);
                            }}
                            style={
                              hideMode && isHiddenTarget
                                ? {
                                    borderColor: "rgba(248, 113, 113, 0.8)",
                                    background: isSelected ? "#fff" : "rgba(248, 113, 113, 0.18)",
                                  }
                                : undefined
                            }
                          >
                            {item.schedule.year}년 {item.schedule.month}월
                            {hideMode && isHiddenTarget ? " 숨김" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="schedule-published-hero__center">
                    <strong className="schedule-current-title schedule-published-hero__title">{selectedItem.title}</strong>
                  </div>
                  <div className="schedule-published-hero__right">
                    <div className="schedule-toolbar-actions schedule-published-hero__user">
                      <div className="schedule-published-hero__user-actions">
                        <button className={`btn ${showMine ? "white" : ""}`} disabled={!username} onClick={() => setShowMine((current) => !current)}>
                          {showMine ? "전체 보기" : "내 근무 보기"}
                        </button>
                        {scheduleLayoutMode === "mobile" && !isHomePreview ? (
                          <button
                            className={`btn ${isPageMobileThreeDayView ? "white" : ""}`}
                            onClick={() =>
                              setMobilePageViewMode((current) => (current === "full" ? "three-day" : "full"))
                            }
                          >
                            보기 변경
                          </button>
                        ) : null}
                        <button className={`btn ${editMode ? "white" : ""}`} disabled={!username} onClick={toggleEditMode}>
                          {editMode ? "근무 수정 완료" : "근무 수정"}
                        </button>
                        {scheduleLayoutMode !== "mobile" ? (
                          <button className="btn" onClick={printSelectedSchedule}>
                            출력
                          </button>
                        ) : null}
                        {canHidePublishedSchedules ? (
                          <button className={`btn ${hideMode ? "white" : ""}`} onClick={() => void toggleHideMode()}>
                            {hideMode ? "숨김 완료" : "근무표 숨김"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {hideMode ? (
                      <div className="status note">숨길 월을 선택한 뒤 `숨김 완료`를 누르세요. 숨김 모드에서는 게시된 모든 근무표가 보입니다.</div>
                    ) : null}
                    <div className="schedule-published-hero__footer">
                      <div className="schedule-calendar-top-legend">
                        <VacationLegendChips />
                      </div>
                      <div className="schedule-calendar-top-actions" />
                    </div>
                  </div>
                </div>
              )}

              {canControlScheduleZoom ? (
                <div className="schedule-published-zoom-controls">
                  <button className="btn" disabled={scheduleZoomFactor <= TOUCH_SCHEDULE_ZOOM_MIN} onClick={zoomOutSchedule}>
                    축소
                  </button>
                  <button className="btn" disabled={scheduleZoomFactor >= TOUCH_SCHEDULE_ZOOM_MAX} onClick={zoomInSchedule}>
                    확대
                  </button>
                </div>
              ) : null}
              <div
                ref={scheduleScrollRef}
                className={`schedule-calendar-scroll ${isCompactMonthlyView ? "schedule-calendar-scroll--monthly" : "schedule-calendar-scroll--daily"}`}
                style={{
                  overflowX: shouldAutoFitSchedule ? "auto" : undefined,
                  overflowY: shouldAutoFitSchedule ? "visible" : undefined,
                  WebkitOverflowScrolling: shouldAutoFitSchedule ? "touch" : undefined,
                }}
              >
              <div
                style={{
                  minWidth: shouldAutoFitSchedule ? "100%" : undefined,
                  width: shouldAutoFitSchedule && scaledScheduleWidth > 0 ? scaledScheduleWidth : undefined,
                  height: shouldAutoFitSchedule && scaledScheduleHeight > 0 ? scaledScheduleHeight : undefined,
                  margin: shouldAutoFitSchedule && scaledScheduleWidth > 0 ? "0 auto" : undefined,
                  position: shouldAutoFitSchedule ? "relative" : undefined,
                }}
              >
              <div
                ref={scheduleZoomRef}
                className={`schedule-calendar-zoom ${isCompactMonthlyView ? "schedule-calendar-zoom--monthly" : "schedule-calendar-zoom--daily"}`}
                style={{
                  transform: shouldAutoFitSchedule ? `scale(${appliedScheduleScale})` : undefined,
                  transformOrigin: shouldAutoFitSchedule ? "top left" : undefined,
                  position: shouldAutoFitSchedule ? "absolute" : undefined,
                  top: shouldAutoFitSchedule ? 0 : undefined,
                  left: shouldAutoFitSchedule ? 0 : undefined,
                  willChange: shouldAutoFitSchedule ? "transform" : undefined,
                  backfaceVisibility: shouldAutoFitSchedule ? "hidden" : undefined,
                }}
              >
              <div
                className={`schedule-calendar-grid ${isCompactMonthlyView ? "schedule-calendar-grid--monthly" : "schedule-calendar-grid--daily"} ${isMobileThreeDayView ? "schedule-calendar-grid--home-mobile-three-day" : ""}`}
              >
                {isMobileThreeDayView ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      width: "100%",
                    }}
                  >
                    {mobileThreeDayRows.map((row, rowIndex) => (
                      <div
                        key={`home-mobile-row-${rowIndex}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                          gap: 6,
                          alignItems: "start",
                        }}
                      >
                        {row.map((day) => {
                          const isCurrentSheetDay = day.ownerMonthKey === selectedItem.monthKey;
                          const dayCardStyle = getDayCardStyle(day, isCurrentSheetDay);
                          const isTodayInHomePreview = isHomePreview && day.dateKey === todayKey;
                          const centeredDayLabel = getCenteredDayLabel(day);
                          const isWeekendLike = day.isWeekend || day.isHoliday;
                          const dayHasInlineRecommendations =
                            isRecommendationPopoverOpen &&
                            Boolean(firstSelectedRef) &&
                            selectedRoute.length === 1 &&
                            firstSelectedRef.monthKey === day.ownerMonthKey &&
                            firstSelectedRef.dateKey === day.dateKey;
                          const dayHasRouteSelection = selectedRoute.some(
                            (ref) => ref.monthKey === day.ownerMonthKey && ref.dateKey === day.dateKey,
                          );
                          const highlightDayHead = showMine && dayContainsUser(day, username);
                          const highlightHeaderName = showMine && Boolean(username) && day.headerName?.trim() === username;
                          const duplicateNameSet = getDayDuplicateNameSet(day);
                          const headerNameDuplicated = Boolean(day.headerName?.trim()) && duplicateNameSet.has(day.headerName.trim());
                          const visibleAssignments = Object.entries(day.assignments)
                            .filter(([category, names]) => {
                              if (!Array.isArray(names) || names.length === 0) return false;
                              if (isWeekendLike) return category !== "휴가" && category !== "제크" && category !== "청사";
                              return !["국회", "청사", "청와대"].includes(category);
                            })
                            .sort(
                              ([leftCategory], [rightCategory]) =>
                                getVisibleAssignmentDisplayRank(leftCategory, isWeekendLike) -
                                getVisibleAssignmentDisplayRank(rightCategory, isWeekendLike),
                            );
                          return (
                            <article
                              key={`${day.ownerMonthKey}-${day.dateKey}`}
                              ref={(node) => {
                                compactMonthCardRefs.current[`${day.ownerMonthKey}-${day.dateKey}`] = node;
                              }}
                              className={`panel schedule-day-card ${isCompactMonthlyView ? "schedule-day-card--monthly" : ""}`}
                              style={{
                                position: "relative",
                                padding: 6,
                                minHeight: 0,
                                opacity: day.isOverflowMonth && !isCurrentSheetDay ? 0.55 : 1,
                                background: dayCardStyle.background,
                                border: isTodayInHomePreview ? "2px solid rgba(56,189,248,.92)" : dayCardStyle.border,
                                overflow: "visible",
                                zIndex: dayHasInlineRecommendations ? 80 : dayHasRouteSelection ? 12 : 1,
                                boxShadow: isTodayInHomePreview ? "0 0 0 2px rgba(125,211,252,.18), 0 12px 28px rgba(14,165,233,.16)" : undefined,
                              }}
                            >
                              <div
                                className={`schedule-day-head ${isCompactMonthlyView ? "schedule-day-head--monthly" : ""}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "auto minmax(0, 1fr)",
                                  alignItems: "center",
                                  gap: 6,
                                  marginBottom: 6,
                                  padding: highlightDayHead ? (isCompactMonthlyView ? "4px 6px" : "6px 8px") : 0,
                                  borderRadius: 16,
                                  background: highlightDayHead ? "rgba(125,211,252,.14)" : "transparent",
                                  boxShadow: highlightDayHead ? "0 0 0 1px rgba(125,211,252,.18) inset" : undefined,
                                }}
                              >
                                <div className="schedule-day-date" style={{ fontSize: 19, fontWeight: 900 }}>
                                  <span>{day.month}/{day.day}</span>
                                </div>
                                <div
                                  style={{
                                    display: "grid",
                                    gap: centeredDayLabel ? 4 : 0,
                                    justifyItems: "center",
                                    alignContent: "center",
                                    alignSelf: "stretch",
                                    minHeight: 42,
                                    textAlign: "center",
                                  }}
                                >
                                  {centeredDayLabel ? (
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        alignItems: "center",
                                        minHeight: 24,
                                        textAlign: "center",
                                        color: "#ffd7d7",
                                        fontWeight: 900,
                                        fontSize: 13,
                                      }}
                                    >
                                      {centeredDayLabel}
                                    </div>
                                  ) : null}
                                  <div
                                    style={{
                                      minHeight: 24,
                                      textAlign: "center",
                                      color: headerNameDuplicated ? "#ffe4e6" : "#f8fbff",
                                      fontSize: 18,
                                      fontWeight: 900,
                                      lineHeight: 1.1,
                                      whiteSpace: "normal",
                                      overflow: "visible",
                                      textOverflow: "clip",
                                      wordBreak: "keep-all",
                                      justifySelf: "center",
                                      padding: headerNameDuplicated
                                        ? (isCompactMonthlyView ? "4px 10px" : "5px 12px")
                                        : highlightHeaderName
                                          ? (isCompactMonthlyView ? "4px 10px" : "5px 12px")
                                          : 0,
                                      borderRadius: headerNameDuplicated || highlightHeaderName ? 999 : 0,
                                      background: headerNameDuplicated
                                        ? "rgba(239,68,68,.22)"
                                        : highlightHeaderName
                                          ? "rgba(125,211,252,.2)"
                                          : "transparent",
                                      border: headerNameDuplicated
                                        ? "1px solid rgba(248,113,113,.55)"
                                        : highlightHeaderName
                                          ? "6px solid rgba(255,255,255,.95)"
                                          : undefined,
                                    }}
                                  >
                                    {day.headerName ?? ""}
                                  </div>
                                </div>
                              </div>
                              <div className="schedule-day-body" style={{ display: "grid", gap: 1 }}>
                                {visibleAssignments.map(([category, names]) => (
                                  <div key={`${day.dateKey}-${category}`} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: 6, background: "rgba(9,17,30,.34)" }}>
                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "44px minmax(0, 1fr)",
                                        columnGap: 8,
                                        alignItems: "stretch",
                                      }}
                                    >
                                      <strong
                                        className="schedule-assignment-label"
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          alignSelf: "stretch",
                                          marginBottom: 0,
                                          fontSize: 14,
                                          lineHeight: 1.1,
                                          minHeight: 38,
                                          textAlign: "center",
                                          whiteSpace: "pre-line",
                                        }}
                                      >
                                          {getCategoryDisplayLabel(day, category)}
                                      </strong>
                                      <div
                                        className={`schedule-name-grid ${isCompactMonthlyView ? "schedule-name-grid--monthly" : ""}`}
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                          justifyContent: "stretch",
                                          justifyItems: "stretch",
                                          alignItems: "center",
                                          gap: 0,
                                          minHeight: 38,
                                          width: "100%",
                                        }}
                                      >
                                      {names.length > 0 ? (
                                        names.map((name, index) => {
                                          const assignmentDisplay = getAssignmentDisplay(category, name);
                                          const ref: SchedulePersonRef = {
                                            monthKey: day.ownerMonthKey,
                                            dateKey: day.dateKey,
                                            category,
                                            index,
                                            name,
                                          };
                                          const personObject: ScheduleNameObject = {
                                            key: `${day.ownerMonthKey}-${category}-${name}-${index}`,
                                            name: assignmentDisplay.name,
                                            ref,
                                            pending: isPendingRef(allPendingRequests, ref),
                                          };
                                          const ownPendingRequest = findOwnPendingRequestForRef(allPendingRequests, ref, session?.id);
                                          const isMine = isSameScheduleActorName(username, assignmentDisplay.name);
                                          const mineHighlighted =
                                            isMine && (showMine || (editMode && !isAutoManagedGeneralCategory(category)));
                                          const editModeMineHighlighted =
                                            isMine && editMode && !isAutoManagedGeneralCategory(category);
                                          const routeSelected = routeIncludes(selectedRoute, ref);
                                          const firstSelected = sameRef(firstSelectedRef, ref);
                                          const recommendedHighlighted =
                                            Boolean(firstSelectedRef) &&
                                            !routeSelected &&
                                            !personObject.pending &&
                                            recommendedCandidateKeys.has(getRefKey(ref));
                                          const nameTag = getAssignmentChipTag(category, assignmentDisplay.name, day);
                                          const assignmentDisplayText = formatScheduleAssignmentDisplayName(
                                            {
                                              monthKey: day.ownerMonthKey,
                                              dateKey: day.dateKey,
                                              category,
                                              index,
                                              name: assignmentDisplay.name,
                                            },
                                            scheduleAssignmentStore,
                                            visibleTripTagMap,
                                          );
                                          const hasTaggedDisplayName = Boolean(nameTag || assignmentDisplayText !== assignmentDisplay.name);
                                          const nameTagColors = nameTag ? scheduleAssignmentNameTagColors[nameTag] : null;
                                          const duplicated = duplicateNameSet.has(assignmentDisplay.name.trim());
                                          const dimOtherNames = Boolean(username) && showMine && !isMine && !personObject.pending && !routeSelected;
                                          const isInteractiveChip =
                                            !isHomePreview && editMode && (!personObject.pending || Boolean(ownPendingRequest));
                                          return (
                                            <div
                                              key={personObject.key}
                                              data-swap-recommendation-root={firstSelected ? "true" : undefined}
                                              style={{
                                                position: "relative",
                                                width: "100%",
                                                overflow: "visible",
                                                zIndex: firstSelected ? 40 : routeSelected ? 10 : editModeMineHighlighted ? 8 : 1,
                                              }}
                                            >
                                              <button
                                                type="button"
                                                className={`schedule-name-chip ${mineHighlighted ? "schedule-name-chip--featured" : ""} ${isCompactMonthlyView ? "schedule-name-chip--compact" : ""}`}
                                                disabled={!isInteractiveChip}
                                                onClick={() => void handleNameClick(personObject)}
                                                style={{
                                                  display: "flex",
                                                  flexDirection: "column",
                                                  gridColumn: "auto",
                                                  justifySelf: "stretch",
                                                  alignItems: "center",
                                                  justifyContent: "center",
                                                  width: "100%",
                                                  maxWidth: "100%",
                                                  gap: personObject.pending ? 0 : 5,
                                                  minHeight: 28,
                                                  padding: "3px 4px",
                                                  borderRadius: 0,
                                                  background: personObject.pending
                                                    ? "rgba(245,158,11,.18)"
                                                    : routeSelected
                                                      ? firstSelected
                                                        ? "rgba(168,85,247,.28)"
                                                        : "rgba(56,189,248,.22)"
                                                      : duplicated
                                                        ? "rgba(239,68,68,.22)"
                                                        : recommendedHighlighted
                                                          ? "rgba(124,58,237,.32)"
                                                          : mineHighlighted
                                                            ? "rgba(148,163,184,.38)"
                                                            : dimOtherNames
                                                              ? "rgba(255,255,255,.06)"
                                                              : hasTaggedDisplayName
                                                                ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND
                                                                : nameTagColors
                                                                  ? nameTagColors.background
                                                                  : assignmentDisplay.chipStyle?.background
                                                                    ? assignmentDisplay.chipStyle.background
                                                                    : "rgba(255,255,255,.16)",
                                                  border: personObject.pending
                                                    ? "1px solid rgba(245,158,11,.35)"
                                                    : routeSelected
                                                      ? firstSelected
                                                        ? "1px solid rgba(192,132,252,.78)"
                                                        : "1px solid rgba(56,189,248,.75)"
                                                      : duplicated
                                                        ? "1px solid rgba(239,68,68,.28)"
                                                  : recommendedHighlighted
                                                    ? "3px solid rgba(255,255,255,.95)"
                                                  : mineHighlighted
                                                    ? "4px solid rgba(226,232,240,.82)"
                                                    : dimOtherNames
                                                      ? "1px solid rgba(255,255,255,.08)"
                                                              : hasTaggedDisplayName
                                                                ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER
                                                                : nameTagColors
                                                                  ? nameTagColors.border
                                                                  : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                                  color: routeSelected && firstSelected
                                                    ? "#f5eaff"
                                                    : routeSelected || recommendedHighlighted || mineHighlighted
                                                      ? "#ffffff"
                                                      : duplicated
                                                        ? "#ffe4e6"
                                                        : dimOtherNames
                                                          ? "rgba(248,251,255,.48)"
                                                          : hasTaggedDisplayName
                                                            ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR
                                                            : nameTagColors
                                                              ? nameTagColors.color
                                                              : assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                                  fontWeight: mineHighlighted ? 800 : 700,
                                                  lineHeight: 1.3,
                                                  boxShadow: mineHighlighted
                                                    ? editModeMineHighlighted
                                                      ? "0 14px 28px rgba(15,23,42,.48), 0 0 18px rgba(125,211,252,.36), 0 0 0 1px rgba(255,255,255,.2)"
                                                      : "0 6px 14px rgba(15,23,42,.34), 0 0 0 1px rgba(255,255,255,.18)"
                                                    : "none",
                                                  textShadow: undefined,
                                                  opacity: dimOtherNames ? 0.42 : 1,
                                                  transform: editModeMineHighlighted
                                                    ? "translateY(-2px) scale(1.5)"
                                                    : mineHighlighted
                                                      ? "translateY(-1px)"
                                                      : undefined,
                                                  transformOrigin: "center",
                                                  cursor: isInteractiveChip ? "pointer" : "default",
                                                }}
                                              >
                                                <FittedNameText
                                                  text={getAssignmentChipText(assignmentDisplayText, nameTag)}
                                                  className="schedule-name-chip__text"
                                                  minFontSize={shouldAutoFitSchedule ? 5 : 9}
                                                  maxFontSize={isCompactMonthlyView ? 16 : isCompactDailyView ? 16 : 18}
                                                  style={{
                                                    display: "inline-block",
                                                    flex: "0 1 auto",
                                                    width: "100%",
                                                    margin: "0 auto",
                                                    overflow: "visible",
                                                    textOverflow: "clip",
                                                  }}
                                                />
                                                {personObject.pending ? <span style={{ fontSize: isCompactMonthlyView ? 8 : 9, marginTop: -2, lineHeight: 1 }}>요청중</span> : null}
                                              </button>
                                              {renderInlineRecommendedCandidates(ref)}
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <span style={{ display: "inline-block", minHeight: 22 }} />
                                      )}
                                      {names.length > 0 && names.length % 2 === 1 ? (
                                        <span
                                          aria-hidden="true"
                                          style={{
                                            display: "block",
                                            minHeight: 28,
                                            border: "1px solid rgba(255,255,255,.08)",
                                            background: "rgba(255,255,255,.03)",
                                          }}
                                        />
                                      ) : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </article>
                          );
                        })}
                        {row.length < 3 ? Array.from({ length: 3 - row.length }).map((_, fillerIndex) => (
                          <div
                            key={`home-mobile-row-${rowIndex}-filler-${fillerIndex}`}
                            aria-hidden="true"
                            style={{ minHeight: 0 }}
                          />
                        )) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {weekdayLabels.map((label) => {
                      const isWeekendLabel = label === "토" || label === "일";
                      return (
                      <div key={label} className={`schedule-weekday ${isCompactMonthlyView ? "schedule-weekday--monthly" : ""}`} style={{ textAlign: "center", padding: "6px 4px", borderRadius: 12, border: isWeekendLabel ? "1px solid rgba(239,68,68,.4)" : "1px solid var(--line)", background: isWeekendLabel ? "rgba(239,68,68,.16)" : "rgba(255,255,255,.03)", color: isWeekendLabel ? "#ffffff" : undefined, fontWeight: 900, fontSize: 14 }}>
                        {label}
                      </div>
                    )})}
                    {visibleDisplayDays.map((day) => {
                  const isCurrentSheetDay = day.ownerMonthKey === selectedItem.monthKey;
                  const dayCardStyle = getDayCardStyle(day, isCurrentSheetDay);
                  const isTodayInHomePreview = isHomePreview && day.dateKey === todayKey;
                  const centeredDayLabel = getCenteredDayLabel(day);
                  const isWeekendLike = day.isWeekend || day.isHoliday;
                  const dayHasInlineRecommendations =
                    isRecommendationPopoverOpen &&
                    Boolean(firstSelectedRef) &&
                    selectedRoute.length === 1 &&
                    firstSelectedRef.monthKey === day.ownerMonthKey &&
                    firstSelectedRef.dateKey === day.dateKey;
                  const dayHasRouteSelection = selectedRoute.some(
                    (ref) => ref.monthKey === day.ownerMonthKey && ref.dateKey === day.dateKey,
                  );
                  const highlightDayHead = showMine && dayContainsUser(day, username);
                  const highlightHeaderName = showMine && Boolean(username) && day.headerName?.trim() === username;
                  const duplicateNameSet = getDayDuplicateNameSet(day);
                  const headerNameDuplicated = Boolean(day.headerName?.trim()) && duplicateNameSet.has(day.headerName.trim());
                  const visibleAssignments = Object.entries(day.assignments)
                    .filter(([category, names]) => {
                      if (!Array.isArray(names) || names.length === 0) return false;
                      if (isWeekendLike) return category !== "휴가" && category !== "제크" && category !== "청사";
                      return !["국회", "청사", "청와대"].includes(category);
                    })
                    .sort(
                      ([leftCategory], [rightCategory]) =>
                        getVisibleAssignmentDisplayRank(leftCategory, isWeekendLike) -
                        getVisibleAssignmentDisplayRank(rightCategory, isWeekendLike),
                    );
                  return (
                    <article
                      key={`${day.ownerMonthKey}-${day.dateKey}`}
                      ref={(node) => {
                        compactMonthCardRefs.current[`${day.ownerMonthKey}-${day.dateKey}`] = node;
                      }}
                      className={`panel schedule-day-card ${isCompactMonthlyView ? "schedule-day-card--monthly" : ""}`}
                      style={{
                        position: "relative",
                        padding: 6,
                        minHeight: isMobileThreeDayView ? 160 : isCompactMonthlyView ? 148 : 216,
                        height: isCompactMonthlyView && compactMonthCardHeight ? compactMonthCardHeight : undefined,
                        opacity: day.isOverflowMonth && !isCurrentSheetDay ? 0.55 : 1,
                        background: dayCardStyle.background,
                        border: isTodayInHomePreview ? "2px solid rgba(56,189,248,.92)" : dayCardStyle.border,
                        overflow: "visible",
                        zIndex: dayHasInlineRecommendations ? 80 : dayHasRouteSelection ? 12 : 1,
                        boxShadow: isTodayInHomePreview ? "0 0 0 2px rgba(125,211,252,.18), 0 12px 28px rgba(14,165,233,.16)" : undefined,
                      }}
                    >
                        <div
                          className={`schedule-day-head ${isCompactMonthlyView ? "schedule-day-head--monthly" : ""}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto minmax(0, 1fr)",
                            alignItems: "center",
                            gap: 6,
                            marginBottom: 6,
                            padding: highlightDayHead ? (isCompactMonthlyView ? "4px 6px" : "6px 8px") : 0,
                            borderRadius: 16,
                            background: highlightDayHead ? "rgba(125,211,252,.14)" : "transparent",
                            boxShadow: highlightDayHead ? "0 0 0 1px rgba(125,211,252,.18) inset" : undefined,
                          }}
                      >
                        <div className="schedule-day-date" style={{ fontSize: 21, fontWeight: 900 }}>
                          <span>{day.month}/{day.day}</span>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gap: centeredDayLabel ? 4 : 0,
                            justifyItems: "center",
                            alignContent: "center",
                            alignSelf: "stretch",
                            minHeight: 42,
                            textAlign: "center",
                          }}
                        >
                          {centeredDayLabel ? (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                minHeight: 24,
                                textAlign: "center",
                                color: "#ffd7d7",
                                fontWeight: 900,
                                fontSize: 14,
                              }}
                            >
                              {centeredDayLabel}
                            </div>
                          ) : null}
                          <div
                            style={{
                              minHeight: 24,
                              textAlign: "center",
                              color: headerNameDuplicated ? "#ffe4e6" : "#f8fbff",
                              fontSize: 21,
                              fontWeight: 900,
                              lineHeight: 1.1,
                              whiteSpace: "normal",
                              overflow: "visible",
                              textOverflow: "clip",
                              wordBreak: "keep-all",
                              justifySelf: "center",
                              padding: headerNameDuplicated
                                ? (isCompactMonthlyView ? "4px 10px" : "5px 12px")
                                : highlightHeaderName
                                  ? (isCompactMonthlyView ? "4px 10px" : "5px 12px")
                                  : 0,
                              borderRadius: headerNameDuplicated || highlightHeaderName ? 999 : 0,
                              background: headerNameDuplicated
                                ? "rgba(239,68,68,.22)"
                                : highlightHeaderName
                                  ? "rgba(125,211,252,.2)"
                                  : "transparent",
                              border: headerNameDuplicated
                                ? "1px solid rgba(248,113,113,.55)"
                                : highlightHeaderName
                                  ? "6px solid rgba(255,255,255,.95)"
                                  : undefined,
                            }}
                          >
                            {day.headerName ?? ""}
                          </div>
                        </div>
                      </div>
                      <div className="schedule-day-body" style={{ display: "grid", gap: 1 }}>
                        {visibleAssignments.map(([category, names]) => (
                          <div key={`${day.dateKey}-${category}`} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: 6, background: "rgba(9,17,30,.34)" }}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "44px minmax(0, 1fr)",
                                columnGap: 8,
                                alignItems: "stretch",
                              }}
                            >
                              <strong
                                className="schedule-assignment-label"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  alignSelf: "stretch",
                                  marginBottom: 0,
                                  fontSize: 14,
                                  lineHeight: 1.1,
                                  minHeight: 38,
                                  textAlign: "center",
                                  whiteSpace: "pre-line",
                                }}
                              >
                                  {getCategoryDisplayLabel(day, category)}
                              </strong>
                              <div
                                className={`schedule-name-grid ${isCompactMonthlyView ? "schedule-name-grid--monthly" : ""}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                  justifyContent: "stretch",
                                  justifyItems: "stretch",
                                  alignItems: "center",
                                  gap: 0,
                                  minHeight: 38,
                                  width: "100%",
                                }}
                              >
                              {names.length > 0 ? (
                                names.map((name, index) => {
                                  const assignmentDisplay = getAssignmentDisplay(category, name);
                                  const ref: SchedulePersonRef = {
                                    monthKey: day.ownerMonthKey,
                                    dateKey: day.dateKey,
                                    category,
                                    index,
                                    name,
                                  };
                                  const personObject: ScheduleNameObject = {
                                    key: `${day.ownerMonthKey}-${category}-${name}-${index}`,
                                    name: assignmentDisplay.name,
                                    ref,
                                    pending: isPendingRef(allPendingRequests, ref),
                                  };
                                  const ownPendingRequest = findOwnPendingRequestForRef(allPendingRequests, ref, session?.id);
                                  const isMine = isSameScheduleActorName(username, assignmentDisplay.name);
                                  const mineHighlighted =
                                    isMine && (showMine || (editMode && !isAutoManagedGeneralCategory(category)));
                                  const editModeMineHighlighted =
                                    isMine && editMode && !isAutoManagedGeneralCategory(category);
                                  const routeSelected = routeIncludes(selectedRoute, ref);
                                  const firstSelected = sameRef(firstSelectedRef, ref);
                                  const recommendedHighlighted =
                                    Boolean(firstSelectedRef) &&
                                    !routeSelected &&
                                    !personObject.pending &&
                                    recommendedCandidateKeys.has(getRefKey(ref));
                                  const nameTag = getAssignmentChipTag(category, assignmentDisplay.name, day);
                                  const assignmentDisplayText = formatScheduleAssignmentDisplayName(
                                    {
                                      monthKey: day.ownerMonthKey,
                                      dateKey: day.dateKey,
                                      category,
                                      index,
                                      name: assignmentDisplay.name,
                                    },
                                    scheduleAssignmentStore,
                                    visibleTripTagMap,
                                  );
                                  const hasTaggedDisplayName = Boolean(nameTag || assignmentDisplayText !== assignmentDisplay.name);
                                  const nameTagColors = nameTag ? scheduleAssignmentNameTagColors[nameTag] : null;
                                  const duplicated = duplicateNameSet.has(assignmentDisplay.name.trim());
                                  const dimOtherNames = Boolean(username) && showMine && !isMine && !personObject.pending && !routeSelected;
                                  const isInteractiveChip =
                                    !isHomePreview && editMode && (!personObject.pending || Boolean(ownPendingRequest));
                                  return (
                                    <div
                                      key={personObject.key}
                                      data-swap-recommendation-root={firstSelected ? "true" : undefined}
                                      style={{
                                        position: "relative",
                                        width: "100%",
                                      overflow: "visible",
                                      zIndex: firstSelected ? 40 : routeSelected ? 10 : editModeMineHighlighted ? 8 : 1,
                                    }}
                                  >
                                      <button
                                        type="button"
                                        className={`schedule-name-chip ${mineHighlighted ? "schedule-name-chip--featured" : ""} ${isCompactMonthlyView ? "schedule-name-chip--compact" : ""}`}
                                        disabled={!isInteractiveChip}
                                        onClick={() => void handleNameClick(personObject)}
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gridColumn: "auto",
                                          justifySelf: "stretch",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          width: "100%",
                                          maxWidth: "100%",
                                          gap: personObject.pending ? 0 : 5,
                                          minHeight: isCompactMonthlyView ? 28 : isCompactDailyLandscapeView ? 38 : isCompactDailyView ? 30 : 30,
                                          padding: isCompactMonthlyView ? "3px 4px" : isCompactDailyView ? "4px 4px" : "3px 4px",
                                          borderRadius: 0,
                                          background: personObject.pending
                                            ? "rgba(245,158,11,.18)"
                                            : routeSelected
                                              ? firstSelected
                                                ? "rgba(168,85,247,.28)"
                                                : "rgba(56,189,248,.22)"
                                              : duplicated
                                                ? "rgba(239,68,68,.22)"
                                                : recommendedHighlighted
                                                  ? "rgba(124,58,237,.32)"
                                                  : mineHighlighted
                                                    ? "rgba(148,163,184,.38)"
                                                    : dimOtherNames
                                                      ? "rgba(255,255,255,.06)"
                                                      : hasTaggedDisplayName
                                                        ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND
                                                        : nameTagColors
                                                          ? nameTagColors.background
                                                          : assignmentDisplay.chipStyle?.background
                                                            ? assignmentDisplay.chipStyle.background
                                                            : "rgba(255,255,255,.16)",
                                          border: personObject.pending
                                            ? "1px solid rgba(245,158,11,.35)"
                                            : routeSelected
                                              ? firstSelected
                                                ? "1px solid rgba(192,132,252,.78)"
                                                : "1px solid rgba(56,189,248,.75)"
                                              : duplicated
                                                ? "1px solid rgba(239,68,68,.28)"
                                                : recommendedHighlighted
                                                  ? "3px solid rgba(255,255,255,.95)"
                                                : mineHighlighted
                                                  ? "4px solid rgba(226,232,240,.82)"
                                                  : dimOtherNames
                                                    ? "1px solid rgba(255,255,255,.08)"
                                                      : hasTaggedDisplayName
                                                        ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER
                                                        : nameTagColors
                                                          ? nameTagColors.border
                                                          : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                          color: routeSelected && firstSelected
                                            ? "#f5eaff"
                                            : routeSelected || recommendedHighlighted || mineHighlighted
                                              ? "#ffffff"
                                              : duplicated
                                                ? "#ffe4e6"
                                                : dimOtherNames
                                                  ? "rgba(248,251,255,.48)"
                                                  : hasTaggedDisplayName
                                                    ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR
                                                    : nameTagColors
                                                      ? nameTagColors.color
                                                      : assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                          fontWeight: mineHighlighted ? 800 : 700,
                                          lineHeight: 1.3,
                                          boxShadow: mineHighlighted
                                            ? editModeMineHighlighted
                                              ? "0 14px 28px rgba(15,23,42,.48), 0 0 18px rgba(125,211,252,.36), 0 0 0 1px rgba(255,255,255,.2)"
                                              : "0 6px 14px rgba(15,23,42,.34), 0 0 0 1px rgba(255,255,255,.18)"
                                            : "none",
                                          textShadow: undefined,
                                          opacity: dimOtherNames ? 0.42 : 1,
                                          transform: editModeMineHighlighted
                                            ? "translateY(-2px) scale(1.5)"
                                            : mineHighlighted
                                              ? "translateY(-1px)"
                                              : undefined,
                                          transformOrigin: "center",
                                          cursor: isInteractiveChip ? "pointer" : "default",
                                        }}
                                      >
                                        <FittedNameText
                                          text={getAssignmentChipText(assignmentDisplayText, nameTag)}
                                          className="schedule-name-chip__text"
                                          minFontSize={shouldAutoFitSchedule ? 5 : 9}
                                          maxFontSize={isCompactMonthlyView ? 16 : isCompactDailyView ? 16 : 18}
                                          style={{
                                            display: "inline-block",
                                            flex: "0 1 auto",
                                            width: "100%",
                                            margin: "0 auto",
                                            overflow: "visible",
                                            textOverflow: "clip",
                                          }}
                                        />
                                        {personObject.pending ? <span style={{ fontSize: isCompactMonthlyView ? 8 : 9, marginTop: -2, lineHeight: 1 }}>요청중</span> : null}
                                      </button>
                                      {renderInlineRecommendedCandidates(ref)}
                                    </div>
                                  );
                                })
                              ) : (
                                <span style={{ display: "inline-block", minHeight: 22 }} />
                              )}
                              {names.length > 0 && names.length % 2 === 1 ? (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    display: "block",
                                    minHeight: isCompactMonthlyView ? 28 : isCompactDailyLandscapeView ? 38 : isCompactDailyView ? 30 : 30,
                                    border: "1px solid rgba(255,255,255,.08)",
                                    background: "rgba(255,255,255,.03)",
                                  }}
                                />
                              ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
                  </>
                )}
              </div>
              </div>
              </div>
            </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
