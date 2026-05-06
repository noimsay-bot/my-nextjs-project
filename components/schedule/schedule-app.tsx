﻿﻿﻿"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { FittedNameText } from "@/components/schedule/fitted-name-text";
import { ScheduleManagementLinks } from "@/components/schedule/schedule-management-links";
import { getSession } from "@/lib/auth/storage";
import { printHtmlDocument } from "@/lib/print";
import {
  buildScheduleAssignmentNameTagKey,
  GENERAL_TEAM_DEFAULT_NAMES,
  SCHEDULE_MONTHS,
  SCHEDULE_YEARS,
  categories,
  defaultScheduleState,
  getDayCategoryDisplayLabel,
  getDayDuplicateNameSet,
  getScheduleCategoryLabel,
  getVisibleAssignmentDisplayRank,
  isGeneralAssignmentCategory,
  orderCategories,
  scheduleAssignmentNameTagColors,
  scheduleAssignmentNameTagLabels,
} from "@/lib/schedule/constants";
import { renderSchedulePrintHtml } from "@/lib/schedule/print-layout";
import {
  CHANGE_REQUESTS_EVENT,
  deleteScheduleChangeRequest,
  getScheduleChangeRequests,
  getRequestRoute,
  isPendingRef,
  refreshScheduleChangeRequests,
  resolveScheduleChangeRequest,
} from "@/lib/schedule/change-requests";
import { syncVacationMonthSheetFromGeneratedSchedule } from "@/lib/vacation/storage";
import {
  applyScheduleAssignmentNameTagsToSchedule,
  formatScheduleAssignmentDisplayName,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER,
  getScheduleAssignmentGeneralDisplayNames,
  getScheduleAssignmentStore,
  getScheduleAssignmentVisibleTripTagMap,
  refreshTeamLeadAssignmentMonth,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR,
  type ScheduleAssignmentDataStore,
  type ScheduleAssignmentVisibleTripTag,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
} from "@/lib/team-lead/storage";
import {
  addManualField,
  addPersonToCategory,
  autoRebalance,
  cycleDayAssignmentNameTag,
  cycleVacationEntryType,
  cloneScheduleState,
  compactGeneratedAssignments,
  formatVacationEntry,
  generateEmptySchedule,
  generateSchedule,
  getCategoryPeople,
  getEffectiveOffByCategory,
  getGeneralTeamOffPeopleForDate,
  getMonthKey,
  getScheduleRange,
  getStartPointerRawIndex,
  getUniquePeople,
  moveAssignmentCategory,
  parseVacationEntry,
  removeAssignmentCategory,
  removePersonFromCategory,
  sanitizeScheduleState,
  setMonthStartPointer,
  swapPersonSlots,
  updateDayAssignmentLabel,
  updateDayHeaderName,
  updateManualAssignment,
} from "@/lib/schedule/engine";
import {
  getPublishedSchedules,
  publishSchedule,
  PublishedScheduleItem,
  refreshPublishedSchedules,
  removePublishedSchedule,
} from "@/lib/schedule/published";
import { PUBLISHED_SCHEDULES_STATUS_EVENT } from "@/lib/schedule/published";
import { CHANGE_REQUESTS_STATUS_EVENT } from "@/lib/schedule/change-requests";
import { readStoredScheduleState, refreshScheduleState, saveScheduleState, SCHEDULE_PERSIST_STATUS_EVENT } from "@/lib/schedule/storage";
import { deskEditableVacationTypes, vacationLegendOrder, vacationStyleTones, vacationTypeLabels } from "@/lib/schedule/vacation-styles";
import { VACATION_STATUS_EVENT } from "@/lib/vacation/storage";
import { CategoryKey, DaySchedule, GeneratedSchedule, MessageState, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef, ScheduleState, SnapshotItem, VacationType } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const ALL_DAYS_EDIT_KEY = "__all_days__";
const FOCUS_REFRESH_THROTTLE_MS = 60_000;
const REQUEST_VISIBLE_STATUSES: ScheduleChangeRequest["status"][] = ["pending", "accepted", "rejected", "rolledBack"];

function getWeekdayLabel(dow: number) {
  return weekdayLabels[(dow + 6) % 7] ?? "";
}

function renderScheduleWeekdayCards(keyPrefix: string) {
  return weekdayLabels.map((label) => {
    const isWeekendLabel = label === "토" || label === "일";
    return (
      <div
        key={`${keyPrefix}-${label}`}
        className="schedule-weekday"
        style={{
          textAlign: "center",
          padding: "6px 4px",
          borderRadius: 12,
          border: isWeekendLabel ? "1px solid rgba(239,68,68,.4)" : "1px solid var(--line)",
          background: isWeekendLabel ? "rgba(239,68,68,.16)" : "rgba(255,255,255,.03)",
          color: isWeekendLabel ? "#ffffff" : undefined,
          fontWeight: 900,
          fontSize: 14,
        }}
      >
        {label}
      </div>
    );
  });
}

function buildWeeklyCalendarItems<T>(
  days: T[],
  leadingPlaceholderCount: number,
  keyPrefix: string,
  renderDay: (day: T) => ReactNode,
) {
  const items: ReactNode[] = [];
  if (days.length === 0) return items;

  let dayIndex = 0;
  let weekIndex = 0;

  while (dayIndex < days.length) {
    items.push(...renderScheduleWeekdayCards(`${keyPrefix}-weekdays-${weekIndex}`));

    for (let weekdayIndex = 0; weekdayIndex < 7; weekdayIndex += 1) {
      if (weekIndex === 0 && weekdayIndex < leadingPlaceholderCount) {
        items.push(
          <div
            key={`${keyPrefix}-leading-placeholder-${weekIndex}-${weekdayIndex}`}
            aria-hidden="true"
            style={{ minHeight: 1 }}
          />,
        );
        continue;
      }

      const day = days[dayIndex];
      if (!day) {
        items.push(
          <div
            key={`${keyPrefix}-trailing-placeholder-${weekIndex}-${weekdayIndex}`}
            aria-hidden="true"
            style={{ minHeight: 1 }}
          />,
        );
        continue;
      }

      items.push(renderDay(day));
      dayIndex += 1;
    }

    weekIndex += 1;
  }

  return items;
}

function getAssignmentChipTag(category: string, name: string, day: DaySchedule) {
  const key = buildScheduleAssignmentNameTagKey(category, name);
  return day.assignmentNameTags?.[key] ?? null;
}

function getAssignmentChipText(name: string, tag: "gov" | "law" | null) {
  return tag ? `${name}${scheduleAssignmentNameTagLabels[tag]}` : name;
}

function getAdjacentMonth(year: number, month: number, offset: number) {
  const date = new Date(year, month - 1 + offset, 1);
  const nextYear = date.getFullYear();
  const nextMonth = date.getMonth() + 1;
  return {
    year: nextYear,
    month: nextMonth,
    monthKey: getMonthKey(nextYear, nextMonth),
  };
}

function isSchedulableMonth(year: number, month: number) {
  const firstYear = SCHEDULE_YEARS[0];
  const lastYear = SCHEDULE_YEARS[SCHEDULE_YEARS.length - 1];
  return year >= firstYear && year <= lastYear && month >= 1 && month <= 12;
}

function formatLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getGeneralTeamOffEffectiveDateKey(schedule: GeneratedSchedule | null) {
  const todayKey = formatLocalDateKey(new Date());

  if (!schedule) {
    return todayKey;
  }

  const ownedDateKeys = schedule.days
    .filter((day) => !day.isOverflowMonth && day.year === schedule.year && day.month === schedule.month)
    .map((day) => day.dateKey)
    .sort((left, right) => left.localeCompare(right));

  const firstOwnedDateKey = ownedDateKeys[0];
  if (!firstOwnedDateKey) {
    return todayKey;
  }

  return todayKey.localeCompare(firstOwnedDateKey) > 0 ? todayKey : firstOwnedDateKey;
}

interface AddPersonDialogState {
  dateKey: string;
  category: string;
  dayLabel: string;
  ownerMonthKey: string;
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

interface OrderOffEditorState {
  categoryKey: CategoryKey;
  selectedNames: string[];
}

interface GlobalOffEditorState {
  selectedNames: string[];
}

interface GeneralTeamOffEditorState {
  selectedNames: string[];
}

type ScheduleDragPayload =
  | { kind: "person"; dateKey: string; category: string; index: number }
  | { kind: "category"; dateKey: string; category: string };

function MessageBox({ message }: { message: MessageState | null }) {
  if (!message?.text) return null;
  return <div className={`status ${message.tone}`}>{message.text}</div>;
}

function dayBadge(day: DaySchedule) {
  if (day.isCustomHoliday || day.isWeekdayHoliday) return "평일 휴일";
  if (day.isHoliday) return "휴일";
  return "";
}

function getCenteredDayLabel(day: DaySchedule) {
  if (day.isWeekend) return "";
  return dayBadge(day);
}

function getDayCardStyle(day: DaySchedule) {
  const isRedDay = day.isWeekend || day.isWeekdayHoliday;
  if (isRedDay) {
    return {
      background: "rgba(248,113,113,.4)",
      border: "1px solid rgba(252,165,165,.5)",
    };
  }
  return {
    background: "rgba(255,255,255,.22)",
    border: "1px solid rgba(255,255,255,.22)",
  };
}

function isManualField(category: string) {
  return ["오프", "국회", "청사", "청와대"].includes(category) || category.startsWith("추가칸");
}

function canOpenManualInput(category: string) {
  return isManualField(category) && category !== "오프";
}

function getCategoryDisplayLabel(day: DaySchedule, category: string) {
  const label = getDayCategoryDisplayLabel(day, category);
  return label === "뉴스대기" ? "뉴스\n대기" : label;
}

const weekdayHolidayVisibleAssignmentOrder = ["조근", "일반", "석근", "야근"] as const;
const weekendVisibleAssignmentOrder = ["주말조근", "주말일반근무", "뉴스대기", "청와대", "국회", "청사", "야근"] as const;
const weekendPersistentCategories = ["청와대", "국회", "청사"] as const;
const weekdayEditPersistentCategories = ["조근", "연장", "석근", "일반", "야근", "제크", "휴가", "국회", "청사", "청와대"] as const;
const weekendEditPersistentCategories = ["주말조근", "주말일반근무", "뉴스대기", "청와대", "국회", "청사", "야근", "휴가"] as const;

function getDayAssignmentSortRank(day: DaySchedule, category: string) {
  const isWeekendLike = day.isWeekend || day.isHoliday;
  if (day.dateKey === "2026-05-01" && category === "야근") {
    return 999;
  }
  if (day.isWeekend) {
    const weekendIndex = weekendVisibleAssignmentOrder.indexOf(category as (typeof weekendVisibleAssignmentOrder)[number]);
    if (weekendIndex >= 0) return weekendIndex;
  }
  if (!day.isWeekend && day.isHoliday) {
    const normalized = getScheduleCategoryLabel(category);
    const holidayIndex = weekdayHolidayVisibleAssignmentOrder.indexOf(
      normalized as (typeof weekdayHolidayVisibleAssignmentOrder)[number],
    );
    if (holidayIndex >= 0) return holidayIndex;
  }
  return getVisibleAssignmentDisplayRank(category, isWeekendLike);
}

function getVisibleDayAssignments(
  day: DaySchedule,
  options?: {
    editMode?: boolean;
    assignmentStore?: ScheduleAssignmentDataStore;
    monthKey?: string | null;
    visibleTripTagMap?: Map<string, ScheduleAssignmentVisibleTripTag>;
  },
) {
  const isWeekendLike = day.isWeekend || day.isHoliday;
  const visibleMap = new Map<string, string[]>();
  const overrideOrder = (day.assignmentOrderOverrides ?? []).filter((category, index, array) => array.indexOf(category) === index);
  const editMode = Boolean(options?.editMode);

  Object.entries(day.assignments).forEach(([category, names]) => {
    if (isWeekendLike) {
      if (!editMode && (category === "휴가" || category === "제크")) return;
    } else if (["국회", "청사", "청와대"].includes(category)) {
      return;
    }
    visibleMap.set(category, names);
  });

  if (editMode) {
    const persistentCategories = day.isWeekend
      ? weekendEditPersistentCategories
      : weekdayEditPersistentCategories;
    persistentCategories.forEach((category) => {
      if (!visibleMap.has(category)) {
        visibleMap.set(category, day.assignments[category] ?? []);
      }
    });
  }

  if (day.isWeekend) {
    weekendPersistentCategories.forEach((category) => {
      if (!visibleMap.has(category)) {
        visibleMap.set(category, day.assignments[category] ?? []);
      }
    });
  }

  const monthKey = options?.monthKey ?? "";
  const dayRows = monthKey ? options?.assignmentStore?.rows[monthKey]?.[day.dateKey] : null;
  if (!editMode && dayRows && options?.assignmentStore) {
    const generalCategory =
      Object.keys(day.assignments).find((category) => isGeneralAssignmentCategory(category)) ??
      (day.isWeekend ? "주말일반근무" : "일반");
    const generalNames = getScheduleAssignmentGeneralDisplayNames(
      day,
      monthKey,
      dayRows,
      options.assignmentStore,
      options.visibleTripTagMap,
    );
    const hasGeneralAddedRow = dayRows.addedRows.some((row) => getScheduleCategoryLabel(row.duty) === "일반");
    const hasGeneralDeletedRow = dayRows.deletedRowKeys.some((rowKey) => {
      const [, category = ""] = rowKey.split("::");
      return getScheduleCategoryLabel(category) === "일반";
    });

    if (generalNames.length > 0 || hasGeneralAddedRow || hasGeneralDeletedRow) {
      visibleMap.set(generalCategory, Array.from(new Set(generalNames)));
    }
  }

  return Array.from(visibleMap.entries()).sort(
    ([leftCategory], [rightCategory]) => {
      const leftOverrideIndex = overrideOrder.indexOf(leftCategory);
      const rightOverrideIndex = overrideOrder.indexOf(rightCategory);
      if (leftOverrideIndex >= 0 || rightOverrideIndex >= 0) {
        if (leftOverrideIndex < 0) return 1;
        if (rightOverrideIndex < 0) return -1;
        if (leftOverrideIndex !== rightOverrideIndex) return leftOverrideIndex - rightOverrideIndex;
      }
      return getDayAssignmentSortRank(day, leftCategory) - getDayAssignmentSortRank(day, rightCategory);
    },
  );
}

function canEditAssignmentLabel(day: DaySchedule, category: string) {
  if (day.manualExtras.includes(category)) return true;
  return ["청와대", "국회", "청사"].includes(category);
}

function parseScheduleDragPayload(value: string): ScheduleDragPayload | null {
  try {
    return JSON.parse(value) as ScheduleDragPayload;
  } catch {
    return null;
  }
}

function isEmptyScheduleSlot(value: string | null | undefined) {
  return !value || value.trim().length === 0;
}

function getEditableSlotNames(names: string[]) {
  const slots = names.map((name) => (typeof name === "string" ? name : ""));
  if (!slots.some((name) => isEmptyScheduleSlot(name))) slots.push("");
  return slots;
}

function cloneDaySchedule(day: DaySchedule): DaySchedule {
  return JSON.parse(JSON.stringify(day)) as DaySchedule;
}

function isSameSelectedSlot(
  left: { dateKey: string; category: string; index: number } | null,
  right: { dateKey: string; category: string; index: number },
) {
  if (!left) return false;
  return left.dateKey === right.dateKey && left.category === right.category && left.index === right.index;
}

function getMondayFirstWeekdayOffset(day?: Pick<DaySchedule, "dow"> | null) {
  if (!day) return 0;
  return day.dow === 0 ? 6 : day.dow - 1;
}

function getOwnedDisplayDays(days: DaySchedule[], previousSchedule?: { nextStartDate: string } | null) {
  if (days.length === 0) return days;
  const firstDateKey = days[0]?.dateKey ?? "";
  const startDateKey =
    previousSchedule?.nextStartDate && firstDateKey
      ? previousSchedule.nextStartDate.localeCompare(firstDateKey) > 0
        ? previousSchedule.nextStartDate
        : firstDateKey
      : previousSchedule?.nextStartDate ?? firstDateKey;
  return days
    .filter((day) => day.dateKey >= startDateKey)
    .map((day) => ({
      ...day,
      isOverflowMonth: false,
    }));
}

function buildVisibleScheduleDays(
  schedule: GeneratedSchedule,
  schedules: GeneratedSchedule[],
  previousSchedule?: { nextStartDate: string } | null,
) {
  const range = getScheduleRange(schedule.year, schedule.month);
  const rangeStartKey = formatLocalDateKey(range.start);
  const rangeEndKey = formatLocalDateKey(range.end);
  const firstDateKey = schedule.days[0]?.dateKey ?? rangeStartKey;
  const startDateKey = [rangeStartKey, firstDateKey, previousSchedule?.nextStartDate ?? ""]
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] ?? rangeStartKey;
  const dayMap = new Map<string, DaySchedule>();

  schedules.forEach((item) => {
    item.days.forEach((day) => {
      if (day.dateKey < startDateKey || day.dateKey > rangeEndKey) return;
      dayMap.set(day.dateKey, cloneDaySchedule(day));
    });
  });

  schedule.days.forEach((day) => {
    if (day.dateKey < startDateKey || day.dateKey > rangeEndKey) return;
    dayMap.set(day.dateKey, cloneDaySchedule(day));
  });

  return Array.from(dayMap.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function getDayOwnerMonthKey(
  dateKey: string,
  visibleSchedule: GeneratedSchedule | null,
  schedules: GeneratedSchedule[],
) {
  if (visibleSchedule?.days.some((day) => day.dateKey === dateKey)) {
    return visibleSchedule.monthKey;
  }

  return schedules.find((schedule) => schedule.days.some((day) => day.dateKey === dateKey))?.monthKey ?? visibleSchedule?.monthKey ?? null;
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

function describeRequestSummary(request: ScheduleChangeRequest) {
  const route = getRequestRoute(request);
  const labels = route.map(
    (ref) => `${ref.name} (${ref.dateKey} · ${getScheduleCategoryLabel(ref.category)})`,
  );
  if (labels.length <= 2) {
    return labels.join(" ↔ ");
  }
  return `${labels.join(" → ")} → ${labels[0]}`;
}

export function ScheduleApp() {
  const [state, setState] = useState<ScheduleState>(defaultScheduleState);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [visibleMonthKey, setVisibleMonthKey] = useState<string | null>(null);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [emptyOverwriteConfirmOpen, setEmptyOverwriteConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishMonthKey, setPublishMonthKey] = useState<string>("");
  const [publishedItems, setPublishedItems] = useState<PublishedScheduleItem[]>([]);
  const [hasPreGenerateBackup, setHasPreGenerateBackup] = useState(false);
  const [originalPreviewSnapshot, setOriginalPreviewSnapshot] = useState<SnapshotItem | null>(null);
  const [requests, setRequests] = useState<ScheduleChangeRequest[]>([]);
  const [addPersonDialog, setAddPersonDialog] = useState<AddPersonDialogState | null>(null);
  const [addPersonName, setAddPersonName] = useState("");
  const [addPersonVacationType, setAddPersonVacationType] = useState<VacationType>("연차");
  const [orderOffEditor, setOrderOffEditor] = useState<OrderOffEditorState | null>(null);
  const [globalOffEditor, setGlobalOffEditor] = useState<GlobalOffEditorState | null>(null);
  const [generalTeamOffEditor, setGeneralTeamOffEditor] = useState<GeneralTeamOffEditorState | null>(null);
  const [isOrderEditMode, setIsOrderEditMode] = useState(false);
  const [isGeneralTeamEditMode, setIsGeneralTeamEditMode] = useState(false);
  const [isGlobalOffEditMode, setIsGlobalOffEditMode] = useState(false);
  const [isGeneralTeamAdding, setIsGeneralTeamAdding] = useState(false);
  const [generalTeamDraftName, setGeneralTeamDraftName] = useState("");
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const addPersonInputRef = useRef<HTMLInputElement | null>(null);
  const generalTeamInputRef = useRef<HTMLInputElement | null>(null);
  const editBackupRef = useRef<ScheduleState | null>(null);
  const preGenerateBackupRef = useRef<ScheduleState | null>(null);
  const printableScheduleRef = useRef<HTMLDivElement | null>(null);
  const isEditingDateRef = useRef(false);
  const lastFocusRefreshAtRef = useRef(0);
  const lastLoadedAssignmentMonthRef = useRef("");
  const session = getSession();
  const isAllDaysEditMode = state.editDateKey === ALL_DAYS_EDIT_KEY;
  const isEditingDate = Boolean(state.editDateKey);
  const activeEditMonthKey = state.editingMonthKey ?? state.generated?.monthKey ?? null;
  const scheduleAssignmentStore = useMemo(() => getScheduleAssignmentStore(), [state.generatedHistory, publishedItems]);

  const markVisibleMonthAsLocallyFresh = (monthKey: string | null | undefined) => {
    lastLoadedAssignmentMonthRef.current = monthKey ?? "";
  };

  const applyNameTagsToState = (input: ScheduleState) => {
    const generated = input.generated ? applyScheduleAssignmentNameTagsToSchedule(input.generated) : null;
    const generatedHistory = input.generatedHistory.map((schedule) => applyScheduleAssignmentNameTagsToSchedule(schedule));
    return {
      ...input,
      generated,
      generatedHistory,
    };
  };

  const resolveRouteMonthKey = (nextState: ScheduleState, preferredMonthKey?: string | null) =>
    preferredMonthKey ??
    visibleMonthKey ??
    nextState.editingMonthKey ??
    nextState.generated?.monthKey ??
    nextState.generatedHistory[nextState.generatedHistory.length - 1]?.monthKey ??
    getMonthKey(nextState.year, nextState.month);

  const syncPublishedItemsFromCache = () => {
    const routeMonthKey = resolveRouteMonthKey(readStoredScheduleState());
    setPublishedItems(
      getPublishedSchedules(routeMonthKey ? [routeMonthKey] : undefined).map((item) => ({
        ...item,
        schedule: applyScheduleAssignmentNameTagsToSchedule(item.schedule),
      })),
    );
  };

  const syncRequestsFromCache = () => {
    setRequests(getScheduleChangeRequests());
  };

  const syncAssignmentDecorationsFromCache = (nextState: ScheduleState) => {
    setState(applyNameTagsToState(nextState));
    syncPublishedItemsFromCache();
  };

  const refreshRouteData = async ({
    includeRequests = true,
    preferredMonthKey,
  }: {
    includeRequests?: boolean;
    preferredMonthKey?: string | null;
  } = {}) => {
    try {
      const nextState = await refreshScheduleState();
      const routeMonthKey = resolveRouteMonthKey(nextState, preferredMonthKey);
      await Promise.all([
        routeMonthKey ? refreshTeamLeadAssignmentMonth(routeMonthKey) : Promise.resolve(),
        refreshPublishedSchedules(routeMonthKey ? { monthKeys: [routeMonthKey], repair: false } : { repair: false }),
        includeRequests
          ? refreshScheduleChangeRequests({
              statuses: REQUEST_VISIBLE_STATUSES,
            })
          : Promise.resolve(),
      ]);
      if (routeMonthKey) {
        // The schedule screen only needs assignment data for the visible month.
        lastLoadedAssignmentMonthRef.current = routeMonthKey;
      }
      editBackupRef.current = null;
      preGenerateBackupRef.current = null;
      setHasPreGenerateBackup(false);
      syncAssignmentDecorationsFromCache(nextState);
      if (includeRequests) {
        syncRequestsFromCache();
      }
      return nextState;
    } catch {
      editBackupRef.current = null;
      preGenerateBackupRef.current = null;
      setHasPreGenerateBackup(false);
      syncAssignmentDecorationsFromCache(readStoredScheduleState() ?? defaultScheduleState);
      if (includeRequests) {
        syncRequestsFromCache();
      }
      return readStoredScheduleState() ?? defaultScheduleState;
    }
  };

  const loadRequests = async () => {
    await refreshScheduleChangeRequests({
      statuses: REQUEST_VISIBLE_STATUSES,
    });
    syncRequestsFromCache();
  };

  const loadPublishedItems = async () => {
    const routeMonthKey = resolveRouteMonthKey(readStoredScheduleState());
    await refreshPublishedSchedules(routeMonthKey ? { monthKeys: [routeMonthKey], repair: false } : { repair: false });
    syncPublishedItemsFromCache();
  };

  useEffect(() => {
    let active = true;
    void refreshRouteData({ includeRequests: true }).finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
      if (active) {
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    void saveScheduleState(state).catch(() => undefined);
  }, [loaded, state]);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };

    window.addEventListener(SCHEDULE_PERSIST_STATUS_EVENT, handleStatus);
    window.addEventListener(PUBLISHED_SCHEDULES_STATUS_EVENT, handleStatus);
    window.addEventListener(CHANGE_REQUESTS_STATUS_EVENT, handleStatus);
    window.addEventListener(VACATION_STATUS_EVENT, handleStatus);

    return () => {
      window.removeEventListener(SCHEDULE_PERSIST_STATUS_EVENT, handleStatus);
      window.removeEventListener(PUBLISHED_SCHEDULES_STATUS_EVENT, handleStatus);
      window.removeEventListener(CHANGE_REQUESTS_STATUS_EVENT, handleStatus);
      window.removeEventListener(VACATION_STATUS_EVENT, handleStatus);
    };
  }, []);

  useEffect(() => {
    if (!session?.username) return;
    setState((current) => {
      if (current.currentUser === session.username) return current;
      return { ...current, currentUser: session.username };
    });
  }, [session?.username]);

  useEffect(() => {
    isEditingDateRef.current = isEditingDate;
  }, [isEditingDate]);

  useEffect(() => {
    const refreshForRouteState = () => {
      if (isEditingDateRef.current) {
        void Promise.all([loadRequests(), loadPublishedItems()]);
        return;
      }
      void refreshRouteData({ includeRequests: true });
    };

    const syncAssignmentState = () => {
      syncAssignmentDecorationsFromCache(readStoredScheduleState() ?? defaultScheduleState);
    };

    const syncRequestState = () => {
      syncRequestsFromCache();
      syncAssignmentDecorationsFromCache(readStoredScheduleState() ?? defaultScheduleState);
    };

    const onFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      refreshForRouteState();
    };

    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(CHANGE_REQUESTS_EVENT, syncRequestState);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncAssignmentState);
    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(CHANGE_REQUESTS_EVENT, syncRequestState);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncAssignmentState);
    };
  }, []);

  useEffect(() => {
    if (!loaded || !visibleMonthKey || lastLoadedAssignmentMonthRef.current === visibleMonthKey) {
      return;
    }

    void refreshRouteData({ includeRequests: true, preferredMonthKey: visibleMonthKey })
      .then(() => {
        lastLoadedAssignmentMonthRef.current = visibleMonthKey;
      })
      .catch(() => undefined);
  }, [loaded, visibleMonthKey]);

  useEffect(() => {
    const hasVisibleMonth = visibleMonthKey
      ? state.generatedHistory.some((item) => item.monthKey === visibleMonthKey)
      : false;
    if (hasVisibleMonth) return;
    if (state.generated?.monthKey) {
      setVisibleMonthKey(state.generated.monthKey);
      return;
    }
    if (state.generatedHistory.length > 0) {
      setVisibleMonthKey(state.generatedHistory[state.generatedHistory.length - 1].monthKey);
      return;
    }
    setVisibleMonthKey(null);
  }, [state.generated, state.generatedHistory, visibleMonthKey]);

  useEffect(() => {
    if (!addPersonDialog) return;
    addPersonInputRef.current?.focus();
    addPersonInputRef.current?.select();
  }, [addPersonDialog]);

  useEffect(() => {
    if (!isGeneralTeamAdding) return;
    generalTeamInputRef.current?.focus();
    generalTeamInputRef.current?.select();
  }, [isGeneralTeamAdding]);

  useEffect(() => {
    if (!addPersonDialog) return;
    if (activeEditMonthKey === addPersonDialog.ownerMonthKey && (isAllDaysEditMode || state.editDateKey === addPersonDialog.dateKey)) return;
    setAddPersonDialog(null);
    setAddPersonName("");
  }, [activeEditMonthKey, addPersonDialog, isAllDaysEditMode, state.editDateKey]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setIsCoarsePointer(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const uniquePeople = useMemo(() => getUniquePeople(state), [state]);
  const generalTeamPeople = useMemo(
    () => (state.generalTeamPeople.length > 0 ? state.generalTeamPeople : GENERAL_TEAM_DEFAULT_NAMES.map((name) => name.trim()).filter(Boolean)),
    [state.generalTeamPeople],
  );
  const globalOffPool = useMemo(
    () =>
      state.globalOffPool.length > 0
        ? state.globalOffPool
        : Array.from(new Set([...uniquePeople, ...state.offPeople.map((name) => name.trim()).filter(Boolean)])),
    [state.globalOffPool, state.offPeople, uniquePeople],
  );
  const totalCount = uniquePeople.length;
  const targetMonthKey = useMemo(() => getMonthKey(state.year, state.month), [state.month, state.year]);
  const visibleSchedule = useMemo(() => {
    if (state.generatedHistory.length === 0) return state.generated;
    return state.generatedHistory.find((item) => item.monthKey === visibleMonthKey) ?? state.generatedHistory[state.generatedHistory.length - 1];
  }, [state.generated, state.generatedHistory, visibleMonthKey]);
  const generalTeamOffEffectiveDateKey = useMemo(() => getGeneralTeamOffEffectiveDateKey(visibleSchedule), [visibleSchedule]);
  const effectiveGeneralTeamOffPeople = useMemo(
    () => getGeneralTeamOffPeopleForDate(state, generalTeamOffEffectiveDateKey),
    [generalTeamOffEffectiveDateKey, state],
  );
  const visibleMonthTabs = useMemo(
    () => (state.generatedHistory.length > 0 ? state.generatedHistory : visibleSchedule ? [visibleSchedule] : []),
    [state.generatedHistory, visibleSchedule],
  );
  const visibleTripTagMap = useMemo(
    () => getScheduleAssignmentVisibleTripTagMap(visibleMonthTabs, scheduleAssignmentStore),
    [scheduleAssignmentStore, visibleMonthTabs],
  );
  const originalSnapshotEntries = useMemo(
    () =>
      Object.keys(state.snapshots)
        .map((monthKey) => ({ monthKey, snapshot: (state.snapshots[monthKey] ?? [])[0] ?? null }))
        .filter((item): item is { monthKey: string; snapshot: SnapshotItem } => Boolean(item.snapshot))
        .sort((left, right) => right.monthKey.localeCompare(left.monthKey)),
    [state.snapshots],
  );
  const previousVisibleSchedule = useMemo(() => {
    if (!visibleSchedule) return null;
    const index = state.generatedHistory.findIndex((item) => item.monthKey === visibleSchedule.monthKey);
    if (index <= 0) return null;
    return state.generatedHistory[index - 1] ?? null;
  }, [state.generatedHistory, visibleSchedule]);
  const previousOriginalSchedule = useMemo(() => {
    if (!originalPreviewSnapshot) return null;
    const index = state.generatedHistory.findIndex((item) => item.monthKey === originalPreviewSnapshot.generated.monthKey);
    if (index <= 0) return null;
    return state.generatedHistory[index - 1] ?? null;
  }, [originalPreviewSnapshot, state.generatedHistory]);
  const visibleDays = useMemo(
    () => (visibleSchedule ? buildVisibleScheduleDays(visibleSchedule, state.generatedHistory, previousVisibleSchedule) : []),
    [previousVisibleSchedule, state.generatedHistory, visibleSchedule],
  );
  const visibleLeadingPlaceholderCount = useMemo(
    () => getMondayFirstWeekdayOffset(visibleDays[0]),
    [visibleDays],
  );
  const visibleDayOwnerMonthKeyMap = useMemo(
    () =>
      new Map(
        visibleDays.map((day) => [
          day.dateKey,
          getDayOwnerMonthKey(day.dateKey, visibleSchedule, state.generatedHistory),
        ] as const),
      ),
    [state.generatedHistory, visibleDays, visibleSchedule],
  );
  const originalVisibleDays = useMemo(
    () =>
      originalPreviewSnapshot
        ? getOwnedDisplayDays(originalPreviewSnapshot.generated.days, previousOriginalSchedule)
        : [],
    [originalPreviewSnapshot, previousOriginalSchedule],
  );
  const originalLeadingPlaceholderCount = useMemo(
    () => getMondayFirstWeekdayOffset(originalVisibleDays[0]),
    [originalVisibleDays],
  );
  const visiblePublishedItem = useMemo(
    () => publishedItems.find((item) => item.monthKey === visibleSchedule?.monthKey) ?? null,
    [publishedItems, visibleSchedule?.monthKey],
  );
  const hasUnpublishedChanges = useMemo(() => {
    if (!visibleSchedule || !visiblePublishedItem) return false;
    return JSON.stringify(visibleSchedule) !== JSON.stringify(visiblePublishedItem.schedule);
  }, [visiblePublishedItem, visibleSchedule]);
  const visibleIndex = visibleSchedule ? state.generatedHistory.findIndex((item) => item.monthKey === visibleSchedule.monthKey) : -1;
  const targetHasExistingMonth = useMemo(
    () => state.generatedHistory.some((item) => item.monthKey === targetMonthKey),
    [state.generatedHistory, targetMonthKey],
  );
  const previousTargetMonth = useMemo(() => getAdjacentMonth(state.year, state.month, -1), [state.month, state.year]);
  const generationBlockedReason = useMemo(() => {
    if (state.generatedHistory.length === 0) return null;
    if (targetHasExistingMonth) return null;
    if (!isSchedulableMonth(previousTargetMonth.year, previousTargetMonth.month)) return null;
    const hasPreviousMonth = state.generatedHistory.some((item) => item.monthKey === previousTargetMonth.monthKey);
    if (hasPreviousMonth) return null;
    return `${previousTargetMonth.year}년 ${previousTargetMonth.month}월 근무표를 먼저 작성해야 ${state.year}년 ${state.month}월 근무표를 작성할 수 있습니다.`;
  }, [previousTargetMonth, state.generatedHistory, state.month, state.year, targetHasExistingMonth]);
  const pendingRequests = useMemo(
    () => requests.filter((item) => item.status === "pending"),
    [requests],
  );
  const resolvedRequests = useMemo(
    () => requests.filter((item) => item.status !== "pending"),
    [requests],
  );

  const printVisibleSchedule = () => {
    if (!visibleSchedule) return;
    const printTitle = `${visibleSchedule.month}월 근무표`;
    printHtmlDocument({
      title: printTitle,
      bodyHtml: renderSchedulePrintHtml({
        title: printTitle,
        days: visibleDays,
      }),
    });
  };

  const getOriginalSnapshotPrintDays = (snapshot: SnapshotItem) => {
    const previousMonth = getAdjacentMonth(snapshot.generated.year, snapshot.generated.month, -1);
    const previousSchedule = state.generatedHistory.find((item) => item.monthKey === previousMonth.monthKey) ?? null;
    return getOwnedDisplayDays(snapshot.generated.days, previousSchedule);
  };

  const printOriginalSnapshot = (snapshot: SnapshotItem) => {
    const printTitle = `${snapshot.generated.month}월 원본`;
    printHtmlDocument({
      title: printTitle,
      bodyHtml: renderSchedulePrintHtml({
        title: printTitle,
        days: getOriginalSnapshotPrintDays(snapshot),
      }),
    });
  };

  const updateEditingState = (recipe: (current: ScheduleState) => ScheduleState) => {
    setState((current) => {
      const editingMonthKey = current.editingMonthKey;
      const preparedState =
        editingMonthKey && current.generated?.monthKey !== editingMonthKey
          ? (() => {
              const editingSchedule = current.generatedHistory.find((item) => item.monthKey === editingMonthKey);
              if (!editingSchedule) return current;
              const editingScheduleClone = JSON.parse(JSON.stringify(editingSchedule));
              return {
                ...current,
                generated: editingScheduleClone,
                generatedHistory: current.generatedHistory.map((item) =>
                  item.monthKey === editingScheduleClone.monthKey ? editingScheduleClone : item,
                ),
              };
            })()
          : current;

      return sanitizeScheduleState(recipe(preparedState));
    });
  };

  const applyScheduleTargetMonth = (year: number, month: number) => {
    const monthKey = getMonthKey(year, month);
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        year,
        month,
        extraHolidays: "",
      }),
    );
    setVisibleMonthKey((current) =>
      state.generatedHistory.some((item) => item.monthKey === monthKey) ? monthKey : current,
    );
  };

  const handlePersonSlotActivate = (ref: { dateKey: string; category: string; index: number }) => {
    updateEditingState((current) => {
      if (!current.editDateKey) return current;
      if (!current.selectedPerson) {
        return { ...current, selectedPerson: ref };
      }
      if (isSameSelectedSlot(current.selectedPerson, ref)) {
        return { ...current, selectedPerson: null };
      }
      return swapPersonSlots(current, current.selectedPerson, ref);
    });
  };

  const handleBlankSlotActivate = (ref: { dateKey: string; category: string; index: number }) => {
    updateEditingState((current) => {
      if (!current.editDateKey || !current.selectedPerson) return current;
      return swapPersonSlots(current, current.selectedPerson, ref);
    });
  };

  const closeAddPersonDialog = () => {
    setAddPersonDialog(null);
    setAddPersonName("");
  };

  const startOrderOffEdit = (categoryKey: CategoryKey) => {
    setOrderOffEditor({
      categoryKey,
      selectedNames: getEffectiveOffByCategory(state, categoryKey),
    });
  };

  const cancelOrderOffEdit = () => {
    setOrderOffEditor(null);
  };

  const startGlobalOffEdit = () => {
    setGlobalOffEditor({
      selectedNames: [...state.offPeople],
    });
    setIsGlobalOffEditMode(true);
  };

  const cancelGlobalOffEdit = () => {
    setGlobalOffEditor(null);
    setIsGlobalOffEditMode(false);
  };

  const startGeneralTeamOffEdit = () => {
    setGeneralTeamOffEditor({
      selectedNames: [...effectiveGeneralTeamOffPeople],
    });
    setIsGeneralTeamEditMode(true);
  };

  const cancelGeneralTeamOffEdit = () => {
    setGeneralTeamOffEditor(null);
    setIsGeneralTeamEditMode(false);
    setIsGeneralTeamAdding(false);
    setGeneralTeamDraftName("");
  };

  const toggleOrderEditMode = () => {
    setIsOrderEditMode((current) => {
      const next = !current;
      if (!next) {
        setOrderOffEditor(null);
      }
      return next;
    });
  };

  const appendGeneralTeamPerson = (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        generalTeamPeople: Array.from(
          new Set([...(current.generalTeamPeople.length > 0 ? current.generalTeamPeople : GENERAL_TEAM_DEFAULT_NAMES), trimmed]),
        ),
      }),
    );
    setGeneralTeamDraftName("");
    setIsGeneralTeamAdding(false);
  };

  const removeGeneralTeamPerson = (name: string) => {
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        generalTeamPeople: (current.generalTeamPeople.length > 0 ? current.generalTeamPeople : GENERAL_TEAM_DEFAULT_NAMES).filter((item) => item !== name),
        generalTeamOffPeople: current.generalTeamOffPeople.filter((item) => item !== name),
        generalTeamOffPeopleByDate: Object.fromEntries(
          Object.entries(current.generalTeamOffPeopleByDate ?? {}).map(([dateKey, names]) => [
            dateKey,
            names.filter((item) => item !== name),
          ]),
        ),
      }),
    );
    setGeneralTeamOffEditor((current) => (current ? { ...current, selectedNames: current.selectedNames.filter((item) => item !== name) } : current));
  };

  const appendGlobalOffPoolPerson = () => {
    const name = window.prompt("기본 오프 인원 목록에 추가할 이름을 입력하세요.");
    const trimmed = name?.trim() ?? "";
    if (!trimmed) return;
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        globalOffPool: Array.from(
          new Set([
            ...(current.globalOffPool.length > 0
              ? current.globalOffPool
              : Array.from(new Set([...getUniquePeople(current), ...current.offPeople.map((item) => item.trim()).filter(Boolean)]))),
            trimmed,
          ]),
        ),
      }),
    );
  };

  const removeGlobalOffPoolPerson = (name: string) => {
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        globalOffPool: (current.globalOffPool.length > 0
          ? current.globalOffPool
          : Array.from(new Set([...getUniquePeople(current), ...current.offPeople.map((item) => item.trim()).filter(Boolean)]))).filter((item) => item !== name),
        offPeople: current.offPeople.filter((item) => item !== name),
      }),
    );
    setGlobalOffEditor((current) => (current ? { ...current, selectedNames: current.selectedNames.filter((item) => item !== name) } : current));
  };

  const saveOrderOffEdit = () => {
    if (!orderOffEditor) return;
    const startName = state.monthStartNames[targetMonthKey]?.[orderOffEditor.categoryKey]?.trim();
    const nextSelectedNames = startName
      ? orderOffEditor.selectedNames.filter((name) => name !== startName)
      : orderOffEditor.selectedNames;
    const globalOffSet = new Set((state.offPeople ?? []).map((name) => name.trim()).filter(Boolean));
    const categoryOff = nextSelectedNames.filter((name) => !globalOffSet.has(name));
    const excluded = (state.offPeople ?? []).filter((name) => !nextSelectedNames.includes(name));
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        offByCategory: {
          ...current.offByCategory,
          [orderOffEditor.categoryKey]: [...categoryOff],
        },
        offExcludeByCategory: {
          ...current.offExcludeByCategory,
          [orderOffEditor.categoryKey]: [...excluded],
        },
      }),
    );
    setOrderOffEditor(null);
    setMessage({
      tone: "ok",
      text: startName && nextSelectedNames.length !== orderOffEditor.selectedNames.length
        ? `해당 근무유형 오프를 저장했습니다. 시작점 ${startName}은 오프에서 제외했습니다.`
        : "해당 근무유형 오프를 저장했습니다.",
    });
  };

  const saveGlobalOffEdit = () => {
    if (!globalOffEditor) return;
    const nextGlobalOff = Array.from(new Set(globalOffEditor.selectedNames.map((name) => name.trim()).filter(Boolean)));
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        offPeople: nextGlobalOff,
      }),
    );
    setGlobalOffEditor(null);
    setIsGlobalOffEditMode(false);
    setMessage({ tone: "ok", text: "기본 오프 인원을 저장했습니다." });
  };

  const saveGeneralTeamOffEdit = () => {
    if (!generalTeamOffEditor) return;
    const nextGeneralTeamOff = Array.from(
      new Set(
        generalTeamOffEditor.selectedNames
          .map((name) => name.trim())
          .filter((name) => name && generalTeamPeople.includes(name)),
      ),
    );
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        generalTeamOffPeople: nextGeneralTeamOff,
        generalTeamOffPeopleByDate: {
          ...(current.generalTeamOffPeopleByDate ?? {}),
          [generalTeamOffEffectiveDateKey]: nextGeneralTeamOff,
        },
      }),
    );
    setGeneralTeamOffEditor(null);
    setIsGeneralTeamEditMode(false);
    setIsGeneralTeamAdding(false);
    setGeneralTeamDraftName("");
    setMessage({ tone: "ok", text: "일반조 오프 인원을 저장했습니다." });
  };

  const submitAddPerson = () => {
    if (!addPersonDialog || !isEditingDate) return;
    const trimmed = addPersonName.trim();
    if (!trimmed) return;
    const value =
      addPersonDialog.category === "휴가"
        ? formatVacationEntry(addPersonVacationType, trimmed)
        : trimmed;
    updateEditingState((current) => addPersonToCategory(current, addPersonDialog.dateKey, addPersonDialog.category, value));
    setAddPersonName("");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        addPersonInputRef.current?.focus();
        addPersonInputRef.current?.select();
      });
    }
  };

  const startDayEdit = (dateKey: string, ownerMonthKey?: string | null) => {
    flushSync(() => {
      setState((current) =>
        {
          if (current.editDateKey) return current;
          const targetMonthKey = ownerMonthKey ?? visibleMonthKey;
          const sourceSchedule =
            current.generatedHistory.find((item) => item.monthKey === (targetMonthKey ?? "")) ??
            current.generated ??
            current.generatedHistory[current.generatedHistory.length - 1] ??
            null;
          if (!sourceSchedule) return current;

          editBackupRef.current = cloneScheduleState(current);
          isEditingDateRef.current = true;
          const visibleScheduleClone = JSON.parse(JSON.stringify(sourceSchedule));
          return sanitizeScheduleState({
            ...current,
            generated: visibleScheduleClone,
            generatedHistory: current.generatedHistory.map((item) =>
              item.monthKey === visibleScheduleClone.monthKey ? visibleScheduleClone : item,
            ),
            editDateKey: dateKey,
            editingMonthKey: visibleScheduleClone.monthKey,
            selectedPerson: null,
          });
        },
      );
    });
    closeAddPersonDialog();
  };

  const startAllDaysEdit = () => {
    flushSync(() => {
      setState((current) =>
        {
          if (current.editDateKey) return current;
          const sourceSchedule =
            current.generatedHistory.find((item) => item.monthKey === (visibleMonthKey ?? "")) ??
            current.generated ??
            current.generatedHistory[current.generatedHistory.length - 1] ??
            null;
          if (!sourceSchedule) return current;

          editBackupRef.current = cloneScheduleState(current);
          isEditingDateRef.current = true;
          const visibleScheduleClone = JSON.parse(JSON.stringify(sourceSchedule));
          return sanitizeScheduleState({
            ...current,
            generated: visibleScheduleClone,
            generatedHistory: current.generatedHistory.map((item) =>
              item.monthKey === visibleScheduleClone.monthKey ? visibleScheduleClone : item,
            ),
            editDateKey: ALL_DAYS_EDIT_KEY,
            editingMonthKey: visibleScheduleClone.monthKey,
            selectedPerson: null,
          });
        },
      );
    });
    closeAddPersonDialog();
  };

  const cancelDayEdit = () => {
    const backup = editBackupRef.current ? cloneScheduleState(editBackupRef.current) : null;
    isEditingDateRef.current = false;
    flushSync(() => {
      setState((current) =>
        sanitizeScheduleState(
          backup ?? {
            ...current,
            editDateKey: null,
            editingMonthKey: null,
            selectedPerson: null,
          },
        ),
      );
    });
    editBackupRef.current = null;
    closeAddPersonDialog();
  };

  const confirmDayEdit = () => {
    if (!isEditingDate) return;
    const messageText = isAllDaysEditMode ? "근무표 수정 내용이 반영되었습니다." : "날짜 수정 내용이 반영되었습니다.";
    isEditingDateRef.current = false;
    flushSync(() => {
      setState((current) =>
        sanitizeScheduleState({
          ...compactGeneratedAssignments(current),
          editDateKey: null,
          editingMonthKey: null,
          selectedPerson: null,
        }),
      );
    });
    editBackupRef.current = null;
    closeAddPersonDialog();
    setMessage({ tone: "ok", text: messageText });
  };

  const saveCurrent = () => {
    if (!uniquePeople.length) {
      setMessage({ tone: "warn", text: "최소 한 칸 이상 이름을 입력해 주세요." });
      return false;
    }
    setMessage({ tone: "ok", text: "저장되었습니다. 입력값과 오프 상태를 유지합니다." });
    return true;
  };

  const onGenerate = () => {
    if (!saveCurrent()) return;
    if (generationBlockedReason) {
      setMessage({ tone: "warn", text: generationBlockedReason });
      return;
    }
    if (targetHasExistingMonth) {
      setOverwriteConfirmOpen(true);
      return;
    }
    preGenerateBackupRef.current = cloneScheduleState(state);
    setHasPreGenerateBackup(true);
    const result = generateSchedule(state);
    const nextState = sanitizeScheduleState(result.state);
    if (nextState.generated) {
      syncVacationMonthSheetFromGeneratedSchedule(nextState.generated);
    }
    markVisibleMonthAsLocallyFresh(nextState.generated?.monthKey ?? null);
    setState(nextState);
    setVisibleMonthKey(nextState.generated?.monthKey ?? null);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const onGenerateEmpty = () => {
    if (!saveCurrent()) return;
    if (generationBlockedReason) {
      setMessage({ tone: "warn", text: generationBlockedReason });
      return;
    }
    if (targetHasExistingMonth) {
      setEmptyOverwriteConfirmOpen(true);
      return;
    }
    preGenerateBackupRef.current = cloneScheduleState(state);
    setHasPreGenerateBackup(true);
    const result = generateEmptySchedule(state);
    markVisibleMonthAsLocallyFresh(result.state.generated?.monthKey ?? null);
    setState(result.state);
    setVisibleMonthKey(result.state.generated?.monthKey ?? null);
    setMessage({ tone: "ok", text: result.message });
  };

  const confirmGenerate = () => {
    setOverwriteConfirmOpen(false);
    preGenerateBackupRef.current = cloneScheduleState(state);
    setHasPreGenerateBackup(true);
    const result = generateSchedule(state);
    const nextState = sanitizeScheduleState(result.state);
    if (nextState.generated) {
      syncVacationMonthSheetFromGeneratedSchedule(nextState.generated);
    }
    markVisibleMonthAsLocallyFresh(nextState.generated?.monthKey ?? null);
    setState(nextState);
    setVisibleMonthKey(nextState.generated?.monthKey ?? null);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const confirmGenerateEmpty = () => {
    setEmptyOverwriteConfirmOpen(false);
    preGenerateBackupRef.current = cloneScheduleState(state);
    setHasPreGenerateBackup(true);
    const result = generateEmptySchedule(state);
    markVisibleMonthAsLocallyFresh(result.state.generated?.monthKey ?? null);
    setState(result.state);
    setVisibleMonthKey(result.state.generated?.monthKey ?? null);
    setMessage({ tone: "ok", text: result.message });
  };

  const handleScheduleMonthContextChange = (nextYear: number, nextMonth: number) => {
    const nextMonthKey = getMonthKey(nextYear, nextMonth);
    setState((current) => ({
      ...current,
      year: nextYear,
      month: nextMonth,
      extraHolidays: "",
    }));
    setVisibleMonthKey(nextMonthKey);
  };

  const onRebalance = () => {
    if (!visibleSchedule) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`${visibleSchedule.month}월 근무표를 재배치하겠습니까?`)
    ) {
      return;
    }
    const targetSchedule = JSON.parse(JSON.stringify(visibleSchedule));
    const workingState = sanitizeScheduleState({
      ...state,
      generated: targetSchedule,
      generatedHistory: state.generatedHistory.map((item) =>
        item.monthKey === visibleSchedule.monthKey ? targetSchedule : item,
      ),
    });
    const result = autoRebalance(workingState);
    markVisibleMonthAsLocallyFresh(visibleSchedule.monthKey);
    setState(result.state);
    setVisibleMonthKey(visibleSchedule.monthKey);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const confirmDeleteSchedule = () => {
    if (!visibleSchedule) return;
    const deletedMonthKey = visibleSchedule.monthKey;
    const nextHistory = state.generatedHistory.filter((item) => item.monthKey !== deletedMonthKey);
    const nextVisible = nextHistory[visibleIndex - 1] ?? nextHistory[visibleIndex] ?? nextHistory[nextHistory.length - 1] ?? null;
    const nextState = sanitizeScheduleState({
      ...state,
      generatedHistory: nextHistory,
      generated: state.generated?.monthKey === deletedMonthKey ? nextVisible : state.generated,
      snapshots: Object.fromEntries(
        Object.entries(state.snapshots).filter(([monthKey]) => monthKey !== deletedMonthKey),
      ),
      editDateKey: state.editingMonthKey === deletedMonthKey ? null : state.editDateKey,
      editingMonthKey: state.editingMonthKey === deletedMonthKey ? null : state.editingMonthKey,
      selectedPerson: null,
    });

    setState(nextState);
    if (publishedItems.some((item) => item.monthKey === deletedMonthKey)) {
      removePublishedSchedule(deletedMonthKey);
      setPublishedItems((current) => current.filter((item) => item.monthKey !== deletedMonthKey));
    }
    markVisibleMonthAsLocallyFresh(nextVisible?.monthKey ?? null);
    setVisibleMonthKey(nextVisible?.monthKey ?? null);
    setDeleteConfirmOpen(false);
    closeAddPersonDialog();
    editBackupRef.current = null;
    setMessage({ tone: "ok", text: `${visibleSchedule.year}년 ${visibleSchedule.month}월 근무표를 삭제했습니다.` });
  };

  const confirmPublish = async () => {
    const target = state.generatedHistory.find((item) => item.monthKey === publishMonthKey);
    if (!target) return;
    try {
      const published = await publishSchedule(target);
      await loadPublishedItems();
      setPublishOpen(false);
      setMessage({ tone: "ok", text: `${published.title}를 홈화면에 게시했습니다.` });
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "근무표 게시에 실패했습니다.",
      });
    }
  };

  const onRestorePreviousSchedule = () => {
    if (!preGenerateBackupRef.current) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("작성 직전의 근무표로 되돌리시겠습니까? 지금 상태는 덮어써집니다.")
    ) {
      return;
    }

    const backup = cloneScheduleState(preGenerateBackupRef.current);

    setState((current) =>
      sanitizeScheduleState(backup)
    );
    if (backup.generated) {
      syncVacationMonthSheetFromGeneratedSchedule(backup.generated);
    }
    markVisibleMonthAsLocallyFresh(backup.generated?.monthKey ?? null);
    setVisibleMonthKey(backup.generated?.monthKey ?? null);
    preGenerateBackupRef.current = null;
    setHasPreGenerateBackup(false);
    setMessage({ tone: "ok", text: "작성 직전의 근무표로 복원했습니다." });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button className="btn white" disabled={isEditingDate} onClick={onGenerate}>작성</button>
            <button className="btn" disabled={isEditingDate} onClick={onGenerateEmpty}>빈 근무표 작성</button>
            <button className="btn" disabled={isEditingDate} onClick={onRebalance}>자동 재배치</button>
            <button className="btn" disabled={isEditingDate || !visibleSchedule} onClick={() => setDeleteConfirmOpen(true)}>삭제</button>
            <button className="btn" onClick={() => {
              setPublishMonthKey(visibleSchedule?.monthKey ?? state.generatedHistory[state.generatedHistory.length - 1]?.monthKey ?? "");
              setPublishOpen(true);
            }} disabled={isEditingDate}>
              근무표 게시
            </button>
            <button className="btn" disabled={isEditingDate || !hasPreGenerateBackup} onClick={onRestorePreviousSchedule}>
              직전 근무표 복원
            </button>
            <ScheduleManagementLinks inline />
            {hasUnpublishedChanges ? <span style={{ color: "#fecaca", fontSize: 13, fontWeight: 800 }}>수정사항이 있습니다. 다시 게시하세요</span> : null}
          </div>
          {isEditingDate ? <div className="status note">{isAllDaysEditMode ? "근무표 전체 수정 중입니다. 수정 완료 또는 취소 후 다른 작업을 진행해 주세요." : "날짜 수정 중입니다. 확인 또는 취소 후 다른 작업을 진행해 주세요."}</div> : null}
          {isAllDaysEditMode && !isCoarsePointer ? <div className="status note">수정 모드에서는 이름칩을 다른 이름칩 위에 놓아 1:1로 교환하고, 근무유형칸은 다른 칸 위에 놓아 순서를 밀어내며 재배치할 수 있습니다.</div> : null}
          {isEditingDate && isCoarsePointer ? <div className="status note">모바일에서는 이름을 먼저 누른 뒤, 다른 이름이나 빈칸을 눌러 자리를 교환할 수 있습니다.</div> : null}
          {overwriteConfirmOpen ? (
            <div className="status warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>이미 작성된 {state.month}월 근무표가 있습니다. 다시 작성하시겠습니까?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmGenerate}>작성</button>
                <button className="btn" onClick={() => setOverwriteConfirmOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
          {emptyOverwriteConfirmOpen ? (
            <div className="status warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>이미 작성된 {state.month}월 근무표가 있습니다. 빈 근무표로 다시 작성하시겠습니까?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmGenerateEmpty}>빈 근무표 작성</button>
                <button className="btn" onClick={() => setEmptyOverwriteConfirmOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
          {deleteConfirmOpen && visibleSchedule ? (
            <div className="status warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>{visibleSchedule.year}년 {visibleSchedule.month}월 근무표를 반드시 삭제하시겠습니까?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmDeleteSchedule}>삭제</button>
                <button className="btn" onClick={() => setDeleteConfirmOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
          {generationBlockedReason ? <div className="status warn">{generationBlockedReason}</div> : null}
          {publishOpen ? (
            <div className="status note" style={{ display: "grid", gap: 12 }}>
              <strong>게시할 근무표를 선택하세요</strong>
              <select className="field-select" value={publishMonthKey} onChange={(e) => setPublishMonthKey(e.target.value)}>
                {state.generatedHistory.map((item) => (
                  <option key={item.monthKey} value={item.monthKey}>
                    {item.year}년 {item.month}월
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmPublish}>확인</button>
                <button className="btn" onClick={() => setPublishOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="subgrid-2">
        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="chip">근무표 설정</div>
          <div className="status note" style={{ display: "none" }}>
            ?곗옣? 二??⑥쐞濡??좎??⑸땲?? ??二쇱뿉 戮묓엺 4紐낆씠 ?붿슂?쇰???湲덉슂?쇨퉴吏 媛숆퀬, ?붾쭚??二쇱쨷???앸굹硫?洹?二??쇱슂?쇨퉴吏 ?먮룞 ?앹꽦?⑸땲??
            ?됱씪 ?댁씪???낅젰???좎쭨??`議곌렐 / ?쇰컲 / ?앷렐 / ?쇨렐 / 援?쉶` 移몃쭔 留뚮뱾怨?諛곗튂???섏? ?딆뒿?덈떎.
          </div>
          <div className="status note">
            연장은 주 단위로 묶여 배정됩니다. 한 주에 4명을 먼저 잡고, 휴가나 오프가 있으면 그 주 안에서 다시 맞춥니다.
            평일 휴일로 입력한 날짜는 휴일 기준 칸 순서로 보여 주고, 주말은 `조근 / 일반 / 뉴스대기 / 청와대 / 국회 / 청사 / 야근` 순서를 유지합니다.
          </div>
          <div className="subgrid-2">
            <label>
              <div style={{ marginBottom: 8 }}>연도</div>
              <select
                className="field-select"
                disabled={isEditingDate}
                value={state.year}
                onChange={(e) => handleScheduleMonthContextChange(Number(e.target.value), state.month)}
              >
                {SCHEDULE_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 8 }}>월</div>
              <select
                className="field-select"
                disabled={isEditingDate}
                value={state.month}
                onChange={(e) => handleScheduleMonthContextChange(state.year, Number(e.target.value))}
              >
                {SCHEDULE_MONTHS.map((month) => (
                  <option key={month} value={month}>
                    {month}월
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <div style={{ marginBottom: 8 }}>평일 휴일</div>
            <textarea
              className="field-textarea"
              disabled={isEditingDate}
              value={state.extraHolidays}
              onChange={(e) => setState((current) => ({ ...current, extraHolidays: e.target.value }))}
              placeholder="1,2,3 같은 숫자로만 입력."
            />
          </label>
            <MessageBox message={message} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div className="chip">근무 수정 요청</div>
            <div style={{ display: "grid", gap: 16 }}>
                {pendingRequests.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {pendingRequests.map((request) => (
                      <div
                        key={request.id}
                        style={{
                          display: "grid",
                          gap: 10,
                          padding: 12,
                          borderRadius: 16,
                          border: "1px solid var(--line)",
                          background: "rgba(255,255,255,.05)",
                        }}
                      >
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong>{request.requesterName}</strong>
                          <span className="muted">{describeRequestSummary(request)}</span>
                          {request.hasConflictWarning ? (
                            <span style={{ color: "#fbbf24", fontWeight: 800, fontSize: 12 }}>
                              변경시 충돌이 발생합니다.
                            </span>
                          ) : null}
                          <span className="muted">{request.createdAt}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            className="btn primary"
                            onClick={() => {
                              void (async () => {
                                const result = await resolveScheduleChangeRequest(request.id, "accepted", session?.username ?? "관리자");
                                await refreshRouteData({ includeRequests: true });
                                if (!result.ok) {
                                  setMessage({ tone: "warn", text: "근무 변경 요청 승인에 실패했습니다." });
                                  return;
                                }
                                setMessage({
                                  tone: result.applied ? "ok" : "warn",
                                  text: result.applied
                                    ? "근무 변경 요청을 승인했고 적용 기록도 저장했습니다."
                                    : "근무 변경 요청은 승인했지만 실제 반영은 실패했습니다.",
                                });
                              })();
                            }}
                          >
                            승인
                          </button>
                          <button
                            className="btn"
                            onClick={() => {
                              void (async () => {
                                const result = await resolveScheduleChangeRequest(request.id, "rejected", session?.username ?? "관리자");
                                await loadRequests();
                                if (!result.ok) {
                                  setMessage({ tone: "warn", text: "근무 변경 요청 거절에 실패했습니다." });
                                  return;
                                }
                                setMessage({ tone: "note", text: "근무 변경 요청을 거절했습니다." });
                              })();
                            }}
                          >
                            거절
                          </button>
                          <button
                            className="btn"
                            onClick={() => {
                              const ok = window.confirm("이 근무 수정 요청을 삭제하시겠습니까?");
                              if (!ok) return;
                              void (async () => {
                                const result = await deleteScheduleChangeRequest(request.id);
                                await loadRequests();
                                if (!result.ok) {
                                  setMessage({ tone: "warn", text: "근무 변경 요청 삭제에 실패했습니다." });
                                  return;
                                }
                                setMessage({ tone: "note", text: "근무 변경 요청을 삭제했습니다." });
                              })();
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="status note">현재 대기 중인 근무 수정 요청이 없습니다.</div>
                )}

                <div style={{ display: "grid", gap: 10 }}>
                  <strong>처리 기록</strong>
                  {resolvedRequests.length > 0 ? (
                    resolvedRequests.map((request) => (
                      <div
                        key={`history-${request.id}`}
                        style={{
                          display: "grid",
                          gap: 10,
                          padding: 12,
                          borderRadius: 16,
                          border: "1px solid var(--line)",
                          background: "rgba(255,255,255,.03)",
                        }}
                      >
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong>
                            {request.requesterName} ·{" "}
                            {request.status === "accepted"
                              ? "승인"
                              : request.status === "rolledBack"
                                ? "수락 취소"
                                : "거절"}
                          </strong>
                          <span className="muted">{describeRequestSummary(request)}</span>
                          {request.hasConflictWarning ? (
                            <span style={{ color: "#fbbf24", fontWeight: 800, fontSize: 12 }}>
                              변경시 충돌이 발생합니다.
                            </span>
                          ) : null}
                          <span className="muted">
                            요청 {request.createdAt}
                            {request.resolvedAt ? ` / 처리 ${request.resolvedAt}` : ""}
                            {request.rolledBackAt ? ` / 롤백 ${request.rolledBackAt}` : ""}
                          </span>
                        </div>
                        {request.status === "accepted" ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="btn"
                              onClick={() => {
                                void (async () => {
                                  const result = await resolveScheduleChangeRequest(request.id, "rolledBack", session?.username ?? "관리자");
                                  await refreshRouteData({ includeRequests: true });
                                  if (!result.ok) {
                                    setMessage({ tone: "warn", text: "근무 변경 수락 취소에 실패했습니다." });
                                    return;
                                  }
                                  setMessage({
                                    tone: result.applied ? "note" : "warn",
                                    text: result.applied
                                      ? "승인된 근무 변경을 취소하고 원래 상태로 되돌렸습니다."
                                      : "수락 취소 기록은 남겼지만 실제 롤백은 실패했습니다.",
                                  });
                                })();
                              }}
                            >
                              수락 취소
                            </button>
                            <button
                              className="btn"
                              onClick={() => {
                                const ok = window.confirm("이 근무 수정 요청 기록을 삭제하시겠습니까?");
                                if (!ok) return;
                                void (async () => {
                                  const result = await deleteScheduleChangeRequest(request.id);
                                  await loadRequests();
                                  if (!result.ok) {
                                    setMessage({ tone: "warn", text: "근무 변경 요청 기록 삭제에 실패했습니다." });
                                    return;
                                  }
                                  setMessage({ tone: "note", text: "근무 변경 요청 기록을 삭제했습니다." });
                                })();
                              }}
                            >
                              삭제
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              className="btn"
                              onClick={() => {
                                const ok = window.confirm("이 근무 수정 요청 기록을 삭제하시겠습니까?");
                                if (!ok) return;
                                void (async () => {
                                  const result = await deleteScheduleChangeRequest(request.id);
                                  await loadRequests();
                                  if (!result.ok) {
                                    setMessage({ tone: "warn", text: "근무 변경 요청 기록 삭제에 실패했습니다." });
                                    return;
                                  }
                                  setMessage({ tone: "note", text: "근무 변경 요청 기록을 삭제했습니다." });
                                })();
                              }}
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="status note">처리 기록은 아직 없습니다.</div>
                  )}
                </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="schedule-toolbar">
            <div className="chip">DESK</div>
            {visibleMonthTabs.length > 0 ? (
              <div
                style={{
                  flex: "1 1 320px",
                  minWidth: 0,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div
                  role="tablist"
                  aria-label="월별 근무 탭"
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "nowrap",
                    overflowX: "auto",
                    paddingBottom: 4,
                    WebkitOverflowScrolling: "touch",
                    scrollbarWidth: "thin",
                    alignItems: "center",
                  }}
                >
                  {visibleMonthTabs.map((item) => {
                    const active = item.monthKey === (visibleSchedule?.monthKey ?? visibleMonthKey ?? "");
                    return (
                      <button
                        key={item.monthKey}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        disabled={isEditingDate}
                        className="btn"
                        onClick={() => setVisibleMonthKey(item.monthKey)}
                        style={{
                          flex: "0 0 auto",
                          minWidth: "fit-content",
                          padding: "8px 14px",
                          borderRadius: 999,
                          background: active ? "rgba(96, 165, 250, 0.22)" : "rgba(15, 23, 42, 0.78)",
                          border: active ? "1px solid rgba(103, 232, 249, 0.5)" : "1px solid rgba(148, 163, 184, 0.22)",
                          color: active ? "#e0f2fe" : "#dbeafe",
                          boxShadow: active ? "0 10px 24px rgba(8, 145, 178, 0.24)" : "none",
                          whiteSpace: "nowrap",
                          opacity: isEditingDate ? 0.65 : 1,
                          cursor: isEditingDate ? "not-allowed" : "pointer",
                        }}
                      >
                        {item.year}년 {item.month}월
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {visibleSchedule ? (
              <div className="schedule-toolbar-actions schedule-toolbar-actions--controls">
                <VacationLegendChips />
              {isAllDaysEditMode ? (
                <>
                  <button type="button" className="btn white" onClick={confirmDayEdit}>
                    수정 완료
                  </button>
                  <button type="button" className="btn" onClick={cancelDayEdit}>
                    수정모드 취소
                  </button>
                </>
              ) : (
                <button type="button" className="btn" disabled={isEditingDate || !visibleSchedule} onClick={startAllDaysEdit}>
                  수정 모드
                </button>
              )}
              <strong className="schedule-current-title">{visibleSchedule.year}년 {visibleSchedule.month}월</strong>
                <button className="btn" onClick={printVisibleSchedule}>
                  출력
                </button>
              </div>
            ) : null}
          </div>
          {visibleSchedule ? (
            <div ref={printableScheduleRef} data-print-frame="true" style={{ display: "grid", gap: 12 }}>
              <div data-print-only="true" style={{ display: "none" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <strong style={{ fontSize: 22 }}>{visibleSchedule.year}년 {visibleSchedule.month}월 DESK 근무표</strong>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <VacationLegendChips />
                  </div>
                </div>
              </div>
              <div className="schedule-calendar-scroll">
              <div className="schedule-calendar-grid">
                {buildWeeklyCalendarItems(visibleDays, visibleLeadingPlaceholderCount, "visible", (day) => {
                  const dayOwnerMonthKey = visibleDayOwnerMonthKeyMap.get(day.dateKey) ?? visibleSchedule.monthKey;
                  const isEditingVisibleMonth = activeEditMonthKey === dayOwnerMonthKey && isEditingDate;
                  const editMode =
                    isEditingVisibleMonth &&
                    (isAllDaysEditMode || state.editDateKey === day.dateKey);
                  const canDragAssignments = editMode && !isCoarsePointer;
                  const canDropAssignments = editMode;
                  const currentUser = state.currentUser.trim();
                  const editLocked = Boolean(state.editDateKey && !isAllDaysEditMode && state.editDateKey !== day.dateKey);
                  const conflictSet = new Set(day.conflicts.map((item) => `${item.category}-${item.name}`));
                  const dayCardStyle = getDayCardStyle(day);
                  const centeredDayLabel = getCenteredDayLabel(day);
                  const isWeekendLike = day.isWeekend || day.isHoliday;
                  const duplicateNameSet = getDayDuplicateNameSet(day);
                  const headerNameDuplicated = Boolean(day.headerName?.trim()) && duplicateNameSet.has(day.headerName.trim());
                  const visibleAssignments = getVisibleDayAssignments(day, {
                    editMode,
                    assignmentStore: scheduleAssignmentStore,
                    monthKey: dayOwnerMonthKey,
                    visibleTripTagMap,
                  });
                  const canDragAssignmentCategories = canDragAssignments;
                  const canDropAssignmentCategories = canDropAssignments;

                  return (
                    <article
                      key={day.dateKey}
                      data-date-key={day.dateKey}
                      className="panel schedule-day-card"
                      style={{
                        padding: 6,
                        minHeight: 216,
                        opacity: day.isOverflowMonth ? 0.55 : 1,
                        background: dayCardStyle.background,
                        border: dayCardStyle.border,
                      }}
                    >
                      <div
                        className="schedule-day-head"
                        style={{
                          display: "grid",
                          gridTemplateColumns: editMode ? "auto 1fr auto" : "auto minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: 6,
                          rowGap: editMode ? 8 : 0,
                          marginBottom: 6,
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
                          {!editMode ? (
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
                                padding: headerNameDuplicated ? "4px 10px" : 0,
                                borderRadius: headerNameDuplicated ? 999 : 0,
                                background: headerNameDuplicated ? "rgba(239,68,68,.22)" : "transparent",
                                border: headerNameDuplicated ? "1px solid rgba(248,113,113,.55)" : undefined,
                              }}
                            >
                              {day.headerName ?? ""}
                            </div>
                          ) : null}
                        </div>
                        {editMode ? (
                          <input
                            className="field-input"
                            value={day.headerName ?? ""}
                            onChange={(event) =>
                              updateEditingState((current) => updateDayHeaderName(current, day.dateKey, event.target.value))
                            }
                            placeholder="이름 입력"
                            style={{
                              gridColumn: "1 / -1",
                              minWidth: 0,
                              minHeight: 40,
                              padding: "7px 12px",
                              border: "1px solid rgba(255,255,255,.18)",
                              borderRadius: 12,
                              background: "rgba(7,17,31,.46)",
                              color: "#f8fbff",
                              fontSize: 20,
                              fontWeight: 900,
                              lineHeight: 1.1,
                              textAlign: "center",
                              boxShadow: "none",
                            }}
                          />
                        ) : null}
                        <div style={{ display: "flex", gap: 8, justifySelf: "end" }}>
                          {editMode && !isAllDaysEditMode ? (
                            <>
                              <button type="button" className="btn primary" style={{ padding: "5px 8px", fontSize: 12 }} onClick={confirmDayEdit}>
                                확인
                              </button>
                              <button type="button" className="btn" style={{ padding: "5px 8px", fontSize: 12 }} onClick={cancelDayEdit}>
                                취소
                              </button>
                            </>
                          ) : !editMode ? (
                            <button
                              className="btn"
                              style={{ padding: "5px 8px", fontSize: 12 }}
                              type="button"
                              disabled={editLocked}
                              onClick={() => startDayEdit(day.dateKey, dayOwnerMonthKey)}
                            >
                              수정
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 1 }}>
                        {visibleAssignments.map(([category, names]) => {
                          const slotNames = editMode ? getEditableSlotNames(names) : names.map((name) => name.trim()).filter(Boolean);

                          return (
                          <article
                            key={`${day.dateKey}-${category}`}
                            data-category={category}
                            draggable={canDragAssignmentCategories}
                            onDragStart={(event) => {
                              if (!canDragAssignmentCategories) return;
                              event.stopPropagation();
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "category", dateKey: day.dateKey, category }));
                            }}
                            onDragOver={(event) => {
                              if (!canDropAssignmentCategories) return;
                              const source = parseScheduleDragPayload(event.dataTransfer.getData("text/plain"));
                              if (!source || source.kind !== "category") return;
                              event.preventDefault();
                            }}
                            onDrop={(event) => {
                              const payload = event.dataTransfer.getData("text/plain");
                              if (!payload) return;
                              const source = parseScheduleDragPayload(payload);
                              if (!source || source.kind !== "category" || !canDropAssignmentCategories) return;
                              event.preventDefault();
                              event.stopPropagation();
                              if (source.dateKey === day.dateKey) {
                                updateEditingState((current) => moveAssignmentCategory(current, day.dateKey, source.category, category));
                              }
                            }}
                            style={{
                              border: "1px solid rgba(255,255,255,.16)",
                              borderRadius: 10,
                              padding: 6,
                              background: "rgba(9,17,30,.34)",
                              cursor: canDragAssignmentCategories ? "grab" : "default",
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "44px minmax(0, 1fr)",
                                columnGap: 8,
                                rowGap: editMode && isEditingVisibleMonth ? 8 : 0,
                                alignItems: "stretch",
                              }}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr",
                                  alignItems: "stretch",
                                  gap: 4,
                                }}
                              >
                                <strong
                                  className="schedule-assignment-label"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    alignSelf: "stretch",
                                    fontSize: 14,
                                    lineHeight: 1.1,
                                    minHeight: 38,
                                    whiteSpace: "pre-line",
                                    textAlign: "center",
                                  }}
                                >
                                  {getCategoryDisplayLabel(day, category)}
                                </strong>
                              </div>
                              {editMode && isEditingVisibleMonth ? (
                                <div style={{ display: "flex", gap: 4, alignItems: "center", gridColumn: 2, gridRow: 1, justifySelf: "end" }}>
                                  {canEditAssignmentLabel(day, category) ? (
                                    <button
                                      className="btn"
                                      style={{ padding: "2px 6px", fontSize: 11 }}
                                      onClick={() => {
                                        const value = window.prompt(
                                          "칸 이름을 입력하세요",
                                          day.assignmentLabelOverrides?.[category] ?? getScheduleCategoryLabel(category),
                                        );
                                        if (value === null) return;
                                        updateEditingState((current) =>
                                          updateDayAssignmentLabel(current, day.dateKey, category, value),
                                        );
                                      }}
                                    >
                                      이름
                                    </button>
                                  ) : null}
                                  <button
                                    className="btn"
                                    style={{ width: 22, height: 22, padding: 0, display: "grid", placeItems: "center", fontSize: 14 }}
                                    onClick={() => {
                                      setAddPersonDialog({
                                        dateKey: day.dateKey,
                                        category,
                                        dayLabel: `${day.month}/${day.day}`,
                                        ownerMonthKey: dayOwnerMonthKey,
                                      });
                                      setAddPersonName("");
                                    }}
                                  >
                                    +
                                  </button>
                                  <button
                                    className="btn"
                                    style={{
                                      width: 22,
                                      height: 22,
                                      padding: 0,
                                      display: "grid",
                                      placeItems: "center",
                                      fontSize: 14,
                                      color: "#ffd7d7",
                                      borderColor: "rgba(239,68,68,.38)",
                                      background: "rgba(239,68,68,.18)",
                                    }}
                                    onClick={() => {
                                      const ok = window.confirm("이 칸을 삭제하시겠습니까?");
                                      if (!ok) return;
                                      if (addPersonDialog?.dateKey === day.dateKey && addPersonDialog.category === category) {
                                        closeAddPersonDialog();
                                      }
                                      updateEditingState((current) => removeAssignmentCategory(current, day.dateKey, category));
                                    }}
                                    title="칸 삭제"
                                  >
                                    -
                                  </button>
                                  {canOpenManualInput(category) ? (
                                    <button
                                      className="btn"
                                      style={{ padding: "2px 6px", fontSize: 11 }}
                                      onClick={() => {
                                        const value = window.prompt(`${getScheduleCategoryLabel(category)} 이름을 쉼표로 입력하세요`, names.join(", "));
                                        if (value === null) return;
                                        updateEditingState((current) => updateManualAssignment(current, day.dateKey, category, value));
                                      }}
                                    >
                                      입력
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              <div
                                className="schedule-name-grid"
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                  gap: 0,
                                  minHeight: 38,
                                  gridColumn: editMode ? "1 / -1" : 2,
                                  gridRow: editMode ? 2 : 1,
                                  width: "100%",
                                }}
                              >
                              {slotNames.length > 0 ? (
                                slotNames.map((name, index) => {
                                  const isBlankSlot = isEmptyScheduleSlot(name);
                                  if (isBlankSlot) {
                                    return (
                                      <div
                                        key={`${category}-blank-${index}`}
                                        onDragOver={(event) => {
                                          if (!canDropAssignments) return;
                                          const source = parseScheduleDragPayload(event.dataTransfer.getData("text/plain"));
                                          if (source?.kind === "category") return;
                                          event.preventDefault();
                                          event.stopPropagation();
                                        }}
                                        onDrop={(event) => {
                                          if (!canDropAssignments) return;
                                          event.preventDefault();
                                          event.stopPropagation();
                                          const payload = event.dataTransfer.getData("text/plain");
                                          if (!payload) return;
                                          const source = parseScheduleDragPayload(payload);
                                          if (!source || source.kind !== "person") return;
                                          updateEditingState((current) =>
                                            swapPersonSlots(current, source, { dateKey: day.dateKey, category, index }),
                                          );
                                        }}
                                        style={{ width: "100%" }}
                                      >
                                        <button
                                          type="button"
                                          className="schedule-name-chip schedule-name-chip--edit schedule-name-chip--empty"
                                          onClick={() => handleBlankSlotActivate({ dateKey: day.dateKey, category, index })}
                                          style={{
                                            display: "grid",
                                            placeItems: "center",
                                            width: "100%",
                                            minWidth: 0,
                                            minHeight: 32,
                                            padding: "3px 4px",
                                            borderRadius: 0,
                                            border: "1px dashed rgba(148,163,184,.45)",
                                            background: "rgba(255,255,255,.03)",
                                            color: "rgba(226,232,240,.7)",
                                            fontWeight: 700,
                                            lineHeight: 1,
                                            appearance: "none",
                                            cursor: state.selectedPerson ? "pointer" : "default",
                                          }}
                                        >
                                          빈칸
                                        </button>
                                      </div>
                                    );
                                  }

                                  const assignmentDisplay = getAssignmentDisplay(category, name);
                                  const ref: SchedulePersonRef = {
                                    monthKey: dayOwnerMonthKey,
                                    dateKey: day.dateKey,
                                    category,
                                    index,
                                    name,
                                  };
                                  const personObject: ScheduleNameObject = {
                                    key: `${category}-${name}-${index}`,
                                    name,
                                    ref,
                                    pending: isPendingRef(pendingRequests, ref),
                                  };
                                  const selected =
                                    state.selectedPerson?.dateKey === day.dateKey &&
                                    state.selectedPerson?.category === category &&
                                    state.selectedPerson?.index === index;
                                  const highlighted =
                                    Boolean(currentUser) &&
                                    currentUser === assignmentDisplay.name &&
                                    (state.showMyWork || (editMode && !isAllDaysEditMode));
                                  const nameTag = getAssignmentChipTag(category, assignmentDisplay.name, day);
                                  const assignmentDisplayText = formatScheduleAssignmentDisplayName(
                                    {
                                      monthKey: dayOwnerMonthKey,
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
                                  const conflicted = conflictSet.has(`${category}-${name}`) || selected || personObject.pending || duplicated;
                                  const weekendConflict = conflicted && isWeekendLike;
                                  return (
                                    <div
                                      key={personObject.key}
                                      onDragOver={(event) => {
                                        if (!canDropAssignments) return;
                                        const source = parseScheduleDragPayload(event.dataTransfer.getData("text/plain"));
                                        if (source?.kind === "category") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                      }}
                                      onDrop={(event) => {
                                        if (!canDropAssignments) return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        const payload = event.dataTransfer.getData("text/plain");
                                        if (!payload) return;
                                        const source = parseScheduleDragPayload(payload);
                                        if (!source || source.kind !== "person") return;
                                        updateEditingState((current) =>
                                          swapPersonSlots(current, source, { dateKey: day.dateKey, category, index }),
                                        );
                                      }}
                                      style={{
                                        position: "relative",
                                        width: "100%",
                                        overflow: "visible",
                                      }}
                                    >
                                      <div
                                        className={`schedule-name-chip ${editMode ? "schedule-name-chip--edit" : ""}`}
                                        data-selected={selected ? "true" : undefined}
                                        draggable={canDragAssignments}
                                        onClick={() => {
                                          if (!editMode) return;
                                          if (category === "휴가") {
                                            updateEditingState((current) =>
                                              cycleVacationEntryType(current, day.dateKey, index, name),
                                            );
                                            return;
                                          }
                                          if (isGeneralAssignmentCategory(category)) {
                                            updateEditingState((current) =>
                                              cycleDayAssignmentNameTag(current, day.dateKey, category, assignmentDisplay.name),
                                            );
                                            return;
                                          }
                                          handlePersonSlotActivate({ dateKey: day.dateKey, category, index });
                                        }}
                                        onDragStart={(event) => {
                                          if (!canDragAssignments) return;
                                          event.stopPropagation();
                                          event.dataTransfer.effectAllowed = "move";
                                          event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "person", dateKey: day.dateKey, category, index }));
                                          setState((current) => ({
                                            ...current,
                                            selectedPerson: { dateKey: day.dateKey, category, index },
                                          }));
                                        }}
                                        onDragEnd={() => {
                                          if (!canDragAssignments) return;
                                          setState((current) => ({
                                            ...current,
                                            selectedPerson: null,
                                          }));
                                        }}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                        justifyContent: "center",
                                        gap: 5,
                                        width: "100%",
                                        minWidth: 0,
                                        cursor: canDragAssignments ? "grab" : editMode ? "pointer" : "default",
                                        minHeight: 32,
                                        padding: editMode ? "3px 4px" : "4px 4px",
                                        borderRadius: 0,
                                        background: personObject.pending
                                          ? "rgba(245,158,11,.18)"
                                          : conflicted
                                                ? weekendConflict
                                                  ? "rgba(34,211,238,.28)"
                                                  : "rgba(239,68,68,.22)"
                                                : hasTaggedDisplayName
                                                  ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND
                                                : nameTagColors
                                                  ? nameTagColors.background
                                                : assignmentDisplay.chipStyle?.background
                                                  ? assignmentDisplay.chipStyle.background
                                                  : highlighted
                                                    ? "rgba(34,211,238,.22)"
                                                    : "rgba(255,255,255,.16)",
                                          border: personObject.pending
                                          ? "1px solid rgba(245,158,11,.35)"
                                          : conflicted
                                              ? weekendConflict
                                                ? "1px solid rgba(103,232,249,.65)"
                                                : "1px solid rgba(239,68,68,.28)"
                                              : hasTaggedDisplayName
                                                ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER
                                              : nameTagColors
                                                ? nameTagColors.border
                                              : highlighted
                                                ? "1px solid rgba(34,211,238,.35)"
                                                : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                        color: weekendConflict
                                          ? "#d8fbff"
                                          : hasTaggedDisplayName
                                              ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR
                                          : nameTagColors
                                            ? nameTagColors.color
                                          : editMode
                                              ? "#fffbea"
                                              : assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                        fontWeight: 700,
                                        lineHeight: 1.3,
                                        boxShadow: "none",
                                      }}
                                    >
                                        <FittedNameText
                                          text={getAssignmentChipText(assignmentDisplayText, nameTag)}
                                          className="schedule-name-chip__text"
                                          minFontSize={9}
                                          maxFontSize={editMode ? 16 : 18}
                                          style={{ minWidth: 0 }}
                                        />
                                        {personObject.pending && !editMode ? <span style={{ fontSize: 13 }}>근무변경요청중</span> : null}
                                      </div>
                                      {editMode ? (
                                        <button
                                          className="btn"
                                          style={{
                                            position: "absolute",
                                            top: -4,
                                            right: -4,
                                            width: 18,
                                            minWidth: 18,
                                            height: 18,
                                            padding: 0,
                                            borderRadius: 999,
                                            display: "grid",
                                            placeItems: "center",
                                            fontSize: 12,
                                            lineHeight: 1,
                                          }}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            const ok = window.confirm("이 인원을 삭제하시겠습니까?");
                                            if (!ok) return;
                                            updateEditingState((current) =>
                                              removePersonFromCategory(current, day.dateKey, category, index, name),
                                            );
                                          }}
                                        >
                                          -
                                        </button>
                                      ) : null}
                                    </div>
                                  );
                                })
                              ) : null}
                              {slotNames.length > 0 && slotNames.length % 2 === 1 ? (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    display: "block",
                                    minHeight: 32,
                                    border: "1px solid rgba(255,255,255,.08)",
                                    background: "rgba(255,255,255,.03)",
                                  }}
                                />
                              ) : null}
                              </div>
                            </div>
                          </article>
                        )})}
                        {editMode && isEditingVisibleMonth ? (
                          <button className="btn" onClick={() => {
                            const label = window.prompt("추가칸 이름을 입력하세요", "추가칸");
                            if (label === null) return;
                            updateEditingState((current) => addManualField(current, day.dateKey, label));
                          }}>
                            날짜 수동 칸 추가
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            </div>
          ) : (
            <div className="status note">상단의 작성 버튼을 누르면 근무표가 생성됩니다.</div>
          )}
        </div>
      </section>

      <div style={{ display: "grid", gap: 16 }}>
      <section style={{ display: "grid", gap: 16 }}>
        <section className="subgrid-3">
          <article className="kpi">
            <div className="kpi-label">선택 연도</div>
            <div className="kpi-value">{state.year}년</div>
          </article>
          <article className="kpi">
            <div className="kpi-label">선택 월</div>
            <div className="kpi-value">{state.month}월</div>
          </article>
          <article className="kpi">
            <div className="kpi-label">총 인원 수</div>
            <div className="kpi-value">{totalCount}명</div>
          </article>
        </section>

        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div className="chip">순번 입력</div>
              <button className={`btn ${isOrderEditMode ? "white" : ""}`} disabled={isEditingDate} onClick={toggleOrderEditMode}>
                {isOrderEditMode ? "수정 종료" : "수정"}
              </button>
            </div>
            <div className="schedule-order-sheet">
              <div className="schedule-order-sheet__scroller">
                <table className="schedule-order-sheet__table">
                  <tbody>
                    {orderCategories.map((category) => {
                      const isOffEditing = orderOffEditor?.categoryKey === category.key;
                      const effectiveOffNames = getEffectiveOffByCategory(state, category.key);
                      const selectedOffNames = isOffEditing ? orderOffEditor.selectedNames : effectiveOffNames;
                      const startRawIndex = getStartPointerRawIndex(state, targetMonthKey, category.key);

                      return (
                        <tr key={category.key}>
                          <th className="schedule-order-sheet__sticky-col schedule-order-sheet__row-label">
                            <div className="schedule-order-sheet__row-label-inner">
                              <strong>{category.label}</strong>
                              {isOrderEditMode ? (
                                isOffEditing ? (
                                  <div className="schedule-order-sheet__row-actions">
                                    <button className="btn primary" disabled={isEditingDate} onClick={saveOrderOffEdit}>저장</button>
                                    <button className="btn" disabled={isEditingDate} onClick={cancelOrderOffEdit}>취소</button>
                                  </div>
                                ) : (
                                  <button className="btn" disabled={isEditingDate} onClick={() => startOrderOffEdit(category.key)}>오프</button>
                                )
                              ) : null}
                            </div>
                          </th>
                          {Array.from({ length: 30 }, (_, index) => {
                            const value = state.orders[category.key][index] ?? "";
                            const trimmedValue = value.trim();
                            const isSelectedOff = selectedOffNames.includes(trimmedValue);
                            const isStart = index === startRawIndex;

                            return (
                              <td
                                key={`${category.key}-${index}`}
                                className={`schedule-order-sheet__cell${isSelectedOff ? " schedule-order-sheet__cell--off" : ""}${isStart ? " schedule-order-sheet__cell--start" : ""}`}
                              >
                                <label className="schedule-order-sheet__input-wrap">
                                  <input
                                    className="field-input schedule-order-sheet__input"
                                    disabled={isEditingDate || !isOrderEditMode}
                                    value={value}
                                    onChange={(e) => {
                                      const orders = { ...state.orders, [category.key]: [...state.orders[category.key]] };
                                      orders[category.key][index] = e.target.value;
                                      setState({ ...state, orders });
                                    }}
                                  />
                                </label>
                                {isOrderEditMode && isOffEditing && trimmedValue ? (
                                  <button
                                    type="button"
                                    className="btn schedule-order-sheet__start-button"
                                    onClick={() =>
                                      setState((current) =>
                                        sanitizeScheduleState(setMonthStartPointer(current, targetMonthKey, category.key, index)),
                                      )
                                    }
                                  >
                                    시작점
                                  </button>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {isOrderEditMode && orderOffEditor ? (
              <article style={{ border: "1px solid var(--line)", borderRadius: 20, padding: 16, display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong>{orderCategories.find((category) => category.key === orderOffEditor.categoryKey)?.label ?? "근무유형"} 오프 편집</strong>
                  <span className="muted">이름을 누르면 해당 근무유형의 오프로 저장됩니다.</span>
                </div>
                <div className="status note">아래 기본 오프 인원을 기준으로 더하거나 빼서 조절할 수 있습니다.</div>
                <div className="schedule-order-name-grid">
                  {getCategoryPeople(state, orderOffEditor.categoryKey).length > 0 ? (
                    getCategoryPeople(state, orderOffEditor.categoryKey).map((name) => {
                      const selected = orderOffEditor.selectedNames.includes(name);
                      return (
                        <button
                          key={`${orderOffEditor.categoryKey}-${name}`}
                          type="button"
                          className={`schedule-order-name-cell${selected ? " schedule-order-name-cell--selected" : ""}`}
                          onClick={() =>
                            setOrderOffEditor((current) =>
                              current
                                ? {
                                    ...current,
                                    selectedNames: selected
                                      ? current.selectedNames.filter((item) => item !== name)
                                      : [...current.selectedNames, name],
                                  }
                                : current,
                            )
                          }
                        >
                          {name}
                        </button>
                      );
                    })
                  ) : (
                    <span className="muted">등록된 이름이 없습니다.</span>
                  )}
                </div>
              </article>
            ) : null}
          </div>
        </section>
      </section>

      <section className="panel" style={{ width: "100%" }}>
        <div className="panel-pad" style={{ display: "grid", gap: 8, padding: "8px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="chip">일반조</div>
            {isGeneralTeamEditMode ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 12 }}>이름을 눌러 오프 설정</span>
                {generalTeamOffEditor ? (
                  <>
                    <button className="btn primary" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={saveGeneralTeamOffEdit}>저장</button>
                    <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={cancelGeneralTeamOffEdit}>취소</button>
                  </>
                ) : null}
                {isGeneralTeamAdding ? (
                  <form
                    style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      appendGeneralTeamPerson(generalTeamDraftName);
                    }}
                  >
                    <input
                      ref={generalTeamInputRef}
                      className="field-input"
                      style={{ width: 180, minWidth: 140, padding: "8px 10px", fontSize: 13 }}
                      value={generalTeamDraftName}
                      onChange={(event) => setGeneralTeamDraftName(event.target.value)}
                      placeholder="이름 입력 후 Enter"
                    />
                    <button type="submit" className="btn" style={{ padding: "8px 12px", fontSize: 13 }}>추가</button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "8px 12px", fontSize: 13 }}
                      onClick={() => {
                        setIsGeneralTeamAdding(false);
                        setGeneralTeamDraftName("");
                      }}
                    >
                      취소
                    </button>
                  </form>
                ) : (
                  <button
                    className="btn"
                    style={{ padding: "8px 12px", fontSize: 13 }}
                    onClick={() => {
                      setIsGeneralTeamAdding(true);
                      setGeneralTeamDraftName("");
                    }}
                  >
                    추가
                  </button>
                )}
              </div>
            ) : (
              <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={startGeneralTeamOffEdit}>수정</button>
            )}
          </div>

          <div className="schedule-order-name-grid schedule-order-name-grid--wide">
            {generalTeamPeople.map((name) => {
              const selected = ((isGeneralTeamEditMode ? generalTeamOffEditor?.selectedNames : null) ?? effectiveGeneralTeamOffPeople).includes(name);
              return (
                <div key={`general-team-off-${name}`} className="schedule-order-name-cell-wrap">
                  <button
                    type="button"
                    className={`schedule-order-name-cell${selected ? " schedule-order-name-cell--selected" : ""}`}
                    disabled={!isGeneralTeamEditMode || !generalTeamOffEditor}
                    onClick={() =>
                      setGeneralTeamOffEditor((current) =>
                        current
                          ? {
                              ...current,
                              selectedNames: selected
                                ? current.selectedNames.filter((item) => item !== name)
                                : [...current.selectedNames, name],
                            }
                          : current,
                      )
                    }
                  >
                    {name}
                  </button>
                  {isGeneralTeamEditMode ? (
                    <button
                      type="button"
                      className="schedule-order-name-delete"
                      onClick={() => removeGeneralTeamPerson(name)}
                      aria-label={`${name} 삭제`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="schedule-order-bottom-grid">
        <section className="panel" style={{ width: "100%" }}>
          <div className="panel-pad" style={{ display: "grid", gap: 4, padding: "8px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div className="chip">기본 오프 인원</div>
              {isGlobalOffEditMode && globalOffEditor ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={appendGlobalOffPoolPerson}>추가</button>
                  <button className="btn primary" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={saveGlobalOffEdit}>저장</button>
                  <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={cancelGlobalOffEdit}>취소</button>
                </div>
              ) : (
                <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={startGlobalOffEdit}>수정</button>
              )}
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(255,255,255,.04)",
                color: "#e5edf7",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.55,
              }}
            >
              여기서 고른 인원은 전체 순번에서 기본 오프로 표시됩니다. 각 근무유형의 `수정`에서 근무별 오프를 따로 조절할 수 있습니다.
            </div>

            <div className="schedule-order-name-grid">
              {globalOffPool.length > 0 ? (
                globalOffPool.map((name) => {
                  const selected = ((isGlobalOffEditMode ? globalOffEditor?.selectedNames : null) ?? state.offPeople).includes(name);
                  return (
                    <div key={`global-off-${name}`} className="schedule-order-name-cell-wrap">
                      <button
                        type="button"
                        className={`schedule-order-name-cell${selected ? " schedule-order-name-cell--selected" : ""}`}
                        disabled={!isGlobalOffEditMode || !globalOffEditor}
                        onClick={() =>
                          setGlobalOffEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  selectedNames: selected
                                    ? current.selectedNames.filter((item) => item !== name)
                                    : [...current.selectedNames, name],
                                }
                              : current,
                          )
                        }
                        >
                          {name}
                        </button>
                      {isGlobalOffEditMode ? (
                        <button
                          type="button"
                          className="schedule-order-name-delete"
                          onClick={() => removeGlobalOffPoolPerson(name)}
                          aria-label={`${name} 삭제`}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <span className="muted">순번에 등록된 이름이 없습니다.</span>
              )}
            </div>
          </div>
        </section>

        <section className="panel" style={{ width: "100%" }}>
          <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
            <div className="chip">사본 보관함</div>
            {originalSnapshotEntries.length > 0 ? (
              originalSnapshotEntries.map(({ monthKey, snapshot }) => (
                <div key={snapshot.id} style={{ padding: 12, borderRadius: 14, border: "1px solid var(--line)", display: "grid", gap: 8 }}>
                  <strong>{monthKey} 원본</strong>
                  <div className="muted" style={{ marginTop: 6 }}>{snapshot.createdAt}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <button className="btn" disabled={isEditingDate} onClick={() => setOriginalPreviewSnapshot(snapshot)}>
                      열기
                    </button>
                    <button className="btn" disabled={isEditingDate} onClick={() => printOriginalSnapshot(snapshot)}>
                      출력
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="status note">아직 저장된 원본이 없습니다.</div>
            )}
          </div>
        </section>

      </section>
      </div>
      {originalPreviewSnapshot ? (
        <div
          onClick={() => setOriginalPreviewSnapshot(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 58,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(7,17,31,.78)",
          }}
        >
          <section
            className="panel"
            style={{
              width: "min(1200px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "#0b1628",
              border: "1px solid rgba(255,255,255,.14)",
              boxShadow: "0 24px 64px rgba(0,0,0,.45)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
              <div className="schedule-toolbar">
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="chip">근무 원본</div>
                  <strong>{originalPreviewSnapshot.generated.year}년 {originalPreviewSnapshot.generated.month}월</strong>
                  <span className="muted">{originalPreviewSnapshot.createdAt}</span>
                </div>
                <div className="schedule-toolbar-actions">
                  <button type="button" className="btn" onClick={() => printOriginalSnapshot(originalPreviewSnapshot)}>출력</button>
                  <button type="button" className="btn" onClick={() => setOriginalPreviewSnapshot(null)}>닫기</button>
                </div>
              </div>
              <div className="schedule-calendar-scroll">
                <div className="schedule-calendar-grid">
                  {buildWeeklyCalendarItems(
                    originalVisibleDays,
                    originalLeadingPlaceholderCount,
                    `preview-${originalPreviewSnapshot.id}`,
                    (day) => {
                    const dayCardStyle = getDayCardStyle(day);
                    const centeredDayLabel = getCenteredDayLabel(day);
                    const conflictSet = new Set(day.conflicts.map((item) => `${item.category}-${item.name}`));
                    const duplicateNameSet = getDayDuplicateNameSet(day);
                    const headerNameDuplicated = Boolean(day.headerName?.trim()) && duplicateNameSet.has(day.headerName.trim());
                    const previewAssignments = getVisibleDayAssignments(day).filter(([, names]) => names.length > 0 || day.isWeekend);

                    return (
                      <article
                        key={`preview-${originalPreviewSnapshot.id}-${day.dateKey}`}
                        className="panel schedule-day-card"
                        style={{
                          padding: 8,
                          minHeight: 232,
                          opacity: day.isOverflowMonth ? 0.55 : 1,
                          background: dayCardStyle.background,
                          border: dayCardStyle.border,
                        }}
                      >
                        <div className="schedule-day-head" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <div className="schedule-day-date" style={{ fontSize: 21, fontWeight: 900 }}>
                            <span>{day.month}/{day.day}</span>
                          </div>
                          <div
                            style={{
                              textAlign: "center",
                              display: "grid",
                              gap: centeredDayLabel ? 4 : 0,
                              justifyItems: "center",
                              alignContent: "center",
                              alignSelf: "stretch",
                              minHeight: 48,
                            }}
                          >
                            {centeredDayLabel ? (
                              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 24, textAlign: "center", color: "#ffd7d7", fontWeight: 900, fontSize: 14 }}>
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
                                padding: headerNameDuplicated ? "4px 10px" : 0,
                                borderRadius: headerNameDuplicated ? 999 : 0,
                                background: headerNameDuplicated ? "rgba(239,68,68,.22)" : "transparent",
                                border: headerNameDuplicated ? "1px solid rgba(248,113,113,.55)" : undefined,
                              }}
                            >
                              {day.headerName ?? ""}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 2 }}>
                          {previewAssignments.map(([category, names]) => (
                            <article
                              key={`preview-${day.dateKey}-${category}`}
                              style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: 7, background: "rgba(9,17,30,.34)" }}
                            >
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
                                    fontSize: 14,
                                    lineHeight: 1.1,
                                    minHeight: 42,
                                    whiteSpace: "pre-line",
                                    textAlign: "center",
                                  }}
                                >
                                  {getCategoryDisplayLabel(day, category)}
                                </strong>
                              <div className="schedule-name-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 0, minHeight: 42, width: "100%" }}>
                                {names.map((name, index) => {
                                  const assignmentDisplay = getAssignmentDisplay(category, name);
                                  const nameTag = getAssignmentChipTag(category, assignmentDisplay.name, day);
                                  const assignmentDisplayText = formatScheduleAssignmentDisplayName(
                                    {
                                      monthKey: visibleSchedule?.monthKey ?? "",
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
                                  const conflicted = conflictSet.has(`${category}-${name}`) || duplicateNameSet.has(assignmentDisplay.name.trim());
                                  const weekendConflict = conflicted && (day.isWeekend || day.isHoliday);
                                  return (
                                    <div
                                      className="schedule-name-chip"
                                      key={`preview-${category}-${name}-${index}`}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        width: "100%",
                                        gap: 6,
                                        padding: "4px",
                                        minHeight: 34,
                                        borderRadius: 0,
                                        background: conflicted
                                          ? weekendConflict
                                            ? "rgba(34,211,238,.28)"
                                            : "rgba(239,68,68,.22)"
                                          : hasTaggedDisplayName
                                            ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND
                                          : nameTagColors
                                            ? nameTagColors.background
                                          : assignmentDisplay.chipStyle?.background ?? "rgba(255,255,255,.16)",
                                        border: conflicted
                                          ? weekendConflict
                                            ? "1px solid rgba(103,232,249,.65)"
                                            : "1px solid rgba(239,68,68,.28)"
                                          : hasTaggedDisplayName
                                            ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER
                                          : nameTagColors
                                            ? nameTagColors.border
                                          : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                        color: weekendConflict
                                          ? "#d8fbff"
                                          : hasTaggedDisplayName
                                              ? SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR
                                            : nameTagColors
                                              ? nameTagColors.color
                                            : assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                        fontWeight: 700,
                                        lineHeight: 1.3,
                                        boxShadow: "none",
                                      }}
                                    >
                                      <FittedNameText
                                        text={getAssignmentChipText(assignmentDisplayText, nameTag)}
                                        className="schedule-name-chip__text"
                                        minFontSize={9}
                                        maxFontSize={18}
                                      />
                                    </div>
                                  );
                                })}
                                {names.length > 0 && names.length % 2 === 1 ? (
                                  <span
                                    aria-hidden="true"
                                    style={{
                                      display: "block",
                                      minHeight: 34,
                                      border: "1px solid rgba(255,255,255,.08)",
                                      background: "rgba(255,255,255,.03)",
                                    }}
                                  />
                                ) : null}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {addPersonDialog ? (
        <div
          onClick={closeAddPersonDialog}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(7,17,31,.72)",
          }}
        >
          <section
            className="panel"
            style={{
              width: "min(100%, 420px)",
              background: "#0b1628",
              border: "1px solid rgba(255,255,255,.14)",
              boxShadow: "0 24px 64px rgba(0,0,0,.45)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <form
              className="panel-pad"
              style={{ display: "grid", gap: 14 }}
              onSubmit={(event) => {
                event.preventDefault();
                submitAddPerson();
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <div className="chip">이름 추가</div>
                <strong>{addPersonDialog.dayLabel} {getScheduleCategoryLabel(addPersonDialog.category)}</strong>
                <span className="muted">이름을 입력하고 Enter를 누르면 바로 추가되고 입력창이 초기화됩니다.</span>
              </div>
              {addPersonDialog.category === "휴가" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <span className="muted">휴가 유형</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                    {displayVacationOrder.map((type) => {
                      const selected = addPersonVacationType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          className="btn"
                          onClick={() => setAddPersonVacationType(type as VacationType)}
                          style={{
                            padding: "8px 12px",
                            fontWeight: 800,
                            ...vacationLegendStyles[type as keyof typeof vacationLegendStyles],
                            border: selected ? "2px solid rgba(255,255,255,.96)" : vacationLegendStyles[type as keyof typeof vacationLegendStyles].border,
                            color: selected ? "#ffffff" : vacationLegendStyles[type as keyof typeof vacationLegendStyles].color,
                            background: selected
                              ? `linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.04)), ${vacationLegendStyles[type as keyof typeof vacationLegendStyles].background}`
                              : vacationLegendStyles[type as keyof typeof vacationLegendStyles].background,
                            boxShadow: selected
                              ? "0 0 0 2px rgba(255,255,255,.18), 0 10px 24px rgba(15,23,42,.34), inset 0 1px 0 rgba(255,255,255,.22)"
                              : "inset 0 1px 0 rgba(255,255,255,.08)",
                            transform: selected ? "translateY(-1px) scale(1.02)" : undefined,
                            filter: selected ? "saturate(1.15) brightness(1.08)" : "saturate(.92)",
                          }}
                        >
                          {displayVacationLabels[type as keyof typeof displayVacationLabels]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <input
                ref={addPersonInputRef}
                className="field-input"
                value={addPersonName}
                onChange={(event) => setAddPersonName(event.target.value)}
                placeholder="새 이름 입력"
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <button type="submit" className="btn primary">추가</button>
                <button type="button" className="btn" onClick={closeAddPersonDialog}>닫기</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
