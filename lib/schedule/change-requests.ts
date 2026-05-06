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
import { isAutoManagedGeneralAssignment } from "@/lib/schedule/constants";
import { sanitizeScheduleState, syncGeneralAssignments } from "@/lib/schedule/engine";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseRequestFailureError,
  isSupabaseRequestTimeoutError,
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

const CHANGE_REQUEST_SUMMARY_SELECT =
  "id, month_key, requester_id, requester_name, source_ref, target_ref, route, status, has_conflict_warning, resolved_by, rolled_back_by, created_at, resolved_at, rolled_back_at";
const CHANGE_REQUEST_DETAIL_SELECT = `${CHANGE_REQUEST_SUMMARY_SELECT}, applied_state, history`;

interface RefreshScheduleChangeRequestsOptions {
  monthKeys?: string[];
  statuses?: ScheduleChangeRequest["status"][];
  includeDetails?: boolean;
}

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

function normalizeRequestMonthKeys(monthKeys?: string[]) {
  return Array.from(new Set((monthKeys ?? []).map((item) => item.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeRequestStatuses(statuses?: ScheduleChangeRequest["status"][]) {
  return Array.from(new Set((statuses ?? []).filter(Boolean)));
}

async function fetchScheduleChangeRequestDetail(requestId: string) {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("schedule_change_requests")
    .select(CHANGE_REQUEST_DETAIL_SELECT)
    .eq("id", requestId)
    .maybeSingle<ChangeRequestRow>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) {
      console.warn(getSupabaseStorageErrorMessage(error, "schedule_change_requests"));
      return null;
    }

    throw new Error(error.message);
  }

  return data ? rowToRequest(data) : null;
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

function requestToUpdateRow(request: ScheduleChangeRequest) {
  const { id, ...rest } = requestToRow(request);
  return rest;
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

function findRefDay(scheduleMap: Map<string, GeneratedSchedule>, ref: SchedulePersonRef) {
  return scheduleMap.get(ref.monthKey)?.days.find((item) => item.dateKey === ref.dateKey) ?? null;
}

function isAutoManagedGeneralRef(scheduleMap: Map<string, GeneratedSchedule>, ref: SchedulePersonRef) {
  return isAutoManagedGeneralAssignment(findRefDay(scheduleMap, ref), ref.category);
}

function buildKnownScheduleMapForRoute(route: SchedulePersonRef[]) {
  const monthKeys = new Set(route.map((ref) => ref.monthKey));
  const state = readStoredScheduleState();
  const schedules = [
    ...state.generatedHistory,
    ...(state.generated ? [state.generated] : []),
    ...getPublishedSchedules().map((item) => item.schedule),
  ];
  return buildScheduleMap(schedules, monthKeys);
}

async function buildLatestScheduleMapForRoute(route: SchedulePersonRef[]) {
  const firstKnownMap = buildKnownScheduleMapForRoute(route);
  const hasUnknownPlainGeneralRef = route.some(
    (ref) => ref.category === "일반" && !findRefDay(firstKnownMap, ref),
  );
  if (!hasUnknownPlainGeneralRef) return firstKnownMap;

  await Promise.all([refreshScheduleState().catch(() => null), refreshPublishedSchedules().catch(() => null)]);
  return buildKnownScheduleMapForRoute(route);
}

async function hasAutoManagedGeneralRef(route: SchedulePersonRef[]) {
  const scheduleMap = await buildLatestScheduleMapForRoute(route);
  return route.some((ref) => isAutoManagedGeneralRef(scheduleMap, ref));
}

function isGeneralAssistRoute(scheduleMap: Map<string, GeneratedSchedule>, route: SchedulePersonRef[]) {
  if (route.length !== 2) return false;
  const generalCount = route.filter((ref) => isAutoManagedGeneralRef(scheduleMap, ref)).length;
  return generalCount === 1;
}

function applyGeneralAssistRoute(
  scheduleMap: Map<string, GeneratedSchedule>,
  route: SchedulePersonRef[],
) {
  if (!isGeneralAssistRoute(scheduleMap, route)) return false;

  const workRef = route.find((ref) => !isAutoManagedGeneralRef(scheduleMap, ref)) ?? null;
  const generalRef = route.find((ref) => isAutoManagedGeneralRef(scheduleMap, ref)) ?? null;
  if (!workRef || !generalRef) return false;
  if (workRef.category === "휴가" || generalRef.category === "휴가") return false;

  const workSchedule = scheduleMap.get(workRef.monthKey);
  const generalSchedule = scheduleMap.get(generalRef.monthKey);
  if (!workSchedule || !generalSchedule) return false;

  const workSlot = findRefSlot(workSchedule, workRef);
  const generalSlot = findRefSlot(generalSchedule, generalRef);
  if (!workSlot || !generalSlot) return false;

  const promotedName = generalSlot.list[generalSlot.index]?.trim();
  if (!promotedName) return false;

  workSlot.list.splice(workSlot.index, 1);
  generalSlot.list.splice(generalSlot.index, 1);
  generalSlot.day.assignments[generalRef.category] = [...generalSlot.list];
  generalSlot.day.assignments[workRef.category] = [
    ...(generalSlot.day.assignments[workRef.category] ?? []),
    promotedName,
  ];

  return true;
}

function syncGeneralAssignmentsForSchedules(
  currentState: ScheduleState,
  schedules: GeneratedSchedule[],
) {
  return schedules.map((schedule) => {
    const syncedSchedule = cloneValue(schedule);
    syncGeneralAssignments(currentState, syncedSchedule.days, currentState.generalTeamPeople);
    return syncedSchedule;
  });
}

function rotateAssignmentsAcrossSchedules(
  scheduleMap: Map<string, GeneratedSchedule>,
  route: SchedulePersonRef[],
) {
  if (applyGeneralAssistRoute(scheduleMap, route)) {
    return true;
  }

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
  if (snapshots.length === 0) {
    return { matched: false, applied: false, snapshots: [] as GeneratedSchedule[] };
  }

  const changed = rotateAssignmentsAcrossSchedules(scheduleMap, request.route);
  if (!changed) {
    return { matched: true, applied: false, snapshots: [] as GeneratedSchedule[] };
  }

  const generatedHistory = current.generatedHistory.map((item) => scheduleMap.get(item.monthKey) ?? item);
  const generated = current.generated ? scheduleMap.get(current.generated.monthKey) ?? current.generated : null;
  const syncedGeneratedHistory = syncGeneralAssignmentsForSchedules(current, generatedHistory);
  const syncedGenerated = generated ? syncGeneralAssignmentsForSchedules(current, [generated])[0] : null;
  const nextState = {
    ...current,
    generated: syncedGenerated,
    generatedHistory: syncedGeneratedHistory,
  } satisfies ScheduleState;
  try {
    await saveScheduleState(nextState);
    const savedState = cloneValue(readStoredScheduleState());
    const nextSchedules = savedState.generatedHistory.filter((item) => monthKeys.has(item.monthKey));
    return { matched: true, applied: true, snapshots, nextSchedules };
  } catch {
    return { matched: true, applied: false, snapshots: [] as GeneratedSchedule[], nextSchedules: [] as GeneratedSchedule[] };
  }
}

async function applyRequestToPublishedSchedules(
  request: ScheduleChangeRequest,
  resolvedSchedules: GeneratedSchedule[] = [],
) {
  await refreshPublishedSchedules();
  await refreshScheduleState();
  const items = getPublishedSchedules();
  const currentState = cloneValue(readStoredScheduleState());
  const monthKeys = collectMonthKeys(request);
  const scheduleMap = buildScheduleMap(
    items.map((item) => item.schedule),
    monthKeys,
  );
  const snapshots = items
    .filter((item) => monthKeys.has(item.monthKey))
    .map((item) => cloneValue(item.schedule));
  if (snapshots.length === 0) {
    return { matched: false, applied: false, snapshots: [] as GeneratedSchedule[] };
  }

  const changed = rotateAssignmentsAcrossSchedules(scheduleMap, request.route);
  if (!changed) {
    return { matched: true, applied: false, snapshots: [] as GeneratedSchedule[] };
  }

  const syncedSchedules =
    resolvedSchedules.length > 0
      ? resolvedSchedules.map((schedule) => cloneValue(schedule))
      : syncGeneralAssignmentsForSchedules(currentState, Array.from(scheduleMap.values()));
  const syncedScheduleMap = new Map(syncedSchedules.map((schedule) => [schedule.monthKey, schedule]));

  const nextItems = items.map((item) => {
    const schedule = syncedScheduleMap.get(item.monthKey) ?? scheduleMap.get(item.monthKey);
    return schedule ? { ...item, schedule } : item;
  });
  try {
    await savePublishedSchedules(nextItems);
    return { matched: true, applied: true, snapshots };
  } catch {
    return { matched: true, applied: false, snapshots: [] as GeneratedSchedule[] };
  }
}

async function restoreScheduleStateSnapshots(appliedState: ScheduleChangeRequestAppliedState | null) {
  if (!appliedState || appliedState.scheduleMonths.length === 0) return false;
  await refreshScheduleState();
  const current = cloneValue(readStoredScheduleState());
  const snapshotMap = new Map(appliedState.scheduleMonths.map((item) => [item.monthKey, cloneValue(item)]));
  const generatedHistory = current.generatedHistory.map((item) => snapshotMap.get(item.monthKey) ?? item);
  const generated = current.generated ? snapshotMap.get(current.generated.monthKey) ?? current.generated : null;
  try {
    await saveScheduleState({
      ...current,
      generated,
      generatedHistory,
    });
    return true;
  } catch {
    return false;
  }
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
  try {
    await savePublishedSchedules(nextItems);
    return true;
  } catch {
    return false;
  }
}

export function getRequestRoute(request: ScheduleChangeRequest) {
  return request.route?.length >= 2 ? request.route : [request.source, request.target];
}

export function getScheduleChangeRequests(monthKeys?: string[]) {
  const normalizedMonthKeys = normalizeRequestMonthKeys(monthKeys);
  const monthKeySet = normalizedMonthKeys.length > 0 ? new Set(normalizedMonthKeys) : null;
  return requestCache
    .filter((item) => !monthKeySet || monthKeySet.has(item.monthKey))
    .map((item) => cloneValue(item));
}

export function getPendingScheduleChangeRequests(monthKey?: string) {
  return getScheduleChangeRequests().filter(
    (item) => item.status === "pending" && (!monthKey || item.monthKey === monthKey),
  );
}

export async function refreshScheduleChangeRequests(options: RefreshScheduleChangeRequestsOptions = {}) {
  if (requestRefreshPromise) {
    return requestRefreshPromise;
  }

  requestRefreshPromise = (async () => {
    const monthKeys = normalizeRequestMonthKeys(options.monthKeys);
    const statuses = normalizeRequestStatuses(options.statuses);
    const session = await getPortalSession();
    if (!session?.approved) {
      requestCache = [];
      emitChangeRequestEvent();
      return [];
    }

    const supabase = await getPortalSupabaseClient();
    let query = supabase
      .from("schedule_change_requests")
      .select(options.includeDetails ? CHANGE_REQUEST_DETAIL_SELECT : CHANGE_REQUEST_SUMMARY_SELECT)
      .order("created_at", { ascending: false });

    if (monthKeys.length === 1) {
      query = query.eq("month_key", monthKeys[0]);
    } else if (monthKeys.length > 1) {
      query = query.in("month_key", monthKeys);
    }

    if (statuses.length === 1) {
      query = query.eq("status", statuses[0]);
    } else if (statuses.length > 1) {
      query = query.in("status", statuses);
    }

    const { data, error } = await query.returns<ChangeRequestRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "schedule_change_requests"));
        requestCache = [];
        emitChangeRequestEvent();
        return [];
      }

      if (isSupabaseRequestTimeoutError(error) || isSupabaseRequestFailureError(error)) {
        console.warn("근무 변경 요청을 불러오지 못했습니다. 기존 캐시를 유지합니다.", error);
        emitChangeRequestEvent();
        return getScheduleChangeRequests(monthKeys);
      }

      throw new Error(error.message);
    }

    requestCache = (data ?? [])
      .map((row) => rowToRequest(row))
      .filter((item): item is ScheduleChangeRequest => Boolean(item));
    emitChangeRequestEvent();
    return getScheduleChangeRequests(monthKeys);
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
  if (await hasAutoManagedGeneralRef(route)) {
    throw new Error("일반 근무는 변경 요청 대상이 아닙니다. 실제 근무가 변경되면 일반 근무는 자동으로 다시 계산됩니다.");
  }
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
  resolverName?: string,
) {
  const session = await getPortalSession();
  if (!session?.approved) {
    return { ok: false as const, applied: false };
  }

  const resolverId = session.id;
  const resolverLabel = resolverName?.trim() || session.username || "관리자";

  const items = getScheduleChangeRequests();
  const cachedTarget = items.find((item) => item.id === requestId);
  const target = (await fetchScheduleChangeRequestDetail(requestId)) ?? cachedTarget;
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
      rolledBackBy: resolverId,
      history: appendHistory(target, "rolledBack", resolverLabel, rolledBackAt),
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
      resolvedBy: resolverId,
      history: appendHistory(target, "rejected", resolverLabel, resolvedAt),
    };
  } else {
    if (target.status !== "pending") {
      return { ok: false as const, applied: false };
    }
    if (await hasAutoManagedGeneralRef(target.route)) {
      emitChangeRequestStatus({
        ok: false,
        message: "일반 근무는 변경 요청 대상이 아닙니다. 실제 근무가 변경되면 일반 근무는 자동으로 다시 계산됩니다.",
      });
      return { ok: false as const, applied: false };
    }

    const scheduleResult = await applyRequestToScheduleState(target);
    const publishedResult = await applyRequestToPublishedSchedules(target, scheduleResult.nextSchedules ?? []);
    const hasApplyFailure =
      (scheduleResult.matched && !scheduleResult.applied) || (publishedResult.matched && !publishedResult.applied);

    if (hasApplyFailure) {
      if (scheduleResult.applied) {
        await restoreScheduleStateSnapshots({
          scheduleMonths: scheduleResult.snapshots,
          publishedMonths: [],
        });
      }
      if (publishedResult.applied) {
        await restorePublishedScheduleSnapshots({
          scheduleMonths: [],
          publishedMonths: publishedResult.snapshots,
        });
      }
      emitChangeRequestStatus({
        ok: false,
        message: "근무 변경 요청 반영에 실패했습니다. 변경 내용을 되돌렸습니다.",
      });
      await Promise.all([refreshScheduleState(), refreshPublishedSchedules()]);
      return { ok: false as const, applied: false };
    }

    applied = scheduleResult.applied || publishedResult.applied;
    const resolvedAt = nowStamp();

    nextItem = {
      ...target,
      status: "accepted",
      resolvedAt,
      resolvedBy: resolverId,
      appliedState: {
        scheduleMonths: scheduleResult.snapshots,
        publishedMonths: publishedResult.snapshots,
      },
      history: appendHistory(target, "accepted", resolverLabel, resolvedAt),
    };
  }

  const previous = items;
  requestCache = previous.map((item) => (item.id === requestId ? nextItem : item));
  emitChangeRequestEvent();

  try {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("schedule_change_requests")
      .update(requestToUpdateRow(nextItem))
      .eq("id", requestId)
      .select("id")
      .returns<Array<{ id: string }>>();
    if (error) {
      throw new Error(error.message);
    }
    if (!data || data.length !== 1) {
      throw new Error("근무 변경 요청을 처리할 권한이 없거나 요청이 이미 변경되었습니다.");
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
    const { data, error } = await supabase
      .from("schedule_change_requests")
      .delete()
      .eq("id", requestId)
      .select("id")
      .returns<Array<{ id: string }>>();
    if (error) {
      throw new Error(error.message);
    }
    if (!data || data.length !== 1) {
      throw new Error("근무 변경 요청을 삭제할 권한이 없거나 요청이 이미 삭제되었습니다.");
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
