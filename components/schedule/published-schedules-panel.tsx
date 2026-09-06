﻿﻿﻿"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FittedNameText } from "@/components/schedule/fitted-name-text";
import { ScheduleTripTooltip } from "@/components/schedule/schedule-trip-tooltip";
import {
  getSession,
  hasDeskAccess,
  subscribeToAuth,
} from "@/lib/auth/storage";
import { printHtmlDocument } from "@/lib/print";
import {
  buildScheduleAssignmentNameTagKey,
  compareDayAssignmentDisplayOrder,
  getAssignmentDisplayRank,
  getDayCategoryDisplayLabel,
  getDayDuplicateNameSet,
  getScheduleCategoryLabel,
  isAutoManagedGeneralAssignment,
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
  loadHiddenPublishedMonthKeys,
  readLocalHiddenPublishedMonthKeys,
  saveHiddenPublishedMonthKeys,
} from "@/lib/schedule/hidden-published-schedules";
import {
  getPublishedSchedules,
  PUBLISHED_SCHEDULES_EVENT,
  PUBLISHED_SCHEDULES_STATUS_EVENT,
  PublishedScheduleItem,
  refreshPublishedSchedules,
} from "@/lib/schedule/published";
import { readStoredScheduleState, refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import { vacationLegendOrder, vacationStyleTones, vacationTypeLabels } from "@/lib/schedule/vacation-styles";
import { DaySchedule, ScheduleAssignmentNameTag, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef, VacationType } from "@/lib/schedule/types";
import {
  applyScheduleAssignmentDutyCategoriesToSchedule,
  applyScheduleAssignmentNameTagsToSchedule,
  formatScheduleAssignmentDisplayName,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER,
  getScheduleAssignmentStore,
  getScheduleAssignmentTripTooltip,
  getScheduleAssignmentVisibleTripTagMap,
  refreshScheduleAssignmentDisplayMonths,
  refreshTeamLeadAssignmentMonths,
  SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  type ScheduleAssignmentDataStore,
} from "@/lib/team-lead/storage";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const MAX_ROUTE_SIZE = 3;
const FOCUS_REFRESH_THROTTLE_MS = 60_000;
const HOME_PREVIEW_DAY_COUNT = 7;
const HOME_RESPONSIVE_PREVIEW_DAY_COUNT = 6;
const HOME_RESPONSIVE_PREVIEW_START_OFFSET = -1;
const MOBILE_THREE_DAY_ROW_SIZE = 3;
const MIN_FIT_SCALE = 0.12;
const MAX_PAN_ZOOM_SCALE = 3;
const PAN_ZOOM_STEP = 1.25;
const TAP_MOVE_THRESHOLD = 8;
const TAP_MAX_DURATION_MS = 300;
type PublishedScheduleLayoutMode = "desktop" | "tablet" | "mobile";

type PanZoomState = {
  x: number;
  y: number;
  scale: number;
  fitScale: number;
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

type ActivePanZoomPointer = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startedAt: number;
};

type PanZoomGesture =
  | { type: "idle" }
  | {
      type: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    }
  | {
      type: "pinch";
      startDistance: number;
      startScale: number;
      anchorContentX: number;
      anchorContentY: number;
    };

const initialPanZoomState: PanZoomState = {
  x: 0,
  y: 0,
  scale: 1,
  fitScale: 1,
  contentWidth: 0,
  contentHeight: 0,
  viewportWidth: 0,
  viewportHeight: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCenteredOrClampedOffset(viewportSize: number, contentSize: number, offset: number) {
  if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
  return clamp(offset, viewportSize - contentSize, 0);
}

function clampPanZoomPosition(state: PanZoomState, scale: number, x: number, y: number) {
  return {
    x: getCenteredOrClampedOffset(state.viewportWidth, state.contentWidth * scale, x),
    y: getCenteredOrClampedOffset(state.viewportHeight, state.contentHeight * scale, y),
  };
}

function getPointerDistance(left: ActivePanZoomPointer, right: ActivePanZoomPointer) {
  return Math.hypot(right.currentX - left.currentX, right.currentY - left.currentY);
}

function getPointerMidpoint(left: ActivePanZoomPointer, right: ActivePanZoomPointer) {
  return {
    x: (left.currentX + right.currentX) / 2,
    y: (left.currentY + right.currentY) / 2,
  };
}

function applyScheduleAssignmentDecorations(schedule: PublishedScheduleItem["schedule"]) {
  return applyScheduleAssignmentNameTagsToSchedule(applyScheduleAssignmentDutyCategoriesToSchedule(schedule));
}

function getScheduleAssignmentMonthKeysForDisplayItems(items: ScheduleDisplaySource[]) {
  return Array.from(
    new Set(
      items.flatMap((item) => [
        item.monthKey,
        ...item.schedule.days
          .map((day) => day.dateKey.slice(0, 7))
          .filter((monthKey) => /^\d{4}-\d{2}$/.test(monthKey)),
      ]),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function getWeekdayLabel(dow: number) {
  return weekdayLabels[(dow + 6) % 7] ?? "";
}

function renderPublishedWeekdayCards(keyPrefix: string, isCompactMonthlyView: boolean) {
  return weekdayLabels.map((label) => {
    const isWeekendLabel = label === "토" || label === "일";
    return (
      <div
        key={`${keyPrefix}-${label}`}
        className={`schedule-weekday ${isCompactMonthlyView ? "schedule-weekday--monthly" : ""}`}
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

function buildPublishedWeeklyCalendarItems<T>(
  days: T[],
  keyPrefix: string,
  isCompactMonthlyView: boolean,
  renderDay: (day: T) => ReactNode,
) {
  const items: ReactNode[] = [];
  if (days.length === 0) return items;

  for (let weekStart = 0; weekStart < days.length; weekStart += 7) {
    const weekIndex = Math.floor(weekStart / 7);
    const weekDays = days.slice(weekStart, weekStart + 7);
    items.push(...renderPublishedWeekdayCards(`${keyPrefix}-weekdays-${weekIndex}`, isCompactMonthlyView));

    for (let weekdayIndex = 0; weekdayIndex < 7; weekdayIndex += 1) {
      const day = weekDays[weekdayIndex];
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
    }
  }

  return items;
}

function getAssignmentChipTag(category: string, name: string, day: DaySchedule) {
  const key = buildScheduleAssignmentNameTagKey(category, name);
  return day.assignmentNameTags?.[key] ?? null;
}

function getAssignmentChipText(name: string, tag: ScheduleAssignmentNameTag | null) {
  return tag ? `${name}${scheduleAssignmentNameTagLabels[tag]}` : name;
}

function getPublishedScheduleLayoutMode(
  viewportWidth: number,
  viewportHeight: number,
  hasCoarsePointer: boolean,
): PublishedScheduleLayoutMode {
  const shortSide = Math.min(viewportWidth, viewportHeight);
  if (viewportWidth <= 480 || shortSide <= 420) return "mobile";
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
    nextStartDate?: string;
  };
};

type PublishedSchedulesPanelMode = "home" | "page";
type MobileSchedulePageViewMode = "full" | "three-day";

type PublishedSchedulesPanelProps = {
  mode?: PublishedSchedulesPanelMode;
  readOnlyPreview?: {
    displayName: string;
    items: PublishedScheduleItem[];
  };
};

type PublishedScheduleTripTooltipProps = {
  tooltip: ReturnType<typeof getScheduleAssignmentTripTooltip>;
  clickEnabled: boolean;
  portalEnabled: boolean;
  positionKey: string;
  children: ReactNode;
};

function PublishedScheduleTripTooltip({
  tooltip,
  clickEnabled,
  portalEnabled,
  positionKey,
  children,
}: PublishedScheduleTripTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [portalStyle, setPortalStyle] = useState<CSSProperties>({});
  const [isPortalPositioned, setIsPortalPositioned] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const portalRef = useRef<HTMLSpanElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!portalEnabled || !isOpen) return;

    let frameId = 0;

    const syncPosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const maxWidth = Math.min(280, Math.max(180, window.innerWidth - 24));
      const maxHeight = Math.max(120, window.innerHeight - 24);
      const tooltipRect = portalRef.current?.getBoundingClientRect();
      const tooltipWidth = Math.min(tooltipRect?.width ?? maxWidth, maxWidth);
      const tooltipHeight = Math.min(tooltipRect?.height ?? 180, maxHeight);
      const left = clamp(rect.left, 12, Math.max(12, window.innerWidth - tooltipWidth - 12));
      let top = rect.bottom + 8;
      if (top + tooltipHeight > window.innerHeight - 12 && rect.top > tooltipHeight + 20) {
        top = rect.top - tooltipHeight - 8;
      }
      top = clamp(top, 12, Math.max(12, window.innerHeight - tooltipHeight - 12));
      setPortalStyle((current) => {
        if (
          current.left === left &&
          current.top === top &&
          current.maxWidth === maxWidth &&
          current.maxHeight === maxHeight
        ) {
          return current;
        }
        return { left, top, maxWidth, maxHeight, overflowY: "auto" };
      });
      setIsPortalPositioned(true);
      frameId = window.requestAnimationFrame(syncPosition);
    };

    syncPosition();
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen, portalEnabled, positionKey]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || portalRef.current?.contains(target)) return;
      if (closeTimeoutRef.current !== null) window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
      setIsOpen(false);
      setIsPortalPositioned(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  useEffect(() => () => {
    if (closeTimeoutRef.current !== null) window.clearTimeout(closeTimeoutRef.current);
  }, []);

  const cancelScheduledClose = () => {
    if (closeTimeoutRef.current === null) return;
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  };

  const openTooltip = () => {
    cancelScheduledClose();
    setIsPortalPositioned(false);
    setIsOpen(true);
  };

  const closeTooltip = () => {
    cancelScheduledClose();
    setIsOpen(false);
    setIsPortalPositioned(false);
  };

  const keepTooltipOpen = () => {
    cancelScheduledClose();
    setIsOpen(true);
  };

  const scheduleTooltipClose = () => {
    cancelScheduledClose();
    closeTimeoutRef.current = window.setTimeout(closeTooltip, 100);
  };

  if (!portalEnabled) {
    return (
      <ScheduleTripTooltip tooltip={tooltip} clickEnabled={clickEnabled}>
        {children}
      </ScheduleTripTooltip>
    );
  }

  if (!tooltip) return <>{children}</>;

  const travelTypeLabel =
    tooltip.travelType === "국내출장" || tooltip.travelType === "해외출장" || tooltip.travelType === "당일출장"
      ? tooltip.travelType
      : "";

  return (
    <div
      ref={anchorRef}
      className="schedule-trip-tooltip-anchor"
      data-tooltip-open={isOpen ? "true" : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") openTooltip();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && portalRef.current?.contains(nextTarget)) return;
        scheduleTooltipClose();
      }}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) openTooltip();
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && (anchorRef.current?.contains(nextTarget) || portalRef.current?.contains(nextTarget))) return;
        closeTooltip();
      }}
      onClickCapture={() => {
        if (!clickEnabled) return;
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        setIsPortalPositioned(false);
        setIsOpen((current) => !current);
      }}
      onKeyDownCapture={(event) => {
        if (!clickEnabled || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openTooltip();
      }}
    >
      {children}
      {isOpen
        ? createPortal(
            <span
              ref={portalRef}
              className="schedule-trip-tooltip schedule-trip-tooltip--portal"
              role="tooltip"
              style={{ ...portalStyle, visibility: isPortalPositioned ? "visible" : "hidden" }}
              onPointerEnter={keepTooltipOpen}
              onPointerLeave={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (nextTarget && anchorRef.current?.contains(nextTarget)) return;
                scheduleTooltipClose();
              }}
            >
              <span className="schedule-trip-tooltip__head">
                <strong>{tooltip.tripTagLabel}</strong>
                {travelTypeLabel ? <span>{travelTypeLabel}</span> : null}
              </span>
              <span className="schedule-trip-tooltip__body">
                {tooltip.schedules.length > 0
                  ? tooltip.schedules.map((schedule, index) => (
                      <span key={`${schedule}-${index}`}>{schedule}</span>
                    ))
                  : <span>일정 내용 없음</span>}
              </span>
            </span>,
            document.body,
          )
        : null}
    </div>
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
  let days: DisplayDay[] = item.schedule.days.map((day) => ({
    ...day,
    ownerMonthKey: item.monthKey,
  }));

  // 이전 근무표가 nextStartDate까지 담당하므로 그 이전 날짜는 표시하지 않음
  const prevNextStart = previousItem?.schedule.nextStartDate ?? "";
  if (prevNextStart) {
    days = days.filter((day) => day.dateKey >= prevNextStart);
  }

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

function isAutoManagedGeneralRef(ref: SchedulePersonRef, dayIndex: Map<string, DaySchedule>) {
  return isAutoManagedGeneralAssignment(dayIndex.get(ref.dateKey), ref.category);
}

function isAutoManagedGeneralCategoryOnDay(day: DaySchedule | undefined, category: string) {
  return isAutoManagedGeneralAssignment(day, category);
}

function isGeneralAssistRoute(route: SchedulePersonRef[], dayIndex: Map<string, DaySchedule>) {
  if (route.length !== 2) return false;
  const generalCount = route.filter((ref) => isAutoManagedGeneralRef(ref, dayIndex)).length;
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

function findRefDayInScheduleMap(
  scheduleMap: Map<string, PublishedScheduleItem["schedule"]>,
  ref: SchedulePersonRef,
) {
  return scheduleMap.get(ref.monthKey)?.days.find((item) => item.dateKey === ref.dateKey);
}

function isAutoManagedGeneralRefInScheduleMap(
  scheduleMap: Map<string, PublishedScheduleItem["schedule"]>,
  ref: SchedulePersonRef,
) {
  return isAutoManagedGeneralAssignment(findRefDayInScheduleMap(scheduleMap, ref), ref.category);
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
  if (route.length !== 2) return false;
  const generalCount = route.filter((ref) => isAutoManagedGeneralRefInScheduleMap(scheduleMap, ref)).length;
  if (generalCount !== 1) return false;

  const workRef = route.find((ref) => !isAutoManagedGeneralRefInScheduleMap(scheduleMap, ref)) ?? null;
  const generalRef = route.find((ref) => isAutoManagedGeneralRefInScheduleMap(scheduleMap, ref)) ?? null;
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
    !isAutoManagedGeneralCategoryOnDay(day, category) &&
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

  const previewDayIndex = new Map<string, DaySchedule>();
  previewMap.forEach((schedule) => {
    schedule.days.forEach((day) => {
      previewDayIndex.set(day.dateKey, day);
    });
  });

  if (isGeneralAssistRoute(route, previewDayIndex)) {
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
        !isAutoManagedGeneralCategoryOnDay(day, category) &&
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

function buildActualDisplayDays(item: ScheduleDisplaySource) {
  return item.schedule.days.map((day) => ({
    ...day,
    ownerMonthKey: item.monthKey,
  }));
}

function getHomePreviewDays(
  days: DisplayDay[],
  todayKey: string,
  dayCount = HOME_PREVIEW_DAY_COUNT,
  startOffset = 0,
) {
  if (days.length === 0) return [];

  const exactTodayIndex = days.findIndex(
    (day) => day.dateKey === todayKey && !day.isOverflowMonth,
  );
  const todayIndex = exactTodayIndex >= 0 ? exactTodayIndex : days.findIndex((day) => day.dateKey === todayKey);
  const firstCurrentMonthIndex = days.findIndex((day) => !day.isOverflowMonth);
  const resolvedAnchorIndex = todayIndex >= 0 ? todayIndex : Math.max(firstCurrentMonthIndex, 0);
  const offset = todayIndex >= 0 ? startOffset : 0;
  const startIndex = Math.max(0, resolvedAnchorIndex + offset);

  return days.slice(startIndex, startIndex + dayCount);
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
    !isAutoManagedGeneralCategoryOnDay(day, category) &&
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
  if (isAutoManagedGeneralRef(source, dayIndex)) return false;
  if (isAutoManagedGeneralRef(target, dayIndex)) return false;
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

export function PublishedSchedulesPanel({ mode = "page", readOnlyPreview }: PublishedSchedulesPanelProps) {
  const isHomePreview = mode === "home";
  const isReadOnlyPreview = Boolean(readOnlyPreview);
  const [items, setItems] = useState<PublishedScheduleItem[]>(() =>
    (readOnlyPreview?.items ?? getPublishedSchedules()).map((item) => ({
      ...item,
      schedule: readOnlyPreview ? item.schedule : applyScheduleAssignmentDecorations(item.schedule),
    })),
  );
  const [itemsLoading, setItemsLoading] = useState(() => (
    readOnlyPreview ? false : getPublishedSchedules().length === 0
  ));
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
  const [panZoomState, setPanZoomState] = useState<PanZoomState>(initialPanZoomState);
  const [recommendationPortalStyle, setRecommendationPortalStyle] = useState<CSSProperties | null>(null);
  const [session, setSession] = useState(() => (readOnlyPreview ? null : getSession()));
  const printableScheduleRef = useRef<HTMLDivElement | null>(null);
  const scheduleScrollRef = useRef<HTMLDivElement | null>(null);
  const scheduleZoomRef = useRef<HTMLDivElement | null>(null);
  const scheduleNameChipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const compactMonthCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastFocusRefreshAtRef = useRef(0);
  const lastAssignmentSessionKeyRef = useRef("");
  const panZoomStateRef = useRef<PanZoomState>(initialPanZoomState);
  const activePanZoomPointersRef = useRef(new Map<number, ActivePanZoomPointer>());
  const panZoomGestureRef = useRef<PanZoomGesture>({ type: "idle" });
  const suppressPanZoomClickRef = useRef(false);
  const suppressPanZoomClickTimeoutRef = useRef<number | null>(null);
  const canHidePublishedSchedules = Boolean(!isReadOnlyPreview && session?.approved && session?.id);
  const username = readOnlyPreview?.displayName ?? session?.username ?? "";
  const scheduleAssignmentStore = useMemo<ScheduleAssignmentDataStore>(
    () => (isReadOnlyPreview ? { entries: {}, rows: {} } : getScheduleAssignmentStore()),
    [isReadOnlyPreview, items, scheduleHistory],
  );
  const visibleTripTagMap = useMemo(
    () => (
      isReadOnlyPreview
        ? getScheduleAssignmentVisibleTripTagMap(items.map((item) => item.schedule), scheduleAssignmentStore)
        : getScheduleAssignmentVisibleTripTagMap()
    ),
    [isReadOnlyPreview, items, scheduleAssignmentStore, scheduleHistory],
  );

  useEffect(() => {
    if (isReadOnlyPreview) return;
    return subscribeToAuth((nextSession) => {
      setSession(nextSession);
    });
  }, [isReadOnlyPreview]);

  useEffect(() => {
    if (isReadOnlyPreview) return;
    let cancelled = false;
    const localHidden = readLocalHiddenPublishedMonthKeys(session?.id, session?.username);
    setHiddenPublishedMonthKeys(localHidden);
    setDraftHiddenPublishedMonthKeys(localHidden);
    void loadHiddenPublishedMonthKeys(session?.id, session?.username)
      .then((nextHidden) => {
        if (cancelled) return;
        setHiddenPublishedMonthKeys(nextHidden);
        setDraftHiddenPublishedMonthKeys(nextHidden);
      })
      .catch((error) => {
        if (cancelled) return;
        setRequestMessage(error instanceof Error ? error.message : "근무표 숨김 상태를 불러오지 못했습니다.");
        setRequestMessageTone("warn");
      });
    return () => {
      cancelled = true;
    };
  }, [isReadOnlyPreview, session?.id, session?.username]);

  const syncItemsFromCache = () => {
    setItems(
      getPublishedSchedules().map((item) => ({
        ...item,
        schedule: applyScheduleAssignmentDecorations(item.schedule),
      })),
    );
  };

  const syncRequestsFromCache = () => {
    setRequests(getScheduleChangeRequests());
  };

  const loadItems = async () => {
    if (isReadOnlyPreview) return;
    setItemsLoading(true);
    try {
      const publishedItems = await refreshPublishedSchedules({ repair: true });
      const activeSession = getSession();
      if (activeSession?.approved) {
        try {
          const monthKeys = getScheduleAssignmentMonthKeysForDisplayItems(
            publishedItems.map((item) => ({
              monthKey: item.monthKey,
              schedule: item.schedule,
            })),
          );
          if (hasDeskAccess(activeSession.actualRole)) {
            await refreshTeamLeadAssignmentMonths(monthKeys);
          } else {
            await refreshScheduleAssignmentDisplayMonths(monthKeys);
          }
        } catch (error) {
          setRequestMessage(error instanceof Error ? error.message : "일정배정 정보를 불러오지 못했습니다.");
          setRequestMessageTone("warn");
        }
      }
      syncItemsFromCache();
    } finally {
      setItemsLoading(false);
    }
  };

  const loadRequests = async () => {
    if (isReadOnlyPreview) return;
    await refreshScheduleChangeRequests({
      statuses: ["pending"],
    });
    syncRequestsFromCache();
  };

  const syncScheduleHistory = () => {
    const nextHistory = readStoredScheduleState().generatedHistory.map((schedule) => ({
      monthKey: schedule.monthKey,
      schedule: applyScheduleAssignmentDecorations(schedule),
    }));
    setScheduleHistory(nextHistory);
  };

  const loadScheduleHistory = async () => {
    if (isReadOnlyPreview) return;
    const activeSession = getSession();
    if (!activeSession?.approved || !hasDeskAccess(activeSession.actualRole)) {
      setScheduleHistory([]);
      return;
    }

    const nextState = await refreshScheduleState();
    await refreshTeamLeadAssignmentMonths(
      getScheduleAssignmentMonthKeysForDisplayItems(
        nextState.generatedHistory.map((schedule) => ({
          monthKey: schedule.monthKey,
          schedule,
        })),
      ),
    );
    syncScheduleHistory();
  };

  useEffect(() => {
    if (isReadOnlyPreview) return;
    const sessionKey = session?.approved ? `${session.id}:${session.actualRole}` : "";
    if (!sessionKey || lastAssignmentSessionKeyRef.current === sessionKey) return;
    lastAssignmentSessionKeyRef.current = sessionKey;
    void loadItems().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
    });
  }, [isReadOnlyPreview, session?.approved, session?.id, session?.actualRole]);

  useEffect(() => {
    if (isReadOnlyPreview) return;
    let cancelled = false;
    let deferredHandle = 0;

    void loadItems().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
    });

    const runDeferredLoads = () => {
      if (cancelled) return;
      if (isHomePreview) return;
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
  }, [isReadOnlyPreview]);

  useEffect(() => {
    if (isReadOnlyPreview) return;
    if (!editMode) return;
    void loadRequests();
  }, [editMode, isReadOnlyPreview]);

  useEffect(() => {
    if (isReadOnlyPreview) return;
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
  }, [editMode, isReadOnlyPreview]);

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
    let frameId = 0;
    let settleTimeoutId = 0;
    const syncViewport = () => {
      const viewportWidth = Math.round(window.innerWidth);
      const viewportHeight = Math.round(window.innerHeight);
      setScheduleLayoutMode(
        getPublishedScheduleLayoutMode(viewportWidth, viewportHeight, coarsePointerMediaQuery.matches),
      );
    };
    const syncViewportByOrientation = () => {
      syncViewport();
    };
    syncViewport();
    frameId = window.requestAnimationFrame(syncViewport);
    settleTimeoutId = window.setTimeout(syncViewport, 150);
    coarsePointerMediaQuery.addEventListener?.("change", syncViewport);
    coarsePointerMediaQuery.addListener?.(syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewportByOrientation);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(settleTimeoutId);
      coarsePointerMediaQuery.removeEventListener?.("change", syncViewport);
      coarsePointerMediaQuery.removeListener?.(syncViewport);
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewportByOrientation);
    };
  }, []);

  const isPageMobileFullScheduleView = !isHomePreview && scheduleLayoutMode === "mobile" && mobilePageViewMode === "full";
  const isMobilePageSchedule = !isHomePreview && scheduleLayoutMode === "mobile";

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
  const isHomeThreeDayPreviewView = isHomePreview && scheduleLayoutMode !== "desktop";
  const isPageMobileThreeDayView = !isHomePreview && scheduleLayoutMode === "mobile" && mobilePageViewMode === "three-day";
  const isMobileThreeDayView = isHomeThreeDayPreviewView || isPageMobileThreeDayView;
  const isCompactThreeDayView = isHomeThreeDayPreviewView || isPageMobileThreeDayView;
  const allPendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);
  const publishedDayIndex = useMemo(() => buildDayIndex(activeItems), [activeItems]);
  const displayDays = useMemo(
    () => (selectedItem ? buildDisplayDays(selectedItem, previousDisplaySource) : []),
    [previousDisplaySource, selectedItem],
  );
  const homeMobileDisplayDays = useMemo(() => {
    if (!isHomePreview || !selectedItem) return displayDays;

    const merged = new Map<string, DisplayDay>();
    [
      ...(previousSelectedItem ? buildActualDisplayDays(previousSelectedItem) : []),
      ...displayDays,
      ...(nextSelectedItem ? buildActualDisplayDays(nextSelectedItem) : []),
    ].forEach((day) => {
      if (!merged.has(day.dateKey)) {
        merged.set(day.dateKey, day);
      }
    });

    return Array.from(merged.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  }, [displayDays, isHomePreview, nextSelectedItem, previousSelectedItem, selectedItem]);
  const homeResponsivePreviewDayCount =
    isHomeThreeDayPreviewView
      ? HOME_RESPONSIVE_PREVIEW_DAY_COUNT
      : HOME_PREVIEW_DAY_COUNT;
  const homeResponsivePreviewStartOffset =
    isHomeThreeDayPreviewView
      ? HOME_RESPONSIVE_PREVIEW_START_OFFSET
      : 0;
  const visibleDisplayDays = useMemo(
    () =>
      isHomePreview
          ? isHomeThreeDayPreviewView
            ? getHomePreviewDays(
                homeMobileDisplayDays,
                todayKey,
                homeResponsivePreviewDayCount,
                homeResponsivePreviewStartOffset,
              )
            : getWeeklyPreviewDays(displayDays, todayKey)
        : displayDays,
    [
      displayDays,
      homeMobileDisplayDays,
      homeResponsivePreviewDayCount,
      homeResponsivePreviewStartOffset,
      isHomePreview,
      isHomeThreeDayPreviewView,
      todayKey,
    ],
  );
  const mobileThreeDayDisplayDays = useMemo(() => {
    if (!isMobileThreeDayView) return [] as DisplayDay[];
    if (isHomeThreeDayPreviewView) return visibleDisplayDays;
    return visibleDisplayDays;
  }, [isHomeThreeDayPreviewView, isMobileThreeDayView, visibleDisplayDays]);
  const mobileThreeDayRowSize = MOBILE_THREE_DAY_ROW_SIZE;
  const mobileThreeDayRows = useMemo(() => {
    if (!isMobileThreeDayView) return [];

    const rows: DisplayDay[][] = [];
    for (let index = 0; index < mobileThreeDayDisplayDays.length; index += mobileThreeDayRowSize) {
      rows.push(mobileThreeDayDisplayDays.slice(index, index + mobileThreeDayRowSize));
    }
    return rows;
  }, [isMobileThreeDayView, mobileThreeDayDisplayDays, mobileThreeDayRowSize]);
  const homePreviewTitle = "이번주 근무표";
  const homePreviewRangeLabel =
    visibleDisplayDays.length > 0
      ? isHomeThreeDayPreviewView
        ? `어제부터 ${visibleDisplayDays.length}일`
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
    if (isReadOnlyPreview) return;
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

    let saveFailed = false;
    try {
      await saveHiddenPublishedMonthKeys(draftHiddenPublishedMonthKeys, session?.id, session?.username);
    } catch (error) {
      saveFailed = true;
      setRequestMessage(error instanceof Error ? error.message : "근무표 숨김 상태를 저장하지 못했습니다.");
      setRequestMessageTone("warn");
    }
    setHiddenPublishedMonthKeys(draftHiddenPublishedMonthKeys);
    setHideMode(false);
    if (!saveFailed) {
      setRequestMessage("내 홈 근무표 숨김 상태를 저장했습니다.");
      setRequestMessageTone("ok");
    }
  };

  const isCompactMonthlyView = false;
  const isCompactDailyView = false;
  const isCompactDailyLandscapeView = false;
  const shouldAutoFitSchedule = !isHomePreview && !isMobileThreeDayView && scheduleLayoutMode !== "desktop";
  const schedulePanelLayoutBaseClassName =
    scheduleLayoutMode === "mobile"
      ? "schedule-published-panel--mobile schedule-published-panel--fit schedule-published-panel--mobile-layout"
      : scheduleLayoutMode === "tablet"
        ? "schedule-published-panel--tablet schedule-published-panel--fit schedule-published-panel--mobile-layout"
        : "schedule-published-panel--desktop schedule-published-panel--desktop-layout";
  const schedulePanelLayoutClassName = `${schedulePanelLayoutBaseClassName}${isMobileThreeDayView ? " schedule-published-panel--three-day" : ""}${isHomeThreeDayPreviewView ? " schedule-published-panel--home-three-day" : ""}${isPageMobileThreeDayView ? " schedule-published-panel--page-three-day" : ""}${isPageMobileFullScheduleView ? " schedule-published-panel--mobile-full-fit schedule-published-panel--fit" : ""}`;
  const toggleMobilePageViewMode = () => {
    setMobilePageViewMode((current) => (current === "full" ? "three-day" : "full"));
  };

  const applyPanZoomState = (nextState: PanZoomState, syncReactState = true) => {
    panZoomStateRef.current = nextState;
    const zoomNode = scheduleZoomRef.current;
    const viewportNode = scheduleScrollRef.current;
    if (zoomNode) {
      zoomNode.style.transform = `translate3d(${nextState.x}px, ${nextState.y}px, 0) scale(${nextState.scale})`;
    }
    if (viewportNode) {
      viewportNode.dataset.scale = String(nextState.scale);
      viewportNode.dataset.fitScale = String(nextState.fitScale);
      viewportNode.dataset.panX = String(nextState.x);
      viewportNode.dataset.panY = String(nextState.y);
    }
    if (syncReactState) setPanZoomState(nextState);
  };

  const resetPanZoomView = () => {
    const current = panZoomStateRef.current;
    if (!shouldAutoFitSchedule || current.contentWidth <= 0) return;
    const position = clampPanZoomPosition(current, current.fitScale, 0, 0);
    applyPanZoomState({ ...current, ...position, scale: current.fitScale });
  };

  const zoomPanZoomView = (factor: number) => {
    const current = panZoomStateRef.current;
    if (!shouldAutoFitSchedule || current.contentWidth <= 0) return;
    const nextScale = clamp(current.scale * factor, current.fitScale, MAX_PAN_ZOOM_SCALE);
    const centerX = current.viewportWidth / 2;
    const centerY = current.viewportHeight / 2;
    const contentX = (centerX - current.x) / current.scale;
    const contentY = (centerY - current.y) / current.scale;
    const position = clampPanZoomPosition(
      current,
      nextScale,
      centerX - contentX * nextScale,
      centerY - contentY * nextScale,
    );
    applyPanZoomState({ ...current, ...position, scale: nextScale });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedItem) return;
    if (!shouldAutoFitSchedule) {
      panZoomStateRef.current = initialPanZoomState;
      setPanZoomState(initialPanZoomState);
      if (scheduleZoomRef.current) scheduleZoomRef.current.style.transform = "";
      return;
    }

    let frameId = 0;
    const measureSchedule = () => {
      const scrollNode = scheduleScrollRef.current;
      const zoomNode = scheduleZoomRef.current;
      if (!scrollNode || !zoomNode) return;
      const contentWidth = Math.ceil(zoomNode.offsetWidth);
      const contentHeight = Math.ceil(zoomNode.offsetHeight);
      const viewportWidth = scrollNode.clientWidth;
      if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0) return;

      const widthFitScale = viewportWidth / contentWidth;
      const fitScale = clamp(widthFitScale, MIN_FIT_SCALE, 1);
      const visualViewportTop = window.visualViewport?.offsetTop ?? 0;
      const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const visualViewportBottom = visualViewportTop + visualViewportHeight;
      const viewportElementTop = Math.max(visualViewportTop, scrollNode.getBoundingClientRect().top);
      const remainingViewportHeight = visualViewportBottom - viewportElementTop;
      const allocatedViewportHeight = Math.round(
        Math.max(remainingViewportHeight, visualViewportHeight * 0.6),
      );
      scrollNode.style.height = `${allocatedViewportHeight}px`;
      const viewportHeight = scrollNode.clientHeight;
      if (viewportHeight <= 0) return;
      const measuredState: PanZoomState = {
        x: 0,
        y: 0,
        scale: fitScale,
        fitScale,
        contentWidth,
        contentHeight,
        viewportWidth,
        viewportHeight,
      };
      const position = clampPanZoomPosition(measuredState, fitScale, 0, 0);
      applyPanZoomState({ ...measuredState, ...position });
    };

    const queueMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureSchedule);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queueMeasure);
    if (scheduleZoomRef.current) resizeObserver?.observe(scheduleZoomRef.current);
    if (scheduleScrollRef.current) resizeObserver?.observe(scheduleScrollRef.current);
    queueMeasure();
    window.visualViewport?.addEventListener("resize", queueMeasure);
    window.visualViewport?.addEventListener("scroll", queueMeasure);
    window.addEventListener("resize", queueMeasure);
    window.addEventListener("orientationchange", queueMeasure);
    window.addEventListener("scroll", queueMeasure, { passive: true });
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.visualViewport?.removeEventListener("resize", queueMeasure);
      window.visualViewport?.removeEventListener("scroll", queueMeasure);
      window.removeEventListener("resize", queueMeasure);
      window.removeEventListener("orientationchange", queueMeasure);
      window.removeEventListener("scroll", queueMeasure);
    };
  }, [
    visibleDisplayDays,
    selectedItem,
    shouldAutoFitSchedule,
  ]);

  useEffect(() => () => {
    if (suppressPanZoomClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressPanZoomClickTimeoutRef.current);
    }
  }, []);

  const markPanZoomGestureConsumed = () => {
    suppressPanZoomClickRef.current = true;
    if (suppressPanZoomClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressPanZoomClickTimeoutRef.current);
    }
    suppressPanZoomClickTimeoutRef.current = window.setTimeout(() => {
      suppressPanZoomClickRef.current = false;
      suppressPanZoomClickTimeoutRef.current = null;
    }, TAP_MAX_DURATION_MS + 100);
  };

  const handlePanZoomPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!shouldAutoFitSchedule || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (activePanZoomPointersRef.current.size === 0 && suppressPanZoomClickRef.current) {
      suppressPanZoomClickRef.current = false;
      if (suppressPanZoomClickTimeoutRef.current !== null) {
        window.clearTimeout(suppressPanZoomClickTimeoutRef.current);
        suppressPanZoomClickTimeoutRef.current = null;
      }
    }
    if (!event.currentTarget.contains(event.target as Node)) return;
    activePanZoomPointersRef.current.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      startedAt: performance.now(),
    });

    const pointers = Array.from(activePanZoomPointersRef.current.values());
    if (pointers.length !== 2) return;
    const [left, right] = pointers;
    const rect = event.currentTarget.getBoundingClientRect();
    const midpoint = getPointerMidpoint(left, right);
    const current = panZoomStateRef.current;
    panZoomGestureRef.current = {
      type: "pinch",
      startDistance: Math.max(1, getPointerDistance(left, right)),
      startScale: current.scale,
      anchorContentX: (midpoint.x - rect.left - current.x) / current.scale,
      anchorContentY: (midpoint.y - rect.top - current.y) / current.scale,
    };
    activePanZoomPointersRef.current.forEach((_, pointerId) => {
      try {
        event.currentTarget.setPointerCapture(pointerId);
      } catch {
        // The pointer may already have left the viewport.
      }
    });
    event.preventDefault();
  };

  const handlePanZoomPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!shouldAutoFitSchedule) return;
    const pointer = activePanZoomPointersRef.current.get(event.pointerId);
    if (!pointer) return;
    pointer.currentX = event.clientX;
    pointer.currentY = event.clientY;

    const pointers = Array.from(activePanZoomPointersRef.current.values());
    const current = panZoomStateRef.current;
    if (pointers.length >= 2) {
      const [left, right] = pointers;
      const rect = event.currentTarget.getBoundingClientRect();
      const midpoint = getPointerMidpoint(left, right);
      let gesture = panZoomGestureRef.current;
      if (gesture.type !== "pinch") {
        gesture = {
          type: "pinch",
          startDistance: Math.max(1, getPointerDistance(left, right)),
          startScale: current.scale,
          anchorContentX: (midpoint.x - rect.left - current.x) / current.scale,
          anchorContentY: (midpoint.y - rect.top - current.y) / current.scale,
        };
        panZoomGestureRef.current = gesture;
      }
      const nextScale = clamp(
        gesture.startScale * (getPointerDistance(left, right) / gesture.startDistance),
        current.fitScale,
        MAX_PAN_ZOOM_SCALE,
      );
      const localMidpointX = midpoint.x - rect.left;
      const localMidpointY = midpoint.y - rect.top;
      const position = clampPanZoomPosition(
        current,
        nextScale,
        localMidpointX - gesture.anchorContentX * nextScale,
        localMidpointY - gesture.anchorContentY * nextScale,
      );
      applyPanZoomState({ ...current, ...position, scale: nextScale }, false);
      event.preventDefault();
      return;
    }

    const distanceFromStart = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    let gesture = panZoomGestureRef.current;
    if (gesture.type === "idle" && distanceFromStart > TAP_MOVE_THRESHOLD) {
      gesture = {
        type: "pan",
        pointerId: event.pointerId,
        startClientX: pointer.startX,
        startClientY: pointer.startY,
        startX: current.x,
        startY: current.y,
      };
      panZoomGestureRef.current = gesture;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already have left the viewport.
      }
    }
    if (gesture.type !== "pan" || gesture.pointerId !== event.pointerId) return;

    const position = clampPanZoomPosition(
      current,
      current.scale,
      gesture.startX + event.clientX - gesture.startClientX,
      gesture.startY + event.clientY - gesture.startClientY,
    );
    applyPanZoomState({ ...current, ...position }, false);
    event.preventDefault();
  };

  const finishPanZoomPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const pointer = activePanZoomPointersRef.current.get(event.pointerId);
    if (!pointer) return;
    const gesture = panZoomGestureRef.current;
    const movement = Math.hypot(pointer.currentX - pointer.startX, pointer.currentY - pointer.startY);
    const elapsed = performance.now() - pointer.startedAt;
    const isTap = !cancelled && gesture.type === "idle" && movement <= TAP_MOVE_THRESHOLD && elapsed < TAP_MAX_DURATION_MS;

    activePanZoomPointersRef.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (!isTap) {
      markPanZoomGestureConsumed();
      event.preventDefault();
    }

    const remainingPointers = Array.from(activePanZoomPointersRef.current.entries());
    if (remainingPointers.length === 1 && gesture.type === "pinch") {
      const [pointerId, remaining] = remainingPointers[0];
      remaining.startX = remaining.currentX;
      remaining.startY = remaining.currentY;
      remaining.startedAt = performance.now();
      const current = panZoomStateRef.current;
      panZoomGestureRef.current = {
        type: "pan",
        pointerId,
        startClientX: remaining.currentX,
        startClientY: remaining.currentY,
        startX: current.x,
        startY: current.y,
      };
    } else if (remainingPointers.length === 0) {
      panZoomGestureRef.current = { type: "idle" };
      setPanZoomState(panZoomStateRef.current);
    }
  };

  const handlePanZoomClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressPanZoomClickRef.current) return;
    suppressPanZoomClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

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
      pageMargin: "0mm",
      bodyHtml: renderSchedulePrintHtml({
        title: printTitle,
        days: visibleDisplayDays,
        highlightedName: showMine ? username : null,
      }),
    });
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

    if (isAutoManagedGeneralRef(person.ref, publishedDayIndex)) {
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

  useEffect(() => {
    const floatingVisible =
      shouldAutoFitSchedule &&
      Boolean(firstSelectedRef) &&
      (isRecommendationPopoverOpen || Boolean(inlineRecommendationConfirmRef));
    if (!floatingVisible || !firstSelectedRef) {
      setRecommendationPortalStyle(null);
      return;
    }

    let frameId = 0;
    const syncPosition = () => {
      const anchor = scheduleNameChipRefs.current[getRefKey(firstSelectedRef)];
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const popoverWidth = Math.min(280, Math.max(180, window.innerWidth - 24));
        const popoverHeight = 240;
        let left: number;
        let top: number;

        if (scheduleLayoutMode === "mobile") {
          left = clamp(rect.left, 12, Math.max(12, window.innerWidth - popoverWidth - 12));
          top = rect.bottom + 8;
          if (top + popoverHeight > window.innerHeight - 12) {
            top = Math.max(12, rect.top - popoverHeight - 8);
          }
        } else {
          left = rect.right + 8;
          if (left + popoverWidth > window.innerWidth - 12) {
            left = Math.max(12, rect.left - popoverWidth - 8);
          }
          top = clamp(rect.top + rect.height / 2 - popoverHeight / 2, 12, Math.max(12, window.innerHeight - popoverHeight - 12));
        }

        setRecommendationPortalStyle((current) => {
          if (current?.left === left && current?.top === top && current?.width === popoverWidth) return current;
          return { left, top, width: popoverWidth };
        });
      }
      frameId = window.requestAnimationFrame(syncPosition);
    };

    syncPosition();
    return () => window.cancelAnimationFrame(frameId);
  }, [
    firstSelectedRef,
    inlineRecommendationConfirmRef,
    isRecommendationPopoverOpen,
    scheduleLayoutMode,
    shouldAutoFitSchedule,
  ]);

  const renderInlineRecommendedCandidates = (anchorRef: SchedulePersonRef) => {
    if (!sameRef(firstSelectedRef, anchorRef)) return null;

    const openToRight = scheduleLayoutMode !== "mobile";
    const inlineConfirmVisible =
      Boolean(inlineRecommendationConfirmRef) &&
      selectedRoute.length === 2 &&
      sameRef(selectedRoute[selectedRoute.length - 1] ?? null, inlineRecommendationConfirmRef);

    if (!isRecommendationPopoverOpen && !inlineConfirmVisible) return null;

    const popover = (
      <div
        data-swap-recommendation-root="true"
        className={shouldAutoFitSchedule ? "schedule-swap-recommendation-portal" : undefined}
        style={{
          position: shouldAutoFitSchedule ? "fixed" : "absolute",
          top: shouldAutoFitSchedule ? recommendationPortalStyle?.top : openToRight ? "50%" : "calc(100% + 8px)",
          left: shouldAutoFitSchedule ? recommendationPortalStyle?.left : openToRight ? "calc(100% + 8px)" : 0,
          width: shouldAutoFitSchedule ? recommendationPortalStyle?.width : undefined,
          transform: shouldAutoFitSchedule ? undefined : openToRight ? "translateY(-50%)" : undefined,
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
    if (!shouldAutoFitSchedule) return popover;
    if (!recommendationPortalStyle) return null;
    return createPortal(popover, document.body);
  };

  const handleSchedulePanelClickCapture = (event: React.MouseEvent<HTMLElement>) => {
    if (!firstSelectedRef || selectedRoute.length !== 1 || !isRecommendationPopoverOpen) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('[data-swap-recommendation-root="true"]')) return;
    if (target.closest('[data-schedule-change-name-chip="true"]')) {
      setIsRecommendationPopoverOpen(false);
      return;
    }
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
      data-read-only-preview={isReadOnlyPreview ? "true" : undefined}
      onClickCapture={isReadOnlyPreview ? undefined : handleSchedulePanelClickCapture}
    >
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        {isReadOnlyPreview ? (
          <div className="status note" role="status">
            {username} (프리뷰) · 읽기 전용 데모 · 합성 데이터 · 저장되지 않음
          </div>
        ) : null}
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
                <div className="schedule-home-preview-card">
                  <strong className="schedule-home-preview-title">{homePreviewTitle}</strong>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ display: "grid", gap: 2 }}>
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
                        {!isReadOnlyPreview ? (
                          <button className={`btn ${editMode ? "white" : ""}`} disabled={!username} onClick={toggleEditMode}>
                            {editMode ? "근무 수정 완료" : "근무 수정"}
                          </button>
                        ) : null}
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

              {isMobilePageSchedule ? (
                <div className="schedule-published-mobile-view-controls">
                  <button
                    className={`btn ${isPageMobileThreeDayView ? "white" : ""}`}
                    aria-pressed={isPageMobileThreeDayView}
                    onClick={toggleMobilePageViewMode}
                  >
                    {isPageMobileThreeDayView ? "전체 보기" : "보기 변경"}
                  </button>
                </div>
              ) : null}

              <div
                className={shouldAutoFitSchedule ? "schedule-pan-zoom-shell" : undefined}
                style={!shouldAutoFitSchedule ? { display: "contents" } : undefined}
              >

              {shouldAutoFitSchedule ? (
                <div
                  className="schedule-published-zoom-controls schedule-published-zoom-controls--hidden"
                  role="group"
                  aria-label="근무표 확대 및 이동"
                  data-swap-recommendation-root="true"
                >
                  <button
                    type="button"
                    className="btn"
                    aria-label="근무표 축소"
                    disabled={panZoomState.scale <= panZoomState.fitScale + 0.001}
                    onClick={() => zoomPanZoomView(1 / PAN_ZOOM_STEP)}
                  >
                    −
                  </button>
                  <button type="button" className="btn" onClick={resetPanZoomView}>
                    전체 맞춤
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label="근무표 확대"
                    disabled={panZoomState.scale >= MAX_PAN_ZOOM_SCALE - 0.001}
                    onClick={() => zoomPanZoomView(PAN_ZOOM_STEP)}
                  >
                    +
                  </button>
                  <span className="sr-only" aria-live="polite">
                    근무표 배율 {Math.round(panZoomState.scale * 100)}%
                  </span>
                </div>
              ) : null}

              <div
                ref={scheduleScrollRef}
                className={`schedule-calendar-scroll ${isCompactMonthlyView ? "schedule-calendar-scroll--monthly" : "schedule-calendar-scroll--daily"} ${shouldAutoFitSchedule ? "schedule-pan-zoom-viewport" : ""}`}
                data-testid={shouldAutoFitSchedule ? "schedule-pan-zoom-surface" : undefined}
                data-pan-zoom-enabled={shouldAutoFitSchedule ? "true" : undefined}
                data-layout-mode={scheduleLayoutMode}
                data-scale={shouldAutoFitSchedule ? panZoomState.scale : undefined}
                data-fit-scale={shouldAutoFitSchedule ? panZoomState.fitScale : undefined}
                data-pan-x={shouldAutoFitSchedule ? panZoomState.x : undefined}
                data-pan-y={shouldAutoFitSchedule ? panZoomState.y : undefined}
                data-content-width={shouldAutoFitSchedule ? panZoomState.contentWidth : undefined}
                data-content-height={shouldAutoFitSchedule ? panZoomState.contentHeight : undefined}
                aria-label={shouldAutoFitSchedule ? "확대 및 이동 가능한 월간 근무표" : undefined}
                onPointerDown={handlePanZoomPointerDown}
                onPointerMove={handlePanZoomPointerMove}
                onPointerUp={(event) => finishPanZoomPointer(event)}
                onPointerCancel={(event) => finishPanZoomPointer(event, true)}
                onLostPointerCapture={(event) => {
                  if (event.target !== event.currentTarget) return;
                  finishPanZoomPointer(event, true);
                }}
                onClickCapture={handlePanZoomClickCapture}
                style={{
                  height: shouldAutoFitSchedule
                    ? panZoomState.viewportHeight || "60dvh"
                    : undefined,
                  touchAction: shouldAutoFitSchedule ? "none" : undefined,
                }}
              >
              <div
                className={shouldAutoFitSchedule ? "schedule-pan-zoom-stage" : undefined}
                style={{
                  minWidth: shouldAutoFitSchedule ? 0 : undefined,
                  height: shouldAutoFitSchedule ? "100%" : undefined,
                  position: shouldAutoFitSchedule ? "relative" : undefined,
                }}
              >
              <div
                ref={scheduleZoomRef}
                className={`schedule-calendar-zoom ${isCompactMonthlyView ? "schedule-calendar-zoom--monthly" : "schedule-calendar-zoom--daily"}`}
                data-testid={shouldAutoFitSchedule ? "schedule-pan-zoom-content" : undefined}
                style={{
                  transform: shouldAutoFitSchedule ? `translate3d(${panZoomState.x}px, ${panZoomState.y}px, 0) scale(${panZoomState.scale})` : undefined,
                  transformOrigin: shouldAutoFitSchedule ? "0 0" : undefined,
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
                          gridTemplateColumns: `repeat(${mobileThreeDayRowSize}, minmax(0, 1fr))`,
                          gap: 6,
                          alignItems: "start",
                        }}
                      >
                        {row.map((day) => {
                          const label = getWeekdayLabel(day.dow);
                          const isWeekendLabel = label === "토" || label === "일";
                          return (
                            <div
                              key={`home-mobile-row-${rowIndex}-weekday-${day.dateKey}`}
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
                        })}
                        {row.length < mobileThreeDayRowSize ? Array.from({ length: mobileThreeDayRowSize - row.length }).map((_, fillerIndex) => (
                          <div
                            key={`home-mobile-row-${rowIndex}-weekday-filler-${fillerIndex}`}
                            aria-hidden="true"
                            style={{ minHeight: 0 }}
                          />
                        )) : null}
                        {row.map((day) => {
                          const isCurrentSheetDay = day.ownerMonthKey === selectedItem.monthKey;
                          const dayCardStyle = getDayCardStyle(day, isCurrentSheetDay);
                          const isToday = day.dateKey === todayKey;
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
                              if (isWeekendLike) return category !== "휴가" && category !== "제크";
                              return !["국회", "청사", "청와대"].includes(category);
                            })
                            .sort(([leftCategory], [rightCategory]) =>
                              compareDayAssignmentDisplayOrder(day, leftCategory, rightCategory),
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
                                border: isToday ? "3px solid rgba(56,189,248,.92)" : dayCardStyle.border,
                                overflow: "visible",
                                zIndex: dayHasInlineRecommendations ? 80 : dayHasRouteSelection ? 12 : 1,
                                boxShadow: isToday ? "0 0 0 2px rgba(125,211,252,.18), 0 12px 28px rgba(14,165,233,.16)" : undefined,
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
                                  <div key={`${day.dateKey}-${category}`} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: isCompactThreeDayView ? 8 : 10, padding: isCompactThreeDayView ? 4 : 6, background: "rgba(9,17,30,.34)" }}>
                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: isCompactThreeDayView ? "32px minmax(0, 1fr)" : "44px minmax(0, 1fr)",
                                        columnGap: isCompactThreeDayView ? 4 : 8,
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
                                          fontSize: isCompactThreeDayView ? 10 : 14,
                                          lineHeight: isCompactThreeDayView ? 1.05 : 1.1,
                                          minHeight: isCompactThreeDayView ? 24 : 38,
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
                                            isMine && (showMine || (editMode && !isAutoManagedGeneralRef(ref, publishedDayIndex)));
                                          const editModeMineHighlighted =
                                            isMine && editMode && !isAutoManagedGeneralRef(ref, publishedDayIndex);
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
                                          const tripTooltip = getScheduleAssignmentTripTooltip(
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
                                          const tripDisplayFontSizeBoost = assignmentDisplayText.includes("(출)") ? 2 : 0;
                                          const hasTaggedDisplayName = Boolean(nameTag || assignmentDisplayText !== assignmentDisplay.name);
                                          const nameTagColors = nameTag ? scheduleAssignmentNameTagColors[nameTag] : null;
                                          const duplicated = duplicateNameSet.has(assignmentDisplay.name.trim());
                                          const dimOtherNames = Boolean(username) && showMine && !isMine && !personObject.pending && !routeSelected;
                                          const isInteractiveChip =
                                            !isReadOnlyPreview && !isHomePreview && editMode && (!personObject.pending || Boolean(ownPendingRequest));
                                          return (
                                            <div
                                              key={personObject.key}
                                              className="schedule-trip-tooltip-layer"
                                              data-swap-recommendation-root={firstSelected ? "true" : undefined}
                                              style={{
                                                position: "relative",
                                                minWidth: 0,
                                                width: "100%",
                                                overflow: tripTooltip ? "visible" : isMobileThreeDayView ? "hidden" : "visible",
                                                zIndex: tripTooltip ? 20 : firstSelected ? 40 : routeSelected ? 10 : editModeMineHighlighted ? 8 : 1,
                                              }}
                                            >
                                              <PublishedScheduleTripTooltip
                                                tooltip={tripTooltip}
                                                clickEnabled={!isInteractiveChip}
                                                portalEnabled={shouldAutoFitSchedule}
                                                positionKey={`${panZoomState.x}:${panZoomState.y}:${panZoomState.scale}`}
                                              >
                                                <button
                                                  ref={(node) => {
                                                    scheduleNameChipRefs.current[getRefKey(ref)] = node;
                                                  }}
                                                  type="button"
                                                  data-schedule-change-name-chip="true"
                                                  className={`schedule-name-chip ${mineHighlighted ? "schedule-name-chip--featured" : ""} ${isCompactMonthlyView ? "schedule-name-chip--compact" : ""}`}
                                                  disabled={!isInteractiveChip && !tripTooltip}
                                                  onClick={() => {
                                                    if (!isInteractiveChip) return;
                                                    void handleNameClick(personObject);
                                                  }}
                                                  style={{
                                                  display: "flex",
                                                  flexDirection: "column",
                                                  gridColumn: "auto",
                                                  justifySelf: "stretch",
                                                  alignItems: "center",
                                                  justifyContent: "center",
                                                  minWidth: 0,
                                                  width: "100%",
                                                  maxWidth: "100%",
                                                  overflow: isMobileThreeDayView ? "hidden" : "visible",
                                                  gap: isCompactThreeDayView ? 0 : personObject.pending ? 0 : 5,
                                                  minHeight: isCompactThreeDayView ? 18 : 28,
                                                  padding: isCompactThreeDayView ? "2px" : "3px 4px",
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
                                                    minFontSize={shouldAutoFitSchedule || isCompactThreeDayView ? 3.5 : 9}
                                                    maxFontSize={(isCompactThreeDayView ? 10 : isCompactMonthlyView ? 16 : isCompactDailyView ? 16 : 18) + tripDisplayFontSizeBoost}
                                                    style={{
                                                      display: "inline-block",
                                                      flex: "0 1 auto",
                                                      minWidth: 0,
                                                      width: "100%",
                                                      margin: "0 auto",
                                                      overflow: "visible",
                                                      textOverflow: "clip",
                                                    }}
                                                  />
                                                  {personObject.pending ? <span style={{ fontSize: isCompactMonthlyView ? 8 : 9, marginTop: -2, lineHeight: 1 }}>요청중</span> : null}
                                                </button>
                                              </PublishedScheduleTripTooltip>
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
                        {row.length < mobileThreeDayRowSize
                          ? Array.from({ length: mobileThreeDayRowSize - row.length }).map((_, fillerIndex) => (
                              <div
                                key={`home-mobile-row-${rowIndex}-filler-${fillerIndex}`}
                                aria-hidden="true"
                                style={{ minHeight: 0 }}
                              />
                            ))
                          : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {buildPublishedWeeklyCalendarItems(
                      visibleDisplayDays,
                      selectedItem.monthKey,
                      isCompactMonthlyView,
                      (day) => {
                  const isCurrentSheetDay = day.ownerMonthKey === selectedItem.monthKey;
                  const dayCardStyle = getDayCardStyle(day, isCurrentSheetDay);
                  const isToday = day.dateKey === todayKey;
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
                      if (isWeekendLike) return category !== "휴가" && category !== "제크";
                      return !["국회", "청사", "청와대"].includes(category);
                    })
                    .sort(([leftCategory], [rightCategory]) =>
                      compareDayAssignmentDisplayOrder(day, leftCategory, rightCategory),
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
                        border: isToday ? "3px solid rgba(56,189,248,.92)" : dayCardStyle.border,
                        overflow: "visible",
                        zIndex: dayHasInlineRecommendations ? 80 : dayHasRouteSelection ? 12 : 1,
                        boxShadow: isToday ? "0 0 0 2px rgba(125,211,252,.18), 0 12px 28px rgba(14,165,233,.16)" : undefined,
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
                                  <div key={`${day.dateKey}-${category}`} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: isCompactThreeDayView ? 8 : 10, padding: isCompactThreeDayView ? 4 : 6, background: "rgba(9,17,30,.34)" }}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: isCompactThreeDayView ? "32px minmax(0, 1fr)" : "44px minmax(0, 1fr)",
                                columnGap: isCompactThreeDayView ? 4 : 8,
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
                                  fontSize: isCompactThreeDayView ? 10 : 14,
                                  lineHeight: isCompactThreeDayView ? 1.05 : 1.1,
                                  minHeight: isCompactThreeDayView ? 24 : 38,
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
                                    isMine && (showMine || (editMode && !isAutoManagedGeneralRef(ref, publishedDayIndex)));
                                  const editModeMineHighlighted =
                                    isMine && editMode && !isAutoManagedGeneralRef(ref, publishedDayIndex);
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
                                  const tripTooltip = getScheduleAssignmentTripTooltip(
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
                                  const tripDisplayFontSizeBoost = assignmentDisplayText.includes("(출)") ? 2 : 0;
                                  const hasTaggedDisplayName = Boolean(nameTag || assignmentDisplayText !== assignmentDisplay.name);
                                  const nameTagColors = nameTag ? scheduleAssignmentNameTagColors[nameTag] : null;
                                  const duplicated = duplicateNameSet.has(assignmentDisplay.name.trim());
                                  const dimOtherNames = Boolean(username) && showMine && !isMine && !personObject.pending && !routeSelected;
                                  const isInteractiveChip =
                                    !isReadOnlyPreview && !isHomePreview && editMode && (!personObject.pending || Boolean(ownPendingRequest));
                                  return (
                                    <div
                                      key={personObject.key}
                                      className="schedule-trip-tooltip-layer"
                                      data-swap-recommendation-root={firstSelected ? "true" : undefined}
                                      style={{
                                        position: "relative",
                                        minWidth: 0,
                                        width: "100%",
                                        overflow: tripTooltip ? "visible" : isMobileThreeDayView ? "hidden" : "visible",
                                        zIndex: tripTooltip ? 20 : firstSelected ? 40 : routeSelected ? 10 : editModeMineHighlighted ? 8 : 1,
                                      }}
                                    >
                                      <PublishedScheduleTripTooltip
                                        tooltip={tripTooltip}
                                        clickEnabled={!isInteractiveChip}
                                        portalEnabled={shouldAutoFitSchedule}
                                        positionKey={`${panZoomState.x}:${panZoomState.y}:${panZoomState.scale}`}
                                      >
                                        <button
                                          ref={(node) => {
                                            scheduleNameChipRefs.current[getRefKey(ref)] = node;
                                          }}
                                          type="button"
                                          data-schedule-change-name-chip="true"
                                          className={`schedule-name-chip ${mineHighlighted ? "schedule-name-chip--featured" : ""} ${isCompactMonthlyView ? "schedule-name-chip--compact" : ""}`}
                                          disabled={!isInteractiveChip && !tripTooltip}
                                          onClick={() => {
                                            if (!isInteractiveChip) return;
                                            void handleNameClick(personObject);
                                          }}
                                          style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gridColumn: "auto",
                                          justifySelf: "stretch",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          minWidth: 0,
                                          width: "100%",
                                          maxWidth: "100%",
                                          overflow: isMobileThreeDayView ? "hidden" : "visible",
                                          gap: isCompactThreeDayView ? 0 : personObject.pending ? 0 : 5,
                                          minHeight: isCompactThreeDayView ? 18 : isCompactMonthlyView ? 28 : isCompactDailyLandscapeView ? 38 : isCompactDailyView ? 30 : 30,
                                          padding: isCompactThreeDayView ? "2px" : isCompactMonthlyView ? "3px 4px" : isCompactDailyView ? "4px 4px" : "3px 4px",
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
                                            minFontSize={shouldAutoFitSchedule || isCompactThreeDayView ? 3.5 : 9}
                                            maxFontSize={(isCompactThreeDayView ? 10 : isCompactMonthlyView ? 16 : isCompactDailyView ? 16 : 18) + tripDisplayFontSizeBoost}
                                            style={{
                                              display: "inline-block",
                                              flex: "0 1 auto",
                                              minWidth: 0,
                                              width: "100%",
                                              margin: "0 auto",
                                              overflow: "visible",
                                              textOverflow: "clip",
                                            }}
                                          />
                                          {personObject.pending ? <span style={{ fontSize: isCompactMonthlyView ? 8 : 9, marginTop: -2, lineHeight: 1 }}>요청중</span> : null}
                                        </button>
                                      </PublishedScheduleTripTooltip>
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
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
