"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSession, hasDeskAccess } from "@/lib/auth/storage";
import { printHtmlDocument } from "@/lib/print";
import { getAssignmentDisplayRank, getScheduleCategoryLabel } from "@/lib/schedule/constants";
import { renderSchedulePrintHtml } from "@/lib/schedule/print-layout";
import {
  CHANGE_REQUESTS_EVENT,
  CHANGE_REQUESTS_STATUS_EVENT,
  createScheduleChangeRequest,
  getScheduleChangeRequests,
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
  removePublishedSchedule,
} from "@/lib/schedule/published";
import { DaySchedule, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const MAX_ROUTE_SIZE = 3;
const MOBILE_VIEWPORT_MAX = 720;
const weekendAssignmentOrder = ["조근", "일반", "뉴스대기", "야근", "청와대", "국회", "청사"] as const;

function getWeekdayLabel(dow: number) {
  return weekdayLabels[(dow + 6) % 7] ?? "";
}

function isHandheldPhoneDevice() {
  if (typeof navigator === "undefined") return false;
  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (userAgentData?.mobile) return true;
  return /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile/i.test(navigator.userAgent);
}

function isMobileScheduleViewport() {
  if (typeof window === "undefined") return false;
  if (window.innerWidth <= MOBILE_VIEWPORT_MAX) return true;
  if (isHandheldPhoneDevice()) return true;
  const isCoarsePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const screenShortEdge = Math.min(window.innerWidth, window.innerHeight, window.screen.width, window.screen.height);
  return isCoarsePointer && screenShortEdge <= 860;
}

const vacationLegendStyles = {
  연차: {
    background: "rgba(59,130,246,.22)",
    border: "1px solid rgba(96,165,250,.5)",
    color: "#dbeafe",
  },
  대휴: {
    background: "rgba(16,185,129,.22)",
    border: "1px solid rgba(52,211,153,.5)",
    color: "#d1fae5",
  },
  근속휴가: {
    background: "rgba(251,191,36,.22)",
    border: "1px solid rgba(252,211,77,.5)",
    color: "#fde68a",
  },
  건강검진: {
    background: "rgba(244,114,182,.2)",
    border: "1px solid rgba(251,113,133,.48)",
    color: "#ffe4e6",
  },
  경조: {
    background: "rgba(167,139,250,.2)",
    border: "1px solid rgba(196,181,253,.48)",
    color: "#ede9fe",
  },
} as const;

const dutyLegendStyles = {
  조근: {
    background: "rgba(250,204,21,.78)",
    border: "1px solid rgba(253,224,71,.92)",
    color: "#fde68a",
  },
} as const;

type DisplayDay = DaySchedule & {
  ownerMonthKey: string;
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
  return {
    name: parsed.name,
    chipStyle: vacationLegendStyles[parsed.type],
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

function getCategoryDisplayLabel(category: string) {
  const label = getScheduleCategoryLabel(category);
  return label === "뉴스대기" ? "뉴스\n대기" : label;
}

function getVisibleAssignmentRank(category: string, isWeekendLike: boolean) {
  if (!isWeekendLike) return getAssignmentDisplayRank(category);
  const normalized = getScheduleCategoryLabel(category);
  const weekendIndex = weekendAssignmentOrder.indexOf(normalized as (typeof weekendAssignmentOrder)[number]);
  if (weekendIndex >= 0) return weekendIndex;
  return weekendAssignmentOrder.length + getAssignmentDisplayRank(category);
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
    .filter((day) => Object.values(day.assignments).some((names) => names.includes(currentUser)))
    .map((day) => {
      const categories = Object.entries(day.assignments)
        .filter(([, names]) => names.includes(currentUser))
        .sort(([leftCategory], [rightCategory]) => getAssignmentDisplayRank(leftCategory) - getAssignmentDisplayRank(rightCategory))
        .map(([category]) => getScheduleCategoryLabel(category))
        .join(", ");
      return `${day.month}/${day.day} - ${categories}`;
    });
}

function dayContainsUser(day: DaySchedule, username: string) {
  if (!username) return false;
  if (day.headerName?.trim() === username) return true;
  return Object.values(day.assignments).some((names) => names.includes(username));
}

function getCurrentMonthKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
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
  previousItem?: PublishedScheduleItem | null,
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

function routeIncludes(route: SchedulePersonRef[], ref: SchedulePersonRef) {
  return route.some((candidate) => sameRef(candidate, ref));
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

function hasAssignmentElsewhereOnDay(day: DaySchedule | undefined, ref: SchedulePersonRef, name: string) {
  if (!day) return false;
  return Object.entries(day.assignments).some(([category, names]) =>
    names.some((currentName, index) => {
      if (currentName !== name) return false;
      return !(category === ref.category && index === ref.index);
    }),
  );
}

function routeWouldCreateConflict(items: PublishedScheduleItem[], route: SchedulePersonRef[]) {
  if (route.length < 2) return false;
  const previewMap = rotateRoutePreview(items, route);
  if (!previewMap) return true;
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
    if (hadNightShiftPreviousDay(dayIndex, name, ref.dateKey)) return true;
    if (ref.category === "야근" && hasWorkAfterNightShift(dayIndex, name, ref.dateKey)) return true;
    return false;
  });
}

function describeRef(ref: SchedulePersonRef | null) {
  if (!ref) return "";
  return `${ref.dateKey} ${getScheduleCategoryLabel(ref.category)} ${ref.name}`;
}

function describeRoute(route: SchedulePersonRef[]) {
  const labels = route.map((ref) => describeRef(ref));
  if (labels.length <= 2) return labels.join(" ↔ ");
  return `${labels.join(" → ")} → ${labels[0]}`;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDateKey() {
  return toDateKey(new Date());
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

function hasAssignmentOnDay(day: DaySchedule | undefined, name: string) {
  if (!day) return false;
  return Object.values(day.assignments).some((names) => names.includes(name));
}

function isHolidayLikeDay(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const day = dayIndex.get(dateKey);
  return Boolean(day && (day.isWeekend || day.isHoliday));
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

function hadNightShiftPreviousDay(dayIndex: Map<string, DaySchedule>, name: string, dateKey: string) {
  const previousDay = dayIndex.get(getPreviousDateKey(dateKey));
  return (previousDay?.assignments["야근"] ?? []).includes(name);
}

function isSwapCandidateValid(
  source: SchedulePersonRef,
  target: SchedulePersonRef,
  dayIndex: Map<string, DaySchedule>,
  todayKey: string,
) {
  const categoryLabel = getScheduleCategoryLabel(source.category);
  if (source.category !== target.category) return false;
  if (!hasCompatibleVacationType(source, target)) return false;
  if (source.name === target.name) return false;
  if (source.dateKey <= todayKey || target.dateKey <= todayKey) return false;
  if (source.dateKey === target.dateKey) return false;
  if (categoryLabel === "조근" && isHolidayLikeDay(dayIndex, source.dateKey) !== isHolidayLikeDay(dayIndex, target.dateKey)) {
    return false;
  }
  if (categoryLabel === "야근" && getNightShiftGroup(dayIndex, source.dateKey) !== getNightShiftGroup(dayIndex, target.dateKey)) {
    return false;
  }
  if (hasAssignmentOnDay(dayIndex.get(source.dateKey), target.name)) return false;
  if (hasAssignmentOnDay(dayIndex.get(target.dateKey), source.name)) return false;
  if (hadNightShiftPreviousDay(dayIndex, target.name, source.dateKey)) return false;
  if (hadNightShiftPreviousDay(dayIndex, source.name, target.dateKey)) return false;
  if (categoryLabel === "야근") {
    if (hasWorkAfterNightShift(dayIndex, target.name, source.dateKey)) return false;
    if (hasWorkAfterNightShift(dayIndex, source.name, target.dateKey)) return false;
  }
  return true;
}

export function PublishedSchedulesPanel() {
  const [items, setItems] = useState<PublishedScheduleItem[]>([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isLandscapeViewport, setIsLandscapeViewport] = useState(false);
  const [displayMode, setDisplayMode] = useState<"daily" | "monthly">("daily");
  const [selectedRoute, setSelectedRoute] = useState<SchedulePersonRef[]>([]);
  const [confirmConflictRequest, setConfirmConflictRequest] = useState(false);
  const [requests, setRequests] = useState<ScheduleChangeRequest[]>([]);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestMessageTone, setRequestMessageTone] = useState<"ok" | "warn" | "note">("ok");
  const [compactMonthCardHeight, setCompactMonthCardHeight] = useState<number | null>(null);
  const printableScheduleRef = useRef<HTMLDivElement | null>(null);
  const compactMonthCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const session = getSession();
  const canDelete = hasDeskAccess(session?.role);
  const username = session?.username ?? "";

  const loadItems = async () => {
    await refreshPublishedSchedules();
    const nextItems = getPublishedSchedules();
    setItems(nextItems);
    setSelectedMonthKey((current) => {
      if (current && nextItems.some((item) => item.monthKey === current)) return current;
      return getPreferredPublishedMonthKey(nextItems);
    });
  };

  const loadRequests = async () => {
    await refreshScheduleChangeRequests();
    setRequests(getScheduleChangeRequests());
  };

  useEffect(() => {
    void loadItems();
    void loadRequests();
  }, []);

  useEffect(() => {
    const onRefresh = () => {
      void loadItems();
      void loadRequests();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setRequestMessage(detail.message);
      setRequestMessageTone("warn");
    };
    window.addEventListener("storage", onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, onRefresh);
    window.addEventListener(CHANGE_REQUESTS_EVENT, onRefresh);
    window.addEventListener(PUBLISHED_SCHEDULES_STATUS_EVENT, onStatus);
    window.addEventListener(CHANGE_REQUESTS_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, onRefresh);
      window.removeEventListener(CHANGE_REQUESTS_EVENT, onRefresh);
      window.removeEventListener(PUBLISHED_SCHEDULES_STATUS_EVENT, onStatus);
      window.removeEventListener(CHANGE_REQUESTS_STATUS_EVENT, onStatus);
    };
  }, []);

  useEffect(() => {
    setSelectedRoute([]);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  }, [editMode, selectedMonthKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewport = () => {
      setIsMobileViewport(isMobileScheduleViewport());
      setIsLandscapeViewport(window.innerWidth > window.innerHeight);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, []);

  const selectedItem = useMemo(() => {
    if (items.length === 0) return null;
    return items.find((item) => item.monthKey === selectedMonthKey) ?? items[items.length - 1];
  }, [items, selectedMonthKey]);

  const previousSelectedItem = useMemo(() => {
    if (!selectedItem) return null;
    const index = items.findIndex((item) => item.monthKey === selectedItem.monthKey);
    if (index <= 0) return null;
    return items[index - 1] ?? null;
  }, [items, selectedItem]);

  const selectedIndex = selectedItem ? items.findIndex((item) => item.monthKey === selectedItem.monthKey) : -1;
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const allPendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);
  const publishedDayIndex = useMemo(() => buildDayIndex(items), [items]);
  const displayDays = useMemo(
    () => (selectedItem ? buildDisplayDays(selectedItem, previousSelectedItem) : []),
    [previousSelectedItem, selectedItem],
  );
  const firstSelectedRef = selectedRoute[0] ?? null;
  const hasConflictWarning = useMemo(
    () => routeWouldCreateConflict(items, selectedRoute),
    [items, selectedRoute],
  );

  const recommendedCandidates = useMemo(() => {
    if (!editMode || !firstSelectedRef) return [];
    return items
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
        items.some((item) => item.monthKey === ref.monthKey && item.schedule.days.some((day) => day.dateKey === ref.dateKey)),
      )
      .filter((ref) => !sameRef(firstSelectedRef, ref))
      .filter((ref) => !isPendingRef(allPendingRequests, ref))
      .filter((ref) => isSwapCandidateValid(firstSelectedRef, ref, publishedDayIndex, todayKey))
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.name.localeCompare(right.name));
  }, [allPendingRequests, editMode, firstSelectedRef, items, publishedDayIndex, todayKey]);

  const routeScopeLabel = useMemo(() => {
    if (items.length === 0) return "게시된 근무표";
    const first = items[0];
    const last = items[items.length - 1];
    if (first.monthKey === last.monthKey) {
      return `${first.schedule.year}년 ${first.schedule.month}월 게시 근무표`;
    }
    return `${first.schedule.year}년 ${first.schedule.month}월 ~ ${last.schedule.year}년 ${last.schedule.month}월 게시 근무표`;
  }, [items]);

  const toggleEditMode = () => {
    setEditMode((current) => !current);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const isMonthlyView = !isMobileViewport || displayMode === "monthly";
  const isCompactMonthlyView = isMobileViewport && displayMode === "monthly";
  const isCompactDailyView = isMobileViewport && displayMode === "daily";
  const isCompactDailyLandscapeView = isCompactDailyView && isLandscapeViewport;

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
  }, [displayDays, editMode, isCompactMonthlyView, requests, selectedRoute, showMine]);

  const printSelectedSchedule = () => {
    if (!selectedItem) return;
    const printTitle = `${selectedItem.schedule.month}월 근무표`;
    printHtmlDocument({
      title: printTitle,
      bodyHtml: renderSchedulePrintHtml({
        title: printTitle,
        days: displayDays,
        highlightedName: showMine ? username : null,
      }),
    });
  };

  const handleNameClick = (person: ScheduleNameObject) => {
    if (!editMode || !username || person.pending) return;
    if (person.ref.dateKey <= todayKey) {
      setRequestMessage("오늘 이후 근무만 변경 요청할 수 있습니다.");
      setRequestMessageTone("warn");
      return;
    }

    if (selectedRoute.length === 0) {
      if (person.name !== username) {
        setRequestMessage("먼저 내 근무를 선택해 주세요.");
        setRequestMessageTone("warn");
        return;
      }
      setSelectedRoute([person.ref]);
      setConfirmConflictRequest(false);
      setRequestMessage("");
      setRequestMessageTone("ok");
      return;
    }

    const existingIndex = selectedRoute.findIndex((ref) => sameRef(ref, person.ref));
    if (existingIndex >= 0) {
      if (selectedRoute.length === 1 && existingIndex === 0) {
        clearRoute();
        return;
      }
      if (existingIndex === selectedRoute.length - 1) {
        setSelectedRoute(selectedRoute.slice(0, -1));
        setConfirmConflictRequest(false);
        setRequestMessage("");
        setRequestMessageTone("ok");
        return;
      }
      setSelectedRoute(selectedRoute.slice(0, existingIndex + 1));
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
      setRequestMessage("휴가 교환은 같은 유형끼리만 가능합니다. 연차와 대휴는 서로 바꿀 수 없습니다.");
      setRequestMessageTone("warn");
      return;
    }

    setSelectedRoute([...selectedRoute, person.ref]);
    setConfirmConflictRequest(false);
    setRequestMessage("");
    setRequestMessageTone("ok");
  };

  const clearRoute = () => {
    setSelectedRoute([]);
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

  if (items.length === 0) {
    return (
      <section className="panel">
        <div className="panel-pad">
          <div className="chip">게시된 근무표</div>
          <div className="status note" style={{ marginTop: 16 }}>게시된 근무표가 없습니다.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        {editMode && username ? (
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
            <strong>요청 경로</strong>
            {selectedRoute.length > 0 ? (
              <div className="muted">{describeRoute(selectedRoute)}</div>
            ) : (
              <div className="muted">먼저 내 이름을 누른 뒤, {routeScopeLabel} 전체에서 미래 날짜의 교환 또는 삼각 트레이드 상대를 선택하세요.</div>
            )}

            {firstSelectedRef ? (
              <div style={{ display: "grid", gap: 8 }}>
                <span className="muted">추천 직접 교환 후보</span>
                {recommendedCandidates.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
                    {recommendedCandidates.map((candidate) => (
                      <button
                        key={`${candidate.monthKey}-${candidate.dateKey}-${candidate.category}-${candidate.index}-${candidate.name}`}
                        type="button"
                        className="btn"
                        onClick={() => {
                          setSelectedRoute((current) => {
                            if (routeIncludes(current, candidate) || current.length >= MAX_ROUTE_SIZE) return current;
                            return [...current, candidate];
                          });
                          setRequestMessage("");
                        }}
                      >
                        {candidate.dateKey} {getScheduleCategoryLabel(candidate.category)} {candidate.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="status note">추천 후보가 없어도 현재 보고 있는 달 표에서 다른 근무를 눌러 요청할 수 있습니다.</div>
                )}
              </div>
            ) : null}

            {selectedRoute.length >= 2 ? (
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

        <div className="schedule-toolbar">
          <div className="chip">게시된 근무표</div>
          <div className="schedule-toolbar-actions schedule-toolbar-actions--controls">
            <span className="muted">{username ? `${username} 기준` : "로그인 사용자 없음"}</span>
            <button className={`btn ${showMine ? "white" : ""}`} disabled={!username} onClick={() => setShowMine((current) => !current)}>
              {showMine ? "전체 보기" : "내 근무 보기"}
            </button>
            <button className={`btn ${editMode ? "white" : ""}`} disabled={!username} onClick={toggleEditMode}>
              {editMode ? "근무 수정 완료" : "근무 수정"}
            </button>
          </div>
        </div>

        {editMode && username ? (
          <div className="status note">처음 시작은 로그인한 본인 이름으로만 가능합니다. 이후에는 {routeScopeLabel} 전체에서 미래 날짜 근무를 요청 경로에 넣을 수 있습니다.</div>
        ) : null}
        {requestMessage ? <div className={`status ${requestMessageTone}`}>{requestMessage}</div> : null}

        {isMobileViewport ? (
          <div className="schedule-toolbar">
            <div className="schedule-toolbar-actions">
              <span className="muted">보기 방식</span>
              <button className={`btn ${displayMode === "daily" ? "white" : ""}`} onClick={() => setDisplayMode("daily")}>
                일별 보기
              </button>
              <button className={`btn ${displayMode === "monthly" ? "white" : ""}`} onClick={() => setDisplayMode("monthly")}>
                월별 보기
              </button>
            </div>
          </div>
        ) : null}

        <div className="schedule-toolbar">
          <div className="schedule-toolbar-actions">
            {items.map((item) => (
              <button
                key={item.monthKey}
                className={`btn ${selectedItem?.monthKey === item.monthKey ? "white" : ""}`}
                onClick={() => setSelectedMonthKey(item.monthKey)}
              >
                {item.schedule.year}년 {item.schedule.month}월
              </button>
            ))}
          </div>
          {selectedItem ? (
            <div className="schedule-toolbar-actions schedule-toolbar-actions--controls">
              <strong className="schedule-current-title">{selectedItem.title}</strong>
              <div className="schedule-toolbar-actions schedule-toolbar-actions--legend">
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    ...vacationLegendStyles.연차,
                  }}
                >
                  연차
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    ...vacationLegendStyles.대휴,
                  }}
                >
                  대휴
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    ...vacationLegendStyles.근속휴가,
                  }}
                >
                  근속
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    ...vacationLegendStyles.건강검진,
                  }}
                >
                  검진
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    ...vacationLegendStyles.경조,
                  }}
                >
                  경조
                </span>
              </div>
              <div className="schedule-toolbar-actions schedule-toolbar-actions--nav">
                <button className="btn" disabled={selectedIndex <= 0} onClick={() => setSelectedMonthKey(items[selectedIndex - 1]?.monthKey ?? null)}>
                  이전 달
                </button>
                <button className="btn" disabled={selectedIndex < 0 || selectedIndex >= items.length - 1} onClick={() => setSelectedMonthKey(items[selectedIndex + 1]?.monthKey ?? null)}>
                  다음 달
                </button>
                {!isMobileViewport ? (
                  <button className="btn" onClick={printSelectedSchedule}>
                    출력
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    className="btn"
                    onClick={() => {
                      const ok = window.confirm(`${selectedItem.title} 게시를 해제하시겠습니까?`);
                      if (!ok) return;
                      const next = removePublishedSchedule(selectedItem.monthKey);
                      setItems(next);
                      setSelectedMonthKey(getPreferredPublishedMonthKey(next));
                    }}
                  >
                    게시 해제
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {selectedItem ? (
          <>
            <div ref={printableScheduleRef} data-print-frame="true" style={{ display: "grid", gap: 12 }}>
              <div data-print-only="true" style={{ display: "none" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <strong style={{ fontSize: 22 }}>{selectedItem.title}</strong>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 14,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        ...vacationLegendStyles.연차,
                      }}
                    >
                      연차
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 14,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        ...vacationLegendStyles.대휴,
                      }}
                    >
                      대휴
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 14,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        ...vacationLegendStyles.근속휴가,
                      }}
                    >
                      근속
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 14,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        ...vacationLegendStyles.건강검진,
                      }}
                    >
                      검진
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 14,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        ...vacationLegendStyles.경조,
                      }}
                    >
                      경조
                    </span>
                  </div>
                  <div className="muted">게시 {formatPublishedAt(selectedItem.publishedAt)}</div>
                </div>
              </div>
              <div className="muted">게시 {formatPublishedAt(selectedItem.publishedAt)}</div>

              <div className={`schedule-calendar-scroll ${isCompactMonthlyView ? "schedule-calendar-scroll--monthly" : "schedule-calendar-scroll--daily"}`}>
              <div
                className={`schedule-calendar-zoom ${isCompactMonthlyView ? "schedule-calendar-zoom--monthly" : "schedule-calendar-zoom--daily"}`}
              >
              <div className={`schedule-calendar-grid ${isCompactMonthlyView ? "schedule-calendar-grid--monthly" : "schedule-calendar-grid--daily"}`}>
                {weekdayLabels.map((label) => (
                  <div key={label} className={`schedule-weekday ${isCompactMonthlyView ? "schedule-weekday--monthly" : ""}`} style={{ textAlign: "center", padding: "6px 4px", borderRadius: 12, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)", fontWeight: 900, fontSize: 14 }}>
                    {label}
                  </div>
                ))}
                {displayDays.map((day) => {
                  const isCurrentSheetDay = day.ownerMonthKey === selectedItem.monthKey;
                  const dayCardStyle = getDayCardStyle(day, isCurrentSheetDay);
                  const centeredDayLabel = getCenteredDayLabel(day);
                  const isWeekendLike = day.isWeekend || day.isHoliday;
                  const highlightDayHead = showMine && dayContainsUser(day, username);
                  const highlightHeaderName = highlightDayHead && Boolean(day.headerName?.trim());
                  const visibleAssignments = Object.entries(day.assignments)
                    .filter(([category]) => {
                      if (isWeekendLike) return category !== "휴가" && category !== "제크";
                      return !["국회", "청사", "청와대"].includes(category);
                    })
                    .sort(([leftCategory], [rightCategory]) => getVisibleAssignmentRank(leftCategory, isWeekendLike) - getVisibleAssignmentRank(rightCategory, isWeekendLike));
                  return (
                    <article
                      key={`${day.ownerMonthKey}-${day.dateKey}`}
                      ref={(node) => {
                        compactMonthCardRefs.current[`${day.ownerMonthKey}-${day.dateKey}`] = node;
                      }}
                      className={`panel schedule-day-card ${isCompactMonthlyView ? "schedule-day-card--monthly" : ""}`}
                      style={{
                        padding: 6,
                        minHeight: isCompactMonthlyView ? 148 : 216,
                        height: isCompactMonthlyView && compactMonthCardHeight ? compactMonthCardHeight : undefined,
                        opacity: day.isOverflowMonth && !isCurrentSheetDay ? 0.55 : 1,
                        background: dayCardStyle.background,
                        border: dayCardStyle.border,
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
                          <span className="schedule-day-weekday">{getWeekdayLabel(day.dow)}</span>
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
                              color: highlightHeaderName ? "#f8fbff" : "#f8fbff",
                              fontSize: 21,
                              fontWeight: 900,
                              lineHeight: 1.1,
                              whiteSpace: "normal",
                              overflow: "visible",
                              textOverflow: "clip",
                              wordBreak: "keep-all",
                              justifySelf: "center",
                              padding: highlightHeaderName ? (isCompactMonthlyView ? "4px 10px" : "5px 12px") : 0,
                              borderRadius: highlightHeaderName ? 999 : 0,
                              background: highlightHeaderName ? "rgba(125,211,252,.2)" : "transparent",
                              border: highlightHeaderName ? "6px solid rgba(255,255,255,.95)" : undefined,
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
                                {getCategoryDisplayLabel(category)}
                              </strong>
                              <div className={`schedule-name-grid ${isCompactMonthlyView ? "schedule-name-grid--monthly" : ""}`} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 5, minHeight: 38 }}>
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
                                  const isMine = Boolean(username) && username === assignmentDisplay.name;
                                  const mineHighlighted = isMine && (showMine || editMode);
                                  const routeSelected = routeIncludes(selectedRoute, ref);
                                  const firstSelected = sameRef(firstSelectedRef, ref);
                                  const dimOtherNames = Boolean(username) && showMine && !isMine && !personObject.pending && !routeSelected;
                                  return (
                                    <button
                                      key={personObject.key}
                                      type="button"
                                      onClick={() => handleNameClick(personObject)}
                                      style={{
                                        display: "flex",
                                        gridColumn: mineHighlighted ? "1 / -1" : "auto",
                                        justifySelf: mineHighlighted ? "center" : "stretch",
                                        alignItems: "center",
                                        justifyContent: personObject.pending ? "space-between" : "center",
                                        width: mineHighlighted ? "fit-content" : "100%",
                                        maxWidth: "100%",
                                        gap: 5,
                                        minHeight: mineHighlighted ? (isCompactMonthlyView ? 30 : isCompactDailyLandscapeView ? 42 : isCompactDailyView ? 34 : 36) : isCompactMonthlyView ? 28 : isCompactDailyLandscapeView ? 38 : isCompactDailyView ? 30 : 32,
                                        padding: mineHighlighted ? (isCompactMonthlyView ? "4px 9px" : isCompactDailyView ? "5px 9px" : "5px 11px") : isCompactMonthlyView ? "4px 7px" : isCompactDailyView ? "5px 8px" : "5px 9px",
                                        borderRadius: mineHighlighted ? 16 : 14,
                                        background: personObject.pending
                                          ? "rgba(245,158,11,.18)"
                                          : routeSelected
                                            ? firstSelected
                                              ? "rgba(168,85,247,.28)"
                                              : "rgba(56,189,248,.22)"
                                            : mineHighlighted
                                              ? "rgba(148,163,184,.38)"
                                              : dimOtherNames
                                                ? "rgba(255,255,255,.06)"
                                                : assignmentDisplay.isVacation
                                                ? assignmentDisplay.chipStyle?.background
                                                : "rgba(255,255,255,.16)",
                                        border: personObject.pending
                                          ? "1px solid rgba(245,158,11,.35)"
                                          : routeSelected
                                            ? firstSelected
                                              ? "1px solid rgba(192,132,252,.78)"
                                              : "1px solid rgba(56,189,248,.75)"
                                            : mineHighlighted
                                              ? "4px solid rgba(226,232,240,.82)"
                                              : dimOtherNames
                                                ? "1px solid rgba(255,255,255,.08)"
                                              : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                        color: routeSelected && firstSelected ? "#f5eaff" : mineHighlighted ? "#ffffff" : dimOtherNames ? "rgba(248,251,255,.48)" : assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                        fontWeight: mineHighlighted ? 800 : 700,
                                        fontSize: mineHighlighted ? (isCompactMonthlyView ? 16 : isCompactDailyLandscapeView ? 15 : isCompactDailyView ? 18 : 22) : isCompactMonthlyView ? 12 : isCompactDailyLandscapeView ? 12 : isCompactDailyView ? 13 : 15,
                                        lineHeight: 1.3,
                                        boxShadow: routeSelected && firstSelected
                                          ? "0 10px 24px rgba(88,28,135,.28), 0 0 0 1px rgba(255,255,255,.08) inset"
                                          : mineHighlighted
                                            ? "0 10px 24px rgba(15,23,42,.18), 0 0 0 1px rgba(255,255,255,.08) inset"
                                            : undefined,
                                        textShadow: undefined,
                                        opacity: dimOtherNames ? 0.42 : 1,
                                        cursor: editMode && !personObject.pending ? "pointer" : "default",
                                      }}
                                    >
                                      <span
                                        style={{
                                          whiteSpace: isCompactDailyLandscapeView ? "normal" : "nowrap",
                                          textAlign: "center",
                                          flex: 1,
                                          minWidth: 0,
                                          overflow: isCompactMonthlyView ? "hidden" : isCompactDailyLandscapeView ? "visible" : isMobileViewport ? "hidden" : "visible",
                                          textOverflow: isCompactMonthlyView ? "ellipsis" : isCompactDailyLandscapeView ? "clip" : isMobileViewport ? "ellipsis" : "clip",
                                          lineHeight: isCompactDailyLandscapeView ? 1.15 : 1.3,
                                          wordBreak: "keep-all",
                                        }}
                                      >
                                        {assignmentDisplay.name}
                                      </span>
                                      {personObject.pending ? <span style={{ fontSize: isCompactMonthlyView ? 10 : 12 }}>요청중</span> : null}
                                    </button>
                                  );
                                })
                              ) : (
                                <span style={{ display: "inline-block", minHeight: 22 }} />
                              )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
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
