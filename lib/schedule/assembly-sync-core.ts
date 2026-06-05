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

const ASSEMBLY_DUTY_TYPES = new Set<AssemblyDutyItem["dutyType"]>(["공휴일", "주말근무"]);
const ASSEMBLY_LEAVE_TYPES = new Set<AssemblyLeaveItem["leaveType"]>(["연차", "공가", "검진", "경조", "대휴"]);
const ASSEMBLY_ANNUAL_LEAVE_VARIANTS = new Set<NonNullable<AssemblyLeaveItem["leaveVariant"]>>(["normal", "blue"]);
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
  const rawDuties = Array.isArray(record.items) ? record.items : [];
  const hasLeavesProperty = Object.prototype.hasOwnProperty.call(record, "leaves");
  const hasLeavesField = hasLeavesProperty && Array.isArray(record.leaves);
  const rawLeaves = hasLeavesField ? record.leaves as unknown[] : [];
  const errors: AssemblySyncErrorDetail[] = [];

  if (hasLeavesProperty && !Array.isArray(record.leaves)) {
    errors.push({
      stage: "validation",
      message: "leaves 필드는 배열이어야 합니다. 휴가 동기화는 건너뜁니다.",
    });
  }

  return {
    duties: parseAssemblyDutyItems(rawDuties, month, errors),
    leaves: parseAssemblyLeaveItems(rawLeaves, month, errors),
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

function compactDayJcheckAssignment(day: GeneratedSchedule["days"][number]) {
  const names = (day.assignments[HUB_JCHECK_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
  if (names.length > 0) {
    day.assignments[HUB_JCHECK_CATEGORY] = Array.from(new Set(names));
    return;
  }

  delete day.assignments[HUB_JCHECK_CATEGORY];
  day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== HUB_JCHECK_CATEGORY);
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

function setDayVacationEntries(day: GeneratedSchedule["days"][number], entries: string[]) {
  if (entries.length > 0) {
    day.assignments[HUB_VACATION_CATEGORY] = entries;
    day.vacations = entries;
    return;
  }

  delete day.assignments[HUB_VACATION_CATEGORY];
  day.vacations = [];
  day.manualExtras = (day.manualExtras ?? []).filter((category) => category !== HUB_VACATION_CATEGORY);
}

export function applyAssemblyLeavesToSchedule(
  schedule: GeneratedSchedule,
  targetDateKeys: Set<string>,
  desiredByDateCategory: Map<string, Map<HubAssemblyLeaveAssignment, string[]>>,
  dateCategoryWithMatchErrors: Set<string>,
): AssemblyLeaveApplyResult {
  const nextSchedule = cloneSchedule(schedule);
  let insertedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;

  nextSchedule.days.forEach((day) => {
    if (!targetDateKeys.has(day.dateKey)) return;

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
    const nextAnnualNames = hasAnnualMatchError || desiredAnnualNames.length === 0
      ? Array.from(new Set([...currentAnnualNames, ...desiredAnnualNames]))
      : desiredAnnualNames;
    const nextOtherNames = hasOtherMatchError || desiredOtherNames.length === 0
      ? Array.from(new Set([...currentOtherNames, ...desiredOtherNames]))
      : desiredOtherNames;
    const nextVacationEntries = rebuildVacationEntries(currentVacationEntries, nextAnnualNames, nextOtherNames);

    (["연차", "기타"] as const).forEach((assignmentType) => {
      const currentNames = assignmentType === "연차" ? currentAnnualNames : currentOtherNames;
      const exportedNames = assignmentType === "연차" ? desiredAnnualNames : desiredOtherNames;
      const desiredNames = assignmentType === "연차" ? nextAnnualNames : nextOtherNames;
      const hasMatchError = assignmentType === "연차" ? hasAnnualMatchError : hasOtherMatchError;

      if (exportedNames.length === 0) {
        skippedCount += 1;
        return;
      }

      if (hasMatchError) {
        if (desiredNames.length > 0 && !areSameNames(currentNames, desiredNames)) {
          if (currentNames.length > 0) updatedCount += 1;
          else insertedCount += 1;
        } else {
          skippedCount += 1;
        }
        return;
      }

      if (desiredNames.length > 0) {
        if (areSameNames(currentNames, desiredNames)) {
          skippedCount += 1;
          return;
        }

        if (currentNames.length > 0) updatedCount += 1;
        else insertedCount += 1;
        return;
      }

      skippedCount += 1;
    });

    if (!areSameEntries(currentVacationEntries, nextVacationEntries)) {
      setDayVacationEntries(day, nextVacationEntries);
    }

    const currentJcheckNames = (day.assignments[HUB_JCHECK_CATEGORY] ?? []).map((name) => name.trim()).filter(Boolean);
    const desiredJcheckNames = desiredByDateCategory.get(day.dateKey)?.get("제크") ?? [];
    const hasJcheckMatchError = dateCategoryWithMatchErrors.has(createAssemblyLeaveMatchErrorKey(day.dateKey, "제크"));
    const nextJcheckNames = Array.from(new Set([...currentJcheckNames, ...desiredJcheckNames]));

    if (desiredJcheckNames.length === 0) {
      skippedCount += 1;
      return;
    }

    if (hasJcheckMatchError) {
      if (nextJcheckNames.length > 0 && !areSameNames(currentJcheckNames, nextJcheckNames)) {
        day.assignments[HUB_JCHECK_CATEGORY] = nextJcheckNames;
        compactDayJcheckAssignment(day);
        if (currentJcheckNames.length > 0) updatedCount += 1;
        else insertedCount += 1;
      } else {
        skippedCount += 1;
      }
      return;
    }

    if (nextJcheckNames.length > 0) {
      if (areSameNames(currentJcheckNames, nextJcheckNames)) {
        skippedCount += 1;
        return;
      }

      day.assignments[HUB_JCHECK_CATEGORY] = nextJcheckNames;
      compactDayJcheckAssignment(day);
      if (currentJcheckNames.length > 0) updatedCount += 1;
      else insertedCount += 1;
      return;
    }

    skippedCount += 1;
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
