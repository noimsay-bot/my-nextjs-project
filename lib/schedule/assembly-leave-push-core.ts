import type { SchedulePersonRef } from "@/lib/schedule/types";

export type AssemblyLeavePushAction = "upsert" | "delete";

export type AssemblyCompensatoryLeavePushItem = {
  date: string;
  memberName: string;
};

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

export function getAssemblyCompensatoryLeavePushItems(route: SchedulePersonRef[]) {
  const vacationRoute = route.filter((ref) => ref.category === "휴가");
  if (vacationRoute.length < 2 || vacationRoute.length !== route.length) return [];

  const parsedEntries = vacationRoute.map((ref) => parseVacationEntry(ref.name));
  if (parsedEntries.some((entry) => entry.type !== "대휴" || !entry.name)) return [];

  const items = vacationRoute.map((ref, index) => {
    const nextEntry = parsedEntries[(index + 1) % parsedEntries.length];
    return {
      date: ref.dateKey,
      memberName: nextEntry.name,
    };
  });

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.date}:${item.memberName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasAssemblyCompensatoryLeavePushItems(route: SchedulePersonRef[]) {
  return getAssemblyCompensatoryLeavePushItems(route).length > 0;
}
