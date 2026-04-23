﻿import {
  categories,
  createEmptyOffByCategory,
  DEFAULT_JCHECK_COUNT,
  defaultPointers,
  defaultScheduleState,
  GENERAL_TEAM_DEFAULT_NAMES,
  buildScheduleAssignmentNameTagKey,
  getNextScheduleAssignmentNameTag,
  getStoredAssignmentDisplayRank,
  getScheduleCategoryLabel,
  isGeneralAssignmentCategory,
  SCHEDULE_MONTHS,
  SCHEDULE_YEAR_END,
  SCHEDULE_YEAR_START,
} from "@/lib/schedule/constants";
import { getDeskPriorityVacationMap } from "@/lib/schedule/desk-records";
import {
  CategoryKey,
  DaySchedule,
  GeneratedSchedule,
  GenerationResult,
  PointerState,
  ScheduleAssignmentNameTag,
  ScheduleState,
  SnapshotItem,
  VacationType,
} from "@/lib/schedule/types";

export function cloneScheduleState(state: ScheduleState): ScheduleState {
  return JSON.parse(JSON.stringify(state)) as ScheduleState;
}

function normalizeDayAssignments(day: DaySchedule) {
  const entries = Object.entries(day.assignments ?? {});
  const isWeekendLike = day.isWeekend || day.isHoliday;
  const overrideOrder = (day.assignmentOrderOverrides ?? []).filter((category, index, array) =>
    array.indexOf(category) === index && entries.some(([entryCategory]) => entryCategory === category),
  );
  return Object.fromEntries(
    entries
      .map(([category, names], index) => ({ category, names, index }))
      .sort((left, right) => {
        const leftOverrideIndex = overrideOrder.indexOf(left.category);
        const rightOverrideIndex = overrideOrder.indexOf(right.category);
        if (leftOverrideIndex >= 0 || rightOverrideIndex >= 0) {
          if (leftOverrideIndex < 0) return 1;
          if (rightOverrideIndex < 0) return -1;
          if (leftOverrideIndex !== rightOverrideIndex) return leftOverrideIndex - rightOverrideIndex;
        }
        const leftRank = getStoredAssignmentDisplayRank(left.category, isWeekendLike);
        const rightRank = getStoredAssignmentDisplayRank(right.category, isWeekendLike);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.index - right.index;
      })
      .map(({ category, names }) => [category, names]),
  ) as Record<string, string[]>;
}

function normalizeDayAssignmentNameTags(day: DaySchedule) {
  return Object.fromEntries(
    Object.entries(day.assignmentNameTags ?? {}).filter(([key, value]) => {
      if (value !== "gov" && value !== "law") return false;
      const [category, name] = key.split("::");
      if (!category || !name || !isGeneralAssignmentCategory(category)) return false;
      return (day.assignments[category] ?? []).includes(name);
    }),
  ) as Record<string, ScheduleAssignmentNameTag>;
}

function normalizeDayAssignmentLabelOverrides(day: DaySchedule) {
  return Object.fromEntries(
    Object.entries(day.assignmentLabelOverrides ?? {}).filter(([category, value]) => {
      if (!Object.prototype.hasOwnProperty.call(day.assignments ?? {}, category)) return false;
      return typeof value === "string" && value.trim().length > 0;
    }),
  ) as Record<string, string>;
}

function normalizeDayAssignmentOrderOverrides(day: DaySchedule) {
  return (day.assignmentOrderOverrides ?? []).filter((category, index, array) => {
    if (array.indexOf(category) !== index) return false;
    return Object.prototype.hasOwnProperty.call(day.assignments ?? {}, category);
  });
}

const REQUIRED_DAY_ASSIGNMENT_OVERRIDES: Record<
  string,
  {
    isHoliday: boolean;
    isCustomHoliday: boolean;
    isWeekdayHoliday: boolean;
    assignments: Record<string, string[]>;
  }
> = {
  "2026-05-01": {
    isHoliday: true,
    isCustomHoliday: true,
    isWeekdayHoliday: true,
    assignments: {
      조근: ["조용희"],
      일반: ["구본준", "이지수", "김진광", "박대권"],
      석근: ["이학진", "김재식", "김준택"],
      야근: ["반일훈"],
    },
  },
};

function hasRequiredDayOverride(dateKey: string) {
  return dateKey in REQUIRED_DAY_ASSIGNMENT_OVERRIDES;
}

function applyRequiredDayOverride(day: DaySchedule): DaySchedule {
  const override = REQUIRED_DAY_ASSIGNMENT_OVERRIDES[day.dateKey];
  if (!override) {
    return {
      ...day,
      assignments: normalizeDayAssignments(day),
      assignmentNameTags: normalizeDayAssignmentNameTags(day),
    };
  }

  return {
    ...day,
    isHoliday: override.isHoliday,
    isCustomHoliday: override.isCustomHoliday,
    isWeekdayHoliday: override.isWeekdayHoliday,
    assignments: normalizeDayAssignments({
      ...day,
      isHoliday: override.isHoliday,
      assignments: override.assignments,
    }),
    assignmentNameTags: normalizeDayAssignmentNameTags({
      ...day,
      isHoliday: override.isHoliday,
      assignments: override.assignments,
    }),
    assignmentLabelOverrides: normalizeDayAssignmentLabelOverrides({
      ...day,
      isHoliday: override.isHoliday,
      assignments: override.assignments,
    }),
    assignmentOrderOverrides: normalizeDayAssignmentOrderOverrides({
      ...day,
      isHoliday: override.isHoliday,
      assignments: override.assignments,
    }),
    manualExtras: [],
  };
}

export function normalizeGeneratedSchedule(schedule: GeneratedSchedule): GeneratedSchedule {
  return {
    ...schedule,
    days: schedule.days.map((day) => {
      const normalizedDay = applyRequiredDayOverride(day);
      return {
        ...normalizedDay,
        assignmentNameTags: normalizeDayAssignmentNameTags(normalizedDay),
        assignmentLabelOverrides: normalizeDayAssignmentLabelOverrides(normalizedDay),
        assignmentOrderOverrides: normalizeDayAssignmentOrderOverrides(normalizedDay),
      };
    }),
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeEditableNameList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)));
}

const REQUIRED_EXTRA_HOLIDAYS = ["2026-05-01"];

function getRequiredExtraHolidays(year?: number, month?: number) {
  if (!year || !month) return [...REQUIRED_EXTRA_HOLIDAYS];
  const monthKey = getMonthKey(year, month);
  return REQUIRED_EXTRA_HOLIDAYS.filter((dateKey) => dateKey.startsWith(`${monthKey}-`));
}

function normalizeHolidayToken(token: string, year?: number, month?: number) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  if (/^\d{1,2}$/.test(token) && year && month) {
    const day = Number(token);
    if (day >= 1 && day <= daysInMonth(year, month)) {
      return fmtDate(year, month, day);
    }
  }
  return token;
}

function normalizeExtraHolidaysText(value: unknown, year?: number, month?: number) {
  const merged = new Set(
    String(typeof value === "string" ? value : "")
      .split(/[,\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const normalized = new Set(
    Array.from(merged)
      .map((item) => normalizeHolidayToken(item, year, month))
      .filter(Boolean),
  );

  return [...normalized].join(", ");
}

function syncDayVacationsFromState(state: ScheduleState, days: DaySchedule[]) {
  const vacationMap = mergeVacationMaps(getDeskPriorityVacationMap(), parseVacationMap(state.vacations));

  days.forEach((day) => {
    const nextVacations = [...(vacationMap[day.dateKey] ?? [])];
    day.vacations = nextVacations;

    if (nextVacations.length > 0) {
      day.assignments["휴가"] = nextVacations;
      return;
    }

    delete day.assignments["휴가"];
  });
}

export function syncGeneralAssignments(state: ScheduleState, days: DaySchedule[], generalTeamPeople: string[]) {
  const orderedDays = [...days].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  syncDayVacationsFromState(state, orderedDays);
  let previousNight: string[] = [];

  orderedDays.forEach((day) => {
    if (hasRequiredDayOverride(day.dateKey)) {
      const overriddenDay = applyRequiredDayOverride(day);
      day.isHoliday = overriddenDay.isHoliday;
      day.isCustomHoliday = overriddenDay.isCustomHoliday;
      day.isWeekdayHoliday = overriddenDay.isWeekdayHoliday;
      day.assignments = overriddenDay.assignments;
      day.manualExtras = overriddenDay.manualExtras;
      day.conflicts = collectConflicts(day.assignments, previousNight, [], day.dateKey);
      day.assignmentNameTags = normalizeDayAssignmentNameTags(day);
      previousNight = (day.assignments["야근"] ?? []).map((name) => name.trim()).filter(Boolean);
      return;
    }

    if (day.isWeekend || day.isWeekdayHoliday || day.isCustomHoliday) {
      delete day.assignments["일반"];
      day.conflicts = collectConflicts(day.assignments, previousNight, [], day.dateKey);
      day.assignmentNameTags = normalizeDayAssignmentNameTags(day);
      previousNight = (day.assignments["야근"] ?? []).map((name) => name.trim()).filter(Boolean);
      return;
    }

    const assignedNames = new Set<string>();
    Object.entries(day.assignments).forEach(([category, names]) => {
      if (category === "일반") return;
      names.forEach((name) => {
        if (category === "휴가") {
          const vacationName = parseVacationEntry(name).name.trim();
          if (vacationName) assignedNames.add(vacationName);
          return;
        }

        const trimmed = name.trim();
        if (trimmed) assignedNames.add(trimmed);
      });
    });
    day.vacations.forEach((entry) => {
      const vacationName = parseVacationEntry(entry).name.trim();
      if (vacationName) assignedNames.add(vacationName);
    });

    const globalOffSet = new Set((state.offPeople ?? []).map((name) => name.trim()).filter(Boolean));
    const nextGeneralNames = generalTeamPeople.filter(
      (name) => !assignedNames.has(name) && !previousNight.includes(name) && !globalOffSet.has(name),
    );

    if (nextGeneralNames.length > 0) {
      day.assignments["일반"] = nextGeneralNames;
    } else {
      delete day.assignments["일반"];
    }

    day.conflicts = collectConflicts(day.assignments, previousNight, [], day.dateKey);
    day.assignmentNameTags = normalizeDayAssignmentNameTags(day);
    previousNight = (day.assignments["야근"] ?? []).map((name) => name.trim()).filter(Boolean);
  });
}

export function sanitizeScheduleState(input?: Partial<ScheduleState> | null): ScheduleState {
  const base = cloneScheduleState(defaultScheduleState);
  if (!input) return base;
  const editDateKey = input.editDateKey ?? null;
  const editingMonthKey = editDateKey
    ? typeof input.editingMonthKey === "string"
      ? input.editingMonthKey
      : input.generated?.monthKey ?? null
    : null;
  const legacyOffPeople = Array.isArray(input.offPeople) ? input.offPeople : [];
  const nextOffByCategory = createEmptyOffByCategory();
  const nextOffExcludeByCategory = createEmptyOffByCategory();
  const nextOrders = Object.fromEntries(
    categories.map((category) => {
      const inputOrder = input.orders?.[category.key] ?? [];
      const hasAnyNames = inputOrder.some((name) => typeof name === "string" && name.trim().length > 0);
      const sourceOrder = hasAnyNames ? inputOrder : base.orders[category.key];

      return [
        category.key,
        Array.from({ length: 30 }, (_, index) => sourceOrder[index] ?? base.orders[category.key][index] ?? ""),
      ];
    }),
  ) as Record<CategoryKey, string[]>;

  categories.forEach((category) => {
    nextOffByCategory[category.key] = Array.from(
      new Set(
        input.offByCategory?.[category.key] ??
          (legacyOffPeople.length > 0 ? legacyOffPeople : base.offByCategory[category.key]),
      ),
    );
    nextOffExcludeByCategory[category.key] = Array.from(
      new Set(input.offExcludeByCategory?.[category.key] ?? base.offExcludeByCategory[category.key]),
    );
  });
  const snapshots = Object.fromEntries(
    Object.entries(input.snapshots ?? {}).map(([monthKey, items]) => [
      monthKey,
      (items ?? []).map((item) => ({
        ...item,
        generated: normalizeGeneratedSchedule(item.generated),
      })),
    ]),
  ) as Record<string, SnapshotItem[]>;
  const generated = input.generated ? normalizeGeneratedSchedule(input.generated) : null;
  const generatedHistory = (input.generatedHistory ?? (generated ? [generated] : [])).map((item) =>
    normalizeGeneratedSchedule(item),
  );
  const nextYear = clampNumber(input.year ?? base.year, SCHEDULE_YEAR_START, SCHEDULE_YEAR_END, base.year);
  const nextMonth = clampNumber(
    input.month ?? base.month,
    SCHEDULE_MONTHS[0],
    SCHEDULE_MONTHS[SCHEDULE_MONTHS.length - 1],
    base.month,
  );

  const normalizedGeneralTeamPeople = normalizeEditableNameList(
    input.generalTeamPeople ?? base.generalTeamPeople ?? GENERAL_TEAM_DEFAULT_NAMES,
  );
  const generalTeamPeople =
    normalizedGeneralTeamPeople.length > 0
      ? normalizedGeneralTeamPeople
      : [...GENERAL_TEAM_DEFAULT_NAMES];

  const nextState: ScheduleState = {
    ...base,
    ...input,
    year: nextYear,
    month: nextMonth,
    jcheckCount: DEFAULT_JCHECK_COUNT,
    extraHolidays: normalizeExtraHolidaysText(input.extraHolidays ?? base.extraHolidays, nextYear, nextMonth),
    generalTeamPeople: generalTeamPeople,
    globalOffPool: normalizeEditableNameList(input.globalOffPool),
    offPeople: Array.from(new Set(legacyOffPeople.map((name) => name.trim()).filter(Boolean))),
    offByCategory: nextOffByCategory,
    offExcludeByCategory: nextOffExcludeByCategory,
    orders: nextOrders,
    pointers: { ...defaultPointers, ...(input.pointers ?? {}) },
    monthStartPointers: Object.fromEntries(
      Object.entries(input.monthStartPointers ?? {}).map(([monthKey, pointerState]) => [
        monthKey,
        { ...defaultPointers, ...pointerState },
      ]),
    ) as Record<string, PointerState>,
    monthStartNames: Object.fromEntries(
      Object.entries(input.monthStartNames ?? {}).map(([monthKey, names]) => [
        monthKey,
        Object.fromEntries(
          Object.entries(names ?? {}).map(([key, name]) => [key, typeof name === "string" ? name.trim() : ""]),
        ),
      ]),
    ) as Record<string, Partial<Record<CategoryKey, string>>>,
    pendingSnapshotMonthKey: typeof input.pendingSnapshotMonthKey === "string" ? input.pendingSnapshotMonthKey : null,
    snapshots,
    generated,
    generatedHistory,
    currentUser: input.currentUser ?? base.currentUser,
    showMyWork: Boolean(input.showMyWork),
    editDateKey,
    editingMonthKey,
    selectedPerson: input.selectedPerson ?? null,
  };

  if (nextState.generated) {
    syncGeneralAssignments(nextState, nextState.generated.days, generalTeamPeople);
  }
  nextState.generatedHistory.forEach((item) => {
    syncGeneralAssignments(nextState, item.days, generalTeamPeople);
  });

  return nextState;
}

export function getUniquePeople(state: ScheduleState) {
  const set = new Set<string>();
  categories.forEach((category) => {
    state.orders[category.key].forEach((name) => {
      const trimmed = name.trim();
      if (trimmed) set.add(trimmed);
    });
  });
  return Array.from(set);
}

export function splitNames(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseVacationEntry(value: string): { type: VacationType; name: string } {
  const trimmed = value.trim();
  const matched = /^(연차|대휴|etc|기타|공가|근속휴가|건강검진|경조)\s*:(.+)$/.exec(trimmed); // 기존 데이터 호환을 위해 모든 유형을 매칭
  if (matched) {
    const type = matched[1];
    const normalizedType = (type === "연차" || type === "대휴") ? type : "기타"; // "etc", "공가", "경조" 등 모든 기타 유형을 "기타"로 매핑
    return {
      type: normalizedType as VacationType,
      name: matched[2].trim(),
    };
  }
  return {
    type: "연차",
    name: trimmed,
  };
}

export function formatVacationEntry(type: VacationType, name: string) {
  return `${type}:${name.trim()}`;
}

const VACATION_TYPE_SEQUENCE: VacationType[] = ["연차", "대휴", "기타"];

function getNextVacationType(type: VacationType): VacationType {
  const currentIndex = VACATION_TYPE_SEQUENCE.indexOf(type);
  if (currentIndex < 0) return VACATION_TYPE_SEQUENCE[0];
  return VACATION_TYPE_SEQUENCE[(currentIndex + 1) % VACATION_TYPE_SEQUENCE.length];
}

function getVacationNames(entries: string[]) {
  return entries.map((entry) => parseVacationEntry(entry).name).filter(Boolean);
}

function mergeVacationMaps(...maps: Array<Record<string, string[]>>) {
  const merged: Record<string, string[]> = {};
  maps.forEach((map) => {
    Object.entries(map).forEach(([dateKey, entries]) => {
      const current = merged[dateKey] ?? [];
      const currentNames = new Set(current.map((entry) => parseVacationEntry(entry).name));
      entries.forEach((entry) => {
        const parsed = parseVacationEntry(entry);
        if (!parsed.name || currentNames.has(parsed.name)) return;
        current.push(entry);
        currentNames.add(parsed.name);
      });
      merged[dateKey] = current;
    });
  });
  return merged;
}

export function parseHolidaySet(text: string, year?: number, month?: number) {
  const parsed = new Set(
    text
      .split(/[,\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => normalizeHolidayToken(item, year, month)),
  );
  getRequiredExtraHolidays(year, month).forEach((dateKey) => parsed.add(dateKey));
  return parsed;
}

export function parseVacationMap(text: string) {
  const map: Record<string, string[]> = {};
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [dateKey, ...rest] = line.split(":");
      if (!dateKey || rest.length === 0) return;
      map[dateKey.trim()] = rest
        .join(":")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    });
  return map;
}

function serializeVacationMap(map: Record<string, string[]>) {
  return Object.entries(map)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, entries]) => `${dateKey}: ${entries.join(", ")}`)
    .join("\n");
}

export function fmtDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getMonthStartPointers(state: ScheduleState, monthKey: string): PointerState {
  const base = { ...defaultPointers, ...(state.monthStartPointers[monthKey] ?? state.pointers) };
  const startNames = state.monthStartNames[monthKey] ?? {};

  categories.forEach((category) => {
    const startName = startNames[category.key]?.trim();
    if (!startName) return;
    const pool = getActiveOrderPool(state, category.key);
    const foundIndex = pool.findIndex((name) => name === startName);
    if (foundIndex >= 0) {
      base[category.key] = foundIndex + 1;
    }
  });

  return base;
}

export function getStartPointerRawIndex(state: ScheduleState, monthKey: string, key: CategoryKey) {
  const order = state.orders[key] ?? [];
  const startName = state.monthStartNames[monthKey]?.[key]?.trim();
  if (startName) {
    const rawIndex = order.findIndex((name) => name.trim() === startName);
    if (rawIndex >= 0) return rawIndex;
  }
  const nonEmptyIndices = order
    .map((name, index) => ({ name: name.trim(), index }))
    .filter((item) => Boolean(item.name))
    .map((item) => item.index);
  if (nonEmptyIndices.length === 0) return null;
  const pointer = getMonthStartPointers(state, monthKey)[key] || 1;
  const compactIndex = ((pointer - 1) % nonEmptyIndices.length + nonEmptyIndices.length) % nonEmptyIndices.length;
  return nonEmptyIndices[compactIndex] ?? null;
}

export function setMonthStartPointer(state: ScheduleState, monthKey: string, key: CategoryKey, rawIndex: number) {
  const order = state.orders[key] ?? [];
  const nonEmptyIndices = order
    .map((name, index) => ({ name: name.trim(), index }))
    .filter((item) => Boolean(item.name));
  const compactIndex = nonEmptyIndices.findIndex((item) => item.index === rawIndex);
  if (compactIndex < 0) return state;
  const selectedName = nonEmptyIndices[compactIndex]?.name ?? "";

  const next = cloneScheduleState(state);
  next.monthStartPointers = {
    ...next.monthStartPointers,
    [monthKey]: {
      ...defaultPointers,
      ...(next.monthStartPointers[monthKey] ?? next.pointers),
      [key]: compactIndex + 1,
    },
  };
  next.monthStartNames = {
    ...next.monthStartNames,
    [monthKey]: {
      ...(next.monthStartNames[monthKey] ?? {}),
      [key]: selectedName,
    },
  };
  next.pointers = {
    ...next.pointers,
    [key]: compactIndex + 1,
  };
  if (selectedName) {
    next.offByCategory = {
      ...next.offByCategory,
      [key]: (next.offByCategory[key] ?? []).filter((name) => name !== selectedName),
    };
  }
  const activePool = getActiveOrderPool(next, key);
  const activeIndex = activePool.findIndex((name) => name === selectedName);
  const nextPointer = activeIndex >= 0 ? activeIndex + 1 : compactIndex + 1;
  next.monthStartPointers = {
    ...next.monthStartPointers,
    [monthKey]: {
      ...next.monthStartPointers[monthKey],
      [key]: nextPointer,
    },
  };
  next.pointers = {
    ...next.pointers,
    [key]: nextPointer,
  };
  return next;
}

function formatDayOnly(dateKey: string) {
  const [, , day] = dateKey.split("-");
  return `${Number(day)}일`;
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function getScheduleRange(year: number, month: number) {
  if (year === 2026 && month === 5) {
    return {
      start: new Date(year, month - 1, 4),
      end: new Date(year, month - 1, 31),
    };
  }
  const start = new Date(year, month - 1, 1);
  const startDow = start.getDay();
  const diffToMonday = startDow === 0 ? -6 : 1 - startDow;
  if (diffToMonday !== 0) start.setDate(start.getDate() + diffToMonday);
  const last = new Date(year, month - 1, daysInMonth(year, month));
  const end = new Date(last);
  const dayOfWeek = end.getDay();
  if (dayOfWeek !== 0) end.setDate(end.getDate() + (7 - dayOfWeek));
  return { start, end };
}

function getOrderPool(state: ScheduleState, key: CategoryKey) {
  return state.orders[key].map((name) => name.trim()).filter(Boolean);
}

export function getEffectiveOffByCategory(state: ScheduleState, key: CategoryKey) {
  const globalOff = new Set((state.offPeople ?? []).map((name) => name.trim()).filter(Boolean));
  const categoryOff = new Set((state.offByCategory[key] ?? []).map((name) => name.trim()).filter(Boolean));
  const excluded = new Set((state.offExcludeByCategory[key] ?? []).map((name) => name.trim()).filter(Boolean));
  const merged = new Set<string>([...globalOff, ...categoryOff]);
  excluded.forEach((name) => merged.delete(name));
  return Array.from(merged);
}

function getActiveOrderPool(state: ScheduleState, key: CategoryKey) {
  const offSet = new Set(getEffectiveOffByCategory(state, key));
  return getOrderPool(state, key).filter((name) => !offSet.has(name));
}

export function getCategoryPeople(state: ScheduleState, key: CategoryKey) {
  return Array.from(new Set(getOrderPool(state, key)));
}

function getStartNameFromPointer(state: ScheduleState, key: CategoryKey, pointer: number) {
  const pool = getActiveOrderPool(state, key);
  if (pool.length === 0) return "";
  const index = ((pointer - 1) % pool.length + pool.length) % pool.length;
  return pool[index] ?? "";
}

function buildMonthStartNamesFromPointers(state: ScheduleState, pointers: PointerState) {
  return categories.reduce((accumulator, category) => {
    const pointer = pointers[category.key] || 1;
    accumulator[category.key] = getStartNameFromPointer(state, category.key, pointer);
    return accumulator;
  }, {} as Partial<Record<CategoryKey, string>>);
}

function nextCandidatesByOrder(
  state: ScheduleState,
  key: CategoryKey,
  count: number,
  blockedNames: Set<string>,
  excludeNames: string[],
  vacationNames: string[],
  pointers: PointerState,
) {
  const pool = getActiveOrderPool(state, key);
  const selected: string[] = [];
  if (pool.length === 0) return selected;

  let pointer = pointers[key] || 1;
  let guard = 0;
  while (selected.length < count && guard < pool.length * 6) {
    const index = ((pointer - 1) % pool.length + pool.length) % pool.length;
    const name = pool[index];
    if (
      name &&
      !blockedNames.has(name) &&
      !selected.includes(name) &&
      !excludeNames.includes(name) &&
      !vacationNames.includes(name)
    ) {
      selected.push(name);
    }
    pointer += 1;
    guard += 1;
  }

  pointers[key] = pointer;
  return selected;
}

function takeSequentialCandidatesByOrder(
  state: ScheduleState,
  key: CategoryKey,
  count: number,
  pointers: PointerState,
) {
  const pool = getActiveOrderPool(state, key);
  const selected: string[] = [];
  if (pool.length === 0 || count <= 0) return selected;

  let pointer = pointers[key] || 1;
  let taken = 0;
  while (taken < count) {
    const index = ((pointer - 1) % pool.length + pool.length) % pool.length;
    selected.push(pool[index]);
    pointer += 1;
    taken += 1;
  }

  pointers[key] = pointer;
  return selected;
}

function collectConflicts(
  assignments: Record<string, string[]>,
  previousNight: string[],
  warnings: Array<{ date: string; category: string; name: string }>,
  dateKey: string,
) {
  const conflicts: DaySchedule["conflicts"] = [];
  const conflictKeys = new Set<string>();

  const pushConflict = (category: string, name: string) => {
    const key = `${category}-${name}`;
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push({ category, name });
    warnings.push({ date: dateKey, category, name });
  };

  Object.entries(assignments).forEach(([category, names]) => {
    if (category === "휴가") return;
    names.forEach((name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (previousNight.includes(trimmed)) {
        pushConflict(category, trimmed);
      }
    });
  });

  const categoriesByName = new Map<string, string[]>();
  Object.entries(assignments).forEach(([category, names]) => {
    if (category === "휴가") return;
    names.forEach((name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const current = categoriesByName.get(trimmed) ?? [];
      if (!current.includes(category)) current.push(category);
      categoriesByName.set(trimmed, current);
    });
  });

  categoriesByName.forEach((categoriesForName, name) => {
    if (categoriesForName.length <= 1) return;
    categoriesForName.forEach((category) => pushConflict(category, name));
  });

  return conflicts;
}

function getAssignedNamesForDay(day: DaySchedule) {
  const assigned = new Set<string>();
  Object.values(day.assignments).forEach((names) => {
    names.forEach((name) => {
      const trimmed = name.trim();
      if (trimmed) assigned.add(trimmed);
    });
  });
  return assigned;
}

function ensureMonthlyJcheckCoverage(state: ScheduleState, days: DaySchedule[]) {
  const activePeople = getCategoryPeople(state, "jcheck").filter((name) => !(state.offByCategory.jcheck ?? []).includes(name));
  if (activePeople.length === 0) return;

  const eligibleDays = days.filter(
    (day) =>
      !day.isOverflowMonth &&
      day.month === state.month &&
      !day.isWeekend &&
      !day.isCustomHoliday &&
      Array.isArray(day.assignments["제크"]),
  );
  if (eligibleDays.length === 0) return;

  const assignedSet = new Set(eligibleDays.flatMap((day) => day.assignments["제크"] ?? []));
  const priorityDays = eligibleDays.filter((day) => day.dow === 1 || day.dow === 5);
  const fallbackDays = eligibleDays.filter((day) => day.dow !== 1 && day.dow !== 5);
  const missingPeople = activePeople.filter((name) => !assignedSet.has(name));

  const assignMissing = (targetDays: DaySchedule[], allowSameDayOtherWork: boolean) => {
    if (targetDays.length === 0) return;
    let dayIndex = 0;

    for (let personIndex = 0; personIndex < missingPeople.length; personIndex += 1) {
      const name = missingPeople[personIndex];
      if (!name || assignedSet.has(name)) continue;

      for (let offset = 0; offset < targetDays.length; offset += 1) {
        const target = targetDays[(dayIndex + offset) % targetDays.length];
        const usedNames = getAssignedNamesForDay(target);
        const isAvailable = !getVacationNames(target.vacations).includes(name) && !target.assignments["제크"].includes(name);
        const canAssign = isAvailable && (allowSameDayOtherWork || !usedNames.has(name));
        if (!canAssign) continue;

        target.assignments["제크"] = [...(target.assignments["제크"] ?? []), name];
        assignedSet.add(name);
        dayIndex = (dayIndex + offset + 1) % targetDays.length;
        break;
      }
    }
  };

  assignMissing(priorityDays, false);
  assignMissing(fallbackDays, false);
  assignMissing(priorityDays, true);
  assignMissing(fallbackDays, true);
}

export function generateSchedule(state: ScheduleState): GenerationResult {
  const nextState = cloneScheduleState(state);
  const monthKey = getMonthKey(nextState.year, nextState.month);
  const holidaySet = parseHolidaySet(nextState.extraHolidays, nextState.year, nextState.month);
  const vacationMap = mergeVacationMaps(getDeskPriorityVacationMap(), parseVacationMap(nextState.vacations));
  const range = getScheduleRange(nextState.year, nextState.month);
  const startPointers = getMonthStartPointers(nextState, monthKey);
  const pointers = { ...startPointers };
  const days: DaySchedule[] = [];
  const warnings: Array<{ date: string; category: string; name: string }> = [];
  let previousNight: string[] = [];
  let weeklyExtensionCrew: string[] = [];
  let weeklyExtensionWeekKey = "";

  for (const cursor = new Date(range.start); cursor <= range.end; cursor.setDate(cursor.getDate() + 1)) {
    const dateKey = fmtDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    const dow = cursor.getDay();
    const mondayAnchor = new Date(cursor);
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    mondayAnchor.setDate(cursor.getDate() + diffToMonday);
    const weekKey = fmtDate(mondayAnchor.getFullYear(), mondayAnchor.getMonth() + 1, mondayAnchor.getDate());
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidaySet.has(dateKey);
    const isCustomHoliday = isHoliday;
    const isWeekdayHoliday = isHoliday && !isWeekend;
    const vacations = vacationMap[dateKey] ?? [];
    const vacationNames = getVacationNames(vacations);
    const assignments: Record<string, string[]> = {};
    const desiredCounts: Record<string, number> = {};

    if (isCustomHoliday) {
      assignments["조근"] = [];
      assignments["연장"] = [];
      assignments["일반"] = [];
      assignments["야근"] = [];
      assignments["국회"] = [];
    } else if (isWeekend) {
      const weekendCrew = takeSequentialCandidatesByOrder(nextState, "holidayDuty", 4, pointers);
      assignments["주말조근"] = weekendCrew.slice(0, 1);
      assignments["주말일반근무"] = weekendCrew.slice(1, 3);
      assignments["뉴스대기"] = weekendCrew.slice(3, 4);
      assignments["청와대"] = [];
      assignments["국회"] = [];
    } else {
      assignments["조근"] = takeSequentialCandidatesByOrder(nextState, "morning", 2, pointers);

      if (dow >= 1 && dow <= 5) {
        if (weeklyExtensionWeekKey !== weekKey) {
          weeklyExtensionWeekKey = weekKey;
          weeklyExtensionCrew = takeSequentialCandidatesByOrder(nextState, "extension", 4, pointers);
        }
        assignments["연장"] = [...weeklyExtensionCrew];
      } else {
        assignments["연장"] = [];
      }

      assignments["석근"] = takeSequentialCandidatesByOrder(nextState, "evening", 3, pointers);
    }

    if (!isCustomHoliday) {
      let nightKey: CategoryKey = "nightWeekday";
      if (dow === 5) nightKey = "nightFriday";
      if (dow === 6) nightKey = "nightSaturday";
      if (dow === 0) nightKey = "nightSunday";
      assignments["야근"] = takeSequentialCandidatesByOrder(nextState, nightKey, 1, pointers);
    }

    if (!isWeekend && !isCustomHoliday) {
      assignments["제크"] = [];
    }

    if (isCustomHoliday) {
      assignments["국회"] = assignments["국회"] ?? [];
    } else if (isWeekend || isHoliday) {
      assignments["국회"] = [];
      assignments["청사"] = [];
      assignments["청와대"] = [];
    }

    if (vacations.length > 0) {
      assignments["휴가"] = [...vacations];
    }

    Object.entries(assignments).forEach(([category, names]) => {
      if (category === "휴가") return;
      desiredCounts[category] = names.length;
      assignments[category] = names.filter((name) => !vacationNames.includes(name));
    });

    const blockedNames = new Set(
      Object.entries(assignments)
        .filter(([category]) => category !== "휴가")
        .flatMap(([, names]) => names),
    );

    const refillCategory = (category: string, key: CategoryKey) => {
      const targetCount = desiredCounts[category] ?? 0;
      const currentNames = assignments[category] ?? [];
      if (targetCount <= currentNames.length) return;
      const nextNames = nextCandidatesByOrder(
        nextState,
        key,
        targetCount - currentNames.length,
        blockedNames,
        [],
        vacationNames,
        pointers,
      );
      nextNames.forEach((name) => blockedNames.add(name));
      assignments[category] = [...currentNames, ...nextNames];
    };

    refillCategory("조근", "morning");
    refillCategory("연장", "extension");
    refillCategory("석근", "evening");
    refillCategory("야근", dow === 5 ? "nightFriday" : dow === 6 ? "nightSaturday" : dow === 0 ? "nightSunday" : "nightWeekday");
    refillCategory("주말조근", "holidayDuty");
    refillCategory("주말일반근무", "holidayDuty");
    refillCategory("뉴스대기", "holidayDuty");

    const conflicts = collectConflicts(assignments, previousNight, warnings, dateKey);
    days.push({
      dateKey,
      day: cursor.getDate(),
      month: cursor.getMonth() + 1,
      year: cursor.getFullYear(),
      dow,
      isWeekend,
      isHoliday,
      isCustomHoliday,
      isWeekdayHoliday,
      isOverflowMonth: cursor.getMonth() + 1 !== nextState.month,
      vacations,
      assignments,
      manualExtras: [],
      headerName: "",
      conflicts,
    });
    previousNight = [...(assignments["야근"] ?? [])];
  }

  const nextMonthStart = new Date(range.end);
  nextMonthStart.setDate(nextMonthStart.getDate() + 1);
  const nextMonthKey = getMonthKey(nextMonthStart.getFullYear(), nextMonthStart.getMonth() + 1);
  const nextMonthStartNames = buildMonthStartNamesFromPointers(nextState, pointers);

  syncGeneralAssignments(nextState, days, nextState.generalTeamPeople);

  const generated: GeneratedSchedule = {
    year: nextState.year,
    month: nextState.month,
    monthKey,
    days,
    nextPointers: pointers,
    nextStartDate: fmtDate(nextMonthStart.getFullYear(), nextMonthStart.getMonth() + 1, nextMonthStart.getDate()),
  };

  nextState.generated = generated;
  nextState.monthStartPointers = {
    ...nextState.monthStartPointers,
    [monthKey]: startPointers,
    [nextMonthKey]: { ...pointers },
  };
  nextState.monthStartNames = {
    ...nextState.monthStartNames,
    [nextMonthKey]: nextMonthStartNames,
  };
  nextState.generatedHistory = [
    ...nextState.generatedHistory.filter((item) => item.monthKey !== generated.monthKey),
    generated,
  ].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  nextState.pointers = pointers;
  nextState.pendingSnapshotMonthKey = monthKey;

  return {
    state: nextState,
    warningCount: warnings.length,
    message:
      warnings.length > 0
        ? `순번대로 작성했고 충돌 ${warnings.length}건을 표시했습니다. 자동 재배치로 조정할 수 있습니다. 다음 근무표는 ${generated.nextStartDate}부터 이어서 작성하면 됩니다.`
        : `순번대로 작성했습니다. 다음 근무표는 ${generated.nextStartDate}부터 이어서 작성하면 됩니다.`,
  };
}

function mapCategoryToPointer(category: string, day: DaySchedule): CategoryKey {
  if (category === "조근") return "morning";
  if (category === "연장") return "extension";
  if (category === "석근") return "evening";
  if (category === "일반") return "evening";
  if (category === "제크") return "jcheck";
  if (category === "주말조근") return "holidayDuty";
  if (category === "주말일반근무" || category === "뉴스대기") return "holidayDuty";
  if (category === "야근") {
    if (day.dow === 5) return "nightFriday";
    if (day.dow === 6) return "nightSaturday";
    if (day.dow === 0) return "nightSunday";
    return "nightWeekday";
  }
  return "extension";
}

export function createSnapshot(state: ScheduleState, label = "원본") {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const currentGenerated = next.generated as GeneratedSchedule;
  const key = currentGenerated.monthKey;
  const item: SnapshotItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    createdAt: new Date().toLocaleString("ko-KR"),
    generated: cloneScheduleState(next).generated as GeneratedSchedule,
  };
  next.snapshots[key] = [item];
  return next;
}

export function autoRebalance(state: ScheduleState): GenerationResult {
  if (!state.generated) return { state, warningCount: 0, message: "먼저 근무표를 작성하세요." };

  const next = cloneScheduleState(state);
  const generated = cloneScheduleState(next).generated as GeneratedSchedule;
  let snapshotSavedThisRun = false;
  if (next.pendingSnapshotMonthKey === generated.monthKey) {
    const snapshotState = createSnapshot(next, "원본");
    next.snapshots = snapshotState.snapshots;
    next.pendingSnapshotMonthKey = null;
    snapshotSavedThisRun = true;
  }
  const warnings: Array<{ date: string; category: string; name: string }> = [];
  const changes: Array<{ sourceDate: string; targetDate: string; category: string; sourceName: string; targetName: string }> = [];
  const blockedSwapKeys = new Set<string>();
  const allDays = generated.days;
  const generatedIndex = next.generatedHistory.findIndex((item) => item.monthKey === generated.monthKey);
  const previousGenerated = generatedIndex > 0 ? next.generatedHistory[generatedIndex - 1] ?? null : null;
  const rebalanceStartDate = previousGenerated?.nextStartDate ?? allDays[0]?.dateKey ?? "";
  const sheetDays = allDays.filter((day) => day.dateKey >= rebalanceStartDate);
  const visibleDays = sheetDays;
  const rebalanceDateSet = new Set(sheetDays.map((day) => day.dateKey));
  const indexByDateKey = new Map(allDays.map((day, index) => [day.dateKey, index]));

  const getPreviousDay = (dateKey: string) => {
    const currentIndex = indexByDateKey.get(dateKey);
    if (currentIndex === undefined || currentIndex <= 0) return null;
    return allDays[currentIndex - 1] ?? null;
  };

  const getNextDay = (dateKey: string) => {
    const currentIndex = indexByDateKey.get(dateKey);
    if (currentIndex === undefined || currentIndex >= allDays.length - 1) return null;
    return allDays[currentIndex + 1] ?? null;
  };

  const getNightShiftGroup = (day: DaySchedule) => {
    if (day.dow === 5) return "friday";
    if (day.dow === 6) return "saturday";
    if (day.dow === 0) return "sunday";
    return "weekday";
  };

  const getWeekKey = (dateKey: string) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    date.setDate(date.getDate() + diffToMonday);
    return fmtDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  };

  const weekDaysByKey = visibleDays.reduce(
    (accumulator, day) => {
      const weekKey = getWeekKey(day.dateKey);
      accumulator.set(weekKey, [...(accumulator.get(weekKey) ?? []), day]);
      return accumulator;
    },
    new Map<string, DaySchedule[]>(),
  );

  const hasNightShiftPreviousDay = (dateKey: string, name: string) => {
    const previousDay = getPreviousDay(dateKey);
    return (previousDay?.assignments["야근"] ?? []).includes(name);
  };

  const hasLockedAssignmentNextDay = (dateKey: string, name: string) => {
    const nextDay = getNextDay(dateKey);
    if (!nextDay) return false;
    return (nextDay.assignments["연장"] ?? []).includes(name);
  };

  const canPlaceNameOnDay = (
    day: DaySchedule,
    category: string,
    indexToReplace: number,
    name: string,
  ) => {
    if (getVacationNames(day.vacations ?? []).includes(name)) return false;
    return !Object.entries(day.assignments).some(([currentCategory, names]) =>
      names.some((currentName, currentIndex) => {
        if (currentName !== name) return false;
        return !(currentCategory === category && currentIndex === indexToReplace);
      }),
    );
  };

  const getEquivalentCategories = (category: string) => {
    if (["주말조근", "주말일반근무", "뉴스대기"].includes(category)) {
      return ["주말조근", "주말일반근무", "뉴스대기"];
    }
    return [category];
  };

  const createSwapKey = (
    sourceRef: string,
    sourceName: string,
    targetRef: string,
    targetName: string,
  ) =>
    [`${sourceRef}|${sourceName}`, `${targetRef}|${targetName}`]
      .sort()
      .join("<->");

  const getAssignmentIndexes = (day: DaySchedule, category: string, name: string) =>
    (day.assignments[category] ?? [])
      .map((currentName, index) => ({ currentName, index }))
      .filter((item) => item.currentName === name)
      .map((item) => item.index);

  let getVisibleWarningCount = () => 0;
  let enforceLocalImprovement = true;

  const captureRebalanceSnapshot = () => ({
    days: allDays.map((day) => ({
      day,
      assignments: JSON.parse(JSON.stringify(day.assignments)) as Record<string, string[]>,
      conflicts: JSON.parse(JSON.stringify(day.conflicts)) as DaySchedule["conflicts"],
    })),
    blockedSwapKeys: new Set(blockedSwapKeys),
  });

  const restoreRebalanceSnapshot = (
    snapshot: ReturnType<typeof captureRebalanceSnapshot>,
  ) => {
    snapshot.days.forEach((item) => {
      item.day.assignments = JSON.parse(JSON.stringify(item.assignments)) as Record<string, string[]>;
      item.day.conflicts = JSON.parse(JSON.stringify(item.conflicts)) as DaySchedule["conflicts"];
    });
    blockedSwapKeys.clear();
    snapshot.blockedSwapKeys.forEach((key) => blockedSwapKeys.add(key));
  };

  const trySwapWithinCategory = (
    sourceDay: DaySchedule,
    category: string,
    index: number,
    sourceName: string,
  ) => {
    for (const candidateDay of visibleDays) {
      if (candidateDay.dateKey === sourceDay.dateKey) continue;
      const candidateNames = candidateDay.assignments[category] ?? [];
      if (candidateNames.length === 0) continue;

      for (let candidateIndex = 0; candidateIndex < candidateNames.length; candidateIndex += 1) {
        const candidateName = candidateNames[candidateIndex];
        if (!candidateName || candidateName === sourceName) continue;
        if (category === "야근" && getNightShiftGroup(sourceDay) !== getNightShiftGroup(candidateDay)) continue;
        if (hasNightShiftPreviousDay(sourceDay.dateKey, candidateName)) continue;
        if (hasNightShiftPreviousDay(candidateDay.dateKey, sourceName)) continue;
        if (category === "야근" && hasLockedAssignmentNextDay(sourceDay.dateKey, candidateName)) continue;
        if (category === "야근" && hasLockedAssignmentNextDay(candidateDay.dateKey, sourceName)) continue;
        if (!canPlaceNameOnDay(sourceDay, category, index, candidateName)) continue;
        if (!canPlaceNameOnDay(candidateDay, category, candidateIndex, sourceName)) continue;
        const swapKey = createSwapKey(
          `${sourceDay.dateKey}|${category}|${index}`,
          sourceName,
          `${candidateDay.dateKey}|${category}|${candidateIndex}`,
          candidateName,
        );
        if (blockedSwapKeys.has(swapKey)) continue;
        const beforeCount = enforceLocalImprovement ? getVisibleWarningCount() : 0;

        sourceDay.assignments[category][index] = candidateName;
        candidateDay.assignments[category][candidateIndex] = sourceName;
        const afterCount = enforceLocalImprovement ? getVisibleWarningCount() : beforeCount - 1;
        if (enforceLocalImprovement && afterCount >= beforeCount) {
          sourceDay.assignments[category][index] = sourceName;
          candidateDay.assignments[category][candidateIndex] = candidateName;
          getVisibleWarningCount();
          continue;
        }
        blockedSwapKeys.add(
          createSwapKey(
            `${sourceDay.dateKey}|${category}|${index}`,
            candidateName,
            `${candidateDay.dateKey}|${category}|${candidateIndex}`,
            sourceName,
          ),
        );
        changes.push({
          sourceDate: sourceDay.dateKey,
          targetDate: candidateDay.dateKey,
          category,
          sourceName,
          targetName: candidateName,
        });
        return true;
      }
    }

    return false;
  };

  const canSwapExtensionWeeks = (
    sourceWeekDays: DaySchedule[],
    candidateWeekDays: DaySchedule[],
    sourceName: string,
    candidateName: string,
  ) => {
    for (const day of sourceWeekDays) {
      if (!(day.assignments["연장"] ?? []).includes(sourceName)) continue;
      if (!canPlaceNameOnDay(day, "연장", (day.assignments["연장"] ?? []).indexOf(sourceName), candidateName)) return false;
      if (hasNightShiftPreviousDay(day.dateKey, candidateName)) return false;
    }

    for (const day of candidateWeekDays) {
      if (!(day.assignments["연장"] ?? []).includes(candidateName)) continue;
      if (!canPlaceNameOnDay(day, "연장", (day.assignments["연장"] ?? []).indexOf(candidateName), sourceName)) return false;
      if (hasNightShiftPreviousDay(day.dateKey, sourceName)) return false;
    }

    return true;
  };

  const trySwapExtensionWeek = (day: DaySchedule, sourceName: string) => {
    const sourceWeekKey = getWeekKey(day.dateKey);
    const sourceWeekDays = weekDaysByKey.get(sourceWeekKey) ?? [];
    if (sourceWeekDays.length === 0) return false;

    for (const [candidateWeekKey, candidateWeekDays] of weekDaysByKey.entries()) {
      if (candidateWeekKey === sourceWeekKey) continue;
      const candidateNames = Array.from(
        new Set(candidateWeekDays.flatMap((weekDay) => weekDay.assignments["연장"] ?? [])),
      ).filter((name) => Boolean(name) && name !== sourceName);

      for (const candidateName of candidateNames) {
        if (!canSwapExtensionWeeks(sourceWeekDays, candidateWeekDays, sourceName, candidateName)) continue;
        const swapKey = createSwapKey(
          `${sourceWeekKey}|연장|${sourceName}`,
          sourceName,
          `${candidateWeekKey}|연장|${candidateName}`,
          candidateName,
        );
        if (blockedSwapKeys.has(swapKey)) continue;
        const sourceWeekOriginal = sourceWeekDays.map((weekDay) => [...(weekDay.assignments["연장"] ?? [])]);
        const candidateWeekOriginal = candidateWeekDays.map((weekDay) => [...(weekDay.assignments["연장"] ?? [])]);
        const beforeCount = enforceLocalImprovement ? getVisibleWarningCount() : 0;

        sourceWeekDays.forEach((weekDay) => {
          weekDay.assignments["연장"] = (weekDay.assignments["연장"] ?? []).map((name) =>
            name === sourceName ? candidateName : name,
          );
        });
        candidateWeekDays.forEach((weekDay) => {
          weekDay.assignments["연장"] = (weekDay.assignments["연장"] ?? []).map((name) =>
            name === candidateName ? sourceName : name,
          );
        });
        const afterCount = enforceLocalImprovement ? getVisibleWarningCount() : beforeCount - 1;
        if (enforceLocalImprovement && afterCount >= beforeCount) {
          sourceWeekDays.forEach((weekDay, weekIndex) => {
            weekDay.assignments["연장"] = [...sourceWeekOriginal[weekIndex]];
          });
          candidateWeekDays.forEach((weekDay, weekIndex) => {
            weekDay.assignments["연장"] = [...candidateWeekOriginal[weekIndex]];
          });
          getVisibleWarningCount();
          continue;
        }
        blockedSwapKeys.add(
          createSwapKey(
            `${sourceWeekKey}|연장|${candidateName}`,
            candidateName,
            `${candidateWeekKey}|연장|${sourceName}`,
            sourceName,
          ),
        );
        changes.push({
          sourceDate: sourceWeekDays[0]?.dateKey ?? day.dateKey,
          targetDate: candidateWeekDays[0]?.dateKey ?? day.dateKey,
          category: "연장",
          sourceName,
          targetName: candidateName,
        });
        return true;
      }
    }

    return false;
  };

  const trySwapAcrossEquivalentCategories = (
    sourceDay: DaySchedule,
    sourceCategory: string,
    index: number,
    sourceName: string,
  ) => {
    const candidateCategories = getEquivalentCategories(sourceCategory);

    for (const candidateDay of visibleDays) {
      for (const candidateCategory of candidateCategories) {
        const candidateNames = candidateDay.assignments[candidateCategory] ?? [];
        if (candidateNames.length === 0) continue;

        for (let candidateIndex = 0; candidateIndex < candidateNames.length; candidateIndex += 1) {
          const candidateName = candidateNames[candidateIndex];
          if (!candidateName || candidateName === sourceName) continue;
          if (candidateDay.dateKey === sourceDay.dateKey && candidateCategory === sourceCategory && candidateIndex === index) continue;
          if (hasNightShiftPreviousDay(sourceDay.dateKey, candidateName)) continue;
          if (hasNightShiftPreviousDay(candidateDay.dateKey, sourceName)) continue;
          if (!canPlaceNameOnDay(sourceDay, sourceCategory, index, candidateName)) continue;
          if (!canPlaceNameOnDay(candidateDay, candidateCategory, candidateIndex, sourceName)) continue;
          const swapKey = createSwapKey(
            `${sourceDay.dateKey}|${sourceCategory}|${index}`,
            sourceName,
            `${candidateDay.dateKey}|${candidateCategory}|${candidateIndex}`,
            candidateName,
          );
          if (blockedSwapKeys.has(swapKey)) continue;
          const beforeCount = enforceLocalImprovement ? getVisibleWarningCount() : 0;

          sourceDay.assignments[sourceCategory][index] = candidateName;
          candidateDay.assignments[candidateCategory][candidateIndex] = sourceName;
          const afterCount = enforceLocalImprovement ? getVisibleWarningCount() : beforeCount - 1;
          if (enforceLocalImprovement && afterCount >= beforeCount) {
            sourceDay.assignments[sourceCategory][index] = sourceName;
            candidateDay.assignments[candidateCategory][candidateIndex] = candidateName;
            getVisibleWarningCount();
            continue;
          }
          blockedSwapKeys.add(
            createSwapKey(
              `${sourceDay.dateKey}|${sourceCategory}|${index}`,
              candidateName,
              `${candidateDay.dateKey}|${candidateCategory}|${candidateIndex}`,
              sourceName,
            ),
          );
          changes.push({
            sourceDate: sourceDay.dateKey,
            targetDate: candidateDay.dateKey,
            category: sourceCategory === candidateCategory ? sourceCategory : `${sourceCategory}/${candidateCategory}`,
            sourceName,
            targetName: candidateName,
          });
          return true;
        }
      }
    }

    return false;
  };

  const trySwapNameInCategory = (day: DaySchedule, category: string, name: string) => {
    const indexes = getAssignmentIndexes(day, category, name);
    for (const index of indexes) {
      if (trySwapWithinCategory(day, category, index, name)) return true;
      if (getEquivalentCategories(category).length > 1 && trySwapAcrossEquivalentCategories(day, category, index, name)) return true;
    }
    return false;
  };

  const tryResolvePreviousNightConflict = (day: DaySchedule, name: string) => {
    const previousDay = getPreviousDay(day.dateKey);
    if (!previousDay || !rebalanceDateSet.has(previousDay.dateKey)) return false;
    const previousNightIndex = (previousDay.assignments["야근"] ?? []).findIndex((nightName) => nightName === name);
    if (previousNightIndex < 0) return false;
    return trySwapWithinCategory(previousDay, "야근", previousNightIndex, name);
  };

  const tryResolveByCategoryPriority = (day: DaySchedule, name: string, preferredCategory?: string) => {
    const priorityCategories = ["조근", "석근", "일반", "제크"];
    const orderedCategories = [
      ...(preferredCategory && priorityCategories.includes(preferredCategory) ? [preferredCategory] : []),
      ...priorityCategories.filter((category) => category !== preferredCategory),
    ];

    for (const category of orderedCategories) {
      if (!(day.assignments[category] ?? []).includes(name)) continue;
      if (trySwapNameInCategory(day, category, name)) return true;
    }

    return false;
  };

  const tryResolveSameDayDuplicateBeforeNight = (day: DaySchedule, name: string) => {
    const priorityCategories = ["조근", "석근", "일반", "제크", "주말조근", "주말일반근무", "뉴스대기"];
    const duplicateCategories = priorityCategories.filter(
      (currentCategory) => currentCategory !== "야근" && (day.assignments[currentCategory] ?? []).includes(name),
    );

    for (const currentCategory of duplicateCategories) {
      if (trySwapNameInCategory(day, currentCategory, name)) return true;
    }

    if ((day.assignments["연장"] ?? []).includes(name) && trySwapExtensionWeek(day, name)) {
      return true;
    }

    return false;
  };

  const trySwapNightThenResolveIntroducedDuplicate = (day: DaySchedule, name: string) => {
    const nightIndexes = getAssignmentIndexes(day, "야근", name);
    if (nightIndexes.length === 0) return false;

    for (const nightIndex of nightIndexes) {
      const beforeCount = getVisibleWarningCount();

      for (const candidateDay of visibleDays) {
        if (candidateDay.dateKey === day.dateKey) continue;
        if (getNightShiftGroup(day) !== getNightShiftGroup(candidateDay)) continue;
        const candidateNames = candidateDay.assignments["야근"] ?? [];
        if (candidateNames.length === 0) continue;

        for (let candidateIndex = 0; candidateIndex < candidateNames.length; candidateIndex += 1) {
          const candidateName = candidateNames[candidateIndex];
          if (!candidateName || candidateName === name) continue;
          if (hasNightShiftPreviousDay(day.dateKey, candidateName)) continue;
          if (hasNightShiftPreviousDay(candidateDay.dateKey, name)) continue;
          if (hasLockedAssignmentNextDay(day.dateKey, candidateName)) continue;
          if (hasLockedAssignmentNextDay(candidateDay.dateKey, name)) continue;
          if (getVacationNames(candidateDay.vacations ?? []).includes(name)) continue;

          const snapshot = captureRebalanceSnapshot();

          day.assignments["야근"][nightIndex] = candidateName;
          candidateDay.assignments["야근"][candidateIndex] = name;

          const previousEnforcement = enforceLocalImprovement;
          enforceLocalImprovement = false;
          tryResolveSameDayDuplicateBeforeNight(day, candidateName);
          tryResolveSameDayDuplicateBeforeNight(candidateDay, name);
          enforceLocalImprovement = previousEnforcement;

          const afterCount = getVisibleWarningCount();
          if (afterCount < beforeCount) {
            blockedSwapKeys.add(
              createSwapKey(
                `${day.dateKey}|야근|${nightIndex}`,
                candidateName,
                `${candidateDay.dateKey}|야근|${candidateIndex}`,
                name,
              ),
            );
            changes.push({
              sourceDate: day.dateKey,
              targetDate: candidateDay.dateKey,
              category: "야근",
              sourceName: name,
              targetName: candidateName,
            });
            return true;
          }

          restoreRebalanceSnapshot(snapshot);
        }
      }
    }

    return false;
  };

  const tryResolveConflictWithPriority = (day: DaySchedule, category: string, name: string) => {
    if (category === "야근") {
      if (hasNightShiftPreviousDay(day.dateKey, name) && tryResolvePreviousNightConflict(day, name)) {
        return true;
      }
      if (tryResolveSameDayDuplicateBeforeNight(day, name)) {
        return true;
      }
      if (trySwapNightThenResolveIntroducedDuplicate(day, name)) {
        return true;
      }
      return trySwapNameInCategory(day, "야근", name);
    }

    if (hasNightShiftPreviousDay(day.dateKey, name) && tryResolvePreviousNightConflict(day, name)) {
      return true;
    }

    if (category !== "연장" && trySwapNameInCategory(day, category, name)) {
      return true;
    }

    if (tryResolveByCategoryPriority(day, name, category)) {
      return true;
    }

    if ((day.assignments["연장"] ?? []).includes(name) && trySwapExtensionWeek(day, name)) {
      return true;
    }

    return false;
  };

  const getAssignmentSignature = () =>
    JSON.stringify(
      sheetDays.map((day) => ({
        dateKey: day.dateKey,
        assignments: day.assignments,
      })),
    );

  const recomputeConflicts = () => {
    const nextWarnings: Array<{ date: string; category: string; name: string }> = [];
    let previousNight: string[] = [];
    allDays.forEach((day) => {
      day.conflicts = collectConflicts(day.assignments, previousNight, nextWarnings, day.dateKey);
      previousNight = [...(day.assignments["야근"] ?? [])];
    });
    return nextWarnings;
  };

  getVisibleWarningCount = () => recomputeConflicts().filter((warning) => rebalanceDateSet.has(warning.date)).length;

  const seenSignatures = new Set<string>();
  let passCount = 0;

  while (passCount < 100) {
    const beforeSignature = getAssignmentSignature();
    if (seenSignatures.has(beforeSignature)) break;
    seenSignatures.add(beforeSignature);

    const currentWarnings = recomputeConflicts().filter((warning) => rebalanceDateSet.has(warning.date));
    if (currentWarnings.length === 0) break;

    let resolvedInPass = false;

    for (const day of visibleDays) {
      for (const conflict of [...day.conflicts]) {
        if (tryResolveConflictWithPriority(day, conflict.category, conflict.name)) {
          resolvedInPass = true;
          break;
        }
      }

      if (resolvedInPass) break;
    }

    passCount += 1;
    if (!resolvedInPass) break;
  }

  warnings.splice(0, warnings.length, ...recomputeConflicts());
  const visibleWarnings = warnings.filter((warning) => rebalanceDateSet.has(warning.date));
  const visibleConflictDays = new Set(visibleWarnings.map((warning) => warning.date)).size;

  next.generated = generated;
  next.generatedHistory = next.generatedHistory.map((item) => (item.monthKey === generated.monthKey ? generated : item));
  const changeSummary =
    changes.length > 0
      ? ` 재배치: ${changes
          .map((item) => `${formatDayOnly(item.sourceDate)} ${getScheduleCategoryLabel(item.category)} ${item.sourceName}↔${formatDayOnly(item.targetDate)} ${getScheduleCategoryLabel(item.category)} ${item.targetName}`)
          .join(", ")}`
      : "";
  const snapshotSummary = snapshotSavedThisRun ? " 원본 사본을 저장했습니다." : "";
  return {
    state: next,
    warningCount: visibleWarnings.length,
    message:
      visibleWarnings.length > 0
        ? `자동 재배치 후에도 충돌 날짜 ${visibleConflictDays}일(상세 ${visibleWarnings.length}건)이 남아 있습니다.${snapshotSummary}${changeSummary}`
        : `자동 재배치가 완료되었습니다.${snapshotSummary}${changeSummary}`,
  };
}

export function openSnapshot(state: ScheduleState, snapshotId: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const currentGenerated = next.generated as GeneratedSchedule;
  const found = (next.snapshots[currentGenerated.monthKey] ?? []).find((item) => item.id === snapshotId);
  if (!found) return state;
  next.generated = found.generated;
  next.generatedHistory = next.generatedHistory.map((item) =>
    item.monthKey === found.generated.monthKey ? found.generated : item,
  );
  return next;
}

function syncGeneratedSchedule(next: ScheduleState, generated: GeneratedSchedule) {
  const normalizedGenerated = normalizeGeneratedSchedule(generated);
  const nextVacationMap = parseVacationMap(next.vacations);

  // Keep the vacation source-of-truth aligned with manual edits in schedule edit mode.
  normalizedGenerated.days.forEach((day) => {
    delete nextVacationMap[day.dateKey];
    const nextEntries = (day.assignments["휴가"] ?? day.vacations ?? []).map((name) => name.trim()).filter(Boolean);
    if (nextEntries.length > 0) {
      nextVacationMap[day.dateKey] = nextEntries;
    }
  });

  next.vacations = serializeVacationMap(nextVacationMap);
  syncGeneralAssignments(next, normalizedGenerated.days, next.generalTeamPeople);
  const warnings: Array<{ date: string; category: string; name: string }> = [];
  let previousNight: string[] = [];
  normalizedGenerated.days.forEach((day) => {
    day.conflicts = collectConflicts(day.assignments, previousNight, warnings, day.dateKey);
    previousNight = (day.assignments["야근"] ?? []).map((name) => name.trim()).filter(Boolean);
    if (day.assignments["휴가"]) {
      day.vacations = day.assignments["휴가"].map((name) => name.trim()).filter(Boolean);
    }
  });
  next.generated = normalizedGenerated;
  next.generatedHistory = next.generatedHistory.map((item) =>
    item.monthKey === normalizedGenerated.monthKey ? normalizedGenerated : item,
  );
  return next;
}

export function updateDayHeaderName(state: ScheduleState, dateKey: string, value: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;
  day.headerName = value;
  return syncGeneratedSchedule(next, generated);
}

export function cycleDayAssignmentNameTag(state: ScheduleState, dateKey: string, category: string, name: string) {
  if (!state.generated || !isGeneralAssignmentCategory(category)) return state;

  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;

  const key = buildScheduleAssignmentNameTagKey(category, name);
  const currentTag = day.assignmentNameTags?.[key] ?? null;
  const nextTag = getNextScheduleAssignmentNameTag(currentTag);
  const nextMap = { ...(day.assignmentNameTags ?? {}) };

  if (!nextTag) {
    delete nextMap[key];
  } else {
    nextMap[key] = nextTag;
  }

  day.assignmentNameTags = nextMap;
  return syncGeneratedSchedule(next, generated);
}

export function updateManualAssignment(state: ScheduleState, dateKey: string, category: string, value: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;
  day.assignments[category] = splitNames(value);
  if (category === "휴가") day.vacations = day.assignments[category];
  return syncGeneratedSchedule(next, generated);
}

export function updateDayAssignmentLabel(state: ScheduleState, dateKey: string, category: string, value: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day || !Object.prototype.hasOwnProperty.call(day.assignments, category)) return state;

  const trimmed = value.trim();
  const baseLabel = getScheduleCategoryLabel(category).trim();
  const nextOverrides = { ...(day.assignmentLabelOverrides ?? {}) };

  if (!trimmed || trimmed === baseLabel) {
    delete nextOverrides[category];
  } else {
    nextOverrides[category] = trimmed;
  }

  day.assignmentLabelOverrides = nextOverrides;
  return syncGeneratedSchedule(next, generated);
}

export function addManualField(state: ScheduleState, dateKey: string, name: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;
  const base = name.trim() || "추가칸";
  let finalName = base;
  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(day.assignments, finalName)) {
    finalName = `${base}${suffix}`;
    suffix += 1;
  }
  day.assignments[finalName] = [];
  day.manualExtras.push(finalName);
  day.assignmentOrderOverrides = [...(day.assignmentOrderOverrides ?? Object.keys(day.assignments)), finalName];
  return syncGeneratedSchedule(next, generated);
}

export function removeAssignmentCategory(state: ScheduleState, dateKey: string, category: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day || !Object.prototype.hasOwnProperty.call(day.assignments, category)) return state;
  delete day.assignments[category];
  if (day.assignmentLabelOverrides) {
    delete day.assignmentLabelOverrides[category];
  }
  if (day.assignmentOrderOverrides) {
    day.assignmentOrderOverrides = day.assignmentOrderOverrides.filter((item) => item !== category);
  }
  day.manualExtras = day.manualExtras.filter((item) => item !== category);
  day.conflicts = day.conflicts.filter((item) => item.category !== category);
  if (category === "휴가") day.vacations = [];
  if (next.selectedPerson?.dateKey === dateKey && next.selectedPerson.category === category) {
    next.selectedPerson = null;
  }
  return syncGeneratedSchedule(next, generated);
}

export function moveAssignmentCategory(
  state: ScheduleState,
  dateKey: string,
  sourceCategory: string,
  targetCategory: string,
) {
  if (!state.generated || sourceCategory === targetCategory) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;

  const order = Object.keys(day.assignments);
  if (!order.includes(sourceCategory) || !order.includes(targetCategory)) return state;

  const reordered = order.filter((item) => item !== sourceCategory);
  const targetIndex = reordered.indexOf(targetCategory);
  if (targetIndex < 0) return state;
  reordered.splice(targetIndex, 0, sourceCategory);
  day.assignments = Object.fromEntries(reordered.map((key) => [key, day.assignments[key] ?? []]));
  day.assignmentOrderOverrides = reordered;

  return syncGeneratedSchedule(next, generated);
}

export function shiftAssignmentCategory(
  state: ScheduleState,
  dateKey: string,
  category: string,
  direction: "up" | "down",
) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;

  const order = Object.keys(day.assignments);
  const sourceIndex = order.indexOf(category);
  if (sourceIndex < 0) return state;

  const targetIndex = direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return state;

  const reordered = [...order];
  const [movedCategory] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, movedCategory);
  day.assignments = Object.fromEntries(reordered.map((key) => [key, day.assignments[key] ?? []]));
  day.assignmentOrderOverrides = reordered;

  return syncGeneratedSchedule(next, generated);
}

export function addPersonToCategory(state: ScheduleState, dateKey: string, category: string, name: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;
  const trimmed = name.trim();
  if (!trimmed) return state;
  day.assignments[category] = [...(day.assignments[category] ?? []), trimmed];
  if (category === "휴가") day.vacations = day.assignments[category];
  return syncGeneratedSchedule(next, generated);
}

export function removePersonFromCategory(
  state: ScheduleState,
  dateKey: string,
  category: string,
  index: number,
  name?: string,
) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  const assignments = day?.assignments[category];
  if (!day || !assignments?.length) return state;
  let removeIndex = index;
  if (removeIndex < 0 || removeIndex >= assignments.length || (name && assignments[removeIndex] !== name)) {
    removeIndex = typeof name === "string" ? assignments.findIndex((item) => item === name) : -1;
  }
  if (removeIndex < 0 || removeIndex >= assignments.length) return state;
  assignments.splice(removeIndex, 1);
  if (category === "휴가") day.vacations = day.assignments[category];
  if (next.selectedPerson?.dateKey === dateKey && next.selectedPerson.category === category) {
    if (next.selectedPerson.index === removeIndex) {
      next.selectedPerson = null;
    } else if (next.selectedPerson.index > removeIndex) {
      next.selectedPerson = {
        ...next.selectedPerson,
        index: next.selectedPerson.index - 1,
      };
    }
  }
  return syncGeneratedSchedule(next, generated);
}

export function cycleVacationEntryType(
  state: ScheduleState,
  dateKey: string,
  index: number,
  name?: string,
) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  const assignments = day?.assignments["휴가"];
  if (!day || !assignments?.length) return state;

  let targetIndex = index;
  if (targetIndex < 0 || targetIndex >= assignments.length || (name && assignments[targetIndex] !== name)) {
    targetIndex = typeof name === "string" ? assignments.findIndex((item) => item === name) : -1;
  }
  if (targetIndex < 0 || targetIndex >= assignments.length) return state;

  const parsed = parseVacationEntry(assignments[targetIndex]);
  if (!parsed.name) return state;

  assignments[targetIndex] = formatVacationEntry(getNextVacationType(parsed.type), parsed.name);
  day.vacations = day.assignments["휴가"];

  return syncGeneratedSchedule(next, generated);
}

export function movePerson(
  state: ScheduleState,
  source: { dateKey: string; category: string; index: number },
  destination: { dateKey: string; category: string },
) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const sourceDay = generated.days.find((item) => item.dateKey === source.dateKey);
  const destinationDay = generated.days.find((item) => item.dateKey === destination.dateKey);
  if (!sourceDay || !destinationDay) return state;
  const sourceList = sourceDay.assignments[source.category] ?? [];
  if (source.index < 0 || source.index >= sourceList.length) return state;
  const [person] = sourceList.splice(source.index, 1);
  destinationDay.assignments[destination.category] = [...(destinationDay.assignments[destination.category] ?? []), person];
  if (source.category === "휴가") sourceDay.vacations = sourceDay.assignments[source.category] ?? [];
  if (destination.category === "휴가") destinationDay.vacations = destinationDay.assignments[destination.category];
  next.selectedPerson = null;
  return syncGeneratedSchedule(next, generated);
}

export function swapPersonSlots(
  state: ScheduleState,
  source: { dateKey: string; category: string; index: number },
  destination: { dateKey: string; category: string; index: number },
) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const sourceDay = generated.days.find((item) => item.dateKey === source.dateKey);
  const destinationDay = generated.days.find((item) => item.dateKey === destination.dateKey);
  if (!sourceDay || !destinationDay) return state;

  sourceDay.assignments[source.category] = [...(sourceDay.assignments[source.category] ?? [])];
  if (sourceDay === destinationDay && source.category === destination.category) {
    const list = sourceDay.assignments[source.category];
    while (list.length <= Math.max(source.index, destination.index)) list.push("");
    const sourceName = list[source.index]?.trim() ?? "";
    if (!sourceName) return state;
    const destinationName = list[destination.index] ?? "";
    list[source.index] = destinationName;
    list[destination.index] = sourceName;
  } else {
    destinationDay.assignments[destination.category] = [...(destinationDay.assignments[destination.category] ?? [])];
    const sourceList = sourceDay.assignments[source.category];
    const destinationList = destinationDay.assignments[destination.category];
    while (sourceList.length <= source.index) sourceList.push("");
    while (destinationList.length <= destination.index) destinationList.push("");
    const sourceName = sourceList[source.index]?.trim() ?? "";
    if (!sourceName) return state;
    const destinationName = destinationList[destination.index] ?? "";
    sourceList[source.index] = destinationName;
    destinationList[destination.index] = sourceName;
  }

  next.selectedPerson = null;
  return syncGeneratedSchedule(next, generated);
}

export function compactGeneratedAssignments(state: ScheduleState) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  generated.days.forEach((day) => {
    day.assignments = Object.fromEntries(
      Object.entries(day.assignments).map(([category, names]) => [
        category,
        (names ?? []).map((name) => name.trim()).filter(Boolean),
      ]),
    );
    day.vacations = (day.assignments["휴가"] ?? []).map((name) => name.trim()).filter(Boolean);
  });
  return syncGeneratedSchedule(next, generated);
}
