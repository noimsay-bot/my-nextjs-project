import { getPublishedSchedules, refreshPublishedSchedules, savePublishedSchedules } from "@/lib/schedule/published";
import { readStoredScheduleState, refreshScheduleState, saveScheduleState } from "@/lib/schedule/storage";
import {
  GeneratedSchedule,
  ScheduleChangeRequest,
  ScheduleChangeRequestAppliedState,
  ScheduleChangeRequestLogEntry,
  SchedulePersonRef,
  ScheduleState,
} from "@/lib/schedule/types";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

interface ChangeRequestRow {
  id: string;
  month_key: string;
  requester_id: string;
  requester_name: string;
  source_ref: SchedulePersonRef | null;
  target_ref: SchedulePersonRef | null;
  route: SchedulePersonRef[] | null;
  status: ScheduleChangeRequest["status"];
  has_conflict_warning: boolean;
  applied_state: ScheduleChangeRequestAppliedState | null;
  history: ScheduleChangeRequestLogEntry[] | null;
  resolved_by: string | null;
  rolled_back_by: string | null;
  created_at: string;
  resolved_at: string | null;
  rolled_back_at: string | null;
}

export const CHANGE_REQUESTS_EVENT = "j-special-force-schedule-change-requests-updated";
export const CHANGE_REQUESTS_STATUS_EVENT = "j-special-force-schedule-change-requests-status";

let requestCache: ScheduleChangeRequest[] = [];
let requestRefreshPromise: Promise<ScheduleChangeRequest[]> | null = null;

function emitChangeRequestEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_REQUESTS_EVENT));
}

function emitChangeRequestStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_REQUESTS_STATUS_EVENT, { detail }));
}

function nowStamp() {
  return new Date().toISOString();
}

function refKey(ref: SchedulePersonRef) {
  return `${ref.monthKey}:${ref.dateKey}:${ref.category}:${ref.index}:${ref.name}`;
}

function cloneValue<T>(value: T): T {
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
    id: raw.id ?? crypto.randomUUID(),
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
            ? raw.appliedState.scheduleMonths.map((item) => cloneValue(item))
            : [],
          publishedMonths: Array.isArray(raw.appliedState.publishedMonths)
            ? raw.appliedState.publishedMonths.map((item) => cloneValue(item))
            : [],
        }
      : null,
    history:
      Array.isArray(raw.history) && raw.history.length > 0
        ? raw.history
        : [defaultLogEntry],
  } satisfies ScheduleChangeRequest;
}

function rowToRequest(row: ChangeRequestRow) {
  return normalizeRequest({
    id: row.id,
    monthKey: row.month_key,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    source: row.source_ref ?? undefined,
    target: row.target_ref ?? undefined,
    route: row.route ?? undefined,
    status: row.status,
    hasConflictWarning: row.has_conflict_warning,
    appliedState: row.applied_state ?? undefined,
    history: row.history ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    rolledBackAt: row.rolled_back_at ?? undefined,
    rolledBackBy: row.rolled_back_by ?? undefined,
  });
}

function requestToRow(request: ScheduleChangeRequest) {
  return {
    id: request.id,
    month_key: request.monthKey,
    requester_id: request.requesterId,
    requester_name: request.requesterName,
    source_ref: request.source,
    target_ref: request.target,
    route: request.route,
    status: request.status,
    has_conflict_warning: request.hasConflictWarning,
    applied_state: request.appliedState,
    history: request.history,
    resolved_by: request.resolvedBy || null,
    rolled_back_by: request.rolledBackBy || null,
    created_at: request.createdAt,
    resolved_at: request.resolvedAt,
    rolled_back_at: request.rolledBackAt,
  };
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
    items.filter((item) => monthKeys.has(item.monthKey)).map((item) => [item.monthKey, cloneValue(item)]),
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

async function applyRequestToScheduleState(request: ScheduleChangeRequest) {
  await refreshScheduleState();
  const current = cloneValue(readStoredScheduleState());
  const monthKeys = collectMonthKeys(request);
  const scheduleMap = buildScheduleMap(current.generatedHistory, monthKeys);
  const snapshots = current.generatedHistory
    .filter((item) => monthKeys.has(item.monthKey))
    .map((item) => cloneValue(item));
  if (snapshots.length === 0) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const changed = rotateAssignmentsAcrossSchedules(scheduleMap, request.route);
  if (!changed) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const generatedHistory = current.generatedHistory.map((item) => scheduleMap.get(item.monthKey) ?? item);
  const generated = current.generated ? scheduleMap.get(current.generated.monthKey) ?? current.generated : null;
  const nextState = {
    ...current,
    generated,
    generatedHistory,
  } satisfies ScheduleState;
  await saveScheduleState(nextState);
  return { applied: true, snapshots };
}

async function applyRequestToPublishedSchedules(request: ScheduleChangeRequest) {
  await refreshPublishedSchedules();
  const items = getPublishedSchedules();
  const monthKeys = collectMonthKeys(request);
  const scheduleMap = buildScheduleMap(
    items.map((item) => item.schedule),
    monthKeys,
  );
  const snapshots = items
    .filter((item) => monthKeys.has(item.monthKey))
    .map((item) => cloneValue(item.schedule));
  if (snapshots.length === 0) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const changed = rotateAssignmentsAcrossSchedules(scheduleMap, request.route);
  if (!changed) return { applied: false, snapshots: [] as GeneratedSchedule[] };

  const nextItems = items.map((item) => {
    const schedule = scheduleMap.get(item.monthKey);
    return schedule ? { ...item, schedule } : item;
  });
  await savePublishedSchedules(nextItems);
  return { applied: true, snapshots };
}

async function restoreScheduleStateSnapshots(appliedState: ScheduleChangeRequestAppliedState | null) {
  if (!appliedState || appliedState.scheduleMonths.length === 0) return false;
  await refreshScheduleState();
  const current = cloneValue(readStoredScheduleState());
  const snapshotMap = new Map(appliedState.scheduleMonths.map((item) => [item.monthKey, cloneValue(item)]));
  const generatedHistory = current.generatedHistory.map((item) => snapshotMap.get(item.monthKey) ?? item);
  const generated = current.generated ? snapshotMap.get(current.generated.monthKey) ?? current.generated : null;
  await saveScheduleState({
    ...current,
    generated,
    generatedHistory,
  });
  return true;
}

async function restorePublishedScheduleSnapshots(appliedState: ScheduleChangeRequestAppliedState | null) {
  if (!appliedState || appliedState.publishedMonths.length === 0) return false;
  await refreshPublishedSchedules();
  const items = getPublishedSchedules();
  const snapshotMap = new Map(appliedState.publishedMonths.map((item) => [item.monthKey, cloneValue(item)]));
  const nextItems = items.map((item) => {
    const schedule = snapshotMap.get(item.monthKey);
    return schedule ? { ...item, schedule } : item;
  });
  await savePublishedSchedules(nextItems);
  return true;
}

export function getRequestRoute(request: ScheduleChangeRequest) {
  return request.route?.length >= 2 ? request.route : [request.source, request.target];
}

export function getScheduleChangeRequests() {
  return requestCache.map((item) => cloneValue(item));
}

export function getPendingScheduleChangeRequests(monthKey?: string) {
  return getScheduleChangeRequests().filter(
    (item) => item.status === "pending" && (!monthKey || item.monthKey === monthKey),
  );
}

export async function refreshScheduleChangeRequests() {
  if (requestRefreshPromise) {
    return requestRefreshPromise;
  }

  requestRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      requestCache = [];
      emitChangeRequestEvent();
      return [];
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("schedule_change_requests")
      .select(
        "id, month_key, requester_id, requester_name, source_ref, target_ref, route, status, has_conflict_warning, applied_state, history, resolved_by, rolled_back_by, created_at, resolved_at, rolled_back_at",
      )
      .order("created_at", { ascending: false })
      .returns<ChangeRequestRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "schedule_change_requests"));
        requestCache = [];
        emitChangeRequestEvent();
        return [];
      }

      throw new Error(error.message);
    }

    requestCache = (data ?? [])
      .map((row) => rowToRequest(row))
      .filter((item): item is ScheduleChangeRequest => Boolean(item));
    emitChangeRequestEvent();
    return getScheduleChangeRequests();
  })().finally(() => {
    requestRefreshPromise = null;
  });

  return requestRefreshPromise;
}

export async function createScheduleChangeRequest(input: {
  monthKey: string;
  requesterId: string;
  requesterName: string;
  source: SchedulePersonRef;
  target: SchedulePersonRef;
  route?: SchedulePersonRef[];
  hasConflictWarning?: boolean;
}) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const createdAt = nowStamp();
  const route = normalizeRoute(input.route ?? [input.source, input.target]);
  const nextItem = normalizeRequest({
    id: crypto.randomUUID(),
    monthKey: input.monthKey,
    requesterId: input.requesterId,
    requesterName: input.requesterName,
    source: input.source,
    target: input.target,
    route,
    hasConflictWarning: Boolean(input.hasConflictWarning),
    status: "pending",
    createdAt,
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

  const previous = getScheduleChangeRequests();
  requestCache = [nextItem, ...previous];
  emitChangeRequestEvent();

  try {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("schedule_change_requests").insert(requestToRow(nextItem));
    if (error) {
      throw new Error(error.message);
    }
    return cloneValue(nextItem);
  } catch (error) {
    emitChangeRequestStatus({
      ok: false,
      message: error instanceof Error ? error.message : "근무 변경 요청 저장에 실패했습니다. 다시 시도해 주세요.",
    });
    requestCache = previous;
    emitChangeRequestEvent();
    await refreshScheduleChangeRequests();
    throw error;
  }
}

export function isPendingRef(requests: ScheduleChangeRequest[], ref: SchedulePersonRef) {
  return requests.some(
    (item) => item.status === "pending" && getRequestRoute(item).some((candidate) => refKey(candidate) === refKey(ref)),
  );
}

export async function resolveScheduleChangeRequest(
  requestId: string,
  action: "accepted" | "rejected" | "rolledBack",
  resolverName: string,
) {
  const session = await getPortalSession();
  if (!session?.approved) {
    return { ok: false as const, applied: false };
  }

  const items = getScheduleChangeRequests();
  const target = items.find((item) => item.id === requestId);
  if (!target) {
    return { ok: false as const, applied: false };
  }

  let applied = false;
  let nextItem: ScheduleChangeRequest;

  if (action === "rolledBack") {
    if (target.status !== "accepted") {
      return { ok: false as const, applied: false };
    }

    const restoredSchedule = await restoreScheduleStateSnapshots(target.appliedState);
    const restoredPublished = await restorePublishedScheduleSnapshots(target.appliedState);
    applied = restoredSchedule || restoredPublished;
    const rolledBackAt = nowStamp();
    nextItem = {
      ...target,
      status: "rolledBack",
      rolledBackAt,
      rolledBackBy: resolverName,
      history: appendHistory(target, "rolledBack", resolverName, rolledBackAt),
    };
  } else if (action === "rejected") {
    if (target.status !== "pending") {
      return { ok: false as const, applied: false };
    }

    const resolvedAt = nowStamp();
    nextItem = {
      ...target,
      status: "rejected",
      resolvedAt,
      resolvedBy: resolverName,
      history: appendHistory(target, "rejected", resolverName, resolvedAt),
    };
  } else {
    if (target.status !== "pending") {
      return { ok: false as const, applied: false };
    }

    const scheduleResult = await applyRequestToScheduleState(target);
    const publishedResult = await applyRequestToPublishedSchedules(target);
    applied = scheduleResult.applied || publishedResult.applied;
    const resolvedAt = nowStamp();

    nextItem = {
      ...target,
      status: "accepted",
      resolvedAt,
      resolvedBy: resolverName,
      appliedState: {
        scheduleMonths: scheduleResult.snapshots,
        publishedMonths: publishedResult.snapshots,
      },
      history: appendHistory(target, "accepted", resolverName, resolvedAt),
    };
  }

  const previous = items;
  requestCache = previous.map((item) => (item.id === requestId ? nextItem : item));
  emitChangeRequestEvent();

  try {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("schedule_change_requests").upsert(requestToRow(nextItem));
    if (error) {
      throw new Error(error.message);
    }
    return { ok: true as const, applied };
  } catch (error) {
    emitChangeRequestStatus({
      ok: false,
      message: error instanceof Error ? error.message : "근무 변경 요청 처리에 실패했습니다. DB 기준 상태로 복구합니다.",
    });
    requestCache = previous;
    emitChangeRequestEvent();
    await refreshScheduleChangeRequests();
    if (action === "accepted" || action === "rolledBack") {
      await refreshScheduleState();
      await refreshPublishedSchedules();
    }
    return { ok: false as const, applied: false };
  }
}

export async function deleteScheduleChangeRequest(requestId: string) {
  const previous = getScheduleChangeRequests();
  const target = previous.find((item) => item.id === requestId);
  if (!target) {
    return { ok: false as const };
  }

  requestCache = previous.filter((item) => item.id !== requestId);
  emitChangeRequestEvent();

  try {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from("schedule_change_requests").delete().eq("id", requestId);
    if (error) {
      throw new Error(error.message);
    }
    return { ok: true as const };
  } catch (error) {
    emitChangeRequestStatus({
      ok: false,
      message: error instanceof Error ? error.message : "근무 변경 요청 삭제에 실패했습니다. 다시 불러옵니다.",
    });
    requestCache = previous;
    emitChangeRequestEvent();
    await refreshScheduleChangeRequests();
    return { ok: false as const };
  }
}
