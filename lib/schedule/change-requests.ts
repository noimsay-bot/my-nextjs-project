import { STORAGE_KEY } from "@/lib/schedule/constants";
import { sanitizeScheduleState } from "@/lib/schedule/engine";
import { getPublishedSchedules, savePublishedSchedules } from "@/lib/schedule/published";
import { GeneratedSchedule, ScheduleChangeRequest, SchedulePersonRef, ScheduleState } from "@/lib/schedule/types";

const CHANGE_REQUESTS_KEY = "j-special-force-schedule-change-requests-v1";
export const CHANGE_REQUESTS_EVENT = "j-special-force-schedule-change-requests-updated";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function emitChangeRequestEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_REQUESTS_EVENT));
}

function refKey(ref: SchedulePersonRef) {
  return `${ref.monthKey}:${ref.dateKey}:${ref.category}:${ref.index}:${ref.name}`;
}

function cloneSchedule<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findRefSlot(schedule: GeneratedSchedule, ref: SchedulePersonRef) {
  const day = schedule.days.find((item) => item.dateKey === ref.dateKey);
  if (!day) return null;
  const list = day.assignments[ref.category];
  if (!list) return null;
  const index = list[ref.index] === ref.name ? ref.index : list.findIndex((name) => name === ref.name);
  if (index < 0) return null;
  return { day, list, index };
}

function swapAssignmentsAcrossSchedules(
  sourceSchedule: GeneratedSchedule,
  targetSchedule: GeneratedSchedule,
  request: ScheduleChangeRequest,
) {
  const sourceSlot = findRefSlot(sourceSchedule, request.source);
  const targetSlot = findRefSlot(targetSchedule, request.target);
  if (!sourceSlot || !targetSlot) return false;

  const sourceName = sourceSlot.list[sourceSlot.index];
  const targetName = targetSlot.list[targetSlot.index];
  const sourceWasVacation = sourceSlot.day.vacations.includes(sourceName);
  const targetWasVacation = targetSlot.day.vacations.includes(targetName);

  sourceSlot.list[sourceSlot.index] = targetName;
  targetSlot.list[targetSlot.index] = sourceName;

  if (sourceWasVacation) {
    sourceSlot.day.vacations = [...sourceSlot.list];
  }
  if (targetWasVacation) {
    targetSlot.day.vacations = [...targetSlot.list];
  }

  return true;
}

function swapAssignments(schedule: GeneratedSchedule, request: ScheduleChangeRequest) {
  const nextSchedule = cloneSchedule(schedule);
  const sourceDay = nextSchedule.days.find((item) => item.dateKey === request.source.dateKey);
  const targetDay = nextSchedule.days.find((item) => item.dateKey === request.target.dateKey);
  if (!sourceDay || !targetDay) return null;

  const sourceList = sourceDay.assignments[request.source.category];
  const targetList = targetDay.assignments[request.target.category];
  if (!sourceList || !targetList) return null;

  const sourceIndex =
    sourceList[request.source.index] === request.source.name
      ? request.source.index
      : sourceList.findIndex((name) => name === request.source.name);
  const targetIndex =
    targetList[request.target.index] === request.target.name
      ? request.target.index
      : targetList.findIndex((name) => name === request.target.name);

  if (sourceIndex < 0 || targetIndex < 0) return null;

  const sourceName = sourceList[sourceIndex];
  const targetName = targetList[targetIndex];
  sourceList[sourceIndex] = targetName;
  targetList[targetIndex] = sourceName;

  if (request.source.category === "휴가") {
    sourceDay.vacations = [...sourceList];
  }
  if (request.target.category === "휴가") {
    targetDay.vacations = [...targetList];
  }

  return nextSchedule;
}

function applyRequestToScheduleState(request: ScheduleChangeRequest) {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const current = raw ? sanitizeScheduleState(JSON.parse(raw) as Partial<ScheduleState>) : null;
  if (!current) return false;

  const targetMonthKeys = new Set([request.source.monthKey, request.target.monthKey]);
  const generatedMap = new Map(
    current.generatedHistory
      .filter((item) => targetMonthKeys.has(item.monthKey))
      .map((item) => [item.monthKey, cloneSchedule(item)]),
  );
  const sourceSchedule = generatedMap.get(request.source.monthKey);
  const targetSchedule = generatedMap.get(request.target.monthKey);
  if (!sourceSchedule || !targetSchedule) return false;

  const changed = swapAssignmentsAcrossSchedules(sourceSchedule, targetSchedule, request);
  if (!changed) return false;

  const generatedHistory = current.generatedHistory.map((item) => generatedMap.get(item.monthKey) ?? item);
  const generated = current.generated ? generatedMap.get(current.generated.monthKey) ?? current.generated : null;

  const nextState = sanitizeScheduleState({
    ...current,
    generated,
    generatedHistory,
  });
  writeJson(STORAGE_KEY, nextState);
  return true;
}

function applyRequestToPublishedSchedules(request: ScheduleChangeRequest) {
  const items = getPublishedSchedules();
  const targetMonthKeys = new Set([request.source.monthKey, request.target.monthKey]);
  const scheduleMap = new Map(
    items
      .filter((item) => targetMonthKeys.has(item.monthKey))
      .map((item) => [item.monthKey, cloneSchedule(item.schedule)]),
  );
  const sourceSchedule = scheduleMap.get(request.source.monthKey);
  const targetSchedule = scheduleMap.get(request.target.monthKey);
  if (!sourceSchedule || !targetSchedule) return false;

  const changed = swapAssignmentsAcrossSchedules(sourceSchedule, targetSchedule, request);
  if (!changed) return false;
  const nextItems = items.map((item) => {
    const nextSchedule = scheduleMap.get(item.monthKey);
    return nextSchedule ? { ...item, schedule: nextSchedule } : item;
  });
  savePublishedSchedules(nextItems);
  return true;
}

export function getScheduleChangeRequests() {
  return readJson<ScheduleChangeRequest[]>(CHANGE_REQUESTS_KEY, []);
}

export function getPendingScheduleChangeRequests(monthKey?: string) {
  return getScheduleChangeRequests().filter(
    (item) => item.status === "pending" && (!monthKey || item.monthKey === monthKey),
  );
}

export function createScheduleChangeRequest(input: {
  monthKey: string;
  requesterId: string;
  requesterName: string;
  source: SchedulePersonRef;
  target: SchedulePersonRef;
}) {
  const items = getScheduleChangeRequests();
  const nextItem: ScheduleChangeRequest = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    monthKey: input.monthKey,
    requesterId: input.requesterId,
    requesterName: input.requesterName,
    source: input.source,
    target: input.target,
    status: "pending",
    createdAt: new Date().toLocaleString("ko-KR"),
    resolvedAt: null,
    resolvedBy: null,
  };
  const next = [nextItem, ...items];
  writeJson(CHANGE_REQUESTS_KEY, next);
  emitChangeRequestEvent();
  return nextItem;
}

export function isPendingRef(requests: ScheduleChangeRequest[], ref: SchedulePersonRef) {
  return requests.some(
    (item) =>
      item.status === "pending" &&
      (refKey(item.source) === refKey(ref) || refKey(item.target) === refKey(ref)),
  );
}

export function resolveScheduleChangeRequest(
  requestId: string,
  action: "accepted" | "rejected",
  resolverName: string,
) {
  const items = getScheduleChangeRequests();
  const target = items.find((item) => item.id === requestId);
  if (!target || target.status !== "pending") {
    return { ok: false as const, applied: false };
  }

  let applied = false;
  if (action === "accepted") {
    const scheduleApplied = applyRequestToScheduleState(target);
    const publishedApplied = applyRequestToPublishedSchedules(target);
    applied = scheduleApplied || publishedApplied;
  }

  const next = items.map((item) =>
    item.id === requestId
      ? {
          ...item,
          status: action,
          resolvedAt: new Date().toLocaleString("ko-KR"),
          resolvedBy: resolverName,
        }
      : item,
  );
  writeJson(CHANGE_REQUESTS_KEY, next);
  emitChangeRequestEvent();
  return { ok: true as const, applied };
}
