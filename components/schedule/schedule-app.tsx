"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  getAssignmentDisplayRank,
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
  addManualField,
  addPersonToCategory,
  autoRebalance,
  cycleDayAssignmentNameTag,
  cycleVacationEntryType,
  cloneScheduleState,
  compactGeneratedAssignments,
  formatVacationEntry,
  generateSchedule,
  getCategoryPeople,
  getEffectiveOffByCategory,
  getMonthKey,
  getStartPointerRawIndex,
  getUniquePeople,
  moveAssignmentCategory,
  parseVacationEntry,
  removeAssignmentCategory,
  removePersonFromCategory,
  sanitizeScheduleState,
  setMonthStartPointer,
  swapPersonSlots,
  updateDayHeaderName,
  updateManualAssignment,
} from "@/lib/schedule/engine";
import { getPublishedSchedules, publishSchedule, PublishedScheduleItem, refreshPublishedSchedules } from "@/lib/schedule/published";
import { PUBLISHED_SCHEDULES_STATUS_EVENT } from "@/lib/schedule/published";
import { CHANGE_REQUESTS_STATUS_EVENT } from "@/lib/schedule/change-requests";
import { readStoredScheduleState, refreshScheduleState, saveScheduleState, SCHEDULE_PERSIST_STATUS_EVENT } from "@/lib/schedule/storage";
import { deskEditableVacationTypes, vacationLegendOrder, vacationStyleTones, vacationTypeLabels } from "@/lib/schedule/vacation-styles";
import { VACATION_STATUS_EVENT } from "@/lib/vacation/storage";
import { CategoryKey, DaySchedule, MessageState, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef, ScheduleState, SnapshotItem, VacationType } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const ALL_DAYS_EDIT_KEY = "__all_days__";
const FOCUS_REFRESH_THROTTLE_MS = 60_000;

function getWeekdayLabel(dow: number) {
  return weekdayLabels[(dow + 6) % 7] ?? "";
}

function getAssignmentChipTag(category: string, name: string, day: DaySchedule) {
  if (!isGeneralAssignmentCategory(category)) return null;
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

interface AddPersonDialogState {
  dateKey: string;
  category: string;
  dayLabel: string;
}

const vacationLegendStyles = vacationStyleTones;

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
      {vacationLegendOrder.map((type) => (
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
            ...vacationLegendStyles[type],
          }}
        >
          {vacationTypeLabels[type]}
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
  return {
    name: parsed.name,
    chipStyle: vacationLegendStyles[parsed.type],
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

function getCategoryDisplayLabel(category: string) {
  const label = getScheduleCategoryLabel(category);
  return label === "뉴스대기" ? "뉴스\n대기" : label;
}

function getDayAssignmentSortRank(dateKey: string, category: string, isWeekendLike: boolean) {
  if (dateKey === "2026-05-01" && category === "야근") {
    return 999;
  }
  return getVisibleAssignmentDisplayRank(category, isWeekendLike);
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

function isSameSelectedSlot(
  left: { dateKey: string; category: string; index: number } | null,
  right: { dateKey: string; category: string; index: number },
) {
  if (!left) return false;
  return left.dateKey === right.dateKey && left.category === right.category && left.index === right.index;
}

function buildDisplayDays(days: DaySchedule[], previousDays?: DaySchedule[], targetMonth?: number) {
  if (days.length === 0) return days;
  const first = days[0];
  if (targetMonth && first.month !== targetMonth) return days;
  const firstDate = new Date(first.year, first.month - 1, first.day);
  const firstDow = firstDate.getDay();
  const mondayOffset = firstDow === 0 ? 6 : firstDow - 1;
  if (mondayOffset === 0) return days;

  const leading: DaySchedule[] = [];
  for (let offset = mondayOffset; offset >= 1; offset -= 1) {
    const date = new Date(firstDate);
    date.setDate(firstDate.getDate() - offset);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const matched = previousDays?.find((item) => item.dateKey === dateKey);
    if (matched) {
      leading.push({ ...matched, isOverflowMonth: true });
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
    });
  }

  return [...leading, ...days];
}

function getOwnedDisplayDays(days: DaySchedule[], previousSchedule?: { nextStartDate: string } | null) {
  if (days.length === 0) return days;
  const startDateKey = previousSchedule?.nextStartDate ?? days[0]?.dateKey;
  return days
    .filter((day) => day.dateKey >= startDateKey)
    .map((day) => ({
      ...day,
      isOverflowMonth: false,
    }));
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishMonthKey, setPublishMonthKey] = useState<string>("");
  const [publishedItems, setPublishedItems] = useState<PublishedScheduleItem[]>([]);
  const [originalPreviewSnapshot, setOriginalPreviewSnapshot] = useState<SnapshotItem | null>(null);
  const [requests, setRequests] = useState<ScheduleChangeRequest[]>([]);
  const [addPersonDialog, setAddPersonDialog] = useState<AddPersonDialogState | null>(null);
  const [addPersonName, setAddPersonName] = useState("");
  const [addPersonVacationType, setAddPersonVacationType] = useState<VacationType>("연차");
  const [orderOffEditor, setOrderOffEditor] = useState<OrderOffEditorState | null>(null);
  const [globalOffEditor, setGlobalOffEditor] = useState<GlobalOffEditorState | null>(null);
  const [isOrderEditMode, setIsOrderEditMode] = useState(false);
  const [isGeneralTeamAdding, setIsGeneralTeamAdding] = useState(false);
  const [generalTeamDraftName, setGeneralTeamDraftName] = useState("");
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const addPersonInputRef = useRef<HTMLInputElement | null>(null);
  const generalTeamInputRef = useRef<HTMLInputElement | null>(null);
  const editBackupRef = useRef<ScheduleState | null>(null);
  const printableScheduleRef = useRef<HTMLDivElement | null>(null);
  const isEditingDateRef = useRef(false);
  const lastFocusRefreshAtRef = useRef(0);
  const session = getSession();
  const isAllDaysEditMode = state.editDateKey === ALL_DAYS_EDIT_KEY;
  const isEditingDate = Boolean(state.editDateKey);
  const activeEditMonthKey = state.editingMonthKey ?? state.generated?.monthKey ?? null;

  const loadState = async () => {
    try {
      const nextState = await refreshScheduleState();
      editBackupRef.current = null;
      setState(nextState);
    } catch {
      editBackupRef.current = null;
      setState(readStoredScheduleState() ?? defaultScheduleState);
    }
  };

  const loadRequests = async () => {
    try {
      await refreshScheduleChangeRequests();
    } finally {
      setRequests(getScheduleChangeRequests());
    }
  };

  const loadPublishedItems = async () => {
    try {
      await refreshPublishedSchedules();
    } finally {
      setPublishedItems(getPublishedSchedules());
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([loadState(), loadRequests(), loadPublishedItems()]).finally(() => {
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
      void Promise.all([loadRequests(), loadState(), loadPublishedItems()]);
    };

    const onFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      refreshForRouteState();
    };

    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(CHANGE_REQUESTS_EVENT, refreshForRouteState);
    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(CHANGE_REQUESTS_EVENT, refreshForRouteState);
    };
  }, []);

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
    if (activeEditMonthKey === visibleMonthKey && (isAllDaysEditMode || state.editDateKey === addPersonDialog.dateKey)) return;
    setAddPersonDialog(null);
    setAddPersonName("");
  }, [activeEditMonthKey, addPersonDialog, isAllDaysEditMode, state.editDateKey, visibleMonthKey]);

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
    () => (visibleSchedule ? getOwnedDisplayDays(visibleSchedule.days, previousVisibleSchedule) : []),
    [previousVisibleSchedule, visibleSchedule],
  );
  const originalVisibleDays = useMemo(
    () =>
      originalPreviewSnapshot
        ? getOwnedDisplayDays(originalPreviewSnapshot.generated.days, previousOriginalSchedule)
        : [],
    [originalPreviewSnapshot, previousOriginalSchedule],
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
  const previousVisibleMonth = useMemo(
    () => (visibleSchedule ? getAdjacentMonth(visibleSchedule.year, visibleSchedule.month, -1) : null),
    [visibleSchedule],
  );
  const nextVisibleMonth = useMemo(
    () => (visibleSchedule ? getAdjacentMonth(visibleSchedule.year, visibleSchedule.month, 1) : null),
    [visibleSchedule],
  );
  const hasPreviousVisibleMonth = useMemo(
    () => Boolean(previousVisibleMonth && state.generatedHistory.some((item) => item.monthKey === previousVisibleMonth.monthKey)),
    [previousVisibleMonth, state.generatedHistory],
  );
  const hasNextVisibleMonth = useMemo(
    () => Boolean(nextVisibleMonth && state.generatedHistory.some((item) => item.monthKey === nextVisibleMonth.monthKey)),
    [nextVisibleMonth, state.generatedHistory],
  );
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
    setState((current) => sanitizeScheduleState(recipe(current)));
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
  };

  const cancelGlobalOffEdit = () => {
    setGlobalOffEditor(null);
  };

  const toggleOrderEditMode = () => {
    setIsOrderEditMode((current) => {
      const next = !current;
      if (next) {
        setGlobalOffEditor({
          selectedNames: [...state.offPeople],
        });
      }
      if (!next) {
        setOrderOffEditor(null);
        setGlobalOffEditor(null);
        setIsGeneralTeamAdding(false);
        setGeneralTeamDraftName("");
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
        offPeople: current.offPeople.filter((item) => item !== name),
      }),
    );
    setGlobalOffEditor((current) => (current ? { ...current, selectedNames: current.selectedNames.filter((item) => item !== name) } : current));
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
    setMessage({ tone: "ok", text: "기본 오프 인원을 저장했습니다." });
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

  const startDayEdit = (dateKey: string) => {
    if (!visibleSchedule || isEditingDate) return;
    editBackupRef.current = cloneScheduleState(state);
    const visibleScheduleClone = JSON.parse(JSON.stringify(visibleSchedule));
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        generated: visibleScheduleClone,
        generatedHistory: current.generatedHistory.map((item) =>
          item.monthKey === visibleScheduleClone.monthKey ? visibleScheduleClone : item,
        ),
        editDateKey: dateKey,
        editingMonthKey: visibleScheduleClone.monthKey,
        selectedPerson: null,
      }),
    );
    closeAddPersonDialog();
  };

  const startAllDaysEdit = () => {
    if (!visibleSchedule || isEditingDate) return;
    editBackupRef.current = cloneScheduleState(state);
    const visibleScheduleClone = JSON.parse(JSON.stringify(visibleSchedule));
    setState((current) =>
      sanitizeScheduleState({
        ...current,
        generated: visibleScheduleClone,
        generatedHistory: current.generatedHistory.map((item) =>
          item.monthKey === visibleScheduleClone.monthKey ? visibleScheduleClone : item,
        ),
        editDateKey: ALL_DAYS_EDIT_KEY,
        editingMonthKey: visibleScheduleClone.monthKey,
        selectedPerson: null,
      }),
    );
    closeAddPersonDialog();
  };

  const cancelDayEdit = () => {
    const backup = editBackupRef.current ? cloneScheduleState(editBackupRef.current) : null;
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
    editBackupRef.current = null;
    closeAddPersonDialog();
  };

  const confirmDayEdit = () => {
    if (!isEditingDate) return;
    const messageText = isAllDaysEditMode ? "근무표 수정 내용이 반영되었습니다." : "날짜 수정 내용이 반영되었습니다.";
    setState((current) =>
      sanitizeScheduleState({
        ...compactGeneratedAssignments(current),
        editDateKey: null,
        editingMonthKey: null,
        selectedPerson: null,
      }),
    );
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
    const result = generateSchedule(state);
    const nextState = sanitizeScheduleState(result.state);
    if (nextState.generated) {
      syncVacationMonthSheetFromGeneratedSchedule(nextState.generated);
    }
    setState(nextState);
    setVisibleMonthKey(nextState.generated?.monthKey ?? null);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const confirmGenerate = () => {
    setOverwriteConfirmOpen(false);
    const result = generateSchedule(state);
    const nextState = sanitizeScheduleState(result.state);
    if (nextState.generated) {
      syncVacationMonthSheetFromGeneratedSchedule(nextState.generated);
    }
    setState(nextState);
    setVisibleMonthKey(nextState.generated?.monthKey ?? null);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
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
    setState(result.state);
    setVisibleMonthKey(visibleSchedule.monthKey);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const confirmDeleteSchedule = () => {
    if (!visibleSchedule) return;
    const nextHistory = state.generatedHistory.filter((item) => item.monthKey !== visibleSchedule.monthKey);
    const nextVisible = nextHistory[visibleIndex - 1] ?? nextHistory[visibleIndex] ?? nextHistory[nextHistory.length - 1] ?? null;

    setState((current) =>
      sanitizeScheduleState({
        ...current,
        generatedHistory: current.generatedHistory.filter((item) => item.monthKey !== visibleSchedule.monthKey),
        generated: current.generated?.monthKey === visibleSchedule.monthKey ? nextVisible : current.generated,
        snapshots: Object.fromEntries(
          Object.entries(current.snapshots).filter(([monthKey]) => monthKey !== visibleSchedule.monthKey),
        ),
        editDateKey: current.editingMonthKey === visibleSchedule.monthKey ? null : current.editDateKey,
        editingMonthKey: current.editingMonthKey === visibleSchedule.monthKey ? null : current.editingMonthKey,
        selectedPerson: null,
      }),
    );
    setVisibleMonthKey(nextVisible?.monthKey ?? null);
    setDeleteConfirmOpen(false);
    closeAddPersonDialog();
    editBackupRef.current = null;
    setMessage({ tone: "ok", text: `${visibleSchedule.year}년 ${visibleSchedule.month}월 근무표를 삭제했습니다.` });
  };

  const confirmPublish = async () => {
    const target = state.generatedHistory.find((item) => item.monthKey === publishMonthKey);
    if (!target) return;
    const published = await publishSchedule(target);
    await loadPublishedItems();
    setPublishOpen(false);
    setMessage({ tone: "ok", text: `${published.title}를 홈화면에 게시했습니다.` });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button className="btn white" disabled={isEditingDate} onClick={onGenerate}>작성</button>
            <button className="btn" disabled={isEditingDate} onClick={onRebalance}>자동 재배치</button>
            <button className="btn" disabled={isEditingDate || !visibleSchedule} onClick={() => setDeleteConfirmOpen(true)}>삭제</button>
            <button className="btn" onClick={() => {
              setPublishMonthKey(visibleSchedule?.monthKey ?? state.generatedHistory[state.generatedHistory.length - 1]?.monthKey ?? "");
              setPublishOpen(true);
            }} disabled={isEditingDate}>
              근무표 게시
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
            평일 휴일로 입력한 날짜에는 `조근 / 연장 / 일반 / 야근 / 국회` 칸만 만들고 자동 배치는 하지 않습니다.
          </div>
          <div className="subgrid-2">
            <label>
              <div style={{ marginBottom: 8 }}>연도</div>
              <select className="field-select" disabled={isEditingDate} value={state.year} onChange={(e) => setState({ ...state, year: Number(e.target.value) })}>
                {SCHEDULE_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 8 }}>월</div>
              <select className="field-select" disabled={isEditingDate} value={state.month} onChange={(e) => setState({ ...state, month: Number(e.target.value) })}>
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
            <textarea className="field-textarea" disabled={isEditingDate} value={state.extraHolidays} onChange={(e) => setState({ ...state, extraHolidays: e.target.value })} placeholder="2,15,22" />
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
                                await Promise.all([loadRequests(), loadState(), loadPublishedItems()]);
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
                                  await Promise.all([loadRequests(), loadState(), loadPublishedItems()]);
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
            {visibleSchedule ? (
              <div className="schedule-toolbar-actions schedule-toolbar-actions--controls">
                <VacationLegendChips />
              <button
                className="btn"
                disabled={isEditingDate || !hasPreviousVisibleMonth}
                  onClick={() => {
                    if (!previousVisibleMonth) return;
                    setVisibleMonthKey(previousVisibleMonth.monthKey);
                    setState((current) => sanitizeScheduleState({ ...current, year: previousVisibleMonth.year, month: previousVisibleMonth.month }));
                  }}
              >
                이전 달
              </button>
              {isAllDaysEditMode ? (
                <>
                  <button className="btn white" onClick={confirmDayEdit}>
                    수정 완료
                  </button>
                  <button className="btn" onClick={cancelDayEdit}>
                    수정모드 취소
                  </button>
                </>
              ) : (
                <button className="btn" disabled={isEditingDate || !visibleSchedule} onClick={startAllDaysEdit}>
                  수정 모드
                </button>
              )}
              <strong className="schedule-current-title">{visibleSchedule.year}년 {visibleSchedule.month}월</strong>
              <button
                className="btn"
                  disabled={isEditingDate || !hasNextVisibleMonth}
                  onClick={() => {
                    if (!nextVisibleMonth) return;
                    setVisibleMonthKey(nextVisibleMonth.monthKey);
                    setState((current) => sanitizeScheduleState({ ...current, year: nextVisibleMonth.year, month: nextVisibleMonth.month }));
                  }}
                >
                  다음 달
                </button>
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
                {weekdayLabels.map((label) => {
                  const isWeekendLabel = label === "토" || label === "일";
                  return (
                  <div key={label} className="schedule-weekday" style={{ textAlign: "center", padding: "6px 4px", borderRadius: 12, border: isWeekendLabel ? "1px solid rgba(239,68,68,.4)" : "1px solid var(--line)", background: isWeekendLabel ? "rgba(239,68,68,.16)" : "rgba(255,255,255,.03)", color: isWeekendLabel ? "#ffffff" : undefined, fontWeight: 900, fontSize: 14 }}>
                    {label}
                  </div>
                )})}
                {visibleDays.map((day) => {
                  const isEditingVisibleMonth = activeEditMonthKey === visibleSchedule.monthKey && isEditingDate;
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
                  const visibleAssignments = Object.entries(day.assignments)
                    .filter(([category]) => {
                      if (isWeekendLike) return category !== "휴가" && category !== "제크" && category !== "청사";
                      return !["국회", "청사", "청와대"].includes(category);
                    })
                    .sort(
                      ([leftCategory], [rightCategory]) =>
                        getDayAssignmentSortRank(day.dateKey, leftCategory, isWeekendLike) -
                        getDayAssignmentSortRank(day.dateKey, rightCategory, isWeekendLike),
                    );

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
                                color: "#f8fbff",
                                fontSize: 21,
                                fontWeight: 900,
                                lineHeight: 1.1,
                                whiteSpace: "normal",
                                overflow: "visible",
                                textOverflow: "clip",
                                wordBreak: "keep-all",
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
                              onClick={() => startDayEdit(day.dateKey)}
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
                            draggable={canDragAssignments}
                            onDragStart={(event) => {
                              if (!canDragAssignments) return;
                              event.stopPropagation();
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "category", dateKey: day.dateKey, category }));
                            }}
                            onDragOver={(event) => {
                              if (!canDropAssignments) return;
                              event.preventDefault();
                            }}
                            onDrop={(event) => {
                              if (!canDropAssignments) return;
                              event.preventDefault();
                              const payload = event.dataTransfer.getData("text/plain");
                              if (!payload) return;
                              const source = parseScheduleDragPayload(payload);
                              if (!source) return;
                              if (source.kind === "person") return;
                              if (source.dateKey === day.dateKey) {
                                updateEditingState((current) => moveAssignmentCategory(current, day.dateKey, source.category, category));
                              }
                            }}
                            style={{
                              border: "1px solid rgba(255,255,255,.16)",
                              borderRadius: 10,
                              padding: 6,
                              background: "rgba(9,17,30,.34)",
                              cursor: canDragAssignments ? "grab" : "default",
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
                                  {getCategoryDisplayLabel(category)}
                                </strong>
                              </div>
                              {editMode && isEditingVisibleMonth ? (
                                <div style={{ display: "grid", gap: 6, justifyItems: "end", gridColumn: 2, gridRow: 1 }}>
                                  <button
                                    className="btn"
                                    style={{ width: 34, padding: "4px 0" }}
                                    onClick={() => {
                                      setAddPersonDialog({
                                        dateKey: day.dateKey,
                                        category,
                                        dayLabel: `${day.month}/${day.day}`,
                                      });
                                      setAddPersonName("");
                                    }}
                                  >
                                    +
                                  </button>
                                  <button
                                    className="btn"
                                    style={{
                                      width: 34,
                                      padding: "4px 0",
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
                                      style={{ padding: "4px 9px" }}
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
                                    monthKey: visibleSchedule.monthKey,
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
                                  const nameTagColors = nameTag ? scheduleAssignmentNameTagColors[nameTag] : null;
                                  const conflicted = conflictSet.has(`${category}-${name}`) || selected || personObject.pending;
                                  const weekendConflict = conflicted && isWeekendLike;
                                  return (
                                    <div
                                      key={personObject.key}
                                      onDragOver={(event) => {
                                        if (!canDropAssignments) return;
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
                                              : nameTagColors
                                                ? nameTagColors.border
                                              : highlighted
                                                ? "1px solid rgba(34,211,238,.35)"
                                                : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                        color: weekendConflict
                                          ? "#d8fbff"
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
                                          text={getAssignmentChipText(assignmentDisplay.name, nameTag)}
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
                                            top: -6,
                                            right: -6,
                                            width: 22,
                                            minWidth: 22,
                                            height: 22,
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
                {isOrderEditMode ? "수정모드 종료" : "수정모드"}
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
            {isOrderEditMode ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 12 }}>이름을 눌러 오프 설정</span>
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
              <span className="muted" style={{ fontSize: 12 }}>수정모드에서 편집</span>
            )}
          </div>

          <div className="schedule-order-name-grid schedule-order-name-grid--wide">
            {generalTeamPeople.map((name) => {
              const selected = ((isOrderEditMode ? globalOffEditor?.selectedNames : null) ?? state.offPeople).includes(name);
              return (
                <div key={`general-team-off-${name}`} className="schedule-order-name-cell-wrap">
                  <button
                    type="button"
                    className={`schedule-order-name-cell${selected ? " schedule-order-name-cell--selected" : ""}`}
                    disabled={!isOrderEditMode || !globalOffEditor}
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
                  {isOrderEditMode ? (
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
              {isOrderEditMode && globalOffEditor ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={appendGlobalOffPoolPerson}>추가</button>
                  <button className="btn primary" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={saveGlobalOffEdit}>저장</button>
                  <button className="btn" style={{ padding: "8px 12px", fontSize: 13 }} disabled={isEditingDate} onClick={cancelGlobalOffEdit}>취소</button>
                </div>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>수정모드에서 편집</span>
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
                  const selected = ((isOrderEditMode ? globalOffEditor?.selectedNames : null) ?? state.offPeople).includes(name);
                  return (
                    <div key={`global-off-${name}`} className="schedule-order-name-cell-wrap">
                      <button
                        type="button"
                        className={`schedule-order-name-cell${selected ? " schedule-order-name-cell--selected" : ""}`}
                        disabled={!isOrderEditMode || !globalOffEditor}
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
                      {isOrderEditMode ? (
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
                  {weekdayLabels.map((label) => {
                    const isWeekendLabel = label === "토" || label === "일";
                    return (
                    <div key={`preview-${label}`} className="schedule-weekday" style={{ textAlign: "center", padding: "8px 4px", borderRadius: 12, border: isWeekendLabel ? "1px solid rgba(239,68,68,.4)" : "1px solid var(--line)", background: isWeekendLabel ? "rgba(239,68,68,.16)" : "rgba(255,255,255,.03)", color: isWeekendLabel ? "#ffffff" : undefined, fontWeight: 900, fontSize: 14 }}>
                      {label}
                    </div>
                  )})}
                  {originalVisibleDays.map((day) => {
                    const dayCardStyle = getDayCardStyle(day);
                    const centeredDayLabel = getCenteredDayLabel(day);
                    const conflictSet = new Set(day.conflicts.map((item) => `${item.category}-${item.name}`));
                    const isWeekendLike = day.isWeekend || day.isHoliday;
                    const previewAssignments = Object.entries(day.assignments)
                      .filter(([category, names]) =>
                        names.length > 0 &&
                        (!isWeekendLike ? true : category !== "휴가" && category !== "제크" && category !== "청사"),
                      )
                      .sort(
                        ([leftCategory], [rightCategory]) =>
                          getDayAssignmentSortRank(day.dateKey, leftCategory, isWeekendLike) -
                          getDayAssignmentSortRank(day.dateKey, rightCategory, isWeekendLike),
                      );

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
                                color: "#f8fbff",
                                fontSize: 21,
                                fontWeight: 900,
                                lineHeight: 1.1,
                                whiteSpace: "normal",
                                overflow: "visible",
                                textOverflow: "clip",
                                wordBreak: "keep-all",
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
                                  {getCategoryDisplayLabel(category)}
                                </strong>
                              <div className="schedule-name-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 0, minHeight: 42, width: "100%" }}>
                                {names.map((name, index) => {
                                  const assignmentDisplay = getAssignmentDisplay(category, name);
                                  const nameTag = getAssignmentChipTag(category, assignmentDisplay.name, day);
                                  const nameTagColors = nameTag ? scheduleAssignmentNameTagColors[nameTag] : null;
                                  const conflicted = conflictSet.has(`${category}-${name}`);
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
                                          : nameTagColors
                                            ? nameTagColors.background
                                          : assignmentDisplay.chipStyle?.background ?? "rgba(255,255,255,.16)",
                                        border: conflicted
                                          ? weekendConflict
                                            ? "1px solid rgba(103,232,249,.65)"
                                            : "1px solid rgba(239,68,68,.28)"
                                          : nameTagColors
                                            ? nameTagColors.border
                                          : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                        color: weekendConflict
                                          ? "#d8fbff"
                                          : nameTagColors
                                            ? nameTagColors.color
                                            : assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                        fontWeight: 700,
                                        lineHeight: 1.3,
                                        boxShadow: "none",
                                      }}
                                    >
                                      <FittedNameText
                                        text={getAssignmentChipText(assignmentDisplay.name, nameTag)}
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
                    {deskEditableVacationTypes.map((type) => {
                      const selected = addPersonVacationType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          className="btn"
                          onClick={() => setAddPersonVacationType(type)}
                          style={{
                            padding: "8px 12px",
                            fontWeight: 800,
                            ...vacationLegendStyles[type],
                            border: selected ? "2px solid rgba(255,255,255,.96)" : vacationLegendStyles[type].border,
                            color: selected ? "#ffffff" : vacationLegendStyles[type].color,
                            background: selected
                              ? `linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.04)), ${vacationLegendStyles[type].background}`
                              : vacationLegendStyles[type].background,
                            boxShadow: selected
                              ? "0 0 0 2px rgba(255,255,255,.18), 0 10px 24px rgba(15,23,42,.34), inset 0 1px 0 rgba(255,255,255,.22)"
                              : "inset 0 1px 0 rgba(255,255,255,.08)",
                            transform: selected ? "translateY(-1px) scale(1.02)" : undefined,
                            filter: selected ? "saturate(1.15) brightness(1.08)" : "saturate(.92)",
                          }}
                        >
                          {vacationTypeLabels[type]}
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


