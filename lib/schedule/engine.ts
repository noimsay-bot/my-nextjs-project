import { categories, defaultPointers, defaultScheduleState } from "@/lib/schedule/constants";
import {
  CategoryKey,
  DaySchedule,
  GeneratedSchedule,
  GenerationResult,
  PointerState,
  ScheduleState,
  SnapshotItem,
} from "@/lib/schedule/types";

export function cloneScheduleState(state: ScheduleState): ScheduleState {
  return JSON.parse(JSON.stringify(state)) as ScheduleState;
}

export function sanitizeScheduleState(input?: Partial<ScheduleState> | null): ScheduleState {
  const base = cloneScheduleState(defaultScheduleState);
  if (!input) return base;
  return {
    ...base,
    ...input,
    offPeople: Array.isArray(input.offPeople) ? input.offPeople : [],
    orders: Object.fromEntries(
      categories.map((category) => [
        category.key,
        Array.from({ length: 30 }, (_, index) => input.orders?.[category.key]?.[index] ?? base.orders[category.key][index] ?? ""),
      ]),
    ) as Record<CategoryKey, string[]>,
    pointers: { ...defaultPointers, ...(input.pointers ?? {}) },
    snapshots: input.snapshots ?? {},
    generated: input.generated ?? null,
    generatedHistory: input.generatedHistory ?? (input.generated ? [input.generated] : []),
    currentUser: input.currentUser ?? base.currentUser,
    showMyWork: Boolean(input.showMyWork),
    editDateKey: input.editDateKey ?? null,
    selectedPerson: input.selectedPerson ?? null,
  };
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

export function parseHolidaySet(text: string, year?: number, month?: number) {
  return new Set(
    text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(item)) return item;
        if (/^\d{1,2}$/.test(item) && year && month) {
          return fmtDate(year, month, Number(item));
        }
        return item;
      }),
  );
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

export function fmtDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function getScheduleRange(year: number, month: number) {
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

function nextCandidatesByOrder(
  state: ScheduleState,
  key: CategoryKey,
  count: number,
  usedNames: Set<string>,
  excludeNames: string[],
  vacationNames: string[],
  pointers: PointerState,
) {
  const pool = getOrderPool(state, key).filter((name) => !state.offPeople.includes(name));
  const selected: string[] = [];
  if (pool.length === 0) return selected;

  let pointer = pointers[key] || 1;
  let guard = 0;
  while (selected.length < count && guard < pool.length * 6) {
    const index = ((pointer - 1) % pool.length + pool.length) % pool.length;
    const name = pool[index];
    if (
      name &&
      !usedNames.has(name) &&
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

function collectConflicts(
  assignments: Record<string, string[]>,
  previousNight: string[],
  warnings: Array<{ date: string; category: string; name: string }>,
  dateKey: string,
) {
  const conflicts: DaySchedule["conflicts"] = [];
  Object.entries(assignments).forEach(([category, names]) => {
    names.forEach((name) => {
      if (previousNight.includes(name)) {
        conflicts.push({ category, name });
        warnings.push({ date: dateKey, category, name });
      }
    });
  });
  return conflicts;
}

export function generateSchedule(state: ScheduleState): GenerationResult {
  const nextState = cloneScheduleState(state);
  const holidaySet = parseHolidaySet(nextState.extraHolidays, nextState.year, nextState.month);
  const vacationMap = parseVacationMap(nextState.vacations);
  const range = getScheduleRange(nextState.year, nextState.month);
  const pointers = { ...nextState.pointers };
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
    const used = new Set<string>();
    const assignments: Record<string, string[]> = {};

    if (isCustomHoliday) {
      assignments["조근"] = [];
      assignments["일반"] = [];
      assignments["석근"] = [];
      assignments["야근"] = [];
      assignments["국회"] = [];
    } else if (isWeekend) {
      assignments["주말조근"] = nextCandidatesByOrder(nextState, "morning", 1, used, [], vacations, pointers);
      assignments["주말조근"].forEach((name) => used.add(name));
      assignments["주말일반근무"] = nextCandidatesByOrder(nextState, "holidayDuty", 2, used, [], vacations, pointers);
      assignments["주말일반근무"].forEach((name) => used.add(name));
      assignments["뉴스대기"] = nextCandidatesByOrder(nextState, "holidayDuty", 1, used, [], vacations, pointers);
      assignments["뉴스대기"].forEach((name) => used.add(name));
    } else {
      assignments["조근"] = nextCandidatesByOrder(nextState, "morning", 2, used, [], vacations, pointers);
      assignments["조근"].forEach((name) => used.add(name));

      if (dow >= 1 && dow <= 5) {
        if (weeklyExtensionWeekKey !== weekKey) {
          weeklyExtensionWeekKey = weekKey;
          weeklyExtensionCrew = nextCandidatesByOrder(nextState, "extension", 4, new Set<string>(), [], [], pointers);
        }
        assignments["연장"] = weeklyExtensionCrew
          .filter((name) => !vacations.includes(name) && !nextState.offPeople.includes(name))
          .slice(0, 4);
      } else {
        assignments["연장"] = [];
      }
      assignments["연장"].forEach((name) => used.add(name));

      assignments["석근"] = nextCandidatesByOrder(nextState, "evening", 3, used, [], vacations, pointers);
      assignments["석근"].forEach((name) => used.add(name));
    }

    if (!isCustomHoliday) {
      let nightKey: CategoryKey = "nightWeekday";
      if (dow === 5) nightKey = "nightFriday";
      if (dow === 6) nightKey = "nightSaturday";
      if (dow === 0) nightKey = "nightSunday";
      assignments["야근"] = nextCandidatesByOrder(nextState, nightKey, 1, used, [], vacations, pointers);
      assignments["야근"].forEach((name) => used.add(name));
    }

    if (!isWeekend && !isCustomHoliday) {
      assignments["제크"] = nextCandidatesByOrder(nextState, "jcheck", nextState.jcheckCount, used, [], vacations, pointers);
      assignments["제크"].forEach((name) => used.add(name));
    }

    if (isCustomHoliday) {
      assignments["국회"] = assignments["국회"] ?? [];
    } else if (isWeekend || isHoliday) {
      assignments["국회"] = [];
      assignments["청사"] = [];
      assignments["청와대"] = [];
    } else {
      assignments["휴가"] = [...vacations];
    }

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
      conflicts,
    });
    previousNight = [...(assignments["야근"] ?? [])];
  }

  const nextMonthStart = new Date(range.end);
  nextMonthStart.setDate(nextMonthStart.getDate() + 1);

  const generated: GeneratedSchedule = {
    year: nextState.year,
    month: nextState.month,
    monthKey: `${nextState.year}-${String(nextState.month).padStart(2, "0")}`,
    days,
    nextPointers: pointers,
    nextStartDate: fmtDate(nextMonthStart.getFullYear(), nextMonthStart.getMonth() + 1, nextMonthStart.getDate()),
  };

  nextState.generated = generated;
  nextState.generatedHistory = [
    ...nextState.generatedHistory.filter((item) => item.monthKey !== generated.monthKey),
    generated,
  ].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  nextState.pointers = pointers;

  return {
    state: nextState,
    warningCount: warnings.length,
    message:
      warnings.length > 0
        ? `야근 다음날 근무 충돌 ${warnings.length}건이 발견되었습니다. 다음 근무표는 ${generated.nextStartDate}부터 이어서 작성하면 됩니다.`
        : `충돌 없이 자동 작성되었습니다. 다음 근무표는 ${generated.nextStartDate}부터 이어서 작성하면 됩니다.`,
  };
}

function mapCategoryToPointer(category: string, day: DaySchedule): CategoryKey {
  if (category === "조근" || category === "주말조근") return "morning";
  if (category === "연장") return "extension";
  if (category === "석근") return "evening";
  if (category === "제크") return "jcheck";
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
  next.snapshots[key] = [item, ...(next.snapshots[key] ?? [])];
  return next;
}

export function autoRebalance(state: ScheduleState): GenerationResult {
  if (!state.generated) return { state, warningCount: 0, message: "먼저 근무표를 작성하세요." };

  const next = createSnapshot(state, "원본");
  const generated = cloneScheduleState(next).generated as GeneratedSchedule;
  const pointers = { ...next.pointers };
  let previousNight: string[] = [];
  const warnings: Array<{ date: string; category: string; name: string }> = [];

  generated.days.forEach((day) => {
    const vacations = day.assignments["휴가"] ?? day.vacations ?? [];
    const used = new Set<string>();
    Object.values(day.assignments).forEach((group) => group.forEach((name) => used.add(name)));

    Object.entries(day.assignments).forEach(([category, names]) => {
      names.forEach((name, index) => {
        if (!previousNight.includes(name)) return;
        used.delete(name);
        const replacement = nextCandidatesByOrder(next, mapCategoryToPointer(category, day), 1, used, previousNight, vacations, pointers)[0];
        if (replacement) {
          day.assignments[category][index] = replacement;
          used.add(replacement);
        } else {
          day.assignments[category][index] = name;
          used.add(name);
          warnings.push({ date: day.dateKey, category, name });
        }
      });
    });

    day.conflicts = collectConflicts(day.assignments, previousNight, [], day.dateKey);
    previousNight = [...(day.assignments["야근"] ?? [])];
  });

  next.generated = generated;
  next.generatedHistory = next.generatedHistory.map((item) => (item.monthKey === generated.monthKey ? generated : item));
  next.pointers = pointers;
  return {
    state: next,
    warningCount: warnings.length,
    message:
      warnings.length > 0
        ? `자동 재배치 후에도 ${warnings.length}건의 충돌이 남아 있습니다.`
        : "자동 재배치가 완료되었습니다. 원본 사본이 저장되었습니다.",
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

export function updateManualAssignment(state: ScheduleState, dateKey: string, category: string, value: string) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day) return state;
  day.assignments[category] = splitNames(value);
  if (category === "휴가") day.vacations = day.assignments[category];
  return next;
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
  return next;
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
  return next;
}

export function removePersonFromCategory(state: ScheduleState, dateKey: string, category: string, index: number) {
  if (!state.generated) return state;
  const next = cloneScheduleState(state);
  const generated = next.generated as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === dateKey);
  if (!day || !day.assignments[category]) return state;
  day.assignments[category].splice(index, 1);
  if (category === "휴가") day.vacations = day.assignments[category];
  return next;
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
  return next;
}
