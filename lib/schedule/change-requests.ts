import { STORAGE_KEY } from "@/lib/schedule/constants";
import { sanitizeScheduleState } from "@/lib/schedule/engine";
import { getPublishedSchedules, savePublishedSchedules } from "@/lib/schedule/published";
import {
  GeneratedSchedule,
  ScheduleChangeRequest,
  ScheduleChangeRequestAppliedState,
  ScheduleChangeRequestLogEntry,
  SchedulePersonRef,
  ScheduleState,
} from "@/lib/schedule/types";

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

function nowStamp() {
  return new Date().toLocaleString("ko-KR");
}

function refKey(ref: SchedulePersonRef) {
  return `${ref.monthKey}:${ref.dateKey}:${ref.category}:${ref.index}:${ref.name}`;
}

function cloneSchedule<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRoute(route: SchedulePersonRef[]) {
  const next: SchedulePersonRef[] = [];
  const seen = new Set<string>();
  route.forEach((ref) => {
    if (!ref) return;
    const key = refKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(ref);
  });
  return next;
}

function normalizeRequest(raw: Partial<ScheduleChangeRequest>) {
  const route = normalizeRoute(
    Array.isArray(raw.route) && raw.route.length >= 2
      ? raw.route
      : raw.source && raw.target
        ? [raw.source, raw.target]
        : [],
  );
  if (route.length < 2) return null;

  const source = raw.source ?? route[0];
  const target = raw.target ?? route[route.length - 1];
  if (!source || !target) return null;

  const createdAt = raw.createdAt ?? nowStamp();
  const defaultLogEntry: ScheduleChangeRequestLogEntry = {
    action: "created",
    at: createdAt,
    by: raw.requesterName ?? raw.requesterId ?? "system",
  };

  return {
    id: raw.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    monthKey: raw.monthKey ?? source.monthKey,
    requesterId: raw.requesterId ?? "",
    requesterName: raw.requesterName ?? "",
    source,
    target,
    route,
    hasConflictWarning: Boolean(raw.hasConflictWarning),
    status: raw.status ?? "pending",
    createdAt,
    resolvedAt: raw.resolvedAt ?? null,
    resolvedBy: raw.resolvedBy ?? null,
    rolledBackAt: raw.rolledBackAt ?? null,
    rolledBackBy: raw.rolledBackBy ?? null,
    appliedState: raw.appliedState
      ? {
          scheduleMonths: Array.isArray(raw.appliedState.scheduleMonths)
            ? raw.appliedState.scheduleMonths.map((item) => cloneSchedule(item))
            : [],
          publishedMonths: Array.isArray(raw.appliedState.publishedMonths)
            ? raw.appliedState.publishedMonths.map((item) => cloneSchedule(item))
            : [],
        }
      : null,
    history:
      Array.isArray(raw.history) && raw.history.length > 0
        ? raw.history
        : [defaultLogEntry],
  } satisfies ScheduleChangeRequest;
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

function buildScheduleMap(items: GeneratedSchedule[], monthKeys: Set<string>) {
  return new Map(
    items.filter((item) => monthKeys.has(item.monthKey)).map((item) => [item.monthKey, cloneSchedule(item)]),
  );
}

function rotateAssignmentsAcrossSchedules(
  scheduleMap: Map<string, GeneratedSchedule>,
  route: SchedulePersonRef[],
) {
  const slots = route.map((ref) => {
    const schedule = scheduleMap.get(ref.monthKey);
    if (!schedule) return null;
    return findRefSlot(schedule, ref);
  });
  if (slots.some((slot) => !slot)) return false;

  const resolvedSlots = slots as NonNullable<(typeof slots)[number]>[];
  const originalNames = resolvedSlots.map((slot) => slot.list[slot.index]);

  resolvedSlots.forEach((slot, index) => {
    const nextName = originalNames[(index + 1) % originalNames.length];
    slot.list[slot.index] = nextName;
  });

  route.forEach((ref, index) => {
    if (ref.category !== "휴가") return;
    resolvedSlots[index].day.vacations = [...resolvedSlots[index].list];
  });

  return true;
}

function collectMonthKeys(request: ScheduleChangeRequest) {
  return new Set(request.route.map((ref) => ref.monthKey));
}

function appendHistory(
  request: ScheduleChangeRequest,
  action: ScheduleChangeRequestLogEntry["action"],
  by: string,
  at: string,
) {
  return [...request.history, { action, by, at }];
}

function applyRequestToScheduleState(request: ScheduleChangeRequest) {
  if (typeof window === "undefined") return { applied: false, snapshots: [] as GeneratedSchedule[] };
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const current = raw ? sanitizeScheduleState(JSON.parse(raw) as Partial<ScheduleState>) : null;
  if (!current) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const monthKeys = collectMonthKeys(request);
  const scheduleMap = buildScheduleMap(current.generatedHistory, monthKeys);
  const snapshots = current.generatedHistory
    .filter((item) => monthKeys.has(item.monthKey))
    .map((item) => cloneSchedule(item));
  if (snapshots.length === 0) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const changed = rotateAssignmentsAcrossSchedules(scheduleMap, request.route);
  if (!changed) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const generatedHistory = current.generatedHistory.map((item) => scheduleMap.get(item.monthKey) ?? item);
  const generated = current.generated ? scheduleMap.get(current.generated.monthKey) ?? current.generated : null;
  const nextState = sanitizeScheduleState({
    ...current,
    generated,
    generatedHistory,
  });
  writeJson(STORAGE_KEY, nextState);
  return { applied: true, snapshots };
}

function applyRequestToPublishedSchedules(request: ScheduleChangeRequest) {
  const items = getPublishedSchedules();
  const monthKeys = collectMonthKeys(request);
  const scheduleMap = buildScheduleMap(
    items.map((item) => item.schedule),
    monthKeys,
  );
  const snapshots = items
    .filter((item) => monthKeys.has(item.monthKey))
    .map((item) => cloneSchedule(item.schedule));
  if (snapshots.length === 0) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const changed = rotateAssignmentsAcrossSchedules(scheduleMap, request.route);
  if (!changed) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const nextItems = items.map((item) => {
    const schedule = scheduleMap.get(item.monthKey);
    return schedule ? { ...item, schedule } : item;
  });
  savePublishedSchedules(nextItems);
  return { applied: true, snapshots };
}

function restoreScheduleStateSnapshots(appliedState: ScheduleChangeRequestAppliedState | null) {
  if (typeof window === "undefined" || !appliedState || appliedState.scheduleMonths.length === 0) return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const current = raw ? sanitizeScheduleState(JSON.parse(raw) as Partial<ScheduleState>) : null;
  if (!current) return false;

  const snapshotMap = new Map(appliedState.scheduleMonths.map((item) => [item.monthKey, cloneSchedule(item)]));
  const generatedHistory = current.generatedHistory.map((item) => snapshotMap.get(item.monthKey) ?? item);
  const generated = current.generated ? snapshotMap.get(current.generated.monthKey) ?? current.generated : null;
  const nextState = sanitizeScheduleState({
    ...current,
    generated,
    generatedHistory,
  });
  writeJson(STORAGE_KEY, nextState);
  return true;
}

function restorePublishedScheduleSnapshots(appliedState: ScheduleChangeRequestAppliedState | null) {
  if (!appliedState || appliedState.publishedMonths.length === 0) return false;
  const items = getPublishedSchedules();
  const snapshotMap = new Map(appliedState.publishedMonths.map((item) => [item.monthKey, cloneSchedule(item)]));
  const nextItems = items.map((item) => {
    const schedule = snapshotMap.get(item.monthKey);
    return schedule ? { ...item, schedule } : item;
  });
  savePublishedSchedules(nextItems);
  return true;
}

export function getRequestRoute(request: ScheduleChangeRequest) {
  return request.route?.length >= 2 ? request.route : [request.source, request.target];
}

export function getScheduleChangeRequests() {
  const items = readJson<Partial<ScheduleChangeRequest>[]>(CHANGE_REQUESTS_KEY, []);
  return items
    .map((item) => normalizeRequest(item))
    .filter((item): item is ScheduleChangeRequest => Boolean(item));
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
  route?: SchedulePersonRef[];
  hasConflictWarning?: boolean;
}) {
  const items = getScheduleChangeRequests();
  const createdAt = nowStamp();
  const route = normalizeRoute(input.route ?? [input.source, input.target]);
  const nextItem = normalizeRequest({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    monthKey: input.monthKey,
    requesterId: input.requesterId,
    requesterName: input.requesterName,
    source: input.source,
    target: input.target,
    route,
    hasConflictWarning: Boolean(input.hasConflictWarning),
    status: "pending",
    createdAt,
    resolvedAt: null,
    resolvedBy: null,
    rolledBackAt: null,
    rolledBackBy: null,
    appliedState: null,
    history: [
      {
        action: "created",
        at: createdAt,
        by: input.requesterName,
      },
    ],
  });
  if (!nextItem) {
    throw new Error("invalid change request");
  }

  const next = [nextItem, ...items];
  writeJson(CHANGE_REQUESTS_KEY, next);
  emitChangeRequestEvent();
  return nextItem;
}

export function isPendingRef(requests: ScheduleChangeRequest[], ref: SchedulePersonRef) {
  return requests.some(
    (item) => item.status === "pending" && getRequestRoute(item).some((candidate) => refKey(candidate) === refKey(ref)),
  );
}

export function resolveScheduleChangeRequest(
  requestId: string,
  action: "accepted" | "rejected" | "rolledBack",
  resolverName: string,
) {
  const items = getScheduleChangeRequests();
  const target = items.find((item) => item.id === requestId);
  if (!target) {
    return { ok: false as const, applied: false };
  }

  if (action === "rolledBack") {
    if (target.status !== "accepted") {
      return { ok: false as const, applied: false };
    }
    const restoredSchedule = restoreScheduleStateSnapshots(target.appliedState);
    const restoredPublished = restorePublishedScheduleSnapshots(target.appliedState);
    const applied = restoredSchedule || restoredPublished;
    const rolledBackAt = nowStamp();
    const next = items.map((item) =>
      item.id === requestId
        ? {
            ...item,
            status: "rolledBack" as const,
            rolledBackAt,
            rolledBackBy: resolverName,
            history: appendHistory(item, "rolledBack", resolverName, rolledBackAt),
          }
        : item,
    );
    writeJson(CHANGE_REQUESTS_KEY, next);
    emitChangeRequestEvent();
    return { ok: true as const, applied };
  }

  if (target.status !== "pending") {
    return { ok: false as const, applied: false };
  }

  const resolvedAt = nowStamp();
  let applied = false;
  let appliedState: ScheduleChangeRequestAppliedState | null = null;

  if (action === "accepted") {
    const scheduleResult = applyRequestToScheduleState(target);
    const publishedResult = applyRequestToPublishedSchedules(target);
    applied = scheduleResult.applied || publishedResult.applied;
    appliedState = {
      scheduleMonths: scheduleResult.snapshots,
      publishedMonths: publishedResult.snapshots,
    };
  }

  const next = items.map((item) =>
    item.id === requestId
      ? {
          ...item,
          status: action,
          resolvedAt,
          resolvedBy: resolverName,
          appliedState: action === "accepted" ? appliedState : item.appliedState,
          history: appendHistory(item, action, resolverName, resolvedAt),
        }
      : item,
  );
  writeJson(CHANGE_REQUESTS_KEY, next);
  emitChangeRequestEvent();
  return { ok: true as const, applied };
}

export function deleteScheduleChangeRequest(requestId: string) {
  const items = getScheduleChangeRequests();
  const next = items.filter((item) => item.id !== requestId);
  if (next.length === items.length) {
    return { ok: false as const };
  }
  writeJson(CHANGE_REQUESTS_KEY, next);
  emitChangeRequestEvent();
  return { ok: true as const };
}
