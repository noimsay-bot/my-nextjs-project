import type { GeneratedSchedule, SchedulePersonRef } from "@/lib/schedule/types";

export type AssemblyLeavePushAction = "upsert" | "delete";

export type AssemblyCompensatoryLeavePushItem = {
  date: string;
  memberName: string;
};

export type AssemblyCompensatoryLeavePushOperation = AssemblyCompensatoryLeavePushItem & {
  action: AssemblyLeavePushAction;
};

const HUB_ASSEMBLY_CATEGORY = "국회";

function parseVacationEntry(value: string): { type: "연차" | "대휴" | "기타"; name: string } {
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

function normalizeCompensatoryVacationRoute(route: SchedulePersonRef[]) {
  const vacationRoute = route.filter((ref) => ref.category === "휴가");
  if (vacationRoute.length < 2 || vacationRoute.length !== route.length) return null;

  const parsedEntries = vacationRoute.map((ref) => parseVacationEntry(ref.name));
  if (parsedEntries.some((entry) => entry.type !== "대휴" || !entry.name)) return null;

  return { vacationRoute, parsedEntries };
}

function dedupeItems(items: AssemblyCompensatoryLeavePushItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.date}:${item.memberName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemKey(item: AssemblyCompensatoryLeavePushItem) {
  return `${item.date}:${item.memberName}`;
}

function getAssemblyDutyMemberNames(schedules: Array<GeneratedSchedule | null | undefined>) {
  const names = new Set<string>();

  schedules.forEach((schedule) => {
    schedule?.days.forEach((day) => {
      (day.assignments[HUB_ASSEMBLY_CATEGORY] ?? [])
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name) => names.add(name));
    });
  });

  return names;
}

function getOriginalAssemblyCompensatoryLeavePushItems(route: SchedulePersonRef[]) {
  const normalized = normalizeCompensatoryVacationRoute(route);
  if (!normalized) return [];

  return dedupeItems(
    normalized.vacationRoute.map((ref, index) => ({
      date: ref.dateKey,
      memberName: normalized.parsedEntries[index].name,
    })),
  );
}

export function getAssemblyCompensatoryLeavePushItems(route: SchedulePersonRef[]) {
  const normalized = normalizeCompensatoryVacationRoute(route);
  if (!normalized) return [];

  return dedupeItems(
    normalized.vacationRoute.map((ref, index) => {
      const nextEntry = normalized.parsedEntries[(index + 1) % normalized.parsedEntries.length];
      return {
        date: ref.dateKey,
        memberName: nextEntry.name,
      };
    }),
  );
}

function diffItems(left: AssemblyCompensatoryLeavePushItem[], right: AssemblyCompensatoryLeavePushItem[]) {
  const rightKeys = new Set(right.map(itemKey));
  return left.filter((item) => !rightKeys.has(itemKey(item)));
}

export function getAssemblyCompensatoryLeavePushOperations(
  route: SchedulePersonRef[],
  action: AssemblyLeavePushAction,
) {
  const originalItems = getOriginalAssemblyCompensatoryLeavePushItems(route);
  const finalItems = getAssemblyCompensatoryLeavePushItems(route);
  if (originalItems.length === 0 || finalItems.length === 0) return [];

  if (action === "upsert") {
    return [
      ...diffItems(originalItems, finalItems).map((item) => ({ ...item, action: "delete" as const })),
      ...diffItems(finalItems, originalItems).map((item) => ({ ...item, action: "upsert" as const })),
    ] satisfies AssemblyCompensatoryLeavePushOperation[];
  }

  return [
    ...diffItems(finalItems, originalItems).map((item) => ({ ...item, action: "delete" as const })),
    ...diffItems(originalItems, finalItems).map((item) => ({ ...item, action: "upsert" as const })),
  ] satisfies AssemblyCompensatoryLeavePushOperation[];
}

export function filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties(
  operations: AssemblyCompensatoryLeavePushOperation[],
  schedules: Array<GeneratedSchedule | null | undefined>,
) {
  const assemblyDutyNames = getAssemblyDutyMemberNames(schedules);
  if (assemblyDutyNames.size === 0) return [];

  return operations.filter((operation) =>
    assemblyDutyNames.has(operation.memberName.trim()),
  );
}

export function hasAssemblyCompensatoryLeavePushItems(route: SchedulePersonRef[]) {
  return getAssemblyCompensatoryLeavePushItems(route).length > 0;
}
