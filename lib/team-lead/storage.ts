"use client";

import { getUsers, isReadOnlyPortalRole, isTeamLeadEvaluationExcludedRole, type UserRole } from "@/lib/auth/storage";
import {
  buildScheduleAssignmentNameTagKey,
  defaultPointers,
  getScheduleCategoryLabel,
} from "@/lib/schedule/constants";
import { getPublishedSchedules } from "@/lib/schedule/published";
import { readStoredScheduleState } from "@/lib/schedule/storage";
import { DaySchedule, GeneratedSchedule, ScheduleAssignmentNameTag } from "@/lib/schedule/types";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseRequestFailureError,
  isSupabaseRequestTimeoutError,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";
import {
  getTeamLeadEvaluationPeriod,
  getTeamLeadEvaluationYear,
} from "@/lib/team-lead/evaluation-year";

export type AssignmentTimeColor = "" | "red" | "blue" | "yellow";
export type AssignmentTravelType = "" | "국내출장" | "해외출장" | "당일출장";
export type AssignmentTripTagPhase = "" | "departure" | "ongoing" | "return";

export interface ScheduleAssignmentEntry {
  clockIn: string;
  clockInColor: AssignmentTimeColor;
  clockInConfirmed: boolean;
  clockOut: string;
  clockOutColor: AssignmentTimeColor;
  clockOutConfirmed: boolean;
  schedules: string[];
  travelType: AssignmentTravelType;
  tripTagId: string;
  tripTagLabel: string;
  tripTagPhase: AssignmentTripTagPhase;
  exclusiveVideo: boolean[];
  coverageScore: number;
  coverageNote: string;
}

export interface ScheduleAssignmentRow {
  key: string;
  name: string;
  duty: string;
  isCustom: boolean;
}

export interface ScheduleAssignmentCustomRow {
  id: string;
  name: string;
  duty: string;
}

export interface ScheduleAssignmentRowOverride {
  name: string;
  duty: string;
}

export interface TeamLeadTripItem {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
  startDateKey: string;
  endDateKey: string;
  dayCount: number;
  dateKeys: string[];
  duties: string[];
  schedules: string[];
}

export interface TeamLeadTripPersonCard {
  name: string;
  items: TeamLeadTripItem[];
}

export interface ScheduleAssignmentVisibleTripTag {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
  phase: AssignmentTripTagPhase;
  isInherited: boolean;
}

export interface ScheduleAssignmentDisplayNameInput {
  monthKey: string;
  dateKey: string;
  category: string;
  index: number;
  name: string;
}

export interface ContributionPeriod {
  evaluationYear: number;
  startMonthKey: string;
  endMonthKey: string;
  startLabel: string;
  endLabel: string;
  label: string;
}

export interface ContributionScoreItem {
  monthKey: string;
  dateKey: string;
  duty: string;
  clockIn: string;
  clockOut: string;
  schedules: string[];
  clockInScore: number;
  clockOutScore: number;
  coverageScore: number;
  coverageNote: string;
  totalScore: number;
}

export interface ContributionManualItem {
  id: string;
  label: string;
  score: number;
}

export interface ContributionPersonCard {
  name: string;
  totalScore: number;
  autoScore: number;
  manualScore: number;
  clockInScore: number;
  clockOutScore: number;
  coverageScore: number;
  itemCount: number;
  items: ContributionScoreItem[];
  manualItems: ContributionManualItem[];
}

export type FinalCutDecision = "" | "circle" | "triangle" | "cross";

export interface FinalCutScheduleItem {
  id: string;
  dateKey: string;
  duty: string;
  schedule: string;
  decision: FinalCutDecision;
}

export interface FinalCutPersonCard {
  name: string;
  items: FinalCutScheduleItem[];
}

export interface ScheduleAssignmentDayRows {
  addedRows: ScheduleAssignmentCustomRow[];
  deletedRowKeys: string[];
  rowOverrides: Record<string, ScheduleAssignmentRowOverride>;
}

export type ScheduleAssignmentMonthStore = Record<string, ScheduleAssignmentEntry>;
export type ScheduleAssignmentStore = Record<string, ScheduleAssignmentMonthStore>;
export type ScheduleAssignmentRowStore = Record<string, Record<string, ScheduleAssignmentDayRows>>;
type ContributionManualYearStore = Record<string, ContributionManualItem[]>;
type ContributionManualStore = Record<string, ContributionManualYearStore>;
type ReferenceNotesYearStore = Record<string, TeamLeadReferenceNoteItem[]>;
type ReferenceNotesStore = Record<string, ReferenceNotesYearStore>;

export interface ScheduleAssignmentDataStore {
  entries: ScheduleAssignmentStore;
  rows: ScheduleAssignmentRowStore;
}

export const TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT = "j-team-lead-schedule-assignment-updated";
export const TEAM_LEAD_CONTRIBUTION_EVENT = "j-team-lead-contribution-updated";
export const TEAM_LEAD_FINAL_CUT_EVENT = "j-team-lead-final-cut-updated";
export const TEAM_LEAD_STORAGE_STATUS_EVENT = "j-team-lead-storage-status";
export const SCHEDULE_ASSIGNMENT_TAGGED_NAME_BACKGROUND = "rgba(59,130,246,.28)";
export const SCHEDULE_ASSIGNMENT_TAGGED_NAME_BORDER = "1px solid rgba(96,165,250,.7)";
export const SCHEDULE_ASSIGNMENT_TAGGED_NAME_COLOR = "#eff6ff";
const TEAM_LEAD_CONTRIBUTION_STATE_KEY = "contribution_manual_v1";
const TEAM_LEAD_FINAL_CUT_STATE_KEY = "final_cut_v1";
const TEAM_LEAD_REVIEW_ACCESS_STATE_KEY = "review_access_v1";
const TEAM_LEAD_SUBMISSION_ACCESS_STATE_KEY = "submission_access_v1";
const TEAM_LEAD_REFERENCE_NOTES_STATE_KEY = "reference_notes_v1";
const TEAM_LEAD_BEST_REPORT_QUARTER_STATE_KEY = "best_report_quarters_v1";
const TEAM_LEAD_BEST_REPORT_CURRENT_STATE_KEY = "best_report_current_v1";
export const TEAM_LEAD_BEST_REPORT_EVENT = "j-team-lead-best-report-updated";
export const TEAM_LEAD_SUBMISSION_ACCESS_EVENT = "j-team-lead-submission-access-updated";

interface TeamLeadScheduleAssignmentRow {
  month_key: string;
  entries: ScheduleAssignmentMonthStore | null;
  rows: Record<string, ScheduleAssignmentDayRows> | null;
  updated_at?: string;
}

interface TeamLeadStateRow {
  key: string;
  state: unknown;
}

let assignmentStoreCache: ScheduleAssignmentDataStore = { entries: {}, rows: {} };
let assignmentMonthUpdatedAtCache: Record<string, string> = {};
let contributionManualCache = {} as ContributionManualStore;
let finalCutCache = {} as Record<string, FinalCutDecision>;
let submissionAccessCache = false;
let teamLeadRefreshPromise: Promise<void> | null = null;
let teamLeadMetaRefreshPromise: Promise<void> | null = null;
const assignmentMonthRefreshPromises = new Map<string, Promise<void>>();
const assignmentMonthsRefreshPromises = new Map<string, Promise<void>>();
let assignmentPersistedSnapshotCache: Record<string, string> = {};
let assignmentPersistTimer: ReturnType<typeof setTimeout> | null = null;
let assignmentPersistDelayMs: number | null = null;
let assignmentPersistResolvers: Array<() => void> = [];
let assignmentPersistMonthKeys = new Set<string>();
let finalCutPersistTimer: ReturnType<typeof setTimeout> | null = null;
let finalCutPersistResolvers: Array<() => void> = [];

interface SaveScheduleAssignmentStoreOptions {
  debounceMs?: number;
}

class ScheduleAssignmentConflictError extends Error {
  monthKeys: string[];

  constructor(monthKeys: string[]) {
    super("다른 사용자가 먼저 일정배정을 저장했습니다.");
    this.name = "ScheduleAssignmentConflictError";
    this.monthKeys = monthKeys;
  }
}

export function createAssignmentRowKey(dateKey: string, category: string, index: number, name: string) {
  return `${dateKey}::${category}::${index}::${name}`;
}

export function createCustomAssignmentRowKey(dateKey: string, customId: string) {
  return `${dateKey}::custom::${customId}`;
}

export function createDefaultScheduleAssignmentEntry(): ScheduleAssignmentEntry {
  return {
    clockIn: "",
    clockInColor: "",
    clockInConfirmed: false,
    clockOut: "",
    clockOutColor: "",
    clockOutConfirmed: false,
    schedules: [""],
    travelType: "",
    tripTagId: "",
    tripTagLabel: "",
    tripTagPhase: "",
    exclusiveVideo: [false],
    coverageScore: 0,
    coverageNote: "",
  };
}

export function createDefaultScheduleAssignmentDayRows(): ScheduleAssignmentDayRows {
  return {
    addedRows: [],
    deletedRowKeys: [],
    rowOverrides: {},
  };
}

function normalizeScheduleAssignmentEntry(
  entry: Partial<ScheduleAssignmentEntry> | undefined,
): ScheduleAssignmentEntry {
  const defaultEntry = createDefaultScheduleAssignmentEntry();
  const schedules =
    entry?.schedules && entry.schedules.length > 0
      ? entry.schedules.map((item) => item ?? "")
      : defaultEntry.schedules;
  const exclusiveVideoSource = Array.isArray(entry?.exclusiveVideo)
    ? entry.exclusiveVideo
    : typeof entry?.exclusiveVideo === "boolean"
      ? [entry.exclusiveVideo]
      : [];
  const exclusiveVideo = schedules.map((_, index) => exclusiveVideoSource[index] ?? false);

  const clockIn =
    entry?.clockIn === "00:00" && !entry.clockInColor ? "" : (entry?.clockIn ?? defaultEntry.clockIn);
  const clockOut =
    entry?.clockOut === "00:00" && !entry.clockOutColor ? "" : (entry?.clockOut ?? defaultEntry.clockOut);

  return {
    clockIn,
    clockInColor: entry?.clockInColor ?? defaultEntry.clockInColor,
    clockInConfirmed: entry?.clockInConfirmed ?? Boolean(clockIn),
    clockOut,
    clockOutColor: entry?.clockOutColor ?? defaultEntry.clockOutColor,
    clockOutConfirmed: entry?.clockOutConfirmed ?? Boolean(clockOut),
    schedules,
    travelType: entry?.travelType ?? defaultEntry.travelType,
    tripTagId: typeof entry?.tripTagId === "string" ? entry.tripTagId.trim() : "",
    tripTagLabel: typeof entry?.tripTagLabel === "string" ? entry.tripTagLabel.trim() : "",
    tripTagPhase:
      entry?.tripTagPhase === "departure" || entry?.tripTagPhase === "ongoing" || entry?.tripTagPhase === "return"
        ? entry.tripTagPhase
        : "",
    exclusiveVideo,
    coverageScore: [0, 0.5, 1, 1.5, 2].includes(Number(entry?.coverageScore)) ? Number(entry?.coverageScore) : 0,
    coverageNote: typeof entry?.coverageNote === "string" ? entry.coverageNote : "",
  };
}

function normalizeEntriesStore(store: unknown): ScheduleAssignmentStore {
  if (!store || typeof store !== "object") return {};

  const nextStore: ScheduleAssignmentStore = {};
  for (const [monthKey, monthEntries] of Object.entries(store as Record<string, unknown>)) {
    if (!monthEntries || typeof monthEntries !== "object") continue;

    nextStore[monthKey] = {};
    for (const [rowKey, entry] of Object.entries(monthEntries as Record<string, unknown>)) {
      nextStore[monthKey][rowKey] = normalizeScheduleAssignmentEntry(
        entry as Partial<ScheduleAssignmentEntry> | undefined,
      );
    }
  }

  return nextStore;
}

function normalizeDayRows(dayRows: Partial<ScheduleAssignmentDayRows> | undefined): ScheduleAssignmentDayRows {
  return {
    addedRows: Array.isArray(dayRows?.addedRows)
      ? dayRows.addedRows
          .filter((row): row is ScheduleAssignmentCustomRow => Boolean(row && typeof row.id === "string"))
          .map((row) => ({
            id: row.id,
            name: row.name ?? "",
            duty: row.duty ?? "",
          }))
      : [],
    deletedRowKeys: Array.isArray(dayRows?.deletedRowKeys) ? dayRows.deletedRowKeys.filter(Boolean) : [],
    rowOverrides:
      dayRows?.rowOverrides && typeof dayRows.rowOverrides === "object"
        ? Object.fromEntries(
            Object.entries(dayRows.rowOverrides).map(([rowKey, row]) => [
              rowKey,
              {
                name: row?.name ?? "",
                duty: row?.duty ?? "",
              },
            ]),
          )
        : {},
  };
}

function normalizeRowsStore(store: unknown): ScheduleAssignmentRowStore {
  if (!store || typeof store !== "object") return {};

  const nextStore: ScheduleAssignmentRowStore = {};
  for (const [monthKey, monthRows] of Object.entries(store as Record<string, unknown>)) {
    if (!monthRows || typeof monthRows !== "object") continue;

    nextStore[monthKey] = {};
    for (const [dateKey, dayRows] of Object.entries(monthRows as Record<string, unknown>)) {
      nextStore[monthKey][dateKey] = normalizeDayRows(dayRows as Partial<ScheduleAssignmentDayRows> | undefined);
    }
  }

  return nextStore;
}

function normalizeMonthEntries(value: unknown) {
  if (!value || typeof value !== "object") return {} as ScheduleAssignmentMonthStore;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([rowKey, entry]) => [
      rowKey,
      normalizeScheduleAssignmentEntry(entry as Partial<ScheduleAssignmentEntry> | undefined),
    ]),
  ) as ScheduleAssignmentMonthStore;
}

function normalizeMonthRows(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, ScheduleAssignmentDayRows>;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([dateKey, dayRows]) => [
      dateKey,
      normalizeDayRows(dayRows as Partial<ScheduleAssignmentDayRows> | undefined),
    ]),
  ) as Record<string, ScheduleAssignmentDayRows>;
}

function normalizeScheduleAssignmentDataStore(store: unknown): ScheduleAssignmentDataStore {
  if (!store || typeof store !== "object") {
    return { entries: {}, rows: {} };
  }

  if ("entries" in (store as Record<string, unknown>) || "rows" in (store as Record<string, unknown>)) {
    const structured = store as Partial<ScheduleAssignmentDataStore>;
    return {
      entries: normalizeEntriesStore(structured.entries),
      rows: normalizeRowsStore(structured.rows),
    };
  }

  return {
    entries: normalizeEntriesStore(store),
    rows: {},
  };
}

function setAssignmentMonthUpdatedAt(monthKey: string, updatedAt: string | null | undefined) {
  if (updatedAt) {
    assignmentMonthUpdatedAtCache[monthKey] = updatedAt;
    return;
  }

  delete assignmentMonthUpdatedAtCache[monthKey];
}

function applyAssignmentRowsToCache(rows: TeamLeadScheduleAssignmentRow[]) {
  assignmentStoreCache = {
    entries: Object.fromEntries(
      rows.map((row) => [row.month_key, normalizeMonthEntries(row.entries ?? {})]),
    ),
    rows: Object.fromEntries(
      rows.map((row) => [row.month_key, normalizeMonthRows(row.rows ?? {})]),
    ),
  };
  assignmentMonthUpdatedAtCache = Object.fromEntries(
    rows
      .filter((row) => Boolean(row.updated_at))
      .map((row) => [row.month_key, row.updated_at as string]),
  );
  assignmentPersistedSnapshotCache = Object.fromEntries(
    rows.map((row) => [row.month_key, JSON.stringify({
      entries: normalizeMonthEntries(row.entries ?? {}),
      rows: normalizeMonthRows(row.rows ?? {}),
    })]),
  );
}

function applyAssignmentMonthToCache(monthKey: string, row: TeamLeadScheduleAssignmentRow | null) {
  const nextEntries = { ...assignmentStoreCache.entries };
  const nextRows = { ...assignmentStoreCache.rows };

  if (row) {
    nextEntries[monthKey] = normalizeMonthEntries(row.entries ?? {});
    nextRows[monthKey] = normalizeMonthRows(row.rows ?? {});
    setAssignmentMonthUpdatedAt(monthKey, row.updated_at);
    assignmentPersistedSnapshotCache[monthKey] = JSON.stringify({
      entries: nextEntries[monthKey],
      rows: nextRows[monthKey],
    });
  } else {
    delete nextEntries[monthKey];
    delete nextRows[monthKey];
    setAssignmentMonthUpdatedAt(monthKey, null);
    delete assignmentPersistedSnapshotCache[monthKey];
  }

  assignmentStoreCache = {
    entries: nextEntries,
    rows: nextRows,
  };
}

function applyTeamLeadMetaStateRows(rows: TeamLeadStateRow[]) {
  const stateMap = new Map(rows.map((row) => [row.key, row.state] as const));
  contributionManualCache = normalizeContributionManualStore(stateMap.get(TEAM_LEAD_CONTRIBUTION_STATE_KEY));
  finalCutCache = normalizeFinalCutStore(stateMap.get(TEAM_LEAD_FINAL_CUT_STATE_KEY));
}

export function getScheduleAssignmentStore(): ScheduleAssignmentDataStore {
  return normalizeScheduleAssignmentDataStore(assignmentStoreCache);
}

function emitTeamLeadEvent(eventName: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(eventName));
}

export function emitTeamLeadStorageStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEAM_LEAD_STORAGE_STATUS_EVENT, { detail }));
}

async function readAssignmentMonthUpdatedAt(
  supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>,
  monthKey: string,
) {
  const cachedUpdatedAt = assignmentMonthUpdatedAtCache[monthKey];
  if (cachedUpdatedAt) {
    return cachedUpdatedAt;
  }

  const { data, error } = await supabase
    .from("team_lead_schedule_assignments")
    .select("month_key, updated_at")
    .eq("month_key", monthKey)
    .maybeSingle<{ month_key: string; updated_at: string }>();

  if (error) {
    throw new Error(error.message);
  }

  setAssignmentMonthUpdatedAt(monthKey, data?.updated_at);
  return data?.updated_at ?? null;
}

async function persistScheduleAssignmentStore(
  store: ScheduleAssignmentDataStore,
  monthKeys: string[],
) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const normalized = normalizeScheduleAssignmentDataStore(store);
  const targetMonthKeys = Array.from(new Set(monthKeys.filter(Boolean)));
  const conflictMonthKeys: string[] = [];

  for (const monthKey of targetMonthKeys) {
    const row = {
      month_key: monthKey,
      entries: normalized.entries[monthKey] ?? {},
      rows: normalized.rows[monthKey] ?? {},
      updated_by: session.id,
    };
    const knownUpdatedAt = await readAssignmentMonthUpdatedAt(supabase, monthKey);

    if (knownUpdatedAt) {
      const { data, error } = await supabase
        .from("team_lead_schedule_assignments")
        .update({
          entries: row.entries,
          rows: row.rows,
          updated_by: row.updated_by,
        })
        .eq("month_key", monthKey)
        .eq("updated_at", knownUpdatedAt)
        .select("month_key, updated_at")
        .maybeSingle<{ month_key: string; updated_at: string }>();

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.updated_at) {
        conflictMonthKeys.push(monthKey);
        continue;
      }

      setAssignmentMonthUpdatedAt(monthKey, data.updated_at);
      continue;
    }

    const { data, error } = await supabase
      .from("team_lead_schedule_assignments")
      .insert(row)
      .select("month_key, updated_at")
      .single<{ month_key: string; updated_at: string }>();

    if (error) {
      if (error.code === "23505") {
        conflictMonthKeys.push(monthKey);
        continue;
      }

      throw new Error(error.message);
    }

    setAssignmentMonthUpdatedAt(monthKey, data.updated_at);
  }

  if (conflictMonthKeys.length > 0) {
    throw new ScheduleAssignmentConflictError(conflictMonthKeys);
  }
}

async function persistTeamLeadState(key: string, state: unknown) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("team_lead_state").upsert({
    key,
    state,
    updated_by: session.id,
  });

  if (error) {
    throw new Error(error.message);
  }
}

function normalizeAssignmentPersistDelayMs(value?: number) {
  if (!Number.isFinite(value)) {
    return 250;
  }

  return Math.max(200, Math.round(value as number));
}

function normalizeAssignmentMonthKeys(monthKeys: string[]) {
  return Array.from(new Set(monthKeys.map((monthKey) => monthKey.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function getAssignmentMonthSnapshot(store: ScheduleAssignmentDataStore, monthKey: string) {
  return JSON.stringify({
    entries: normalizeMonthEntries(store.entries[monthKey] ?? {}),
    rows: normalizeMonthRows(store.rows[monthKey] ?? {}),
  });
}

export async function refreshTeamLeadAssignmentMonth(monthKey: string) {
  const normalizedMonthKey = monthKey.trim();
  if (!normalizedMonthKey) {
    return;
  }

  const existingPromise = assignmentMonthRefreshPromises.get(normalizedMonthKey);
  if (existingPromise) {
    return existingPromise;
  }

  const refreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      applyAssignmentMonthToCache(normalizedMonthKey, null);
      emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
      return;
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_schedule_assignments")
      .select("month_key, entries, rows, updated_at")
      .eq("month_key", normalizedMonthKey)
      .maybeSingle<TeamLeadScheduleAssignmentRow>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "team_lead_schedule_assignments"));
        applyAssignmentMonthToCache(normalizedMonthKey, null);
        emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
        return;
      }

      throw new Error(error.message);
    }

    // Keep large assignment JSONB reads scoped to the selected month.
    applyAssignmentMonthToCache(normalizedMonthKey, data ?? null);
    emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
  })().finally(() => {
    assignmentMonthRefreshPromises.delete(normalizedMonthKey);
  });

  assignmentMonthRefreshPromises.set(normalizedMonthKey, refreshPromise);
  return refreshPromise;
}

export async function refreshTeamLeadAssignmentMonths(monthKeys: string[]) {
  const normalizedMonthKeys = normalizeAssignmentMonthKeys(monthKeys);
  if (normalizedMonthKeys.length === 0) {
    return;
  }

  if (normalizedMonthKeys.length === 1) {
    return refreshTeamLeadAssignmentMonth(normalizedMonthKeys[0]);
  }

  const refreshKey = normalizedMonthKeys.join(",");
  const existingPromise = assignmentMonthsRefreshPromises.get(refreshKey);
  if (existingPromise) {
    return existingPromise;
  }

  const refreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      normalizedMonthKeys.forEach((monthKey) => applyAssignmentMonthToCache(monthKey, null));
      emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
      return;
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_schedule_assignments")
      .select("month_key, entries, rows, updated_at")
      .in("month_key", normalizedMonthKeys)
      .returns<TeamLeadScheduleAssignmentRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "team_lead_schedule_assignments"));
        normalizedMonthKeys.forEach((monthKey) => applyAssignmentMonthToCache(monthKey, null));
        emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
        return;
      }

      throw new Error(error.message);
    }

    const rowMap = new Map((data ?? []).map((row) => [row.month_key, row] as const));
    normalizedMonthKeys.forEach((monthKey) => {
      applyAssignmentMonthToCache(monthKey, rowMap.get(monthKey) ?? null);
    });
    emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
  })().finally(() => {
    assignmentMonthsRefreshPromises.delete(refreshKey);
  });

  assignmentMonthsRefreshPromises.set(refreshKey, refreshPromise);
  return refreshPromise;
}

export async function refreshTeamLeadMetaState() {
  if (teamLeadMetaRefreshPromise) {
    return teamLeadMetaRefreshPromise;
  }

  teamLeadMetaRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      contributionManualCache = {};
      finalCutCache = {};
      emitTeamLeadEvent(TEAM_LEAD_CONTRIBUTION_EVENT);
      emitTeamLeadEvent(TEAM_LEAD_FINAL_CUT_EVENT);
      return;
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_state")
      .select("key, state")
      .in("key", [TEAM_LEAD_CONTRIBUTION_STATE_KEY, TEAM_LEAD_FINAL_CUT_STATE_KEY])
      .returns<TeamLeadStateRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "team_lead_state"));
        contributionManualCache = {};
        finalCutCache = {};
        emitTeamLeadEvent(TEAM_LEAD_CONTRIBUTION_EVENT);
        emitTeamLeadEvent(TEAM_LEAD_FINAL_CUT_EVENT);
        return;
      }

      throw new Error(error.message);
    }

    applyTeamLeadMetaStateRows(data ?? []);
    emitTeamLeadEvent(TEAM_LEAD_CONTRIBUTION_EVENT);
    emitTeamLeadEvent(TEAM_LEAD_FINAL_CUT_EVENT);
  })().finally(() => {
    teamLeadMetaRefreshPromise = null;
  });

  return teamLeadMetaRefreshPromise;
}

export async function refreshTeamLeadState() {
  if (teamLeadRefreshPromise) {
    return teamLeadRefreshPromise;
  }

  teamLeadRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      assignmentStoreCache = { entries: {}, rows: {} };
      assignmentMonthUpdatedAtCache = {};
      assignmentPersistedSnapshotCache = {};
      emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
      await refreshTeamLeadMetaState();
      return;
    }

    const supabase = await getPortalSupabaseClient();
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from("team_lead_schedule_assignments")
      .select("month_key, entries, rows, updated_at")
      .returns<TeamLeadScheduleAssignmentRow[]>();

    if (assignmentError) {
      if (isSupabaseSchemaMissingError(assignmentError)) {
        console.warn(getSupabaseStorageErrorMessage(assignmentError, "team_lead_schedule_assignments"));
        assignmentStoreCache = { entries: {}, rows: {} };
        assignmentMonthUpdatedAtCache = {};
        assignmentPersistedSnapshotCache = {};
        emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
        await refreshTeamLeadMetaState();
        return;
      }

      throw new Error(assignmentError.message);
    }

    applyAssignmentRowsToCache(assignmentRows ?? []);
    emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
    await refreshTeamLeadMetaState();
  })().finally(() => {
    teamLeadRefreshPromise = null;
  });

  return teamLeadRefreshPromise;
}

export function saveScheduleAssignmentStore(
  store: ScheduleAssignmentDataStore,
  monthKeys: string[] = Object.keys({ ...store.entries, ...store.rows }),
  options: SaveScheduleAssignmentStoreOptions = {},
) {
  const normalizedStore = normalizeScheduleAssignmentDataStore(store);
  const changedMonthKeys = Array.from(new Set(monthKeys.filter(Boolean))).filter(
    (monthKey) => getAssignmentMonthSnapshot(normalizedStore, monthKey) !== assignmentPersistedSnapshotCache[monthKey],
  );

  assignmentStoreCache = normalizedStore;

  if (changedMonthKeys.length === 0) {
    return Promise.resolve();
  }

  emitTeamLeadEvent(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT);
  changedMonthKeys.forEach((monthKey) => assignmentPersistMonthKeys.add(monthKey));

  if (assignmentPersistTimer) {
    clearTimeout(assignmentPersistTimer);
  }

  const requestedDelayMs = normalizeAssignmentPersistDelayMs(options.debounceMs);
  assignmentPersistDelayMs =
    assignmentPersistDelayMs === null ? requestedDelayMs : Math.min(assignmentPersistDelayMs, requestedDelayMs);

  return new Promise<void>((resolve) => {
    assignmentPersistResolvers.push(resolve);
    assignmentPersistTimer = setTimeout(() => {
      const pendingMonthKeys = Array.from(assignmentPersistMonthKeys);
      const pendingStore = normalizeScheduleAssignmentDataStore(assignmentStoreCache);
      const persistableMonthKeys = pendingMonthKeys.filter(
        (monthKey) => getAssignmentMonthSnapshot(pendingStore, monthKey) !== assignmentPersistedSnapshotCache[monthKey],
      );
      assignmentPersistMonthKeys.clear();
      assignmentPersistTimer = null;
      assignmentPersistDelayMs = null;

      if (persistableMonthKeys.length === 0) {
        const resolvers = [...assignmentPersistResolvers];
        assignmentPersistResolvers = [];
        resolvers.forEach((item) => item());
        return;
      }

      persistScheduleAssignmentStore(pendingStore, persistableMonthKeys)
        .then(() => {
          persistableMonthKeys.forEach((monthKey) => {
            assignmentPersistedSnapshotCache[monthKey] = getAssignmentMonthSnapshot(pendingStore, monthKey);
          });
        })
        .catch(async (error) => {
          emitTeamLeadStorageStatus({
            ok: false,
            message:
              error instanceof ScheduleAssignmentConflictError
                ? "다른 사용자가 먼저 같은 일정배정을 저장했습니다. 최신 내용으로 다시 불러왔습니다."
                : error instanceof Error
                  ? error.message
                  : "일정배정 저장에 실패했습니다. DB 기준 상태로 복구합니다.",
          });
          if (persistableMonthKeys.length > 0) {
            await Promise.all(persistableMonthKeys.map((monthKey) => refreshTeamLeadAssignmentMonth(monthKey)));
            return;
          }
          await refreshTeamLeadState();
        })
        .finally(() => {
          const resolvers = [...assignmentPersistResolvers];
          assignmentPersistResolvers = [];
          resolvers.forEach((item) => item());
        });
    }, assignmentPersistDelayMs ?? requestedDelayMs);
  });
}

function parseTimeMinutes(value: string) {
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  const [hoursText, minutesText] = trimmed.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function normalizeDutyLabel(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function getScheduleAssignmentDutySortRank(duty: string) {
  const normalized = normalizeDutyLabel(duty);
  switch (normalized) {
    case "조근":
      return 0;
    case "일반":
      return 1;
    case "연장":
      return 2;
    case "석근":
      return 3;
    case "야근":
      return 4;
    case "뉴스대기":
      return 5;
    default:
      return 100;
  }
}

function isWeekendDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function isWeekendDutyDay(day: DaySchedule | null, dateKey: string) {
  if (!day) return isWeekendDateKey(dateKey);
  return day.isWeekend;
}

function getDutyBaseTimes(duty: string, dateKey: string, day: DaySchedule | null) {
  const normalized = normalizeDutyLabel(duty);
  switch (normalized) {
    case "조근":
      return isWeekendDutyDay(day, dateKey)
        ? { clockIn: 9 * 60, clockOut: 18 * 60 }
        : { clockIn: 7 * 60, clockOut: 16 * 60 };
    case "일반":
    case "국회지원":
    case "법조지원":
      return { clockIn: 9 * 60, clockOut: 18 * 60 };
    case "연장":
      return { clockIn: 10 * 60, clockOut: 19 * 60 };
    case "석근":
      return { clockIn: 13 * 60, clockOut: 21 * 60 };
    case "야근":
      return { clockIn: 16 * 60 + 30, clockOut: 7 * 60 + 30 };
    case "뉴스대기":
      return { clockIn: 11 * 60, clockOut: 20 * 60 };
    default:
      return null;
  }
}

function formatTimeMinutes(minutes: number) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function getScheduleAssignmentBaseTimes(duty: string, dateKey: string, day: DaySchedule | null) {
  const baseTimes = getDutyBaseTimes(duty, dateKey, day);
  if (!baseTimes) return null;
  return {
    ...baseTimes,
    clockInText: formatTimeMinutes(baseTimes.clockIn),
    clockOutText: formatTimeMinutes(baseTimes.clockOut),
  };
}

export function getScheduleAssignmentTimeColor(
  field: "clockIn" | "clockOut",
  value: string,
  duty: string,
  dateKey: string,
  day: DaySchedule | null,
): AssignmentTimeColor {
  const baseTimes = getDutyBaseTimes(duty, dateKey, day);
  const minutes = parseTimeMinutes(value);
  if (!baseTimes || minutes === null) return "";

  if (field === "clockIn") {
    if (minutes < baseTimes.clockIn) return "blue";
    if (minutes > baseTimes.clockIn) return "red";
    return "";
  }

  if (minutes > baseTimes.clockOut) return "yellow";
  return "";
}

function toScoreByHalfHour(minutes: number) {
  if (minutes < 30) return 0;
  return Math.floor(minutes / 30) * 0.1;
}

function roundScore(score: number) {
  return Math.round(score * 10) / 10;
}

function normalizeContributionManualItem(item: Partial<ContributionManualItem> | undefined): ContributionManualItem | null {
  if (!item) return null;
  const label = typeof item.label === "string" ? item.label.trim() : "";
  const score = roundScore(Number(item.score) || 0);
  if (!label) return null;
  return {
    id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    score,
  };
}

function normalizeContributionManualYearStore(store: unknown) {
  if (!store || typeof store !== "object") return {} as ContributionManualYearStore;
  return Object.fromEntries(
    Object.entries(store as Record<string, unknown>).map(([name, items]) => [
      name,
      Array.isArray(items)
        ? items
            .map((item) => normalizeContributionManualItem(item as Partial<ContributionManualItem> | undefined))
            .filter((item): item is ContributionManualItem => Boolean(item))
        : [],
    ]),
  ) as ContributionManualYearStore;
}

function normalizeContributionManualStore(store: unknown) {
  if (!store || typeof store !== "object") return {} as ContributionManualStore;
  const record = store as Record<string, unknown>;
  const hasLegacyShape = Object.values(record).some((value) => Array.isArray(value));

  if (hasLegacyShape) {
    return {
      [String(getTeamLeadEvaluationYear())]: normalizeContributionManualYearStore(record),
    } satisfies ContributionManualStore;
  }

  return Object.fromEntries(
    Object.entries(record).map(([yearKey, yearStore]) => [yearKey, normalizeContributionManualYearStore(yearStore)]),
  ) as ContributionManualStore;
}

function getAllContributionManualStore() {
  return normalizeContributionManualStore(contributionManualCache);
}

export function getContributionManualStore(evaluationYear = getTeamLeadEvaluationYear()) {
  return normalizeContributionManualYearStore(getAllContributionManualStore()[String(evaluationYear)] ?? {});
}

export function saveContributionManualStore(
  store: ContributionManualYearStore,
  evaluationYear = getTeamLeadEvaluationYear(),
) {
  const previous = getAllContributionManualStore();
  const normalizedYearStore = normalizeContributionManualYearStore(store);
  const next = { ...previous };

  if (Object.keys(normalizedYearStore).length > 0) {
    next[String(evaluationYear)] = normalizedYearStore;
  } else {
    delete next[String(evaluationYear)];
  }

  contributionManualCache = next;
  emitTeamLeadEvent(TEAM_LEAD_CONTRIBUTION_EVENT);
  return persistTeamLeadState(TEAM_LEAD_CONTRIBUTION_STATE_KEY, next).catch(async (error) => {
    emitTeamLeadStorageStatus({
      ok: false,
      message: error instanceof Error ? error.message : "기여도 수동 점수 저장에 실패했습니다. DB 기준 상태로 복구합니다.",
    });
    contributionManualCache = previous;
    emitTeamLeadEvent(TEAM_LEAD_CONTRIBUTION_EVENT);
    await refreshTeamLeadMetaState();
  });
}

export function updateContributionManualItems(
  name: string,
  items: ContributionManualItem[],
  evaluationYear = getTeamLeadEvaluationYear(),
) {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const store = getContributionManualStore(evaluationYear);
  const next = {
    ...store,
    [trimmedName]: items
      .map((item) => normalizeContributionManualItem(item))
      .filter((item): item is ContributionManualItem => Boolean(item)),
  };
  void saveContributionManualStore(next, evaluationYear);
}

function normalizeFinalCutDecision(value: unknown): FinalCutDecision {
  return value === "circle" || value === "triangle" || value === "cross" ? value : "";
}

function normalizeFinalCutStore(store: unknown) {
  if (!store || typeof store !== "object") return {} as Record<string, FinalCutDecision>;
  return Object.fromEntries(
    Object.entries(store as Record<string, unknown>).map(([key, value]) => [key, normalizeFinalCutDecision(value)]),
  ) as Record<string, FinalCutDecision>;
}

export function getFinalCutStore() {
  return normalizeFinalCutStore(finalCutCache);
}

export function saveFinalCutStore(store: Record<string, FinalCutDecision>) {
  const normalized = normalizeFinalCutStore(store);
  const previous = normalizeFinalCutStore(finalCutCache);
  finalCutCache = normalized;
  emitTeamLeadEvent(TEAM_LEAD_FINAL_CUT_EVENT);

  if (finalCutPersistTimer) {
    clearTimeout(finalCutPersistTimer);
  }

  return new Promise<void>((resolve) => {
    finalCutPersistResolvers.push(resolve);
    finalCutPersistTimer = setTimeout(() => {
      finalCutPersistTimer = null;
      persistTeamLeadState(TEAM_LEAD_FINAL_CUT_STATE_KEY, finalCutCache).catch(async (error) => {
        emitTeamLeadStorageStatus({
          ok: false,
          message: error instanceof Error ? error.message : "정제본 저장에 실패했습니다. DB 기준 상태로 복구합니다.",
        });
        finalCutCache = previous;
        emitTeamLeadEvent(TEAM_LEAD_FINAL_CUT_EVENT);
        await refreshTeamLeadMetaState();
      }).finally(() => {
        const resolvers = [...finalCutPersistResolvers];
        finalCutPersistResolvers = [];
        resolvers.forEach((item) => item());
      });
    }, 180);
  });
}

export function updateFinalCutDecision(itemId: string, decision: FinalCutDecision) {
  const trimmedId = itemId.trim();
  if (!trimmedId) return;
  const store = getFinalCutStore();
  const normalizedDecision = normalizeFinalCutDecision(decision);
  const next = { ...store };
  if (!normalizedDecision) {
    delete next[trimmedId];
  } else {
    next[trimmedId] = normalizedDecision;
  }
  saveFinalCutStore(next);
}

function shouldIncludeFinalCutDuty(duty: string) {
  const normalized = duty.replace(/\s+/g, "").trim();
  return Boolean(normalized) && normalized !== "석근";
}

function resolveTeamLeadEvaluationYear(baseDateOrYear: Date | number = new Date()) {
  return typeof baseDateOrYear === "number" ? baseDateOrYear : getTeamLeadEvaluationYear(baseDateOrYear);
}

export function getContributionPeriod(baseDateOrYear: Date | number = new Date()): ContributionPeriod {
  return getTeamLeadEvaluationPeriod(resolveTeamLeadEvaluationYear(baseDateOrYear));
}

function isMonthKeyInContributionPeriod(monthKey: string, period: ContributionPeriod) {
  return monthKey >= period.startMonthKey && monthKey <= period.endMonthKey;
}

function buildContributionItem(
  monthKey: string,
  dateKey: string,
  duty: string,
  entry: ScheduleAssignmentEntry,
  day: DaySchedule | null,
): ContributionScoreItem | null {
  const baseTimes = getDutyBaseTimes(duty, dateKey, day);
  const coverageScore = roundScore(entry.coverageScore ?? 0);
  if (!baseTimes && coverageScore <= 0) return null;

  const clockInMinutes = baseTimes ? parseTimeMinutes(entry.clockIn) : null;
  const clockOutMinutes = baseTimes ? parseTimeMinutes(entry.clockOut) : null;
  const clockInScore =
    !baseTimes || clockInMinutes === null ? 0 : toScoreByHalfHour(Math.max(0, baseTimes.clockIn - clockInMinutes));
  const clockOutScore =
    !baseTimes || clockOutMinutes === null ? 0 : toScoreByHalfHour(Math.max(0, clockOutMinutes - baseTimes.clockOut));
  const totalScore = roundScore(clockInScore + clockOutScore + coverageScore);

  if (totalScore <= 0) return null;

  return {
    monthKey,
    dateKey,
    duty,
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    schedules: entry.schedules.map((item) => item.trim()).filter(Boolean),
    clockInScore: roundScore(clockInScore),
    clockOutScore: roundScore(clockOutScore),
    coverageScore,
    coverageNote: entry.coverageNote.trim(),
    totalScore,
  };
}

function getGeneratedHistorySchedules() {
  return readStoredScheduleState().generatedHistory;
}

function createSyntheticScheduleDay(date: Date): DaySchedule {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dow = date.getDay();

  return {
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day,
    month,
    year,
    dow,
    isWeekend: dow === 0 || dow === 6,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: {},
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
}

function buildSyntheticScheduleFromAssignmentMonth(
  monthKey: string,
  store: ScheduleAssignmentDataStore,
): GeneratedSchedule | null {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const lastDay = new Date(year, month, 0).getDate();
  const days = Array.from({ length: lastDay }, (_, index) =>
    createSyntheticScheduleDay(new Date(year, month - 1, index + 1)),
  );
  const dayMap = new Map(days.map((day) => [day.dateKey, day] as const));
  const groupedAssignments = new Map<string, Map<string, Array<{ index: number; name: string }>>>();
  const monthEntries = store.entries[monthKey] ?? {};
  const knownCategories = new Set([
    "조근",
    "일반",
    "기타",
    "연장",
    "석근",
    "야근",
    "제크",
    "휴가",
    "청와대",
    "국회",
    "청사",
    "주말조근",
    "주말일반근무",
    "뉴스대기",
    "국방부",
    "서울청사",
    "시청",
    "법조",
    "수원",
    "국회지원",
    "법조지원",
    "국내출장",
    "해외출장",
    "오전반차",
    "오후반차",
    "대기",
    "데스크",
    "철야",
  ]);

  Object.keys(monthEntries).forEach((rowKey) => {
    const parsed = parseScheduleAssignmentRowKey(rowKey);
    if (!parsed || !parsed.name || !parsed.dateKey.startsWith(`${monthKey}-`)) {
      return;
    }

    if (!dayMap.has(parsed.dateKey)) {
      return;
    }

    const dayAssignments = groupedAssignments.get(parsed.dateKey) ?? new Map<string, Array<{ index: number; name: string }>>();
    const categoryAssignments = dayAssignments.get(parsed.category) ?? [];
    categoryAssignments.push({ index: Number.isFinite(parsed.index) ? parsed.index : categoryAssignments.length, name: parsed.name });
    dayAssignments.set(parsed.category, categoryAssignments);
    groupedAssignments.set(parsed.dateKey, dayAssignments);
  });

  groupedAssignments.forEach((categories, dateKey) => {
    const day = dayMap.get(dateKey);
    if (!day) return;

    categories.forEach((items, category) => {
      const names = items
        .sort((left, right) => left.index - right.index)
        .map((item) => item.name.trim())
        .filter(Boolean);
      if (names.length === 0) return;
      day.assignments[category] = names;
    });

    if (day.assignments["휴가"]?.length) {
      day.vacations = [...day.assignments["휴가"]];
    }

    day.manualExtras = Object.keys(day.assignments).filter((category) => !knownCategories.has(category));
  });

  const nextStartDate = new Date(year, month, 1);
  return {
    year,
    month,
    monthKey,
    days,
    nextPointers: { ...defaultPointers },
    nextStartDate: `${nextStartDate.getFullYear()}-${String(nextStartDate.getMonth() + 1).padStart(2, "0")}-${String(nextStartDate.getDate()).padStart(2, "0")}`,
  };
}

function getAssignmentOnlySchedules(store: ScheduleAssignmentDataStore, existingMonthKeys: Set<string>) {
  const monthKeys = Array.from(new Set([...Object.keys(store.entries), ...Object.keys(store.rows)]))
    .filter((monthKey) => !existingMonthKeys.has(monthKey))
    .sort((left, right) => left.localeCompare(right));

  return monthKeys
    .map((monthKey) => buildSyntheticScheduleFromAssignmentMonth(monthKey, store))
    .filter((schedule): schedule is GeneratedSchedule => Boolean(schedule));
}

function parseScheduleAssignmentRowKey(rowKey: string) {
  const [dateKey, category, indexText, ...nameParts] = rowKey.split("::");
  if (!dateKey || !category || category === "custom" || nameParts.length === 0) {
    return null;
  }

  return {
    dateKey,
    category,
    index: Number(indexText),
    name: nameParts.join("::").trim(),
  };
}

function getScheduleAssignmentNameTagForDuty(duty: string): ScheduleAssignmentNameTag | null {
  switch (normalizeDutyLabel(duty)) {
    case "국회지원":
      return "gov";
    case "법조지원":
      return "law";
    default:
      return null;
  }
}

export function applyScheduleAssignmentNameTagsToSchedule(
  schedule: GeneratedSchedule,
  store: ScheduleAssignmentDataStore = getScheduleAssignmentStore(),
) {
  const monthRows = store.rows[schedule.monthKey] ?? {};
  let changed = false;

  const days = schedule.days.map((day) => {
    const dayRows = monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows();
    const rows = getScheduleAssignmentRows(day, dayRows);
    const nextTags = { ...(day.assignmentNameTags ?? {}) };
    let dayChanged = false;

    rows.forEach((row) => {
      if (row.isCustom) return;
      const parsed = parseScheduleAssignmentRowKey(row.key);
      if (!parsed?.name) return;

      const tagKey = buildScheduleAssignmentNameTagKey(parsed.category, parsed.name);
      const nextTag = getScheduleAssignmentNameTagForDuty(row.duty);
      const currentTag = nextTags[tagKey] ?? null;

      if (currentTag && (currentTag === "gov" || currentTag === "law")) {
        delete nextTags[tagKey];
        dayChanged = true;
      }

      if (!nextTag) return;
      if (nextTags[tagKey] !== nextTag) {
        nextTags[tagKey] = nextTag;
        dayChanged = true;
      }
    });

    if (!dayChanged) return day;
    changed = true;
    return {
      ...day,
      assignmentNameTags: nextTags,
    };
  });

  if (!changed) return schedule;
  return {
    ...schedule,
    days,
  };
}

export function applyScheduleAssignmentNameTagsToSchedules(
  schedules: GeneratedSchedule[],
  store: ScheduleAssignmentDataStore = getScheduleAssignmentStore(),
) {
  return schedules.map((schedule) => applyScheduleAssignmentNameTagsToSchedule(schedule, store));
}

export function getTeamLeadSchedules() {
  const store = getScheduleAssignmentStore();
  const published = getPublishedSchedules().map((item) => item.schedule);
  const generated = getGeneratedHistorySchedules();
  const merged = new Map<string, GeneratedSchedule>();

  published.forEach((schedule) => {
    merged.set(schedule.monthKey, schedule);
  });
  generated.forEach((schedule) => {
    if (!merged.has(schedule.monthKey)) {
      merged.set(schedule.monthKey, schedule);
    }
  });
  getAssignmentOnlySchedules(store, new Set(merged.keys())).forEach((schedule) => {
    if (!merged.has(schedule.monthKey)) {
      merged.set(schedule.monthKey, schedule);
    }
  });

  return applyScheduleAssignmentNameTagsToSchedules(
    Array.from(merged.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey)),
    store,
  );
}

export function getScheduleAssignmentRows(
  day: DaySchedule,
  dayRows: ScheduleAssignmentDayRows = createDefaultScheduleAssignmentDayRows(),
) {
  const baseRows = Object.entries(day.assignments)
    .filter(([category, names]) => category !== "휴가" && category !== "제크" && names.length > 0)
    .flatMap(([category, names]) =>
      names.map((name, index) => {
        const key = createAssignmentRowKey(day.dateKey, category, index, name);
        const override = dayRows.rowOverrides[key];
        return {
          key,
          name: override?.name || name,
          duty: override?.duty || getScheduleCategoryLabel(category),
          isCustom: false,
        };
      }),
    )
    .filter((row) => !dayRows.deletedRowKeys.includes(row.key));

  const addedRows = dayRows.addedRows.map((row) => ({
    key: createCustomAssignmentRowKey(day.dateKey, row.id),
    name: row.name,
    duty: row.duty,
    isCustom: true,
  }));

  return [...addedRows, ...baseRows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const rankDiff =
        getScheduleAssignmentDutySortRank(left.row.duty) - getScheduleAssignmentDutySortRank(right.row.duty);
      if (rankDiff !== 0) return rankDiff;

      const normalizedLeftDuty = normalizeDutyLabel(left.row.duty);
      const normalizedRightDuty = normalizeDutyLabel(right.row.duty);
      const dutyDiff = normalizedLeftDuty.localeCompare(normalizedRightDuty, "ko");
      if (dutyDiff !== 0) return dutyDiff;

      return left.index - right.index;
    })
    .map(({ row }) => row) satisfies ScheduleAssignmentRow[];
}

interface TripTimelineRow {
  personName: string;
  rowKey: string;
  dateKey: string;
  duty: string;
  entry: ScheduleAssignmentEntry;
}

interface ActiveTripState {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
}

function getTripFlowKey(
  trip: Pick<ActiveTripState, "tripTagLabel" | "travelType"> | null,
) {
  const label = trip?.tripTagLabel.trim() ?? "";
  const travelType = trip?.travelType ?? "";
  if (!label || !travelType || travelType === "당일출장") return "";
  return `${travelType}::${label}`;
}

function isSameTripFlow(
  activeTrip: ActiveTripState | null,
  explicitTrip: Pick<ScheduleAssignmentVisibleTripTag, "tripTagId" | "tripTagLabel" | "travelType"> | null,
) {
  if (!activeTrip || !explicitTrip) return false;
  if (explicitTrip.tripTagId && explicitTrip.tripTagId === activeTrip.tripTagId) return true;

  const activeLabel = activeTrip.tripTagLabel.trim();
  const explicitLabel = explicitTrip.tripTagLabel.trim();
  if (!activeLabel || !explicitLabel) return false;

  return activeLabel === explicitLabel && explicitTrip.travelType === activeTrip.travelType;
}

interface TripAggregateBuilder {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
  startDateKey: string;
  endDateKey: string;
  dateKeys: string[];
  dateKeySet: Set<string>;
  duties: string[];
  dutySet: Set<string>;
  schedules: string[];
  scheduleSet: Set<string>;
}

function buildTripTimelineRows(
  schedules: GeneratedSchedule[],
  store: ScheduleAssignmentDataStore,
) {
  const timelineMap = new Map<string, TripTimelineRow[]>();

  schedules.forEach((monthSchedule) => {
    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(day, monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows());
        rows.forEach((row) => {
          const personName = row.name.trim();
          if (!personName) return;

          const entry = monthEntries[row.key] ?? createDefaultScheduleAssignmentEntry();
          const current = timelineMap.get(personName) ?? [];
          current.push({
            personName,
            rowKey: row.key,
            dateKey: day.dateKey,
            duty: row.duty,
            entry,
          });
          timelineMap.set(personName, current);
        });
      });
  });

  timelineMap.forEach((rows, personName) => {
    timelineMap.set(
      personName,
      [...rows].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.rowKey.localeCompare(right.rowKey)),
    );
  });

  return timelineMap;
}

function addTripAggregateDay(builder: TripAggregateBuilder, row: TripTimelineRow) {
  if (!builder.dateKeySet.has(row.dateKey)) {
    builder.dateKeySet.add(row.dateKey);
    builder.dateKeys.push(row.dateKey);
    builder.startDateKey = builder.startDateKey <= row.dateKey ? builder.startDateKey : row.dateKey;
    builder.endDateKey = builder.endDateKey >= row.dateKey ? builder.endDateKey : row.dateKey;
  }

  const duty = row.duty.trim();
  if (duty && !builder.dutySet.has(duty)) {
    builder.dutySet.add(duty);
    builder.duties.push(duty);
  }
}

function finalizeTripAggregate(builder: TripAggregateBuilder): TeamLeadTripItem {
  return {
    tripTagId: builder.tripTagId,
    tripTagLabel: builder.tripTagLabel,
    travelType: builder.travelType,
    startDateKey: builder.startDateKey,
    endDateKey: builder.endDateKey,
    dayCount: builder.dateKeys.length,
    dateKeys: [...builder.dateKeys],
    duties: [...builder.duties],
    schedules: [...builder.schedules],
  };
}

function buildScheduleAssignmentTripWorkspace(
  schedules: GeneratedSchedule[] = getTeamLeadSchedules(),
  store: ScheduleAssignmentDataStore = getScheduleAssignmentStore(),
) {
  const visibleTripTagMap = new Map<string, ScheduleAssignmentVisibleTripTag>();
  const personTripBuilderMap = new Map<string, Map<string, TripAggregateBuilder>>();
  const timelineMap = buildTripTimelineRows(schedules, store);

  timelineMap.forEach((rows, personName) => {
    let activeTrip: ActiveTripState | null = null;
    const closedTripFlowKeys = new Set<string>();

    rows.forEach((row) => {
      const explicitTrip: ScheduleAssignmentVisibleTripTag | null =
        row.entry.tripTagId && row.entry.tripTagLabel
          ? {
              tripTagId: row.entry.tripTagId,
              tripTagLabel: row.entry.tripTagLabel,
              travelType: (row.entry.travelType || activeTrip?.travelType || "") as AssignmentTravelType,
              phase: row.entry.tripTagPhase,
              isInherited: false,
          }
        : null;
      const explicitTripFlowKey = getTripFlowKey(explicitTrip);

      const visibleTrip: ScheduleAssignmentVisibleTripTag | null = explicitTrip ?? (activeTrip
        ? {
            tripTagId: activeTrip.tripTagId,
            tripTagLabel: activeTrip.tripTagLabel,
            travelType: activeTrip.travelType,
            phase: "ongoing" as AssignmentTripTagPhase,
            isInherited: true,
          }
        : null);

      if (visibleTrip) {
        visibleTripTagMap.set(row.rowKey, visibleTrip);
      }

      if (explicitTrip?.phase === "departure") {
        if (explicitTripFlowKey) {
          closedTripFlowKeys.delete(explicitTripFlowKey);
        }
        activeTrip = {
          tripTagId: explicitTrip.tripTagId,
          tripTagLabel: explicitTrip.tripTagLabel,
          travelType: explicitTrip.travelType,
        };
      } else if (explicitTrip?.phase === "ongoing" && !activeTrip && !closedTripFlowKeys.has(explicitTripFlowKey)) {
        activeTrip = {
          tripTagId: explicitTrip.tripTagId,
          tripTagLabel: explicitTrip.tripTagLabel,
          travelType: explicitTrip.travelType,
        };
      } else if (activeTrip && explicitTrip && isSameTripFlow(activeTrip, explicitTrip)) {
        activeTrip = {
          tripTagId: explicitTrip.tripTagId || activeTrip.tripTagId,
          tripTagLabel: explicitTrip.tripTagLabel,
          travelType: explicitTrip.travelType || activeTrip.travelType,
        };
      }

      const tripForDay =
        explicitTrip?.travelType === "당일출장"
          ? explicitTrip
          : explicitTrip?.phase === "departure" || explicitTrip?.phase === "ongoing"
          ? activeTrip
          : activeTrip && visibleTrip && isSameTripFlow(activeTrip, visibleTrip)
            ? activeTrip
            : null;

      if (tripForDay && tripForDay.travelType) {
        const personTrips = personTripBuilderMap.get(personName) ?? new Map<string, TripAggregateBuilder>();
        const currentBuilder = personTrips.get(tripForDay.tripTagId) ?? {
          tripTagId: tripForDay.tripTagId,
          tripTagLabel: tripForDay.tripTagLabel,
          travelType: tripForDay.travelType,
          startDateKey: row.dateKey,
          endDateKey: row.dateKey,
          dateKeys: [],
          dateKeySet: new Set<string>(),
          duties: [],
          dutySet: new Set<string>(),
          schedules: row.entry.schedules.map((item) => item.trim()).filter(Boolean),
          scheduleSet: new Set(row.entry.schedules.map((item) => item.trim()).filter(Boolean)),
        };

        currentBuilder.tripTagLabel = tripForDay.tripTagLabel;
        currentBuilder.travelType = tripForDay.travelType;
        addTripAggregateDay(currentBuilder, row);
        personTrips.set(tripForDay.tripTagId, currentBuilder);
        personTripBuilderMap.set(personName, personTrips);
      }

      if (explicitTrip?.phase === "return" && activeTrip && isSameTripFlow(activeTrip, explicitTrip)) {
        const activeTripFlowKey = getTripFlowKey(activeTrip);
        if (activeTripFlowKey) {
          closedTripFlowKeys.add(activeTripFlowKey);
        }
        activeTrip = null;
      } else if (explicitTrip?.phase === "return" && explicitTripFlowKey) {
        closedTripFlowKeys.add(explicitTripFlowKey);
      }
    });
  });

  const tripCards = Array.from(personTripBuilderMap.entries())
    .map(([name, tripMap]) => ({
      name,
      items: Array.from(tripMap.values())
        .map((builder) => finalizeTripAggregate(builder))
        .sort((left, right) => left.startDateKey.localeCompare(right.startDateKey)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));

  return {
    visibleTripTagMap,
    tripCards,
  };
}

export function getScheduleAssignmentVisibleTripTagMap() {
  return buildScheduleAssignmentTripWorkspace().visibleTripTagMap;
}

export function formatScheduleAssignmentDisplayName(
  input: ScheduleAssignmentDisplayNameInput,
  store: ScheduleAssignmentDataStore = getScheduleAssignmentStore(),
  visibleTripTagMap: Map<string, ScheduleAssignmentVisibleTripTag> = getScheduleAssignmentVisibleTripTagMap(),
) {
  const trimmedName = input.name.trim();
  if (!trimmedName || input.category === "휴가") return trimmedName;

  const rowKey = createAssignmentRowKey(input.dateKey, input.category, input.index, input.name);
  const monthEntries = store.entries[input.monthKey] ?? {};
  const entry = monthEntries[rowKey] ?? null;
  const hasTripTag = Boolean(visibleTripTagMap.get(rowKey) || entry?.travelType || entry?.tripTagId);

  return hasTripTag ? `${trimmedName}(출)` : trimmedName;
}

export function getTeamLeadTripCards(travelTypes: AssignmentTravelType[]) {
  const allowedTypes = new Set(travelTypes);
  return buildScheduleAssignmentTripWorkspace().tripCards
    .map((card) => ({
      name: card.name,
      items: card.items.filter((item) => allowedTypes.has(item.travelType)),
    }))
    .filter((card) => card.items.length > 0);
}

export function getFinalCutCards(monthKey?: string) {
  const schedules = getTeamLeadSchedules().filter((schedule) => !monthKey || schedule.monthKey === monthKey);
  const store = getScheduleAssignmentStore();
  const finalCutStore = getFinalCutStore();
  const hiddenNames = new Set(
    getUsers()
      .filter((user) => isTeamLeadEvaluationExcludedRole(user.role))
      .map((user) => user.username.trim())
      .filter(Boolean),
  );
  const personMap = new Map<string, FinalCutScheduleItem[]>();

  schedules.forEach((monthSchedule) => {
    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(day, monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows());
        rows.forEach((row) => {
          const personName = row.name.trim();
          if (!personName) return;
          if (hiddenNames.has(personName)) return;
          if (!shouldIncludeFinalCutDuty(row.duty)) return;
          const entry = monthEntries[row.key];
          if (!entry) return;

          entry.schedules
            .map((schedule) => schedule.trim())
            .filter(Boolean)
            .forEach((schedule, index) => {
              const id = `${monthSchedule.monthKey}::${row.key}::${index}`;
              const item: FinalCutScheduleItem = {
                id,
                dateKey: day.dateKey,
                duty: row.duty,
                schedule,
                decision: finalCutStore[id] ?? "",
              };
              const current = personMap.get(personName) ?? [];
              current.push(item);
              personMap.set(personName, current);
            });
        });
      });
  });

  return Array.from(personMap.entries())
    .map(([name, items]) => ({
      name,
      items: [...items].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.schedule.localeCompare(right.schedule, "ko")),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

export function getContributionCards(baseDateOrYear: Date | number = new Date()) {
  const evaluationYear = resolveTeamLeadEvaluationYear(baseDateOrYear);
  const period = getContributionPeriod(evaluationYear);
  const schedules = getTeamLeadSchedules().filter((schedule) => isMonthKeyInContributionPeriod(schedule.monthKey, period));
  const store = getScheduleAssignmentStore();
  const manualStore = getContributionManualStore(evaluationYear);
  const hiddenNames = new Set(
    getUsers()
      .filter((user) => isTeamLeadEvaluationExcludedRole(user.role))
      .map((user) => user.username.trim())
      .filter(Boolean),
  );
  const personMap = new Map<string, ContributionScoreItem[]>();

  schedules.forEach((monthSchedule) => {
    const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
    const monthRows = store.rows[monthSchedule.monthKey] ?? {};

    monthSchedule.days
      .filter((day) => day.month === monthSchedule.month)
      .forEach((day) => {
        const rows = getScheduleAssignmentRows(day, monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows());
        rows.forEach((row) => {
          const personName = row.name.trim();
          if (!personName) return;
          if (hiddenNames.has(personName)) return;
          const entry = monthEntries[row.key];
          if (!entry) return;
          const item = buildContributionItem(monthSchedule.monthKey, day.dateKey, row.duty, entry, day);
          if (!item) return;
          const current = personMap.get(personName) ?? [];
          current.push(item);
          personMap.set(personName, current);
        });
      });
  });

  const allNames = new Set(
    [...personMap.keys(), ...Object.keys(manualStore).map((name) => name.trim()).filter(Boolean)].filter(
      (name) => !hiddenNames.has(name),
    ),
  );

  return Array.from(allNames)
    .map((name) => {
      const items = personMap.get(name) ?? [];
      const sortedItems = [...items].sort((left, right) =>
        left.dateKey.localeCompare(right.dateKey) || left.duty.localeCompare(right.duty, "ko"),
      );
      const manualItems = [...(manualStore[name] ?? [])];
      const clockInScore = roundScore(sortedItems.reduce((sum, item) => sum + item.clockInScore, 0));
      const clockOutScore = roundScore(sortedItems.reduce((sum, item) => sum + item.clockOutScore, 0));
      const coverageScore = roundScore(sortedItems.reduce((sum, item) => sum + item.coverageScore, 0));
      const autoScore = roundScore(sortedItems.reduce((sum, item) => sum + item.totalScore, 0));
      const manualScore = roundScore(manualItems.reduce((sum, item) => sum + item.score, 0));
      const totalScore = roundScore(autoScore + manualScore);
      return {
        name,
        totalScore,
        autoScore,
        manualScore,
        clockInScore,
        clockOutScore,
        coverageScore,
        itemCount: sortedItems.length,
        items: sortedItems,
        manualItems,
      } satisfies ContributionPersonCard;
    })
    .sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"));
}

interface ReviewManagementProfileRow {
  id: string;
  email: string;
  login_id?: string | null;
  name: string;
  role: UserRole;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

interface ReviewManagementSubmissionRow {
  id: string;
  author_id: string;
  type: string;
  title: string;
  link: string;
  date: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ReviewManagementAssignmentRow {
  id: string;
  submission_id: string;
  reviewer_id: string;
  assigned_by: string | null;
  assigned_at: string;
  reset_at: string | null;
  created_at: string;
}

interface ReviewManagementReviewRow {
  id: string;
  submission_id: string;
  reviewer_id: string;
  comment: string | null;
  total: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewerCandidate {
  id: string;
  name: string;
  email: string;
  role: "reviewer";
  approved: boolean;
}

export interface ReviewManagementReviewItem {
  id: string;
  reviewerId: string;
  reviewerName: string;
  total: number | null;
  comment: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface ReviewManagementItem {
  submissionId: string;
  authorId: string;
  authorName: string;
  type: string;
  title: string;
  link: string;
  date: string;
  notes: string;
  status: string;
  updatedAt: string;
  assignmentId: string | null;
  reviewerId: string | null;
  reviewerName: string;
  assignedAt: string | null;
  reviews: ReviewManagementReviewItem[];
}

export interface ReviewManagementWorkspace {
  candidates: ReviewerCandidate[];
  items: ReviewManagementItem[];
}

export interface AdminProfileItem {
  id: string;
  email: string;
  loginId: string;
  name: string;
  role: UserRole;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWorkspace {
  profiles: AdminProfileItem[];
  reviewManagement: ReviewManagementWorkspace;
}

export interface ReviewerRoleProfileItem {
  id: string;
  name: string;
  email: string;
  loginId: string;
  role: UserRole;
  approved: boolean;
}

export interface ReviewerRoleWorkspace {
  profiles: ReviewerRoleProfileItem[];
  grantedProfileIds: string[];
}

export interface TeamLeadReferenceNoteItem {
  id: string;
  text: string;
}

export interface TeamLeadReferenceNoteCard {
  profileId: string;
  name: string;
  role: UserRole;
  items: TeamLeadReferenceNoteItem[];
}

export interface TeamLeadReferenceNotesWorkspace {
  cards: TeamLeadReferenceNoteCard[];
}

export interface TeamLeadBestReportReviewer {
  id: string;
  name: string;
  email: string;
}

export interface TeamLeadBestReportReviewerScore {
  reviewerId: string;
  reviewerName: string;
  score: number | null;
  reportCount: number;
  reportScores: number[];
}

export interface TeamLeadBestReportReviewerDetailReport {
  submissionId: string;
  reportType: string;
  reportTitle: string;
  score: number;
  comment?: string;
  completedAt: string;
  updatedAt: string;
}

export interface TeamLeadBestReportReviewerDetailRow {
  reviewerId: string;
  reviewerName: string;
  authorId: string;
  authorName: string;
  totalScore: number;
  reports: TeamLeadBestReportReviewerDetailReport[];
}

export interface TeamLeadBestReportResultsRow {
  authorId: string;
  authorName: string;
  reviewerScores: TeamLeadBestReportReviewerScore[];
  trimmedAverage: number | null;
}

export type TeamLeadBestReportQuarterNumber = 1 | 2 | 3 | 4;

export interface TeamLeadBestReportQuarterTarget {
  key: string;
  label: string;
  year: number;
  quarter: TeamLeadBestReportQuarterNumber;
}

export interface TeamLeadBestReportQuarterSnapshot extends TeamLeadBestReportQuarterTarget {
  savedAt: string;
  reviewers: TeamLeadBestReportReviewer[];
  rows: TeamLeadBestReportResultsRow[];
  reviewerDetails: TeamLeadBestReportReviewerDetailRow[];
}

export interface TeamLeadBestReportResultsWorkspace {
  reviewers: TeamLeadBestReportReviewer[];
  rows: TeamLeadBestReportResultsRow[];
  reviewerDetails: TeamLeadBestReportReviewerDetailRow[];
  savedQuarters: TeamLeadBestReportQuarterSnapshot[];
  nextQuarter: TeamLeadBestReportQuarterTarget;
}

const REVIEW_MANAGEMENT_PROFILE_COLUMNS =
  "id, email, login_id, name, role, approved, created_at, updated_at";

async function getPrivilegedPortalSession() {
  const authModule = await import("@/lib/auth/storage");
  return authModule.getSession() ?? authModule.getSessionAsync();
}

async function getPrivilegedSupabaseClient() {
  const supabaseModule = await import("@/lib/supabase/client");
  return supabaseModule.createClient();
}

function hasAdminLikeAccess(role: ReviewManagementProfileRow["role"] | null | undefined) {
  return role === "admin" || role === "team_lead";
}

function formatReviewCandidate(row: ReviewManagementProfileRow): ReviewerCandidate {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: "reviewer",
    approved: row.approved,
  };
}

function formatAdminProfile(row: ReviewManagementProfileRow): AdminProfileItem {
  return {
    id: row.id,
    email: row.email,
    loginId: row.login_id ?? "",
    name: row.name,
    role: row.role,
    approved: row.approved,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatReviewerRoleProfile(row: ReviewManagementProfileRow): ReviewerRoleProfileItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    loginId: row.login_id ?? "",
    role:
      row.role === "reviewer" || row.role === "desk" || row.role === "admin"
        ? row.role
        : "member",
    approved: row.approved,
  };
}

function normalizeReviewAccessState(raw: unknown) {
  if (!raw || typeof raw !== "object") return [] as string[];
  const record = raw as { profileIds?: unknown };
  if (!Array.isArray(record.profileIds)) return [] as string[];
  return Array.from(
    new Set(
      record.profileIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  ).sort();
}

function normalizeReferenceNoteItems(raw: unknown) {
  if (!Array.isArray(raw)) return [] as TeamLeadReferenceNoteItem[];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<TeamLeadReferenceNoteItem>;
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (!text) return null;
      return {
        id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
        text,
      } satisfies TeamLeadReferenceNoteItem;
    })
    .filter((item): item is TeamLeadReferenceNoteItem => Boolean(item));
}

function normalizeReferenceNotesProfileStore(raw: unknown) {
  if (!raw || typeof raw !== "object") return {} as ReferenceNotesYearStore;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([profileId, items]) => [
      profileId,
      normalizeReferenceNoteItems(items),
    ]),
  ) as ReferenceNotesYearStore;
}

function normalizeReferenceNotesState(raw: unknown) {
  if (!raw || typeof raw !== "object") return {} as ReferenceNotesStore;
  const record = raw as Record<string, unknown>;
  const hasLegacyShape = Object.values(record).some((value) => Array.isArray(value));

  if (hasLegacyShape) {
    return {
      [String(getTeamLeadEvaluationYear())]: normalizeReferenceNotesProfileStore(record),
    } satisfies ReferenceNotesStore;
  }

  return Object.fromEntries(
    Object.entries(record).map(([yearKey, yearStore]) => [yearKey, normalizeReferenceNotesProfileStore(yearStore)]),
  ) as ReferenceNotesStore;
}

async function getGrantedReviewerProfileIds() {
  const supabase = await getPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("team_lead_state")
    .select("state")
    .eq("key", TEAM_LEAD_REVIEW_ACCESS_STATE_KEY)
    .maybeSingle<{ state: unknown }>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) {
      console.warn(getSupabaseStorageErrorMessage(error, "team_lead_state"));
      return [] as string[];
    }
    throw new Error(error.message);
  }

  return normalizeReviewAccessState(data?.state);
}

export function isTeamLeadSubmissionAccessOpen() {
  return submissionAccessCache;
}

export async function refreshTeamLeadSubmissionAccessState() {
  try {
    const session = await getPortalSession();
    if (!session?.approved) {
      submissionAccessCache = false;
      emitTeamLeadEvent(TEAM_LEAD_SUBMISSION_ACCESS_EVENT);
      return submissionAccessCache;
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_state")
      .select("state")
      .eq("key", TEAM_LEAD_SUBMISSION_ACCESS_STATE_KEY)
      .maybeSingle<{ state: unknown }>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "team_lead_state"));
        submissionAccessCache = false;
        emitTeamLeadEvent(TEAM_LEAD_SUBMISSION_ACCESS_EVENT);
        return submissionAccessCache;
      }
      if (isSupabaseRequestFailureError(error)) {
        console.warn("팀장 제출 접근 상태를 불러오지 못했습니다. 기존 상태를 유지합니다.", error);
        emitTeamLeadEvent(TEAM_LEAD_SUBMISSION_ACCESS_EVENT);
        return submissionAccessCache;
      }
      throw new Error(error.message);
    }

    submissionAccessCache = normalizeSubmissionAccessState(data?.state).isOpen;
    emitTeamLeadEvent(TEAM_LEAD_SUBMISSION_ACCESS_EVENT);
    return submissionAccessCache;
  } catch (error) {
    if (isSupabaseRequestTimeoutError(error) || isSupabaseRequestFailureError(error)) {
      console.warn("팀장 제출 접근 상태를 불러오지 못했습니다. 기존 상태를 유지합니다.", error);
      emitTeamLeadEvent(TEAM_LEAD_SUBMISSION_ACCESS_EVENT);
      return submissionAccessCache;
    }
    throw error;
  }
}

async function getGrantedReviewerProfiles() {
  const supabase = await getPrivilegedSupabaseClient();
  const grantedProfileIds = await getGrantedReviewerProfileIds();
  if (grantedProfileIds.length === 0) return [] as ReviewManagementProfileRow[];

  const { data, error } = await supabase
    .from("profiles")
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
    .eq("approved", true)
    .in("id", grantedProfileIds)
    .order("name", { ascending: true })
    .returns<ReviewManagementProfileRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function getTrimmedReviewAverage(scores: number[]) {
  if (scores.length < 3) return null;
  const sorted = [...scores].sort((left, right) => left - right);
  const middleScores = sorted.slice(1, -1);
  if (middleScores.length === 0) return null;
  return roundScore(middleScores.reduce((sum, score) => sum + score, 0) / middleScores.length);
}

function isBestReportQuarterNumber(value: unknown): value is TeamLeadBestReportQuarterNumber {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function getBestReportQuarterKey(year: number, quarter: TeamLeadBestReportQuarterNumber) {
  return `${year}-Q${quarter}`;
}

function getBestReportQuarterLabel(year: number, quarter: TeamLeadBestReportQuarterNumber) {
  return `${year}년 ${quarter}분기`;
}

function normalizeBestReportQuarterTarget(
  value: Partial<TeamLeadBestReportQuarterTarget> | null | undefined,
): TeamLeadBestReportQuarterTarget | null {
  const year = Number(value?.year);
  const quarter = Number(value?.quarter);
  if (!Number.isInteger(year) || year < 2000 || !isBestReportQuarterNumber(quarter)) {
    return null;
  }

  return {
    year,
    quarter,
    key: getBestReportQuarterKey(year, quarter),
    label: getBestReportQuarterLabel(year, quarter),
  };
}

function normalizeBestReportQuarterSnapshots(raw: unknown) {
  if (!Array.isArray(raw)) return [] as TeamLeadBestReportQuarterSnapshot[];

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<TeamLeadBestReportQuarterSnapshot>;
      const target = normalizeBestReportQuarterTarget(record);
      if (!target) return null;

      return {
        ...target,
        savedAt: typeof record.savedAt === "string" ? record.savedAt : "",
        reviewers: Array.isArray(record.reviewers) ? record.reviewers : [],
        rows: Array.isArray(record.rows) ? record.rows : [],
        reviewerDetails: Array.isArray(record.reviewerDetails) ? record.reviewerDetails : [],
      } satisfies TeamLeadBestReportQuarterSnapshot;
    })
    .filter((item): item is TeamLeadBestReportQuarterSnapshot => Boolean(item))
    .sort((left, right) => left.year - right.year || left.quarter - right.quarter);
}

function normalizeBestReportCurrentState(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return { resetAt: "" };
  }

  const record = raw as { resetAt?: unknown };
  return {
    resetAt: typeof record.resetAt === "string" ? record.resetAt : "",
  };
}

function normalizeSubmissionAccessState(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return { isOpen: false };
  }

  const record = raw as { isOpen?: unknown };
  return {
    isOpen: Boolean(record.isOpen),
  };
}

function getNextBestReportQuarterTarget(
  snapshots: TeamLeadBestReportQuarterSnapshot[],
): TeamLeadBestReportQuarterTarget {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    const year = getTeamLeadEvaluationYear();
    return {
      year,
      quarter: 1,
      key: getBestReportQuarterKey(year, 1),
      label: getBestReportQuarterLabel(year, 1),
    };
  }

  if (latest.quarter < 4) {
    const quarter = (latest.quarter + 1) as TeamLeadBestReportQuarterNumber;
    return {
      year: latest.year,
      quarter,
      key: getBestReportQuarterKey(latest.year, quarter),
      label: getBestReportQuarterLabel(latest.year, quarter),
    };
  }

  const year = latest.year + 1;
  return {
    year,
    quarter: 1,
    key: getBestReportQuarterKey(year, 1),
    label: getBestReportQuarterLabel(year, 1),
  };
}

async function getSavedBestReportQuarterSnapshots() {
  const supabase = await getPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("team_lead_state")
    .select("state")
    .eq("key", TEAM_LEAD_BEST_REPORT_QUARTER_STATE_KEY)
    .maybeSingle<{ state: unknown }>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) {
      console.warn(getSupabaseStorageErrorMessage(error, "team_lead_state"));
      return [] as TeamLeadBestReportQuarterSnapshot[];
    }
    throw new Error(error.message);
  }

  return normalizeBestReportQuarterSnapshots(data?.state);
}

async function getBestReportCurrentResetAt() {
  const supabase = await getPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("team_lead_state")
    .select("state")
    .eq("key", TEAM_LEAD_BEST_REPORT_CURRENT_STATE_KEY)
    .maybeSingle<{ state: unknown }>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) {
      console.warn(getSupabaseStorageErrorMessage(error, "team_lead_state"));
      return "";
    }
    throw new Error(error.message);
  }

  return normalizeBestReportCurrentState(data?.state).resetAt;
}

async function getReviewManagementWorkspaceInternal(): Promise<ReviewManagementWorkspace> {
  const supabase = await getPrivilegedSupabaseClient();
  const grantedProfileIds = await getGrantedReviewerProfileIds();
  const candidateQuery = supabase
    .from("profiles")
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
    .eq("approved", true)
    .order("name", { ascending: true });
  const { data: candidates, error: candidateError } =
    grantedProfileIds.length > 0
      ? await candidateQuery.in("id", grantedProfileIds).returns<ReviewManagementProfileRow[]>()
      : await candidateQuery.limit(0).returns<ReviewManagementProfileRow[]>();

  if (candidateError) {
    throw new Error(candidateError.message);
  }
  const visibleCandidates = (candidates ?? []).filter((candidate) => !isReadOnlyPortalRole(candidate.role));

  const { data: submissionRows, error: submissionError } = await supabase
    .from("submissions")
    .select("id, author_id, type, title, link, date, notes, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .returns<ReviewManagementSubmissionRow[]>();

  if (submissionError) {
    throw new Error(submissionError.message);
  }

  const submissionIds = (submissionRows ?? []).map((row) => row.id);

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("review_assignments")
    .select("id, submission_id, reviewer_id, assigned_by, assigned_at, reset_at, created_at")
    .is("reset_at", null)
    .order("assigned_at", { ascending: false })
    .returns<ReviewManagementAssignmentRow[]>();

  if (assignmentError) {
    throw new Error(assignmentError.message);
  }

  const reviewQuery = supabase
    .from("reviews")
    .select("id, submission_id, reviewer_id, comment, total, completed_at, created_at, updated_at")
    .order("updated_at", { ascending: false });
  const { data: reviewRows, error: reviewError } =
    submissionIds.length > 0
      ? await reviewQuery.in("submission_id", submissionIds).returns<ReviewManagementReviewRow[]>()
      : await reviewQuery.limit(0).returns<ReviewManagementReviewRow[]>();

  if (reviewError) {
    throw new Error(reviewError.message);
  }

  const profileIds = Array.from(
    new Set([
      ...(submissionRows ?? []).map((row) => row.author_id),
      ...(assignmentRows ?? []).map((row) => row.reviewer_id),
      ...(reviewRows ?? []).map((row) => row.reviewer_id),
    ]),
  );

  const profileQuery = supabase
    .from("profiles")
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS);
  const { data: profileRows, error: profileError } =
    profileIds.length > 0
      ? await profileQuery.in("id", profileIds).returns<ReviewManagementProfileRow[]>()
      : await profileQuery.limit(0).returns<ReviewManagementProfileRow[]>();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profileMap = new Map((profileRows ?? []).map((row) => [row.id, row] as const));
  const activeAssignmentMap = new Map(
    (assignmentRows ?? []).map((row) => [row.submission_id, row] as const),
  );
  const reviewMap = new Map<string, ReviewManagementReviewItem[]>();
  const visibleSubmissionRows = (submissionRows ?? []).filter((row) => {
    const authorRole = profileMap.get(row.author_id)?.role;
    return !isTeamLeadEvaluationExcludedRole(authorRole);
  });

  (reviewRows ?? []).forEach((row) => {
    const current = reviewMap.get(row.submission_id) ?? [];
    current.push({
      id: row.id,
      reviewerId: row.reviewer_id,
      reviewerName: profileMap.get(row.reviewer_id)?.name ?? row.reviewer_id,
      total: row.total,
      comment: row.comment ?? "",
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    });
    reviewMap.set(row.submission_id, current);
  });

  return {
    candidates: visibleCandidates.map(formatReviewCandidate),
    items: visibleSubmissionRows.map((row) => {
      const assignment = activeAssignmentMap.get(row.id);
      return {
        submissionId: row.id,
        authorId: row.author_id,
        authorName: profileMap.get(row.author_id)?.name ?? row.author_id,
        type: row.type,
        title: row.title,
        link: row.link,
        date: row.date ?? "",
        notes: row.notes ?? "",
        status: row.status,
        updatedAt: row.updated_at,
        assignmentId: assignment?.id ?? null,
        reviewerId: assignment?.reviewer_id ?? null,
        reviewerName: assignment ? (profileMap.get(assignment.reviewer_id)?.name ?? assignment.reviewer_id) : "",
        assignedAt: assignment?.assigned_at ?? null,
        reviews: reviewMap.get(row.id) ?? [],
      } satisfies ReviewManagementItem;
    }),
  };
}

export async function getTeamLeadReviewManagementWorkspace() {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    throw new Error("review assignment 관리 권한이 없습니다.");
  }

  return getReviewManagementWorkspaceInternal();
}

export async function getTeamLeadReviewerRoleWorkspace(): Promise<ReviewerRoleWorkspace> {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    throw new Error("평가자 지정 권한이 없습니다.");
  }

  const supabase = await getPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
    .eq("approved", true)
    .in("role", ["member", "reviewer", "desk", "admin"])
    .order("name", { ascending: true })
    .returns<ReviewManagementProfileRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    profiles: (data ?? []).map(formatReviewerRoleProfile),
    grantedProfileIds: await getGrantedReviewerProfileIds(),
  };
}

export async function getTeamLeadReferenceNotesWorkspace(
  evaluationYear = getTeamLeadEvaluationYear(),
): Promise<TeamLeadReferenceNotesWorkspace> {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    throw new Error("참고사항 조회 권한이 없습니다.");
  }

  const supabase = await getPrivilegedSupabaseClient();
  const [{ data: profiles, error: profileError }, { data: stateRow, error: stateError }] = await Promise.all([
    supabase
      .from("profiles")
      .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
      .eq("approved", true)
      .neq("role", "team_lead")
      .order("name", { ascending: true })
      .returns<ReviewManagementProfileRow[]>(),
    supabase
      .from("team_lead_state")
      .select("state")
      .eq("key", TEAM_LEAD_REFERENCE_NOTES_STATE_KEY)
      .maybeSingle<{ state: unknown }>(),
  ]);

  if (profileError) {
    throw new Error(profileError.message);
  }
  if (stateError) {
    if (isSupabaseSchemaMissingError(stateError)) {
      console.warn(getSupabaseStorageErrorMessage(stateError, "team_lead_state"));
    } else {
      throw new Error(stateError.message);
    }
  }

  const noteMap = normalizeReferenceNotesState(stateRow?.state)[String(evaluationYear)] ?? {};
  const visibleProfiles = (profiles ?? []).filter((profile) => !isTeamLeadEvaluationExcludedRole(profile.role));

  return {
    cards: visibleProfiles.map((profile) => ({
      profileId: profile.id,
      name: profile.name,
      role:
        profile.role === "reviewer" || profile.role === "desk" || profile.role === "admin"
          ? profile.role
          : "member",
      items: [...(noteMap[profile.id] ?? [])],
    })),
  };
}

export async function saveTeamLeadReferenceNotes(
  profileId: string,
  items: TeamLeadReferenceNoteItem[],
  evaluationYear = getTeamLeadEvaluationYear(),
) {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    return { ok: false as const, message: "참고사항 저장 권한이 없습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const normalizedItems = normalizeReferenceNoteItems(items);
  const { data: stateRow, error: stateError } = await supabase
    .from("team_lead_state")
    .select("state")
    .eq("key", TEAM_LEAD_REFERENCE_NOTES_STATE_KEY)
    .maybeSingle<{ state: unknown }>();

  if (stateError && !isSupabaseSchemaMissingError(stateError)) {
    return { ok: false as const, message: stateError.message };
  }

  const nextState = normalizeReferenceNotesState(stateRow?.state);
  const yearKey = String(evaluationYear);
  const nextYearState = {
    ...(nextState[yearKey] ?? {}),
  };
  if (normalizedItems.length > 0) {
    nextYearState[profileId] = normalizedItems;
  } else {
    delete nextYearState[profileId];
  }

  if (Object.keys(nextYearState).length > 0) {
    nextState[yearKey] = nextYearState;
  } else {
    delete nextState[yearKey];
  }

  try {
    await persistTeamLeadState(TEAM_LEAD_REFERENCE_NOTES_STATE_KEY, nextState);
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "참고사항 저장에 실패했습니다.",
    };
  }

  return {
    ok: true as const,
    message: "참고사항을 저장했습니다.",
  };
}

export async function getTeamLeadBestReportResultsWorkspace(): Promise<TeamLeadBestReportResultsWorkspace> {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    throw new Error("베스트리포트 평가 결과 조회 권한이 없습니다.");
  }

  const supabase = await getPrivilegedSupabaseClient();
  const savedQuarters = await getSavedBestReportQuarterSnapshots();
  const currentResetAt = await getBestReportCurrentResetAt();
  const reviewerProfiles = await getGrantedReviewerProfiles();
  const reviewers = reviewerProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    email: profile.email,
  })) satisfies TeamLeadBestReportReviewer[];

  const { data: submissionRows, error: submissionError } = await supabase
    .from("submissions")
    .select("id, author_id, type, title, link, date, notes, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .returns<ReviewManagementSubmissionRow[]>();

  if (submissionError) {
    throw new Error(submissionError.message);
  }

  const currentSubmissionRows = (submissionRows ?? []).filter((row) =>
    currentResetAt ? row.updated_at > currentResetAt : true,
  );
  const authorIds = Array.from(new Set(currentSubmissionRows.map((row) => row.author_id)));

  const { data: authorProfiles, error: authorProfileError } =
    authorIds.length > 0
      ? await supabase
          .from("profiles")
          .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
          .in("id", authorIds)
          .returns<ReviewManagementProfileRow[]>()
      : await supabase
          .from("profiles")
          .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
          .limit(0)
          .returns<ReviewManagementProfileRow[]>();

  if (authorProfileError) {
    throw new Error(authorProfileError.message);
  }
  const excludedAuthorIds = new Set(
    (authorProfiles ?? [])
      .filter((profile) => isTeamLeadEvaluationExcludedRole(profile.role))
      .map((profile) => profile.id),
  );
  const visibleSubmissionRows = currentSubmissionRows.filter((row) => !excludedAuthorIds.has(row.author_id));
  const submissionIds = visibleSubmissionRows.map((row) => row.id);
  const visibleAuthorIds = Array.from(new Set(visibleSubmissionRows.map((row) => row.author_id)));

  const reviewQuery = supabase
    .from("reviews")
    .select("id, submission_id, reviewer_id, comment, total, completed_at, created_at, updated_at")
    .not("completed_at", "is", null)
    .order("updated_at", { ascending: false });
  const { data: reviewRows, error: reviewError } =
    submissionIds.length > 0 && reviewers.length > 0
      ? await reviewQuery
          .in("submission_id", submissionIds)
          .in("reviewer_id", reviewers.map((reviewer) => reviewer.id))
          .returns<ReviewManagementReviewRow[]>()
      : await reviewQuery.limit(0).returns<ReviewManagementReviewRow[]>();

  if (reviewError) {
    throw new Error(reviewError.message);
  }

  const authorNameMap = new Map((authorProfiles ?? []).map((profile) => [profile.id, profile.name.trim()] as const));
  const reviewerNameMap = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.name] as const));
  const submissionAuthorMap = new Map(visibleSubmissionRows.map((row) => [row.id, row.author_id] as const));
  const submissionMap = new Map(visibleSubmissionRows.map((row) => [row.id, row] as const));
  const scoreMap = new Map<string, Map<string, number[]>>();
  const reviewerDetailMap = new Map<string, TeamLeadBestReportReviewerDetailRow>();

  (reviewRows ?? []).forEach((row) => {
    if (!row.completed_at) return;
    if (currentResetAt && row.completed_at <= currentResetAt) return;
    const authorId = submissionAuthorMap.get(row.submission_id);
    const total = Number(row.total);
    if (!authorId || !Number.isFinite(total)) return;

    const reviewerScores = scoreMap.get(authorId) ?? new Map<string, number[]>();
    const currentScores = reviewerScores.get(row.reviewer_id) ?? [];
    currentScores.push(roundScore(total));
    reviewerScores.set(row.reviewer_id, currentScores);
    scoreMap.set(authorId, reviewerScores);

    const submission = submissionMap.get(row.submission_id);
    const detailKey = `${row.reviewer_id}::${authorId}`;
    const detailRow = reviewerDetailMap.get(detailKey) ?? {
      reviewerId: row.reviewer_id,
      reviewerName: reviewerNameMap.get(row.reviewer_id) ?? row.reviewer_id,
      authorId,
      authorName: authorNameMap.get(authorId) ?? authorId,
      totalScore: 0,
      reports: [],
    };

    detailRow.reports.push({
      submissionId: row.submission_id,
      reportType: submission?.type ?? "",
      reportTitle: submission?.title ?? "",
      score: roundScore(total),
      comment: row.comment ?? "",
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    });
    detailRow.totalScore = roundScore(detailRow.totalScore + roundScore(total));
    reviewerDetailMap.set(detailKey, detailRow);
  });

  const rows = visibleAuthorIds
    .map((authorId) => {
      const reviewerScoreMap = scoreMap.get(authorId) ?? new Map<string, number[]>();
      const reviewerScores = reviewers.map((reviewer) => {
        const reportScores = [...(reviewerScoreMap.get(reviewer.id) ?? [])].sort((left, right) => right - left);
        return {
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          score: reportScores[0] ?? null,
          reportCount: reportScores.length,
          reportScores,
        } satisfies TeamLeadBestReportReviewerScore;
      });
      const validScores = reviewerScores
        .map((item) => item.score)
        .filter((score): score is number => score !== null);

      return {
        authorId,
        authorName: authorNameMap.get(authorId) ?? authorId,
        reviewerScores,
        trimmedAverage: getTrimmedReviewAverage(validScores),
      } satisfies TeamLeadBestReportResultsRow;
    })
    .sort((left, right) => left.authorName.localeCompare(right.authorName, "ko"));

  const reviewerDetails = Array.from(reviewerDetailMap.values())
    .map((row) => ({
      ...row,
      reports: [...row.reports].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      totalScore: roundScore(row.totalScore),
    }))
    .sort((left, right) => {
      const reviewerCompare = left.reviewerName.localeCompare(right.reviewerName, "ko");
      if (reviewerCompare !== 0) return reviewerCompare;
      return left.authorName.localeCompare(right.authorName, "ko");
    });

  return {
    reviewers,
    rows,
    reviewerDetails,
    savedQuarters,
    nextQuarter: getNextBestReportQuarterTarget(savedQuarters),
  };
}

export async function getTeamLeadBestReportScoreMap() {
  const workspace = await getTeamLeadBestReportResultsWorkspace();
  return new Map(
    workspace.rows.map((row) => [row.authorName.trim(), roundScore(row.trimmedAverage ?? 0)] as const),
  );
}

export async function saveCurrentBestReportResultsAsNextQuarter() {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    return { ok: false as const, message: "베스트리포트 분기 저장 권한이 없습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const workspace = await getTeamLeadBestReportResultsWorkspace();
  const hasScoredRows = workspace.rows.some((row) => row.reviewerScores.some((score) => score.score !== null));
  if (!hasScoredRows) {
    return { ok: false as const, message: "저장할 베스트리포트 평가 결과가 없습니다." };
  }

  const nextSnapshot: TeamLeadBestReportQuarterSnapshot = {
    ...workspace.nextQuarter,
    savedAt: new Date().toISOString(),
    reviewers: workspace.reviewers,
    rows: workspace.rows,
    reviewerDetails: workspace.reviewerDetails,
  };
  const previousSnapshots = [...workspace.savedQuarters];
  const nextSnapshots = [...previousSnapshots, nextSnapshot];
  const resetAt = new Date().toISOString();

  try {
    await persistTeamLeadState(TEAM_LEAD_BEST_REPORT_QUARTER_STATE_KEY, nextSnapshots);
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "분기 결과 저장에 실패했습니다.",
    };
  }

  try {
    await persistTeamLeadState(TEAM_LEAD_BEST_REPORT_CURRENT_STATE_KEY, {
      resetAt,
    });
  } catch (error) {
    await persistTeamLeadState(TEAM_LEAD_BEST_REPORT_QUARTER_STATE_KEY, previousSnapshots);
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "현재 분기 초기화에 실패했습니다.",
    };
  }

  try {
    await persistTeamLeadState(TEAM_LEAD_REVIEW_ACCESS_STATE_KEY, {
      profileIds: [],
    });
  } catch (error) {
    await persistTeamLeadState(TEAM_LEAD_BEST_REPORT_QUARTER_STATE_KEY, previousSnapshots);
    await persistTeamLeadState(TEAM_LEAD_BEST_REPORT_CURRENT_STATE_KEY, {
      resetAt: "",
    });
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "평가자 명단 초기화에 실패했습니다.",
    };
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TEAM_LEAD_BEST_REPORT_EVENT));
  }

  return {
    ok: true as const,
    message: `${workspace.nextQuarter.label} 결과를 저장하고 현재 결과를 초기화했습니다.`,
    savedQuarter: nextSnapshot,
  };
}

export async function saveTeamLeadReviewerRoles(selectedProfileIds: string[]) {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    return { ok: false as const, message: "평가자 지정 권한이 없습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const normalizedSelectedIds = Array.from(
    new Set(selectedProfileIds.map((id) => id.trim()).filter(Boolean)),
  ).sort();
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
    .eq("approved", true)
    .in("role", ["member", "reviewer", "desk", "admin"])
    .returns<ReviewManagementProfileRow[]>();

  if (profileError) {
    return { ok: false as const, message: profileError.message };
  }

  const availableIds = new Set((profiles ?? []).map((profile) => profile.id));
  const grantedProfileIds = normalizedSelectedIds.filter((id) => availableIds.has(id));

  try {
    await persistTeamLeadState(TEAM_LEAD_REVIEW_ACCESS_STATE_KEY, {
      profileIds: grantedProfileIds,
    });
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "평가 권한 저장에 실패했습니다.",
    };
  }

  return {
    ok: true as const,
    message: "평가 페이지 권한을 저장했습니다.",
  };
}

export async function setTeamLeadSubmissionAccessOpen(nextOpen: boolean) {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    return { ok: false as const, message: "영상평가 제출 오픈 권한이 없습니다." };
  }

  try {
    await persistTeamLeadState(TEAM_LEAD_SUBMISSION_ACCESS_STATE_KEY, {
      isOpen: nextOpen,
    });
    submissionAccessCache = nextOpen;
    emitTeamLeadEvent(TEAM_LEAD_SUBMISSION_ACCESS_EVENT);
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "영상평가 제출 오픈 상태 저장에 실패했습니다.",
    };
  }

  return {
    ok: true as const,
    isOpen: nextOpen,
    message: nextOpen ? "영상평가 제출을 오픈했습니다." : "영상평가 제출을 닫았습니다.",
  };
}

export async function assignReviewerToSubmission(submissionId: string, reviewerId: string) {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    return { ok: false as const, message: "assignment 관리 권한이 없습니다." };
  }

  const grantedProfileIds = await getGrantedReviewerProfileIds();
  if (!grantedProfileIds.includes(reviewerId)) {
    return { ok: false as const, message: "평가 페이지 권한이 있는 사람만 배정할 수 있습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const resetAt = new Date().toISOString();
  const { error: resetError } = await supabase
    .from("review_assignments")
    .update({ reset_at: resetAt })
    .eq("submission_id", submissionId)
    .is("reset_at", null);

  if (resetError) {
    return { ok: false as const, message: resetError.message };
  }

  const assignedAt = new Date().toISOString();
  const { error: assignError } = await supabase
    .from("review_assignments")
    .upsert(
      {
        submission_id: submissionId,
        reviewer_id: reviewerId,
        assigned_by: session.id,
        assigned_at: assignedAt,
        reset_at: null,
      },
      { onConflict: "submission_id,reviewer_id" },
    );

  if (assignError) {
    return { ok: false as const, message: assignError.message };
  }

  return { ok: true as const, message: "reviewer assignment를 저장했습니다." };
}

export async function resetSubmissionAssignment(submissionId: string) {
  const session = await getPrivilegedPortalSession();
  if (!session || (session.role !== "team_lead" && session.role !== "admin")) {
    return { ok: false as const, message: "assignment 초기화 권한이 없습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const { error } = await supabase
    .from("review_assignments")
    .update({ reset_at: new Date().toISOString() })
    .eq("submission_id", submissionId)
    .is("reset_at", null);

  if (error) {
    return { ok: false as const, message: error.message };
  }

  return { ok: true as const, message: "assignment를 초기화했습니다." };
}

export async function getAdminWorkspace(): Promise<AdminWorkspace> {
  const session = await getPrivilegedPortalSession();
  if (!session || !hasAdminLikeAccess(session.role)) {
    throw new Error("관리자 권한이 없습니다.");
  }

  const supabase = await getPrivilegedSupabaseClient();
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
    .order("created_at", { ascending: false })
    .returns<ReviewManagementProfileRow[]>();

  if (profileError) {
    throw new Error(profileError.message);
  }

  return {
    profiles: (profiles ?? []).map(formatAdminProfile),
    reviewManagement: await getReviewManagementWorkspaceInternal(),
  };
}

export async function updateAdminProfileAccess(
  profileId: string,
  input: {
    role: AdminProfileItem["role"];
    approved: boolean;
  },
) {
  const session = await getPrivilegedPortalSession();
  if (!session || !hasAdminLikeAccess(session.role)) {
    return { ok: false as const, message: "관리자 권한이 없습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      role: input.role,
      approved: input.approved,
    })
    .eq("id", profileId)
    .select(REVIEW_MANAGEMENT_PROFILE_COLUMNS)
    .single<ReviewManagementProfileRow>();

  if (error || !data) {
    return { ok: false as const, message: error?.message ?? "프로필을 저장하지 못했습니다." };
  }

  return {
    ok: true as const,
    message: "사용자 권한을 저장했습니다.",
    profile: formatAdminProfile(data),
  };
}

export async function deleteAdminProfile(profileId: string) {
  const session = await getPrivilegedPortalSession();
  if (!session || !hasAdminLikeAccess(session.role)) {
    return { ok: false as const, message: "관리자 권한이 없습니다." };
  }

  if (session.id === profileId) {
    return { ok: false as const, message: "현재 로그인한 관리자 계정은 탈퇴 처리할 수 없습니다." };
  }

  const supabase = await getPrivilegedSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .delete()
    .eq("id", profileId);

  if (error) {
    return { ok: false as const, message: error.message };
  }

  try {
    const authModule = await import("@/lib/auth/storage");
    await authModule.refreshUsers();
  } catch {
    // Best effort.
  }

  return {
    ok: true as const,
    message: "사용자를 탈퇴 처리했습니다.",
  };
}
