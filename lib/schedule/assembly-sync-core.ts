import type { GeneratedSchedule } from "@/lib/schedule/types";

export type AssemblyDutyItem = {
  date: string;
  dutyType: "공휴일" | "주말근무";
  memberName: string;
  sourceId?: string;
  sourceUpdatedAt?: string;
};

export type AssemblyLeaveItem = {
  date: string;
  leaveType: "연차" | "공가" | "검진" | "경조" | "대휴";
  leaveVariant?: "normal" | "blue";
  memberName: string;
  sourceId?: string;
  sourceUpdatedAt?: string;
};

export type AssemblySyncErrorDetail = {
  stage: "config" | "fetch" | "validation" | "profile_match" | "database" | "not_published";
  message: string;
  date?: string;
  dutyType?: string;
  leaveType?: string;
  leaveVariant?: string;
  assignmentCategory?: string;
  memberName?: string;
  status?: number;
};

export type ParsedAssemblyExport = {
  duties: AssemblyDutyItem[];
  leaves: AssemblyLeaveItem[];
  hasItemsField: boolean;
  hasLeavesField: boolean;
  errors: AssemblySyncErrorDetail[];
};

export type HubAssemblyLeaveAssignment = "연차" | "제크" | "기타";

export type AssemblyLeaveApplyResult = {
  schedule: GeneratedSchedule;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
  changed: boolean;
};

export const ASSEMBLY_LEAVE_SYNC_CATEGORIES = ["연차", "제크", "기타"] as const;
type AssemblyLeaveSyncCategory = (typeof ASSEMBLY_LEAVE_SYNC_CATEGORIES)[number];
type AssemblyLeaveSyncState = NonNullable<GeneratedSchedule["assembly_leave_sync_state"]>;

const ASSEMBLY_DUTY_TYPES = new Set<AssemblyDutyItem["dutyType"]>(["공휴일", "주말근무"]);
const ASSEMBLY_LEAVE_TYPES = new Set<AssemblyLeaveItem["leaveType"]>(["연차", "공가", "검진", "경조", "대휴"]);
const ASSEMBLY_ANNUAL_LEAVE_VARIANTS = new Set<NonNullable<AssemblyLeaveItem["leaveVariant"]>>(["normal", "blue"]);
const HUB_ASSEMBLY_CATEGORY = "국회";
const HUB_VACATION_CATEGORY = "휴가";
const HUB_JCHECK_CATEGORY = "제크";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneSchedule(schedule: GeneratedSchedule) {
  return JSON.parse(JSON.stringify(schedule)) as GeneratedSchedule;
}

function isValidDateKey(value: string, month: string) {
  if (!DATE_PATTERN.test(value) || !value.startsWith(`${month}-`)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, monthIndex, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day
  );
}

function areSameNames(left: string[] | undefined, right: string[]) {
  const normalizedLeft = (left ?? []).map((name) => name.trim()).filter(Boolean);
  return JSON.stringify(normalizedLeft) === JSON.stringify(right);
}

function areSameEntries(left: string[] | undefined, right: string[]) {
  const normalizedLeft = (left ?? []).map((entry) => entry.trim()).filter(Boolean);
  return JSON.stringify(normalizedLeft) === JSON.stringify(right);
}

function normalizeNames(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value.map((name) => normalizeName(name)).filter(Boolean)));
}

function normalizeAssignmentNames(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((name) => normalizeName(name)).filter(Boolean);
}

function cloneAssignments(assignments: Record<string, string[]> | null | undefined) {
  return Object.fromEntries(
    Object.entries(assignments ?? {}).map(([category, names]) => [
      category,
      normalizeAssignmentNames(names),
    ]),
  ) as Record<string, string[]>;
}

export function assertOnlyAllowedAssignmentKeysChanged(
  beforeAssignments: Record<string, string[]> | null | undefined,
  afterAssignments: Record<string, string[]> | null | undefined,
  allowedKeys: readonly string[],
) {
  const before = cloneAssignments(beforeAssignments);
  const after = cloneAssignments(afterAssignments);
  const allowedKeySet = new Set(allowedKeys);
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  allKeys.forEach((key) => {
    if (allowedKeySet.has(key)) return;
    if (JSON.stringify(before[key] ?? []) !== JSON.stringify(after[key] ?? [])) {
      throw new Error(`국회 sync가 허용되지 않은 근무유형을 변경하려고 했습니다: ${key}`);
    }
  });
}

export function safeUpdateAssignments(
  assignments: Record<string, string[]> | null | undefined,
  allowedKeys: readonly string[],
  updates: Record<string, string[] | null | undefined>,
) {
  const before = cloneAssignments(assignments);
  const next = cloneAssignments(assignments);
  const allowedKeySet = new Set(allowedKeys);

  Object.entries(updates).forEach(([key, value]) => {
    if (!allowedKeySet.has(key)) {
      throw new Error(`국회 sync가 허용되지 않은 근무유형을 변경하려고 했습니다: ${key}`);
    }

    const names = normalizeAssignmentNames(value);
    if (names.length > 0) {
      next[key] = Array.from(new Set(names));
    } else {
      delete next[key];
    }
  });

  assertOnlyAllowedAssignmentKeysChanged(before, next, allowedKeys);
  return next;
}

function getRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseAssemblyDutyItems(rawItems: unknown[], month: string, errors: AssemblySyncErrorDetail[]) {
  const duties: AssemblyDutyItem[] = [];
  const seen = new Set<string>();

  rawItems.forEach((rawItem) => {
    const record = getRecord(rawItem);
    const date = typeof record.date === "string" ? record.date.trim() : "";
    const dutyType = typeof record.dutyType === "string" ? record.dutyType.trim() : "";
    const memberName = normalizeName(record.memberName);

    if (!isValidDateKey(date, month)) {
      errors.push({
        stage: "validation",
        message: "date가 YYYY-MM-DD 형식이 아니거나 요청 월에 속하지 않습니다.",
        date,
        dutyType,
        memberName,
      });
      return;
    }

    if (!ASSEMBLY_DUTY_TYPES.has(dutyType as AssemblyDutyItem["dutyType"])) {
      errors.push({
        stage: "validation",
        message: "dutyType은 공휴일 또는 주말근무만 허용됩니다.",
        date,
        dutyType,
        memberName,
      });
      return;
    }

    if (!memberName) {
      errors.push({
        stage: "validation",
        message: "memberName이 비어 있습니다.",
        date,
        dutyType,
      });
      return;
    }

    const key = `${date}:${dutyType}:${memberName}`;
    if (seen.has(key)) return;
    seen.add(key);

    duties.push({
      date,
      dutyType: dutyType as AssemblyDutyItem["dutyType"],
      memberName,
      sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
      sourceUpdatedAt: typeof record.sourceUpdatedAt === "string" ? record.sourceUpdatedAt : undefined,
    });
  });

  return duties;
}

function parseAssemblyLeaveItems(rawItems: unknown[], month: string, errors: AssemblySyncErrorDetail[]) {
  const leaves: AssemblyLeaveItem[] = [];
  const seen = new Set<string>();

  rawItems.forEach((rawItem) => {
    const record = getRecord(rawItem);
    const date = typeof record.date === "string" ? record.date.trim() : "";
    const leaveType = typeof record.leaveType === "string" ? record.leaveType.trim() : "";
    const rawLeaveVariant = typeof record.leaveVariant === "string" ? record.leaveVariant.trim() : "";
    const memberName = normalizeName(record.memberName);

    if (!isValidDateKey(date, month)) {
      errors.push({
        stage: "validation",
        message: "date가 YYYY-MM-DD 형식이 아니거나 요청 월에 속하지 않습니다.",
        date,
        leaveType,
        leaveVariant: rawLeaveVariant || undefined,
        memberName,
      });
      return;
    }

    if (!ASSEMBLY_LEAVE_TYPES.has(leaveType as AssemblyLeaveItem["leaveType"])) {
      errors.push({
        stage: "validation",
        message: "leaveType은 연차, 공가, 검진, 경조, 대휴만 허용됩니다.",
        date,
        leaveType,
        leaveVariant: rawLeaveVariant || undefined,
        memberName,
      });
      return;
    }

    if (!memberName) {
      errors.push({
        stage: "validation",
        message: "memberName이 비어 있습니다.",
        date,
        leaveType,
        leaveVariant: rawLeaveVariant || undefined,
      });
      return;
    }

    let leaveVariant: AssemblyLeaveItem["leaveVariant"];
    if (leaveType === "연차") {
      const normalizedVariant = rawLeaveVariant || "normal";
      if (!ASSEMBLY_ANNUAL_LEAVE_VARIANTS.has(normalizedVariant as NonNullable<AssemblyLeaveItem["leaveVariant"]>)) {
        errors.push({
          stage: "validation",
          message: "연차 leaveVariant는 normal 또는 blue만 허용됩니다.",
          date,
          leaveType,
          leaveVariant: rawLeaveVariant,
          memberName,
        });
        return;
      }
      leaveVariant = normalizedVariant as NonNullable<AssemblyLeaveItem["leaveVariant"]>;
    }

    const key = `${date}:${leaveType}:${leaveVariant ?? ""}:${memberName}`;
    if (seen.has(key)) return;
    seen.add(key);

    leaves.push({
      date,
      leaveType: leaveType as AssemblyLeaveItem["leaveType"],
      leaveVariant,
      memberName,
      sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
      sourceUpdatedAt: typeof record.sourceUpdatedAt === "string" ? record.sourceUpdatedAt : undefined,
    });
  });

  return leaves;
}

export function parseAssemblyExportPayload(payload: unknown, month: string): ParsedAssemblyExport {
  const record = getRecord(payload);
  const hasItemsProperty = Object.prototype.hasOwnProperty.call(record, "items");
  const hasItemsField = hasItemsProperty && Array.isArray(record.items);
  const rawDuties = hasItemsField ? record.items as unknown[] : [];
  const hasLeavesProperty = Object.prototype.hasOwnProperty.call(record, "leaves");
  const hasLeavesField = hasLeavesProperty && Array.isArray(record.leaves);
  const rawLeaves = hasLeavesField ? record.leaves as unknown[] : [];
  const errors: AssemblySyncErrorDetail[] = [];

  if (!hasItemsProperty) {
    errors.push({
      stage: "validation",
      message: "items 필드가 없어 국회 근무 동기화는 건너뜁니다.",
    });
  } else if (!Array.isArray(record.items)) {
    errors.push({
      stage: "validation",
      message: "items 필드는 배열이어야 합니다. 국회 근무 동기화는 건너뜁니다.",
    });
  }

  if (hasLeavesProperty && !Array.isArray(record.leaves)) {
    errors.push({
      stage: "validation",
      message: "leaves 필드는 배열이어야 합니다. 휴가 동기화는 건너뜁니다.",
    });
  }

  return {
    duties: parseAssemblyDutyItems(rawDuties, month, errors),
    leaves: parseAssemblyLeaveItems(rawLeaves, month, errors),
    hasItemsField,
    hasLeavesField,
    errors,
  };
}

export function mapAssemblyLeaveToHubAssignment(leave: AssemblyLeaveItem): HubAssemblyLeaveAssignment | null {
  if (leave.leaveType === "대휴") return null;
  if (leave.leaveType === "연차") {
    return leave.leaveVariant === "blue" ? "제크" : "연차";
  }
  if (leave.leaveType === "공가" || leave.leaveType === "검진" || leave.leaveType === "경조") {
    return "기타";
  }
  return null;
}

export function createAssemblyLeaveMatchErrorKey(date: string, assignmentType: HubAssemblyLeaveAssignment) {
  return `${date}:${assignmentType}`;
}

function getAssemblyLeaveSyncState(schedule: GeneratedSchedule): AssemblyLeaveSyncState {
  const source = getRecord(schedule.assembly_leave_sync_state);
  const state: AssemblyLeaveSyncState = {};

  Object.entries(source).forEach(([dateKey, rawByCategory]) => {
    if (!DATE_PATTERN.test(dateKey)) return;
    const byCategory = getRecord(rawByCategory);
    ASSEMBLY_LEAVE_SYNC_CATEGORIES.forEach((category) => {
      const names = normalizeNames(byCategory[category]);
      if (names.length === 0) return;
      state[dateKey] = {
        ...(state[dateKey] ?? {}),
        [category]: names,
      };
    });
  });

  return state;
}

function getAssemblyLeaveSyncNames(
  state: AssemblyLeaveSyncState,
  dateKey: string,
  category: AssemblyLeaveSyncCategory,
) {
  return normalizeNames(state[dateKey]?.[category]);
}

function setAssemblyLeaveSyncNames(
  state: AssemblyLeaveSyncState,
  dateKey: string,
  category: AssemblyLeaveSyncCategory,
  names: string[],
) {
  const nextNames = normalizeNames(names);
  if (nextNames.length > 0) {
    state[dateKey] = {
      ...(state[dateKey] ?? {}),
      [category]: nextNames,
    };
    return;
  }

  if (!state[dateKey]) return;
  delete state[dateKey][category];
  if (Object.keys(state[dateKey]).length === 0) {
    delete state[dateKey];
  }
}

function buildDesiredDateByCategoryName(
  desiredByDateCategory: Map<string, Map<HubAssemblyLeaveAssignment, string[]>>,
) {
  const dateByCategoryName = new Map<AssemblyLeaveSyncCategory, Map<string, Set<string>>>();

  desiredByDateCategory.forEach((byCategory, dateKey) => {
    ASSEMBLY_LEAVE_SYNC_CATEGORIES.forEach((category) => {
      const names = byCategory.get(category) ?? [];
      names.forEach((name) => {
        const normalized = name.trim();
        if (!normalized) return;
        const byName = dateByCategoryName.get(category) ?? new Map<string, Set<string>>();
        const dates = byName.get(normalized) ?? new Set<string>();
        dates.add(dateKey);
        byName.set(normalized, dates);
        dateByCategoryName.set(category, byName);
      });
    });
  });

  return dateByCategoryName;
}

function isDesiredOnDifferentDate(
  desiredDateByCategoryName: Map<AssemblyLeaveSyncCategory, Map<string, Set<string>>>,
  category: AssemblyLeaveSyncCategory,
  dateKey: string,
  name: string,
) {
  const dates = desiredDateByCategoryName.get(category)?.get(name.trim());
  return Boolean(dates && dates.size > 0 && !dates.has(dateKey));
}

function compactDayJcheckAssignment(day: GeneratedSchedule["days"][number]) {
  const names = (day.assignments[HUB_JCHECK_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
  day.assignments = safeUpdateAssignments(day.assignments, [HUB_JCHECK_CATEGORY], {
    [HUB_JCHECK_CATEGORY]: names,
  });
  if (names.length === 0) {
    day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== HUB_JCHECK_CATEGORY);
  }
}

function parseHubVacationEntry(value: string): { type: "연차" | "대휴" | "기타"; name: string } {
  const trimmed = value.trim();
  const matched = /^(연차|대휴|etc|기타|공가|근속휴가|건강검진|검진|경조)\s*:(.+)$/.exec(trimmed);
  if (!matched) {
    return { type: "연차", name: trimmed };
  }
  const rawType = matched[1];
  return {
    type: rawType === "연차" || rawType === "대휴" ? rawType : "기타",
    name: matched[2].trim(),
  };
}

function formatHubVacationEntry(type: "연차" | "기타", name: string) {
  return `${type}:${name.trim()}`;
}

function getVacationSyncNames(entries: string[], type: "연차" | "기타") {
  return Array.from(
    new Set(
      entries
        .map((entry) => parseHubVacationEntry(entry))
        .filter((entry) => entry.type === type && entry.name)
        .map((entry) => entry.name),
    ),
  );
}

function rebuildVacationEntries(
  currentEntries: string[],
  nextAnnualNames: string[],
  nextOtherNames: string[],
) {
  const preservedEntries = currentEntries
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false;
      const parsed = parseHubVacationEntry(entry);
      return parsed.type === "대휴";
    });

  return [
    ...nextAnnualNames.map((name) => formatHubVacationEntry("연차", name)),
    ...preservedEntries,
    ...nextOtherNames.map((name) => formatHubVacationEntry("기타", name)),
  ];
}

function mergeWithoutNames(currentNames: string[], removeNames: string[], addNames: string[]) {
  const removeSet = new Set(removeNames.map((name) => name.trim()).filter(Boolean));
  return Array.from(
    new Set([
      ...currentNames.filter((name) => !removeSet.has(name.trim())),
      ...addNames.map((name) => name.trim()).filter(Boolean),
    ]),
  );
}

function getNamesToRemoveFromCurrent(options: {
  hasExistingSyncState: boolean;
  previousSyncNames: string[];
  currentNames: string[];
  desiredNames: string[];
  category: AssemblyLeaveSyncCategory;
  dateKey: string;
  desiredDateByCategoryName: Map<AssemblyLeaveSyncCategory, Map<string, Set<string>>>;
}) {
  const desiredSet = new Set(options.desiredNames.map((name) => name.trim()).filter(Boolean));
  if (options.hasExistingSyncState) {
    return options.previousSyncNames.filter((name) => !desiredSet.has(name));
  }

  return options.currentNames.filter((name) =>
    !desiredSet.has(name) &&
    isDesiredOnDifferentDate(options.desiredDateByCategoryName, options.category, options.dateKey, name),
  );
}

function countLeaveCategoryChange(
  currentNames: string[],
  nextNames: string[],
  desiredNames: string[],
  removedNames: string[],
) {
  if (areSameNames(currentNames, nextNames)) {
    return "skipped" as const;
  }
  if (removedNames.length > 0 && desiredNames.length === 0) {
    return "deleted" as const;
  }
  if (currentNames.length > 0) {
    return "updated" as const;
  }
  return "inserted" as const;
}

function setDayVacationEntries(day: GeneratedSchedule["days"][number], entries: string[]) {
  day.assignments = safeUpdateAssignments(day.assignments, [HUB_VACATION_CATEGORY], {
    [HUB_VACATION_CATEGORY]: entries,
  });
  day.vacations = entries.length > 0 ? entries : [];
  if (entries.length === 0) {
    day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== HUB_VACATION_CATEGORY);
  }
}

function compactDayAssemblyAssignment(day: GeneratedSchedule["days"][number]) {
  const names = (day.assignments[HUB_ASSEMBLY_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
  day.assignments = safeUpdateAssignments(day.assignments, [HUB_ASSEMBLY_CATEGORY], {
    [HUB_ASSEMBLY_CATEGORY]: names,
  });
  if (names.length === 0) {
    day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== HUB_ASSEMBLY_CATEGORY);
  }
}

export function applyAssemblyDutiesToSchedule(
  schedule: GeneratedSchedule,
  targetDateKeys: Set<string>,
  desiredByDate: Map<string, string[]>,
  datesWithMatchErrors: Set<string>,
) {
  const nextSchedule = cloneSchedule(schedule);
  let insertedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;

  nextSchedule.days.forEach((day) => {
    if (!targetDateKeys.has(day.dateKey)) return;

    const beforeAssignments = cloneAssignments(day.assignments);
    const currentNames = (day.assignments[HUB_ASSEMBLY_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
    const desiredNames = desiredByDate.get(day.dateKey) ?? [];

    if (datesWithMatchErrors.has(day.dateKey)) {
      const safeDesiredNames = Array.from(new Set([...currentNames, ...desiredNames]));
      if (safeDesiredNames.length > 0 && !areSameNames(currentNames, safeDesiredNames)) {
        day.assignments = safeUpdateAssignments(day.assignments, [HUB_ASSEMBLY_CATEGORY], {
          [HUB_ASSEMBLY_CATEGORY]: safeDesiredNames,
        });
        compactDayAssemblyAssignment(day);
        if (currentNames.length > 0) updatedCount += 1;
        else insertedCount += 1;
      } else {
        skippedCount += 1;
      }
      assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_ASSEMBLY_CATEGORY]);
      return;
    }

    if (desiredNames.length > 0) {
      if (areSameNames(currentNames, desiredNames)) {
        skippedCount += 1;
        assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_ASSEMBLY_CATEGORY]);
        return;
      }

      day.assignments = safeUpdateAssignments(day.assignments, [HUB_ASSEMBLY_CATEGORY], {
        [HUB_ASSEMBLY_CATEGORY]: desiredNames,
      });
      compactDayAssemblyAssignment(day);
      if (currentNames.length > 0) updatedCount += 1;
      else insertedCount += 1;
      assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_ASSEMBLY_CATEGORY]);
      return;
    }

    if (currentNames.length > 0) {
      day.assignments = safeUpdateAssignments(day.assignments, [HUB_ASSEMBLY_CATEGORY], {
        [HUB_ASSEMBLY_CATEGORY]: [],
      });
      day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== HUB_ASSEMBLY_CATEGORY);
      deletedCount += 1;
      assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_ASSEMBLY_CATEGORY]);
      return;
    }

    skippedCount += 1;
    assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_ASSEMBLY_CATEGORY]);
  });

  return {
    schedule: nextSchedule,
    insertedCount,
    updatedCount,
    deletedCount,
    skippedCount,
    changed: JSON.stringify(schedule) !== JSON.stringify(nextSchedule),
  };
}

export function applyAssemblyLeavesToSchedule(
  schedule: GeneratedSchedule,
  targetDateKeys: Set<string>,
  desiredByDateCategory: Map<string, Map<HubAssemblyLeaveAssignment, string[]>>,
  dateCategoryWithMatchErrors: Set<string>,
): AssemblyLeaveApplyResult {
  const nextSchedule = cloneSchedule(schedule);
  const previousSyncState = getAssemblyLeaveSyncState(nextSchedule);
  const nextSyncState = JSON.parse(JSON.stringify(previousSyncState)) as AssemblyLeaveSyncState;
  const hasExistingSyncState = Object.keys(previousSyncState).length > 0;
  const desiredDateByCategoryName = buildDesiredDateByCategoryName(desiredByDateCategory);
  let insertedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;

  nextSchedule.days.forEach((day) => {
    if (!targetDateKeys.has(day.dateKey)) return;

    const beforeAssignments = cloneAssignments(day.assignments);
    const currentVacationEntries = [
      ...(day.vacations ?? []),
      ...(day.assignments[HUB_VACATION_CATEGORY] ?? []),
    ]
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry && array.indexOf(entry) === index);
    const currentAnnualNames = getVacationSyncNames(currentVacationEntries, "연차");
    const currentOtherNames = getVacationSyncNames(currentVacationEntries, "기타");
    const desiredAnnualNames = desiredByDateCategory.get(day.dateKey)?.get("연차") ?? [];
    const desiredOtherNames = desiredByDateCategory.get(day.dateKey)?.get("기타") ?? [];
    const hasAnnualMatchError = dateCategoryWithMatchErrors.has(createAssemblyLeaveMatchErrorKey(day.dateKey, "연차"));
    const hasOtherMatchError = dateCategoryWithMatchErrors.has(createAssemblyLeaveMatchErrorKey(day.dateKey, "기타"));
    const previousAnnualSyncNames = getAssemblyLeaveSyncNames(previousSyncState, day.dateKey, "연차");
    const previousOtherSyncNames = getAssemblyLeaveSyncNames(previousSyncState, day.dateKey, "기타");
    const annualNamesToRemove = hasAnnualMatchError
      ? []
      : getNamesToRemoveFromCurrent({
        hasExistingSyncState,
        previousSyncNames: previousAnnualSyncNames,
        currentNames: currentAnnualNames,
        desiredNames: desiredAnnualNames,
        category: "연차",
        dateKey: day.dateKey,
        desiredDateByCategoryName,
      });
    const otherNamesToRemove = hasOtherMatchError
      ? []
      : getNamesToRemoveFromCurrent({
        hasExistingSyncState,
        previousSyncNames: previousOtherSyncNames,
        currentNames: currentOtherNames,
        desiredNames: desiredOtherNames,
        category: "기타",
        dateKey: day.dateKey,
        desiredDateByCategoryName,
      });
    const nextAnnualNames = hasAnnualMatchError
      ? Array.from(new Set([...currentAnnualNames, ...desiredAnnualNames]))
      : mergeWithoutNames(currentAnnualNames, annualNamesToRemove, desiredAnnualNames);
    const nextOtherNames = hasOtherMatchError
      ? Array.from(new Set([...currentOtherNames, ...desiredOtherNames]))
      : mergeWithoutNames(currentOtherNames, otherNamesToRemove, desiredOtherNames);
    const nextAnnualSyncNames = hasAnnualMatchError
      ? Array.from(new Set([...previousAnnualSyncNames, ...desiredAnnualNames]))
      : desiredAnnualNames;
    const nextOtherSyncNames = hasOtherMatchError
      ? Array.from(new Set([...previousOtherSyncNames, ...desiredOtherNames]))
      : desiredOtherNames;
    const nextVacationEntries = rebuildVacationEntries(currentVacationEntries, nextAnnualNames, nextOtherNames);

    (["연차", "기타"] as const).forEach((assignmentType) => {
      const currentNames = assignmentType === "연차" ? currentAnnualNames : currentOtherNames;
      const exportedNames = assignmentType === "연차" ? desiredAnnualNames : desiredOtherNames;
      const desiredNames = assignmentType === "연차" ? nextAnnualNames : nextOtherNames;
      const removedNames = assignmentType === "연차" ? annualNamesToRemove : otherNamesToRemove;
      const changeType = countLeaveCategoryChange(currentNames, desiredNames, exportedNames, removedNames);
      if (changeType === "inserted") insertedCount += 1;
      else if (changeType === "updated") updatedCount += 1;
      else if (changeType === "deleted") deletedCount += 1;
      else skippedCount += 1;
    });

    if (!areSameEntries(currentVacationEntries, nextVacationEntries)) {
      setDayVacationEntries(day, nextVacationEntries);
    }
    setAssemblyLeaveSyncNames(nextSyncState, day.dateKey, "연차", nextAnnualSyncNames);
    setAssemblyLeaveSyncNames(nextSyncState, day.dateKey, "기타", nextOtherSyncNames);

    const currentJcheckNames = (day.assignments[HUB_JCHECK_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
    const desiredJcheckNames = desiredByDateCategory.get(day.dateKey)?.get("제크") ?? [];
    const hasJcheckMatchError = dateCategoryWithMatchErrors.has(createAssemblyLeaveMatchErrorKey(day.dateKey, "제크"));
    const previousJcheckSyncNames = getAssemblyLeaveSyncNames(previousSyncState, day.dateKey, "제크");
    const jcheckNamesToRemove = hasJcheckMatchError
      ? []
      : getNamesToRemoveFromCurrent({
        hasExistingSyncState,
        previousSyncNames: previousJcheckSyncNames,
        currentNames: currentJcheckNames,
        desiredNames: desiredJcheckNames,
        category: "제크",
        dateKey: day.dateKey,
        desiredDateByCategoryName,
      });
    const nextJcheckNames = hasJcheckMatchError
      ? Array.from(new Set([...currentJcheckNames, ...desiredJcheckNames]))
      : mergeWithoutNames(currentJcheckNames, jcheckNamesToRemove, desiredJcheckNames);
    const nextJcheckSyncNames = hasJcheckMatchError
      ? Array.from(new Set([...previousJcheckSyncNames, ...desiredJcheckNames]))
      : desiredJcheckNames;

    if (hasJcheckMatchError) {
      if (nextJcheckNames.length > 0 && !areSameNames(currentJcheckNames, nextJcheckNames)) {
        day.assignments = safeUpdateAssignments(day.assignments, [HUB_JCHECK_CATEGORY], {
          [HUB_JCHECK_CATEGORY]: nextJcheckNames,
        });
        compactDayJcheckAssignment(day);
        if (currentJcheckNames.length > 0) updatedCount += 1;
        else insertedCount += 1;
      } else {
        skippedCount += 1;
      }
      setAssemblyLeaveSyncNames(nextSyncState, day.dateKey, "제크", nextJcheckSyncNames);
      assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_VACATION_CATEGORY, HUB_JCHECK_CATEGORY]);
      return;
    }

    if (!areSameNames(currentJcheckNames, nextJcheckNames)) {
      day.assignments = safeUpdateAssignments(day.assignments, [HUB_JCHECK_CATEGORY], {
        [HUB_JCHECK_CATEGORY]: nextJcheckNames,
      });
      compactDayJcheckAssignment(day);
      const changeType = countLeaveCategoryChange(currentJcheckNames, nextJcheckNames, desiredJcheckNames, jcheckNamesToRemove);
      if (changeType === "inserted") insertedCount += 1;
      else if (changeType === "updated") updatedCount += 1;
      else if (changeType === "deleted") deletedCount += 1;
      else skippedCount += 1;
    } else {
      skippedCount += 1;
    }
    setAssemblyLeaveSyncNames(nextSyncState, day.dateKey, "제크", nextJcheckSyncNames);
    assertOnlyAllowedAssignmentKeysChanged(beforeAssignments, day.assignments, [HUB_VACATION_CATEGORY, HUB_JCHECK_CATEGORY]);
  });

  if (Object.keys(nextSyncState).length > 0) {
    nextSchedule.assembly_leave_sync_state = nextSyncState;
  } else {
    delete nextSchedule.assembly_leave_sync_state;
  }

  return {
    schedule: nextSchedule,
    insertedCount,
    updatedCount,
    deletedCount,
    skippedCount,
    changed: JSON.stringify(schedule) !== JSON.stringify(nextSchedule),
  };
}
