"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { getSession, getUsers } from "@/lib/auth/storage";
import {
  defaultPointers,
} from "@/lib/schedule/constants";
import { parseVacationEntry } from "@/lib/schedule/engine";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import {
  refreshScheduleState,
  SCHEDULE_STATE_EVENT,
} from "@/lib/schedule/storage";
import { vacationStyleTones } from "@/lib/schedule/vacation-styles";
import { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";
import { getPortalSupabaseClient } from "@/lib/supabase/portal";
import {
  AssignmentTripTagPhase,
  AssignmentTimeColor,
  AssignmentTravelType,
  createAssignmentRowKey,
  createDefaultScheduleAssignmentDayRows,
  createDefaultScheduleAssignmentEntry,
  getScheduleAssignmentBaseTimes,
  getScheduleAssignmentVisibleTripTagMap,
  getScheduleAssignmentRows,
  getScheduleAssignmentTimeColor,
  getScheduleAssignmentStore,
  getTeamLeadSchedules,
  refreshTeamLeadState,
  saveScheduleAssignmentStore,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
  ScheduleAssignmentDataStore,
  ScheduleAssignmentDayRows,
  ScheduleAssignmentEntry,
  ScheduleAssignmentRow,
  ScheduleAssignmentVisibleTripTag,
} from "@/lib/team-lead/storage";

type PortalSupabaseClient = Awaited<ReturnType<typeof getPortalSupabaseClient>>;
type PortalRealtimeChannel = ReturnType<PortalSupabaseClient["channel"]>;

const dutyOptions = [
  "조근",
  "일반",
  "기타",
  "연장",
  "석근",
  "야근",
  "뉴스대기",
  "야퇴",
  "청와대",
  "국회",
  "서울청사",
  "국방부",
  "시청",
  "법조",
  "수원",
  "국회지원",
  "법조지원",
  "국내출장",
  "해외출장",
  "오후반차",
  "오전반차",
];

const travelOptions: Array<{ value: AssignmentTravelType; label: string }> = [
  { value: "", label: "선택" },
  { value: "국내출장", label: "국내출장" },
  { value: "해외출장", label: "해외출장" },
  { value: "당일출장", label: "당일출장" },
];

function timeColorStyle(color: AssignmentTimeColor) {
  if (color === "red") return { borderColor: "rgba(248,113,113,.45)", background: "rgba(254,226,226,.95)", color: "#991b1b" };
  if (color === "blue") return { borderColor: "rgba(125,211,252,.6)", background: "rgba(224,242,254,.95)", color: "#075985" };
  if (color === "yellow") return { borderColor: "rgba(250,204,21,.55)", background: "rgba(254,249,195,.95)", color: "#854d0e" };
  return undefined;
}
const getSafeSchedules = (schedules: string[]) => (schedules.length > 0 ? schedules : [""]);
const removeScheduleAt = (schedules: string[], index: number) => getSafeSchedules(schedules.filter((_, i) => i !== index));
const getSafeExclusiveVideo = (values: boolean[], count: number) => Array.from({ length: Math.max(count, 1) }, (_, i) => values[i] ?? false);
const removeExclusiveVideoAt = (values: boolean[], index: number, nextCount: number) => getSafeExclusiveVideo(values.filter((_, i) => i !== index), nextCount);
const createCustomRowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const coverageScoreSteps = [0, 0.5, 1, 1.5, 2] as const;
const FOCUS_REFRESH_THROTTLE_MS = 60_000;
const CELL_LOCK_DURATION_SECONDS = 8;
const CELL_LOCK_RENEW_INTERVAL_MS = 3_000;
const CELL_LOCK_CLOCK_INTERVAL_MS = 1_000;
const tripPhaseLabels: Record<AssignmentTripTagPhase, string> = {
  "": "",
  departure: "출장출발",
  ongoing: "출장중",
  return: "출장복귀",
};

function getTripTagStyle(travelType: AssignmentTravelType, phase: AssignmentTripTagPhase = "") {
  if (travelType === "국내출장") {
    if (phase === "departure") {
      return {
        borderColor: "rgba(74,222,128,.72)",
        background: "rgba(34,197,94,.16)",
        color: "#dcfce7",
      };
    }
    if (phase === "ongoing") {
      return {
        borderColor: "rgba(16,185,129,.78)",
        background: "rgba(16,185,129,.24)",
        color: "#d1fae5",
      };
    }
    if (phase === "return") {
      return {
        borderColor: "rgba(5,150,105,.82)",
        background: "rgba(5,150,105,.3)",
        color: "#ecfdf5",
      };
    }
    return {
      borderColor: "rgba(34,197,94,.48)",
      background: "rgba(34,197,94,.16)",
      color: "#dcfce7",
    };
  }
  if (travelType === "해외출장") {
    if (phase === "departure") {
      return {
        borderColor: "rgba(125,211,252,.78)",
        background: "rgba(56,189,248,.16)",
        color: "#e0f2fe",
      };
    }
    if (phase === "ongoing") {
      return {
        borderColor: "rgba(96,165,250,.82)",
        background: "rgba(59,130,246,.24)",
        color: "#dbeafe",
      };
    }
    if (phase === "return") {
      return {
        borderColor: "rgba(129,140,248,.82)",
        background: "rgba(99,102,241,.28)",
        color: "#e0e7ff",
      };
    }
    return {
      borderColor: "rgba(96,165,250,.52)",
      background: "rgba(59,130,246,.16)",
      color: "#dbeafe",
    };
  }
  if (travelType === "당일출장") {
    return {
      borderColor: "rgba(250,204,21,.72)",
      background: "rgba(250,204,21,.2)",
      color: "#fef3c7",
    };
  }
  return {
    borderColor: "rgba(255,255,255,.16)",
    background: "rgba(255,255,255,.08)",
    color: "#f8fbff",
  };
}

type ImportMessageTone = "ok" | "warn" | "note";

interface ImportMessage {
  tone: ImportMessageTone;
  text: string;
}

interface ScheduleAssignmentRealtimeRow {
  month_key?: string;
  updated_by?: string | null;
}

interface ScheduleAssignmentRealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: ScheduleAssignmentRealtimeRow;
  old: ScheduleAssignmentRealtimeRow;
}

interface ScheduleAssignmentCellLockRow {
  cell_key: string;
  month_key: string;
  date_key: string;
  row_key: string;
  field_key: string;
  locked_by: string | null;
  locked_by_name: string | null;
  expires_at: string;
  updated_at?: string;
}

interface ScheduleAssignmentCellLockRealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<ScheduleAssignmentCellLockRow>;
  old: Partial<ScheduleAssignmentCellLockRow>;
}

interface ScheduleAssignmentCellLockRpcResult extends ScheduleAssignmentCellLockRow {
  ok: boolean;
}

interface ScheduleAssignmentInputPresencePayload {
  userId: string;
  userName: string;
  monthKey: string;
  activeCellKey: string | null;
  claimedAt: number | null;
  updatedAt: number;
}

interface ScheduleAssignmentInputLeader {
  cellKey: string;
  userId: string;
  userName: string;
  claimedAt: number;
  updatedAt: number;
}

interface ScheduleAssignmentInputBroadcastPayload {
  userId: string;
  userName: string;
  monthKey: string;
  cellKey: string | null;
  claimedAt: number | null;
  updatedAt: number;
}

interface ImportedWorkbookRow {
  day: number;
  headerName: string;
  name: string;
  duty: string;
  clockIn: string;
  clockOut: string;
  schedule: string;
  exclusiveVideo: boolean;
  travelType: AssignmentTravelType;
}

const historicalImportMonthMap = {
  "2025-12": { year: 2025, month: 12, label: "2025년 12월" },
  "2026-01": { year: 2026, month: 1, label: "2026년 1월" },
  "2026-02": { year: 2026, month: 2, label: "2026년 2월" },
  "2026-03": { year: 2026, month: 3, label: "2026년 3월" },
} as const;

type HistoricalImportMonthKey = keyof typeof historicalImportMonthMap;

const vacationBadgeStyles = vacationStyleTones;
const jcheckBadgeStyle = {
  borderColor: "rgba(255,255,255,.92)",
  background: "#ffffff",
  color: "#0f172a",
} as const;
const nightOffBadgeStyle = {
  borderColor: "rgba(203,213,225,.45)",
  background: "rgba(226,232,240,.16)",
  color: "#e2e8f0",
} as const;

function getTodayDateKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function getTodayMonthKey() {
  return getTodayDateKey().slice(0, 7);
}

function createScheduleAssignmentCellLockKey(
  monthKey: string,
  dateKey: string,
  rowKey: string,
  fieldKey: string,
) {
  return `${monthKey}::${dateKey}::${rowKey}::${fieldKey}`;
}

function isScheduleAssignmentCellLockActive(lock: ScheduleAssignmentCellLockRow | null | undefined, now: number) {
  if (!lock?.expires_at) return false;
  const expiresAt = new Date(lock.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function getScheduleAssignmentCellLockOwnerLabel(lock: ScheduleAssignmentCellLockRow | null | undefined) {
  const label = lock?.locked_by_name?.trim();
  return label || "다른 사용자";
}

function getScheduleAssignmentCellLockBlockedMessage(lock: ScheduleAssignmentCellLockRow | null | undefined) {
  return `${getScheduleAssignmentCellLockOwnerLabel(lock)}님이 입력중...`;
}

function getLockAwareFieldStyle(
  style: CSSProperties | undefined,
  lockedByOther: boolean,
): CSSProperties | undefined {
  if (!lockedByOther) return style;
  return {
    ...style,
    borderColor: "rgba(248,113,113,.45)",
    background: "rgba(127,29,29,.12)",
    color: "#fecaca",
    cursor: "not-allowed",
  };
}

function getPreferredScheduleInputLeader(
  current: ScheduleAssignmentInputLeader | undefined,
  candidate: ScheduleAssignmentInputLeader,
) {
  if (!current) return candidate;
  if (candidate.claimedAt !== current.claimedAt) {
    return candidate.claimedAt < current.claimedAt ? candidate : current;
  }
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt < current.updatedAt ? candidate : current;
  }
  return candidate.userId.localeCompare(current.userId) < 0 ? candidate : current;
}

function areScheduleInputLeadersEqual(
  current: Record<string, ScheduleAssignmentInputLeader>,
  next: Record<string, ScheduleAssignmentInputLeader>,
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) return false;

  return currentKeys.every((key) => {
    const currentLeader = current[key];
    const nextLeader = next[key];
    if (!currentLeader || !nextLeader) return false;

    return (
      currentLeader.cellKey === nextLeader.cellKey &&
      currentLeader.userId === nextLeader.userId &&
      currentLeader.userName === nextLeader.userName &&
      currentLeader.claimedAt === nextLeader.claimedAt &&
      currentLeader.updatedAt === nextLeader.updatedAt
    );
  });
}

function getCoverageScoreStyle(score: number) {
  if (score === 0.5) {
    return {
      borderColor: "rgba(132,204,22,.72)",
      background: "rgba(217,249,157,.95)",
      color: "#365314",
    };
  }
  if (score === 1) {
    return {
      borderColor: "rgba(96,165,250,.72)",
      background: "rgba(219,234,254,.95)",
      color: "#1d4ed8",
    };
  }
  if (score === 1.5) {
    return {
      borderColor: "rgba(192,132,252,.72)",
      background: "rgba(243,232,255,.95)",
      color: "#7c3aed",
    };
  }
  if (score === 2) {
    return {
      borderColor: "rgba(248,113,113,.72)",
      background: "rgba(254,226,226,.95)",
      color: "#991b1b",
    };
  }
  return {
    borderColor: "rgba(203,213,225,.95)",
    background: "#ffffff",
    color: "#94a3b8",
  };
}

function cycleCoverageScore(score: number) {
  const currentIndex = coverageScoreSteps.findIndex((item) => item === score);
  const nextIndex = currentIndex < 0 || currentIndex === coverageScoreSteps.length - 1 ? 0 : currentIndex + 1;
  return coverageScoreSteps[nextIndex];
}

function getPreviousDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;

function getWeekdayLabel(dow: number) {
  return weekdayLabels[dow] ?? "";
}

function formatManualTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":")) {
    const [h = "", m = ""] = trimmed.split(":");
    const hh = Number(h.replace(/\D/g, ""));
    const mm = Number(m.replace(/\D/g, ""));
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 3) {
    const hh = Number(digits.slice(0, 1));
    const mm = Number(digits.slice(1));
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  if (digits.length === 4) {
    const hh = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2));
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return null;
}

function cycleTripTagPhase(phase: AssignmentTripTagPhase): AssignmentTripTagPhase {
  if (phase === "") return "departure";
  if (phase === "departure") return "ongoing";
  if (phase === "ongoing") return "return";
  return "";
}

function createEmptyDaySchedule(date: Date): DaySchedule {
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

function cloneDayRows(dayRows: ScheduleAssignmentDayRows): ScheduleAssignmentDayRows {
  return {
    addedRows: dayRows.addedRows.map((row) => ({ ...row })),
    deletedRowKeys: [...dayRows.deletedRowKeys],
    rowOverrides: Object.fromEntries(
      Object.entries(dayRows.rowOverrides).map(([rowKey, row]) => [rowKey, { ...row }]),
    ),
  };
}

function sanitizeDayRows(dayRows: ScheduleAssignmentDayRows): ScheduleAssignmentDayRows {
  return {
    addedRows: dayRows.addedRows
      .map((row) => ({
        ...row,
        name: row.name.trim(),
        duty: row.duty.trim(),
      }))
      .filter((row) => row.name),
    deletedRowKeys: [...dayRows.deletedRowKeys],
    rowOverrides: Object.fromEntries(
      Object.entries(dayRows.rowOverrides).map(([rowKey, row]) => [
        rowKey,
        { name: row.name.trim(), duty: row.duty.trim() },
      ]),
    ),
  };
}

function getCustomRowIdFromKey(rowKey: string) {
  return rowKey.split("::custom::")[1] ?? "";
}

function buildMonthDays(schedule: GeneratedSchedule | null) {
  if (!schedule) return [] as DaySchedule[];
  const dayMap = new Map(
    schedule.days
      .filter((day) => day.month === schedule.month && day.year === schedule.year)
      .map((day) => [day.dateKey, day] as const),
  );
  const lastDay = new Date(schedule.year, schedule.month, 0).getDate();

  return Array.from({ length: lastDay }, (_, index) => {
    const date = new Date(schedule.year, schedule.month - 1, index + 1);
    const dateKey = `${schedule.year}-${String(schedule.month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
    return dayMap.get(dateKey) ?? createEmptyDaySchedule(date);
  });
}

function normalizeWorkbookCellText(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function isTruthyWorkbookFlag(value: string) {
  const normalized = value.replace(/\s+/g, "").trim().toLowerCase();
  return normalized === "1" || normalized === "y" || normalized === "yes" || normalized === "true" || normalized === "o";
}

function normalizeImportedDutyLabel(value: string) {
  const normalized = value.replace(/\s+/g, "").trim();
  if (normalized === "대기") return "뉴스대기";
  return normalized;
}

function getImportedTravelType(duty: string): AssignmentTravelType {
  return "";
}

function parseWorkbookDayMarker(row: string[]) {
  for (const cell of row) {
    const normalized = normalizeWorkbookCellText(cell);
    if (!normalized) continue;
    const matched = normalized.match(/(^|[\s\n])(\d{1,2})일(?:[\s\n(]|$)/);
    if (!matched) continue;

    const day = Number(matched[2]);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const headerName = normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !/^\d{1,2}일$/.test(line) && !/^\([^)]+\)$/.test(line))
      .filter((line) => !line.includes("일"))
      .join(" ")
      .trim();

    return {
      day,
      headerName,
    };
  }

  return null;
}

function findWorkbookHeaderIndex(rows: string[][]) {
  return rows.findIndex((row) => row.includes("이름") && row.includes("근무") && row.includes("일정"));
}

function detectHistoricalImportMonthKey(sourceText: string): HistoricalImportMonthKey | null {
  const normalized = sourceText.replace(/\s+/g, "").toLowerCase();
  if (
    normalized.includes("2025-12") ||
    normalized.includes("2025.12") ||
    normalized.includes("2025/12") ||
    normalized.includes("2025년12월") ||
    normalized.includes("12월")
  ) {
    return "2025-12";
  }
  if (
    normalized.includes("2026-01") ||
    normalized.includes("2026.01") ||
    normalized.includes("2026/01") ||
    normalized.includes("2026-1") ||
    normalized.includes("2026.1") ||
    normalized.includes("2026/1") ||
    normalized.includes("2026년1월") ||
    normalized.includes("1월")
  ) {
    return "2026-01";
  }
  if (
    normalized.includes("2026-02") ||
    normalized.includes("2026.02") ||
    normalized.includes("2026/02") ||
    normalized.includes("2026-2") ||
    normalized.includes("2026.2") ||
    normalized.includes("2026/2") ||
    normalized.includes("2026년2월") ||
    normalized.includes("2월")
  ) {
    return "2026-02";
  }
  if (
    normalized.includes("2026-03") ||
    normalized.includes("2026.03") ||
    normalized.includes("2026/03") ||
    normalized.includes("2026-3") ||
    normalized.includes("2026.3") ||
    normalized.includes("2026/3") ||
    normalized.includes("2026년3월") ||
    normalized.includes("3월")
  ) {
    return "2026-03";
  }
  return null;
}

function buildImportedMonthData(
  rows: string[][],
  year: number,
  month: number,
): { schedule: GeneratedSchedule; monthEntries: Record<string, ScheduleAssignmentEntry> } {
  const headerIndex = findWorkbookHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error("엑셀에서 `이름 / 근무 / 일정` 헤더를 찾지 못했습니다.");
  }

  const headerRow = rows[headerIndex] ?? [];
  const nameIndex = headerRow.indexOf("이름");
  const dutyIndex = headerRow.indexOf("근무");
  const clockInIndex = headerRow.indexOf("출근");
  const clockOutIndex = headerRow.indexOf("퇴근");
  const scheduleIndex = headerRow.indexOf("일정");
  const exclusiveVideoIndex = headerRow.indexOf("영상 단독");

  if (nameIndex < 0 || dutyIndex < 0 || scheduleIndex < 0) {
    throw new Error("엑셀 필수 열(`이름 / 근무 / 일정`)이 없습니다.");
  }

  const lastDay = new Date(year, month, 0).getDate();
  const importedRows: ImportedWorkbookRow[] = [];
  let currentDay = 0;
  let currentHeaderName = "";

  rows.slice(headerIndex + 1).forEach((row) => {
    const normalizedRow = row.map(normalizeWorkbookCellText);
    const marker = parseWorkbookDayMarker(normalizedRow);
    if (marker) {
      currentDay = marker.day;
      if (marker.headerName) {
        currentHeaderName = marker.headerName;
      }
    }

    if (!currentDay || currentDay > lastDay) return;

    const name = normalizeWorkbookCellText(normalizedRow[nameIndex]);
    const rawDuty = normalizeWorkbookCellText(normalizedRow[dutyIndex]);
    const schedule = normalizeWorkbookCellText(normalizedRow[scheduleIndex]);
    const clockIn = clockInIndex >= 0 ? normalizeWorkbookCellText(normalizedRow[clockInIndex]) : "";
    const clockOut = clockOutIndex >= 0 ? normalizeWorkbookCellText(normalizedRow[clockOutIndex]) : "";
    const exclusiveVideo = exclusiveVideoIndex >= 0 ? isTruthyWorkbookFlag(normalizedRow[exclusiveVideoIndex]) : false;

    if (!name && !rawDuty && !schedule && !clockIn && !clockOut) return;
    if (!name) return;

    const duty = normalizeImportedDutyLabel(rawDuty);
    importedRows.push({
      day: currentDay,
      headerName: currentHeaderName,
      name,
      duty,
      clockIn,
      clockOut,
      schedule,
      exclusiveVideo,
      travelType: getImportedTravelType(duty),
    });
  });

  if (importedRows.length === 0) {
    throw new Error("엑셀에서 가져올 일정배정 행을 찾지 못했습니다.");
  }

  const standardCategories = new Set(["조근", "일반", "연장", "석근", "야근", "제크", "휴가", "주말조근", "주말일반근무", "뉴스대기"]);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthEntries: Record<string, ScheduleAssignmentEntry> = {};
  const days = Array.from({ length: lastDay }, (_, index) => createEmptyDaySchedule(new Date(year, month - 1, index + 1)));

  importedRows.forEach((item) => {
    const day = days[item.day - 1];
    if (!day) return;

    if (item.headerName && !day.headerName) {
      day.headerName = item.headerName;
    }

    const category = item.duty;
    const nextNames = day.assignments[category] ?? [];
    const rowIndex = nextNames.length;
    day.assignments[category] = [...nextNames, item.name];

    const rowKey = createAssignmentRowKey(day.dateKey, category, rowIndex, item.name);
    const baseTimes = getScheduleAssignmentBaseTimes(category, day.dateKey, day);
    const normalizedClockIn = formatManualTime(item.clockIn);
    const normalizedClockOut = formatManualTime(item.clockOut);
    const clockInText = normalizedClockIn || baseTimes?.clockInText || "";
    const clockOutText = normalizedClockOut || baseTimes?.clockOutText || "";

    monthEntries[rowKey] = {
      ...createDefaultScheduleAssignmentEntry(),
      clockIn: clockInText,
      clockInConfirmed: false,
      clockOut: clockOutText,
      clockOutConfirmed: false,
      schedules: item.schedule ? [item.schedule] : [""],
      travelType: item.travelType,
      exclusiveVideo: [item.exclusiveVideo],
    };
  });

  days.forEach((day) => {
    day.manualExtras = Object.keys(day.assignments).filter((category) => !standardCategories.has(category));
    if (day.assignments["휴가"]?.length) {
      day.vacations = [...day.assignments["휴가"]];
    }
  });

  const nextStartDate = new Date(year, month, 1);

  return {
    schedule: {
      year,
      month,
      monthKey,
      days,
      nextPointers: { ...defaultPointers },
      nextStartDate: `${nextStartDate.getFullYear()}-${String(nextStartDate.getMonth() + 1).padStart(2, "0")}-${String(nextStartDate.getDate()).padStart(2, "0")}`,
    },
    monthEntries,
  };
}

function ScheduleDeleteConfirmButton({
  onConfirm,
}: {
  onConfirm: () => void;
}) {
  return (
    <button
      type="button"
      className="btn"
      style={{ padding: "3px 6px", fontSize: 11 }}
      onClick={() => {
        const ok = window.confirm("삭제하시겠습니까?");
        if (!ok) return;
        onConfirm();
      }}
    >
      삭제
    </button>
  );
}

export function ScheduleAssignmentPage() {
  const session = getSession();
  const sessionUserId = session?.id ?? null;
  const [schedules, setSchedules] = useState(() => getTeamLeadSchedules());
  const [store, setStore] = useState<ScheduleAssignmentDataStore>({ entries: {}, rows: {} });
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [activeTimeField, setActiveTimeField] = useState<string | null>(null);
  const [editingDayRows, setEditingDayRows] = useState<Record<string, ScheduleAssignmentDayRows>>({});
  const [editingTripTag, setEditingTripTag] = useState<{ tripTagId: string; rowKey: string; value: string } | null>(null);
  const [importMessage, setImportMessage] = useState<ImportMessage | null>(null);
  const [cellLocks, setCellLocks] = useState<Record<string, ScheduleAssignmentCellLockRow>>({});
  const [cellLockClock, setCellLockClock] = useState(() => Date.now());
  const [scheduleInputLeaders, setScheduleInputLeaders] = useState<Record<string, ScheduleAssignmentInputLeader>>({});
  const todayCardRef = useRef<HTMLElement | null>(null);
  const dayCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const autoScrolledMonthKeyRef = useRef<string | null>(null);
  const jumpToTodayPendingRef = useRef(false);
  const lastFocusRefreshAtRef = useRef(0);
  const pendingAssignmentWritesRef = useRef(0);
  const deferredRealtimeRefreshRef = useRef(false);
  const deferredRealtimeMonthKeysRef = useRef<Set<string>>(new Set());
  const editingDayRowsRef = useRef<Record<string, ScheduleAssignmentDayRows>>({});
  const editingTripTagRef = useRef<{ tripTagId: string; rowKey: string; value: string } | null>(null);
  const cellLocksRef = useRef<Record<string, ScheduleAssignmentCellLockRow>>({});
  const cellLockFeatureAvailableRef = useRef(false);
  const ownedCellLockRef = useRef<{
    cellKey: string;
    claimToken: string;
    monthKey: string;
    dateKey: string;
    rowKey: string;
    fieldKey: string;
  } | null>(null);
  const cellLockRenewTimerRef = useRef<number | null>(null);
  const scheduleInputLeadersRef = useRef<Record<string, ScheduleAssignmentInputLeader>>({});
  const scheduleInputPresenceChannelRef = useRef<PortalRealtimeChannel | null>(null);
  const ownedScheduleInputClaimRef = useRef<{ cellKey: string; claimedAt: number } | null>(null);
  const scheduleInputPresenceMutationRef = useRef<Promise<void>>(Promise.resolve());
  const scheduleInputLatestStateRef = useRef<Record<string, ScheduleAssignmentInputBroadcastPayload>>({});
  const scheduleInputPresenceSubscribedRef = useRef(false);
  const pendingScheduleInputBroadcastRef = useRef<ScheduleAssignmentInputBroadcastPayload | null>(null);
  const refreshSchedulesRef = useRef<null | (() => Promise<void>)>(null);
  const refreshAssignmentsRef = useRef<null | (() => Promise<void>)>(null);
  const flushDeferredRefreshRef = useRef<() => void>(() => {});
  const selectedMonthKeyRef = useRef("");
  const todayDateKey = useMemo(() => getTodayDateKey(), []);
  const todayMonthKey = useMemo(() => getTodayMonthKey(), []);

  flushDeferredRefreshRef.current = () => {
    if (!deferredRealtimeRefreshRef.current) return;
    if (pendingAssignmentWritesRef.current > 0) return;
    if (Object.keys(editingDayRowsRef.current).length > 0) return;
    if (editingTripTagRef.current) return;
    const refreshAssignments = refreshAssignmentsRef.current;
    if (!refreshAssignments) return;
    deferredRealtimeRefreshRef.current = false;
    deferredRealtimeMonthKeysRef.current.clear();
    lastFocusRefreshAtRef.current = Date.now();
    void refreshAssignments();
  };

  useEffect(() => {
    editingDayRowsRef.current = editingDayRows;
    flushDeferredRefreshRef.current();
  }, [editingDayRows]);

  useEffect(() => {
    editingTripTagRef.current = editingTripTag;
    flushDeferredRefreshRef.current();
  }, [editingTripTag]);

  useEffect(() => {
    selectedMonthKeyRef.current = selectedMonthKey;
  }, [selectedMonthKey]);

  useEffect(() => {
    cellLocksRef.current = cellLocks;
  }, [cellLocks]);

  useEffect(() => {
    scheduleInputLeadersRef.current = scheduleInputLeaders;
  }, [scheduleInputLeaders]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCellLockClock(Date.now());
    }, CELL_LOCK_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const getActiveCellLock = (
    monthKey: string,
    dateKey: string,
    rowKey: string,
    fieldKey: string,
    now = cellLockClock,
  ) => {
    const cellKey = createScheduleAssignmentCellLockKey(monthKey, dateKey, rowKey, fieldKey);
    const lock = cellLocksRef.current[cellKey];
    if (!isScheduleAssignmentCellLockActive(lock, now)) {
      return { cellKey, lock: null as ScheduleAssignmentCellLockRow | null };
    }
    return { cellKey, lock };
  };

  const clearCellLockRenewTimer = () => {
    if (cellLockRenewTimerRef.current) {
      window.clearInterval(cellLockRenewTimerRef.current);
      cellLockRenewTimerRef.current = null;
    }
  };

  const upsertCellLock = (lock: ScheduleAssignmentCellLockRow) => {
    setCellLocks((current) => ({
      ...current,
      [lock.cell_key]: lock,
    }));
  };

  const removeCellLock = (cellKey: string) => {
    setCellLocks((current) => {
      if (!current[cellKey]) return current;
      const next = { ...current };
      delete next[cellKey];
      return next;
    });
  };

  const handleCellLockBlocked = (lock: ScheduleAssignmentCellLockRow | null | undefined) => {
    setImportMessage({
      tone: "warn",
      text: getScheduleAssignmentCellLockBlockedMessage(lock),
    });
  };

  const releaseOwnedCellLock = async (expectedCellKey?: string) => {
    const currentLock = ownedCellLockRef.current;
    if (!currentLock) return;
    if (expectedCellKey && currentLock.cellKey !== expectedCellKey) return;

    ownedCellLockRef.current = null;
    clearCellLockRenewTimer();
    removeCellLock(currentLock.cellKey);

    if (!cellLockFeatureAvailableRef.current) return;

    try {
      const supabase = await getPortalSupabaseClient();
      await supabase.rpc("release_team_lead_schedule_assignment_cell_lock", {
        p_cell_key: currentLock.cellKey,
        p_claim_token: currentLock.claimToken,
      });
    } catch {
      // Stale locks expire automatically, so release failures can be ignored.
    }
  };

  const acquireCellLock = async (
    monthKey: string,
    dateKey: string,
    rowKey: string,
    fieldKey: string,
  ) => {
    const cellKey = createScheduleAssignmentCellLockKey(monthKey, dateKey, rowKey, fieldKey);
    const currentOwnedLock = ownedCellLockRef.current;
    if (currentOwnedLock?.cellKey === cellKey) {
      return true;
    }

    const existingLock = cellLocksRef.current[cellKey];
    if (isScheduleAssignmentCellLockActive(existingLock, Date.now()) && existingLock?.locked_by && existingLock.locked_by !== sessionUserId) {
      handleCellLockBlocked(existingLock);
      return false;
    }

    if (!cellLockFeatureAvailableRef.current || !sessionUserId) {
      return true;
    }

    if (currentOwnedLock) {
      await releaseOwnedCellLock();
    }

    const claimToken = `${sessionUserId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const supabase = await getPortalSupabaseClient();
      const { data, error } = await supabase.rpc("acquire_team_lead_schedule_assignment_cell_lock", {
        p_month_key: monthKey,
        p_date_key: dateKey,
        p_row_key: rowKey,
        p_field_key: fieldKey,
        p_claim_token: claimToken,
        p_duration_seconds: CELL_LOCK_DURATION_SECONDS,
      });

      if (error) {
        if (/acquire_team_lead_schedule_assignment_cell_lock|team_lead_schedule_assignment_cell_locks/i.test(error.message)) {
          cellLockFeatureAvailableRef.current = false;
          return true;
        }
        throw new Error(error.message);
      }

      const result = Array.isArray(data) ? (data[0] as ScheduleAssignmentCellLockRpcResult | undefined) : undefined;
      if (!result) {
        return true;
      }

      const nextLock: ScheduleAssignmentCellLockRow = {
        cell_key: result.cell_key,
        month_key: result.month_key,
        date_key: result.date_key,
        row_key: result.row_key,
        field_key: result.field_key,
        locked_by: result.locked_by,
        locked_by_name: result.locked_by_name,
        expires_at: result.expires_at,
        updated_at: result.updated_at,
      };
      upsertCellLock(nextLock);

      if (!result.ok || (result.locked_by && result.locked_by !== sessionUserId)) {
        handleCellLockBlocked(nextLock);
        return false;
      }

      ownedCellLockRef.current = {
        cellKey,
        claimToken,
        monthKey,
        dateKey,
        rowKey,
        fieldKey,
      };
      clearCellLockRenewTimer();
      cellLockRenewTimerRef.current = window.setInterval(() => {
        const ownedLock = ownedCellLockRef.current;
        if (
          !ownedLock ||
          ownedLock.cellKey !== cellKey ||
          !cellLockFeatureAvailableRef.current
        ) {
          return;
        }
        void getPortalSupabaseClient()
          .then((supabase) =>
            supabase.rpc("acquire_team_lead_schedule_assignment_cell_lock", {
              p_month_key: ownedLock.monthKey,
              p_date_key: ownedLock.dateKey,
              p_row_key: ownedLock.rowKey,
              p_field_key: ownedLock.fieldKey,
              p_claim_token: ownedLock.claimToken,
              p_duration_seconds: CELL_LOCK_DURATION_SECONDS,
            }),
          )
          .then(({ data, error }) => {
            if (error) return;
            const result = Array.isArray(data) ? (data[0] as ScheduleAssignmentCellLockRpcResult | undefined) : undefined;
            if (!result) return;
            upsertCellLock({
              cell_key: result.cell_key,
              month_key: result.month_key,
              date_key: result.date_key,
              row_key: result.row_key,
              field_key: result.field_key,
              locked_by: result.locked_by,
              locked_by_name: result.locked_by_name,
              expires_at: result.expires_at,
              updated_at: result.updated_at,
            });
          })
          .catch(() => {
            // Ignore transient heartbeat failures and rely on the next renewal or expiry.
          });
      }, CELL_LOCK_RENEW_INTERVAL_MS);
      return true;
    } catch (error) {
      setImportMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "입력 잠금 상태를 확인하지 못했습니다.",
      });
      return false;
    }
  };

  const focusLockableField = (
    monthKey: string,
    dateKey: string,
    rowKey: string,
    fieldKey: string,
    element: HTMLInputElement | null,
    options?: {
      onAcquired?: () => void;
      selectText?: boolean;
    },
  ) => {
    const currentLock = getActiveCellLock(monthKey, dateKey, rowKey, fieldKey, Date.now()).lock;
    if (currentLock?.locked_by && currentLock.locked_by !== sessionUserId) {
      handleCellLockBlocked(currentLock);
      return false;
    }

    options?.onAcquired?.();
    if (options?.selectText) {
      element?.select();
    }

    void acquireCellLock(monthKey, dateKey, rowKey, fieldKey).then((acquired) => {
      if (!acquired) {
        return;
      }
    });

    return true;
  };

  const syncScheduleInputPresence = async (channel: PortalRealtimeChannel) => {
    const payload: ScheduleAssignmentInputPresencePayload = {
      userId: sessionUserId ?? "",
      userName: session?.username ?? "다른 사용자",
      monthKey: selectedMonthKeyRef.current,
      activeCellKey: ownedScheduleInputClaimRef.current?.cellKey ?? null,
      claimedAt: ownedScheduleInputClaimRef.current?.claimedAt ?? null,
      updatedAt: Date.now(),
    };
    await channel.track(payload);
  };

  const reconcileOwnedScheduleInputClaim = (
    nextLeaders: Record<string, ScheduleAssignmentInputLeader>,
  ) => {
    const ownedClaim = ownedScheduleInputClaimRef.current;
    if (!ownedClaim) return;

    const activeLeader = nextLeaders[ownedClaim.cellKey];
    if (activeLeader?.userId === sessionUserId) return;

    ownedScheduleInputClaimRef.current = null;
    if (
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.dataset.scheduleInputCellKey === ownedClaim.cellKey
    ) {
      document.activeElement.blur();
    }
  };

  const commitScheduleInputLeaders = (
    nextLeaders: Record<string, ScheduleAssignmentInputLeader>,
    options?: { immediate?: boolean },
  ) => {
    if (areScheduleInputLeadersEqual(scheduleInputLeadersRef.current, nextLeaders)) {
      reconcileOwnedScheduleInputClaim(nextLeaders);
      return;
    }

    scheduleInputLeadersRef.current = nextLeaders;
    const apply = () => setScheduleInputLeaders(nextLeaders);
    if (options?.immediate) {
      flushSync(apply);
    } else {
      apply();
    }
    reconcileOwnedScheduleInputClaim(nextLeaders);
  };

  const runScheduleInputPresenceMutation = async (
    handler: (channel: PortalRealtimeChannel) => Promise<void>,
  ) => {
    const channel = scheduleInputPresenceChannelRef.current;
    if (!channel || !sessionUserId) return;

    const nextMutation = scheduleInputPresenceMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        if (scheduleInputPresenceChannelRef.current !== channel) return;
        await handler(channel);
      });

    scheduleInputPresenceMutationRef.current = nextMutation.catch(() => undefined);
    await nextMutation;
  };

  const applyScheduleInputState = (
    payload: ScheduleAssignmentInputBroadcastPayload,
    options?: { immediate?: boolean },
  ) => {
    const currentState = scheduleInputLatestStateRef.current[payload.userId];
    if (currentState && currentState.updatedAt > payload.updatedAt) return;

    scheduleInputLatestStateRef.current = {
      ...scheduleInputLatestStateRef.current,
      [payload.userId]: payload,
    };

    if (payload.monthKey !== selectedMonthKeyRef.current) return;

    const nextLeaders = Object.fromEntries(
      Object.entries(scheduleInputLeadersRef.current).filter(([, leader]) => leader.userId !== payload.userId),
    );

    if (payload.cellKey && payload.claimedAt) {
      const candidateLeader: ScheduleAssignmentInputLeader = {
        cellKey: payload.cellKey,
        userId: payload.userId,
        userName: payload.userName,
        claimedAt: payload.claimedAt,
        updatedAt: payload.updatedAt,
      };
      nextLeaders[payload.cellKey] = getPreferredScheduleInputLeader(
        nextLeaders[payload.cellKey],
        candidateLeader,
      ) ?? candidateLeader;
    }

    commitScheduleInputLeaders(nextLeaders, options);
  };

  const broadcastScheduleInputState = async (
    channel: PortalRealtimeChannel,
    payload: ScheduleAssignmentInputBroadcastPayload,
  ) => {
    if (!scheduleInputPresenceSubscribedRef.current) {
      pendingScheduleInputBroadcastRef.current = payload;
      return;
    }

    await channel.send({
      type: "broadcast",
      event: "schedule-input-state",
      payload,
    });
  };

  const clearOwnedScheduleInputClaim = async () => {
    const previousClaim = ownedScheduleInputClaimRef.current;
    ownedScheduleInputClaimRef.current = null;
    if (previousClaim) {
      const nextLeaders = { ...scheduleInputLeadersRef.current };
      const leader = nextLeaders[previousClaim.cellKey];
      if (leader?.userId === sessionUserId) {
        delete nextLeaders[previousClaim.cellKey];
        commitScheduleInputLeaders(nextLeaders, { immediate: true });
      }
    }

    if (!previousClaim || !sessionUserId) return;
    const payload: ScheduleAssignmentInputBroadcastPayload = {
      userId: sessionUserId,
      userName: session?.username ?? "다른 사용자",
      monthKey: selectedMonthKeyRef.current,
      cellKey: null,
      claimedAt: null,
      updatedAt: Date.now(),
    };
    applyScheduleInputState(payload);
    const channel = scheduleInputPresenceChannelRef.current;
    if (channel) {
      void broadcastScheduleInputState(channel, payload).catch(() => undefined);
    }
    try {
      await runScheduleInputPresenceMutation(async (channel) => {
        await syncScheduleInputPresence(channel);
      });
    } catch {
      // Ignore transient presence sync failures.
    }
  };

  const claimScheduleInput = async (cellKey: string) => {
    if (ownedScheduleInputClaimRef.current?.cellKey === cellKey) {
      return true;
    }

    const currentLeader = scheduleInputLeadersRef.current[cellKey];
    if (currentLeader && currentLeader.userId !== sessionUserId) {
      return false;
    }

    const previousClaim = ownedScheduleInputClaimRef.current;
    const claimedAt = Date.now();
    ownedScheduleInputClaimRef.current = { cellKey, claimedAt };
    if (!sessionUserId) {
      return true;
    }

    const nextLeaders = { ...scheduleInputLeadersRef.current };
    if (previousClaim) {
      const previousLeader = nextLeaders[previousClaim.cellKey];
      if (previousLeader?.userId === sessionUserId) {
        delete nextLeaders[previousClaim.cellKey];
      }
    }

    nextLeaders[cellKey] = getPreferredScheduleInputLeader(nextLeaders[cellKey], {
      cellKey,
      userId: sessionUserId,
      userName: session?.username ?? "다른 사용자",
      claimedAt,
      updatedAt: claimedAt,
    }) ?? {
      cellKey,
      userId: sessionUserId,
      userName: session?.username ?? "다른 사용자",
      claimedAt,
      updatedAt: claimedAt,
    };
    commitScheduleInputLeaders(nextLeaders, { immediate: true });

    const payload: ScheduleAssignmentInputBroadcastPayload = {
      userId: sessionUserId,
      userName: session?.username ?? "다른 사용자",
      monthKey: selectedMonthKeyRef.current,
      cellKey,
      claimedAt,
      updatedAt: Date.now(),
    };
    applyScheduleInputState(payload);
    const channel = scheduleInputPresenceChannelRef.current;
    if (channel) {
      void broadcastScheduleInputState(channel, payload).catch(() => undefined);
    }

    try {
      await runScheduleInputPresenceMutation(async (channel) => {
        await syncScheduleInputPresence(channel);
      });
      return true;
    } catch {
      if (ownedScheduleInputClaimRef.current?.cellKey === cellKey) {
        ownedScheduleInputClaimRef.current = null;
      }
      const currentState = scheduleInputLatestStateRef.current[sessionUserId];
      if (currentState?.updatedAt === payload.updatedAt) {
        const nextStates = { ...scheduleInputLatestStateRef.current };
        delete nextStates[sessionUserId];
        scheduleInputLatestStateRef.current = nextStates;
      }
      const nextLeaders = { ...scheduleInputLeadersRef.current };
      const leader = nextLeaders[cellKey];
      if (leader?.userId === sessionUserId) {
        delete nextLeaders[cellKey];
        commitScheduleInputLeaders(nextLeaders, { immediate: true });
      }
      return false;
    }
  };

  const getStickyHeaderOffset = () => {
    if (typeof window === "undefined") return 24;
    if (window.innerWidth <= 960) return 24;

    const selectors = [".portal-header-shell", ".desk-shell-sticky"];
    return selectors.reduce((offset, selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return offset;

      const computed = window.getComputedStyle(element);
      if (computed.display === "none" || computed.visibility === "hidden" || computed.position !== "sticky") {
        return offset;
      }

      return offset + element.getBoundingClientRect().height;
    }, 20);
  };

  const scrollCardToTop = (target: HTMLElement | null, behavior: ScrollBehavior) => {
    if (!target) return;
    const stickyOffset = getStickyHeaderOffset();
    const targetTop = Math.max(0, window.scrollY + target.getBoundingClientRect().top - stickyOffset);
    window.scrollTo({ top: targetTop, behavior });
  };

  const scrollTodayCardToTop = (behavior: ScrollBehavior) => {
    scrollCardToTop(todayCardRef.current, behavior);
  };

  useEffect(() => {
    const buildRealtimeActorLabel = (actorId: string | null | undefined) => {
      if (!actorId) return "다른 데스크 사용자";
      const session = getSession();
      if (session?.id === actorId) {
        return `${session.username}`;
      }
      const matchedUser = getUsers().find((user) => user.id === actorId);
      return matchedUser?.username || "다른 데스크 사용자";
    };

    const syncFromCache = () => {
      const nextSchedules = getTeamLeadSchedules();
      setSchedules(nextSchedules);
      setStore(getScheduleAssignmentStore());
      setSelectedMonthKey((current) =>
        nextSchedules.some((schedule) => schedule.monthKey === current)
          ? current
          : nextSchedules.some((schedule) => schedule.monthKey === todayMonthKey)
            ? todayMonthKey
            : nextSchedules[0]?.monthKey || "",
        );
      setEditingDayRows({});
    };
    const refreshAssignmentStore = async () => {
      await refreshTeamLeadState();
      syncFromCache();
    };
    const refreshSchedules = async () => {
      await Promise.all([refreshScheduleState(), refreshPublishedSchedules(), refreshTeamLeadState()]);
      syncFromCache();
    };
    refreshSchedulesRef.current = refreshSchedules;
    refreshAssignmentsRef.current = refreshAssignmentStore;
    const hasBlockingDrafts = () =>
      pendingAssignmentWritesRef.current > 0 ||
      Object.keys(editingDayRowsRef.current).length > 0 ||
      Boolean(editingTripTagRef.current);
    const refreshSchedulesOnFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      if (hasBlockingDrafts()) {
        deferredRealtimeRefreshRef.current = true;
        return;
      }
      void refreshSchedules();
    };
    const onRealtimeAssignmentChange = (payload: ScheduleAssignmentRealtimePayload) => {
      const monthKey = payload.new.month_key || payload.old.month_key || "";
      const actorId = payload.new.updated_by ?? payload.old.updated_by ?? null;
      const actorLabel = buildRealtimeActorLabel(actorId);
      const isOwnChange = actorId !== null && actorId === getSession()?.id;

      if (isOwnChange) {
        return;
      }

      if (hasBlockingDrafts()) {
        deferredRealtimeRefreshRef.current = true;
        if (monthKey) {
          deferredRealtimeMonthKeysRef.current.add(monthKey);
        }
        if (monthKey && monthKey === selectedMonthKeyRef.current) {
          setImportMessage({
            tone: "warn",
            text: `${actorLabel}님이 ${monthKey} 일정배정을 먼저 수정했습니다. 현재 입력이 저장되는 즉시 최신 내용으로 자동 동기화합니다.`,
          });
        }
        return;
      }
      lastFocusRefreshAtRef.current = Date.now();
      if (monthKey && monthKey === selectedMonthKeyRef.current) {
        setImportMessage({
          tone: "note",
          text: `${actorLabel}님이 ${monthKey} 일정배정을 수정해 최신 내용으로 자동 반영했습니다.`,
        });
      }
      void refreshAssignmentStore();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setImportMessage({ tone: "warn", text: detail.message });
    };
    let cancelled = false;
    let cleanupRealtime: (() => void) | null = null;
    syncFromCache();
    void refreshSchedules().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
    });
    void getPortalSupabaseClient()
      .then((supabase) => {
        if (cancelled) return;
        const channel = supabase
          .channel("team-lead-schedule-assignment-watch")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "team_lead_schedule_assignments",
            },
            onRealtimeAssignmentChange,
          )
          .subscribe();
        cleanupRealtime = () => {
          void supabase.removeChannel(channel);
        };
      })
      .catch(() => {
        cleanupRealtime = null;
      });
    window.addEventListener("focus", refreshSchedulesOnFocus);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    window.addEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    return () => {
      cancelled = true;
        if (refreshSchedulesRef.current === refreshSchedules) {
          refreshSchedulesRef.current = null;
        }
        if (refreshAssignmentsRef.current === refreshAssignmentStore) {
          refreshAssignmentsRef.current = null;
        }
        cleanupRealtime?.();
        window.removeEventListener("focus", refreshSchedulesOnFocus);
        window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
      window.removeEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    };
  }, [todayMonthKey]);

  useEffect(() => {
    let cancelled = false;
    let cleanupRealtime: (() => void) | null = null;

    if (!selectedMonthKey || !sessionUserId) {
      setScheduleInputLeaders({});
      ownedScheduleInputClaimRef.current = null;
      return undefined;
    }

    const syncLeadersFromPresence = () => {
      const channel = scheduleInputPresenceChannelRef.current;
      if (!channel) return;

      const presenceState = channel.presenceState<ScheduleAssignmentInputPresencePayload>();
      const latestStates: Record<string, ScheduleAssignmentInputBroadcastPayload> = {
        ...scheduleInputLatestStateRef.current,
      };

      Object.entries(presenceState).forEach(([userId, entries]) => {
        const latestEntry = entries.reduce<ScheduleAssignmentInputPresencePayload | null>((current, entry) => {
          if (!current) return entry;
          const currentTimestamp = current.updatedAt ?? current.claimedAt;
          const entryTimestamp = entry.updatedAt ?? entry.claimedAt;
          if (entryTimestamp > currentTimestamp) return entry;
          return current;
        }, null);

        if (!latestEntry) return;

        const presencePayload: ScheduleAssignmentInputBroadcastPayload = {
          userId: latestEntry.userId,
          userName: latestEntry.userName,
          monthKey: latestEntry.monthKey,
          cellKey: latestEntry.activeCellKey,
          claimedAt: latestEntry.claimedAt,
          updatedAt: latestEntry.updatedAt ?? latestEntry.claimedAt,
        };
        const currentLatest = latestStates[userId];
        if (
          !currentLatest ||
          presencePayload.updatedAt >= currentLatest.updatedAt
        ) {
          latestStates[userId] = presencePayload;
        }
      });

      scheduleInputLatestStateRef.current = latestStates;

      const nextLeaders: Record<string, ScheduleAssignmentInputLeader> = {};
      Object.values(latestStates).forEach((payload) => {
        if (payload.monthKey !== selectedMonthKey || !payload.cellKey || !payload.claimedAt) {
          return;
        }

        const nextLeader: ScheduleAssignmentInputLeader = {
          cellKey: payload.cellKey,
          userId: payload.userId,
          userName: payload.userName,
          claimedAt: payload.claimedAt,
          updatedAt: payload.updatedAt,
        };

        nextLeaders[payload.cellKey] = getPreferredScheduleInputLeader(
          nextLeaders[payload.cellKey],
          nextLeader,
        ) ?? nextLeader;
      });

      commitScheduleInputLeaders(nextLeaders);
    };

    const setupPresence = async () => {
      const supabase = await getPortalSupabaseClient();
      const channel = supabase.channel(`team-lead-schedule-assignment-input-${selectedMonthKey}`, {
        config: {
          presence: {
            key: sessionUserId,
          },
        },
      });
      scheduleInputPresenceChannelRef.current = channel;

      channel
        .on("broadcast", { event: "schedule-input-state" }, ({ payload }) => {
          if (cancelled) return;
          applyScheduleInputState(payload as ScheduleAssignmentInputBroadcastPayload, { immediate: true });
        })
        .on("presence", { event: "join" }, () => {
          if (cancelled) return;
          syncLeadersFromPresence();
        })
        .on("presence", { event: "leave" }, () => {
          if (cancelled) return;
          syncLeadersFromPresence();
        })
        .on("presence", { event: "sync" }, () => {
          if (cancelled) return;
          syncLeadersFromPresence();
        })
        .subscribe(async (status) => {
          if (cancelled) return;
          if (status !== "SUBSCRIBED") {
            scheduleInputPresenceSubscribedRef.current = false;
            return;
          }
          scheduleInputPresenceSubscribedRef.current = true;
          await syncScheduleInputPresence(channel);
          const pendingPayload = pendingScheduleInputBroadcastRef.current;
          if (pendingPayload) {
            pendingScheduleInputBroadcastRef.current = null;
            await broadcastScheduleInputState(channel, pendingPayload);
          }
        });

      cleanupRealtime = () => {
        void supabase.removeChannel(channel);
      };
    };

    void setupPresence();

    return () => {
      cancelled = true;
      const channel = scheduleInputPresenceChannelRef.current;
      scheduleInputPresenceChannelRef.current = null;
      scheduleInputPresenceMutationRef.current = Promise.resolve();
      scheduleInputPresenceSubscribedRef.current = false;
      pendingScheduleInputBroadcastRef.current = null;
      scheduleInputLatestStateRef.current = {};
      setScheduleInputLeaders({});
      ownedScheduleInputClaimRef.current = null;
      if (channel) {
        void getPortalSupabaseClient().then((supabase) => supabase.removeChannel(channel));
      } else {
        cleanupRealtime?.();
      }
    };
  }, [selectedMonthKey, sessionUserId, session?.username]);

  useEffect(() => {
    let cancelled = false;
    let cleanupRealtime: (() => void) | null = null;

    if (!selectedMonthKey) {
      setCellLocks({});
      return undefined;
    }

    const syncLocks = async () => {
      if (!cellLockFeatureAvailableRef.current) {
        setCellLocks({});
        return;
      }

      const supabase = await getPortalSupabaseClient();
      try {
        const { data, error } = await supabase
          .from("team_lead_schedule_assignment_cell_locks")
          .select("cell_key, month_key, date_key, row_key, field_key, locked_by, locked_by_name, expires_at, updated_at")
          .eq("month_key", selectedMonthKey)
          .returns<ScheduleAssignmentCellLockRow[]>();

        if (cancelled) return;

        if (error) {
          if (/team_lead_schedule_assignment_cell_locks/i.test(error.message)) {
            cellLockFeatureAvailableRef.current = false;
            setCellLocks({});
            return;
          }
          throw new Error(error.message);
        }

        setCellLocks(
          Object.fromEntries((data ?? []).map((row) => [row.cell_key, row])),
        );

        const channel = supabase
          .channel(`team-lead-schedule-assignment-cell-locks-${selectedMonthKey}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "team_lead_schedule_assignment_cell_locks",
              filter: `month_key=eq.${selectedMonthKey}`,
            },
            (payload: ScheduleAssignmentCellLockRealtimePayload) => {
              const nextRow = payload.new.cell_key ? (payload.new as ScheduleAssignmentCellLockRow) : null;
              const previousRow = payload.old.cell_key ? (payload.old as ScheduleAssignmentCellLockRow) : null;
              const targetCellKey = nextRow?.cell_key ?? previousRow?.cell_key;
              if (!targetCellKey) return;

              if (payload.eventType === "DELETE" || !nextRow) {
                removeCellLock(targetCellKey);
                return;
              }

              upsertCellLock(nextRow);

              if (
                previousRow?.locked_by === sessionUserId &&
                nextRow.locked_by &&
                nextRow.locked_by !== sessionUserId &&
                ownedCellLockRef.current?.cellKey === nextRow.cell_key
              ) {
                ownedCellLockRef.current = null;
                clearCellLockRenewTimer();
                handleCellLockBlocked(nextRow);
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
              }
            },
          )
          .subscribe();

        cleanupRealtime = () => {
          void supabase.removeChannel(channel);
        };
      } catch (error) {
        if (cancelled) return;
        setImportMessage({
          tone: "warn",
          text: error instanceof Error ? error.message : "입력 잠금 상태를 불러오지 못했습니다.",
        });
      }
    };

    void syncLocks();

    return () => {
      cancelled = true;
      cleanupRealtime?.();
      void releaseOwnedCellLock();
    };
  }, [selectedMonthKey, sessionUserId]);

  useEffect(() => {
    const releaseForBlur = () => {
      void releaseOwnedCellLock();
      void clearOwnedScheduleInputClaim();
    };

    window.addEventListener("blur", releaseForBlur);
    return () => {
      window.removeEventListener("blur", releaseForBlur);
    };
  }, []);

  useEffect(() => {
    const releaseScheduleInputClaimIfNeeded = (target: EventTarget | null) => {
      const ownedClaim = ownedScheduleInputClaimRef.current;
      if (!ownedClaim) return;

      const targetElement = target instanceof Element ? target : null;
      const targetScheduleInput = targetElement?.closest<HTMLInputElement>("[data-schedule-input-cell-key]") ?? null;
      if (targetScheduleInput?.dataset.scheduleInputCellKey === ownedClaim.cellKey) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement &&
        activeElement.dataset.scheduleInputCellKey === ownedClaim.cellKey
      ) {
        return;
      }

      void clearOwnedScheduleInputClaim();
    };

    const onPointerDownCapture = (event: PointerEvent) => {
      releaseScheduleInputClaimIfNeeded(event.target);
    };

    const onFocusIn = (event: FocusEvent) => {
      releaseScheduleInputClaimIfNeeded(event.target);
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  useEffect(() => {
    setEditingDayRows({});
  }, [selectedMonthKey]);

  const selectedMonth = useMemo(() => schedules.find((schedule) => schedule.monthKey === selectedMonthKey) ?? null, [schedules, selectedMonthKey]);
  const monthEntries = store.entries[selectedMonthKey] ?? {};
  const monthRows = store.rows[selectedMonthKey] ?? {};
  const monthDays = useMemo(() => buildMonthDays(selectedMonth), [selectedMonth]);
  const selectedMonthDayIndex = useMemo(
    () => new Map(monthDays.map((day) => [day.dateKey, day])),
    [monthDays],
  );
  const visibleTripTagMap = useMemo(() => getScheduleAssignmentVisibleTripTagMap(), [schedules, store]);

  useEffect(() => {
    if (selectedMonthKey !== todayMonthKey) return;
    if (!monthDays.some((day) => day.dateKey === todayDateKey)) return;
    if (autoScrolledMonthKeyRef.current === selectedMonthKey && !jumpToTodayPendingRef.current) return;

    autoScrolledMonthKeyRef.current = selectedMonthKey;

    const timer = window.setTimeout(() => {
      scrollTodayCardToTop(jumpToTodayPendingRef.current ? "smooth" : "auto");
      jumpToTodayPendingRef.current = false;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [monthDays, selectedMonthKey, todayDateKey, todayMonthKey]);

  const jumpToToday = () => {
    autoScrolledMonthKeyRef.current = null;
    jumpToTodayPendingRef.current = true;
    if (selectedMonthKey !== todayMonthKey) {
      setSelectedMonthKey(todayMonthKey);
      return;
    }
    window.setTimeout(() => {
      scrollTodayCardToTop("smooth");
      jumpToTodayPendingRef.current = false;
    }, 0);
  };

  const scrollToPageTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateStore = (
    recipe: (current: ScheduleAssignmentDataStore) => ScheduleAssignmentDataStore,
    monthKeys:
      | string[]
      | ((next: ScheduleAssignmentDataStore) => string[]) = [selectedMonthKey],
  ) => {
    setStore((current) => {
      const next = recipe(current);
      const touchedMonthKeys = Array.from(
        new Set(
          (typeof monthKeys === "function" ? monthKeys(next) : monthKeys).filter(Boolean),
        ),
      );
      pendingAssignmentWritesRef.current += 1;
      saveScheduleAssignmentStore(next, touchedMonthKeys).finally(() => {
        pendingAssignmentWritesRef.current = Math.max(0, pendingAssignmentWritesRef.current - 1);
        flushDeferredRefreshRef.current();
      });
      return next;
    });
  };

  const updateMonthEntry = (rowKey: string, recipe: (entry: ScheduleAssignmentEntry) => ScheduleAssignmentEntry) => {
    updateStore((current) => {
      const currentMonth = current.entries[selectedMonthKey] ?? {};
      const currentEntry = currentMonth[rowKey] ?? createDefaultScheduleAssignmentEntry();
      return {
        ...current,
        entries: {
          ...current.entries,
          [selectedMonthKey]: {
            ...currentMonth,
            [rowKey]: recipe(currentEntry),
          },
        },
      };
    });
  };

  const updateDayRows = (dateKey: string, recipe: (dayRows: ScheduleAssignmentDayRows) => ScheduleAssignmentDayRows) => {
    updateStore((current) => {
      const currentMonthRows = current.rows[selectedMonthKey] ?? {};
      const currentDayRows = currentMonthRows[dateKey] ?? createDefaultScheduleAssignmentDayRows();
      return {
        ...current,
        rows: {
          ...current.rows,
          [selectedMonthKey]: {
            ...currentMonthRows,
            [dateKey]: recipe(currentDayRows),
          },
        },
      };
    });
  };

  const updateEditingDayRows = (dateKey: string, recipe: (dayRows: ScheduleAssignmentDayRows) => ScheduleAssignmentDayRows) => {
    setEditingDayRows((current) => {
      const source = current[dateKey] ?? cloneDayRows(monthRows[dateKey] ?? createDefaultScheduleAssignmentDayRows());
      return {
        ...current,
        [dateKey]: recipe(source),
      };
    });
  };

  const startPeopleEdit = (dateKey: string) => {
    setEditingDayRows((current) => ({
      ...current,
      [dateKey]: cloneDayRows(monthRows[dateKey] ?? createDefaultScheduleAssignmentDayRows()),
    }));
  };

  const cancelPeopleEdit = (dateKey: string) => {
    setEditingDayRows((current) => {
      const next = { ...current };
      delete next[dateKey];
      return next;
    });
  };

  const confirmPeopleEdit = (dateKey: string) => {
    const draft = editingDayRows[dateKey];
    if (!draft) return;
    updateDayRows(dateKey, () => sanitizeDayRows(draft));
    cancelPeopleEdit(dateKey);
  };

  const addEditingRow = (dateKey: string) => {
    updateEditingDayRows(dateKey, (dayRows) => ({
      ...dayRows,
      addedRows: [{ id: createCustomRowId(), name: "", duty: dutyOptions[0] ?? "" }, ...dayRows.addedRows],
    }));
  };

  const removeEditingRow = (dateKey: string, row: ScheduleAssignmentRow) => {
    updateEditingDayRows(dateKey, (dayRows) => {
      if (row.isCustom) {
        const customId = getCustomRowIdFromKey(row.key);
        return {
          ...dayRows,
          addedRows: dayRows.addedRows.filter((item) => item.id !== customId),
        };
      }

      return dayRows.deletedRowKeys.includes(row.key)
        ? dayRows
        : {
            ...dayRows,
            deletedRowKeys: [...dayRows.deletedRowKeys, row.key],
          };
    });
  };

  const updateEditingCustomRow = (
    dateKey: string,
    rowKey: string,
    patch: Partial<{ name: string; duty: string }>,
  ) => {
    const customId = getCustomRowIdFromKey(rowKey);
    if (!customId) return;

    updateEditingDayRows(dateKey, (dayRows) => ({
      ...dayRows,
      addedRows: dayRows.addedRows.map((item) => (item.id === customId ? { ...item, ...patch } : item)),
    }));
  };

  const createTripTag = (
    rowKey: string,
    travelType: AssignmentTravelType,
    options?: { initialLabel?: string; startEditing?: boolean },
  ) => {
    if (!travelType) {
      setImportMessage({ tone: "warn", text: "출장 태그를 만들려면 먼저 출장 종류를 선택해 주세요." });
      return;
    }
    const tripTagId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const initialLabel = options?.initialLabel?.trim() ?? "";

    updateMonthEntry(rowKey, (current) => ({
      ...current,
      travelType,
      tripTagId,
      tripTagLabel: initialLabel,
      tripTagPhase: "",
    }));
    if (options?.startEditing ?? true) {
      setEditingTripTag({ tripTagId, rowKey, value: initialLabel });
      return;
    }
    setEditingTripTag(null);
  };

  const cycleTripTag = (
    row: ScheduleAssignmentRow,
    entry: ScheduleAssignmentEntry,
    visibleTripTag: ScheduleAssignmentVisibleTripTag,
  ) => {
    const currentPhase =
      entry.tripTagId === visibleTripTag.tripTagId ? entry.tripTagPhase : "";
    const nextPhase = cycleTripTagPhase(currentPhase);

    updateMonthEntry(row.key, (current) => ({
      ...current,
      travelType: visibleTripTag.travelType || current.travelType,
      tripTagId: visibleTripTag.tripTagId,
      tripTagLabel: visibleTripTag.tripTagLabel,
      tripTagPhase: nextPhase,
    }));
  };

  const saveTripTagLabel = (tripTagId: string, nextLabel: string) => {
    const trimmedLabel = nextLabel.trim();
    if (!trimmedLabel) return;
    updateStore((current) => ({
      ...current,
      entries: Object.fromEntries(
        Object.entries(current.entries).map(([monthKey, monthEntries]) => [
          monthKey,
          Object.fromEntries(
            Object.entries(monthEntries).map(([rowKey, entry]) => [
              rowKey,
              entry.tripTagId === tripTagId ? { ...entry, tripTagLabel: trimmedLabel } : entry,
            ]),
          ),
        ]),
      ),
    }), (next) => Object.keys({ ...next.entries, ...next.rows }));
    setEditingTripTag((current) => (current?.tripTagId === tripTagId ? null : current));
  };

  const clearTripTag = (rowKey: string, tripTagId: string) => {
    setEditingTripTag((current) => (current?.tripTagId === tripTagId ? null : current));
    updateStore((current) => ({
      ...current,
      entries: Object.fromEntries(
        Object.entries(current.entries).map(([monthKey, monthEntries]) => [
          monthKey,
          Object.fromEntries(
            Object.entries(monthEntries).map(([entryRowKey, entry]) => {
              if (tripTagId && entry.tripTagId === tripTagId) {
                return [
                  entryRowKey,
                  {
                    ...entry,
                    travelType: "",
                    tripTagId: "",
                    tripTagLabel: "",
                    tripTagPhase: "",
                  },
                ];
              }
              if (monthKey === selectedMonthKey && entryRowKey === rowKey) {
                return [
                  entryRowKey,
                  {
                    ...entry,
                    travelType: "",
                    tripTagId: "",
                    tripTagLabel: "",
                    tripTagPhase: "",
                  },
                ];
              }
              return [entryRowKey, entry];
            }),
          ),
        ]),
      ),
    }), (next) => Object.keys({ ...next.entries, ...next.rows }));
  };

  const createSingleDayTripTag = (rowKey: string, currentTripTagId: string) => {
    const tripTagId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setEditingTripTag((current) => (current?.tripTagId === currentTripTagId ? null : current));
    updateStore((current) => ({
      ...current,
      entries: Object.fromEntries(
        Object.entries(current.entries).map(([monthKey, monthEntries]) => [
          monthKey,
          Object.fromEntries(
            Object.entries(monthEntries).map(([entryRowKey, entry]) => {
              if (currentTripTagId && entry.tripTagId === currentTripTagId) {
                return [
                  entryRowKey,
                  {
                    ...entry,
                    travelType: "",
                    tripTagId: "",
                    tripTagLabel: "",
                    tripTagPhase: "",
                  },
                ];
              }
              if (monthKey === selectedMonthKey && entryRowKey === rowKey) {
                return [
                  entryRowKey,
                  {
                    ...entry,
                    travelType: "당일출장",
                    tripTagId,
                    tripTagLabel: "당일출장",
                    tripTagPhase: "",
                  },
                ];
              }
              return [entryRowKey, entry];
            }),
          ),
        ]),
      ),
    }), (next) => Object.keys({ ...next.entries, ...next.rows }));
  };

  const updateRowDuty = (dateKey: string, row: ScheduleAssignmentRow, duty: string) => {
    updateDayRows(dateKey, (dayRows) => {
      if (row.isCustom) {
        const customId = row.key.split("::custom::")[1];
        return {
          ...dayRows,
          addedRows: dayRows.addedRows.map((item) => (item.id === customId ? { ...item, duty } : item)),
        };
      }
      const currentOverride = dayRows.rowOverrides[row.key] ?? { name: row.name, duty: row.duty };
      return {
        ...dayRows,
        rowOverrides: {
          ...dayRows.rowOverrides,
          [row.key]: { name: currentOverride.name, duty },
        },
      };
    });

    const normalizedDuty = duty.replace(/\s+/g, "").trim();
    if (normalizedDuty !== "국회지원" && normalizedDuty !== "법조지원") {
      return;
    }

    const baseTimes = getScheduleAssignmentBaseTimes(duty, dateKey, selectedMonthDayIndex.get(dateKey) ?? null);
    if (!baseTimes) return;

    updateMonthEntry(row.key, (current) => ({
      ...current,
      clockIn: baseTimes.clockInText,
      clockInConfirmed: false,
      clockInColor: "",
      clockOut: baseTimes.clockOutText,
      clockOutConfirmed: false,
      clockOutColor: "",
    }));
  };

  if (schedules.length === 0) {
    return <section className="panel"><div className="panel-pad"><div className="status note">게시되었거나 작성된 근무표가 없어 일정배정표를 만들 수 없습니다.</div></div></section>;
  }

  return (
    <section className="schedule-assignment-page-shell">
      <aside className="schedule-assignment-page-rail">
        <button
          type="button"
          className="btn white schedule-assignment-top-button"
          onClick={scrollToPageTop}
        >
          상단
        </button>
        <button
          type="button"
          className="btn white schedule-assignment-today-button"
          onClick={jumpToToday}
        >
          오늘
        </button>
      </aside>
      <div className="schedule-assignment-page-content">
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">일정배정</div>
              <strong style={{ fontSize: 24 }}>월별 일정배정</strong>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {schedules.map((schedule) => (
                <button key={schedule.monthKey} type="button" className={`btn ${selectedMonthKey === schedule.monthKey ? "white" : ""}`} onClick={() => setSelectedMonthKey(schedule.monthKey)}>
                  {schedule.year}년 {schedule.month}월
                </button>
              ))}
            </div>
          </div>
          <div className="status note">근무표의 해당 날짜 근무자를 자동으로 불러오고, 인원 수정과 근무유형 변경까지 이 페이지에서 직접 관리합니다.</div>
          {importMessage ? <div className={`status ${importMessage.tone}`}>{importMessage.text}</div> : null}
        </div>
      </article>

      {monthDays.map((day) => {
        const storedDayRows = monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows();
        const draftDayRows = editingDayRows[day.dateKey];
        const dayRows = draftDayRows ?? storedDayRows;
        const rows = getScheduleAssignmentRows(day, dayRows);
        const isEditingPeople = Boolean(draftDayRows);
        const vacationPeople = day.vacations.map((entry) => parseVacationEntry(entry)).filter((item) => item.name);
        const jcheckPeople = day.assignments["제크"] ?? [];
        const previousDay = selectedMonthDayIndex.get(getPreviousDateKey(day.dateKey));
        const nightOffPeople =
          day.isWeekend || day.isWeekdayHoliday || day.isCustomHoliday
            ? []
            : (previousDay?.assignments["야근"] ?? []);

        return (
          <article
            key={day.dateKey}
            className="panel"
            ref={(element) => {
              dayCardRefs.current[day.dateKey] = element;
              if (day.dateKey === todayDateKey) {
                todayCardRef.current = element;
              }
            }}
          >
            <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
              <div
                className="schedule-assignment-day-head"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, auto) minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: 4, justifySelf: "start" }}>
                  <div className="chip">{day.dateKey}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 22, color: day.dateKey === todayDateKey ? "#8fe7ff" : undefined }}>
                      {day.month}월 {day.day}일 {getWeekdayLabel(day.dow)}요일 일정배정
                    </strong>
                    {!isEditingPeople ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "8px 16px", fontSize: 15, fontWeight: 700 }}
                        onClick={() => startPeopleEdit(day.dateKey)}
                      >
                        인원 수정
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "8px 16px", fontSize: 15, fontWeight: 700 }}
                          onClick={() => addEditingRow(day.dateKey)}
                        >
                          추가
                        </button>
                        <button
                          type="button"
                          className="btn primary"
                          style={{ padding: "8px 16px", fontSize: 15, fontWeight: 700 }}
                          onClick={() => confirmPeopleEdit(day.dateKey)}
                        >
                          확인
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "8px 16px", fontSize: 15, fontWeight: 700 }}
                          onClick={() => cancelPeopleEdit(day.dateKey)}
                        >
                          취소
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
                  {vacationPeople.length > 0 || jcheckPeople.length > 0 || nightOffPeople.length > 0 ? (
                      <div className="schedule-assignment-day-badges" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
                        {vacationPeople.map((vacation, index) => (
                          <span
                            className="schedule-assignment-day-badge"
                            key={`${day.dateKey}-vacation-${vacation.type}-${vacation.name}-${index}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 5,
                              padding: "7px 16px",
                              borderRadius: 999,
                              fontSize: 16,
                              fontWeight: 800,
                              lineHeight: 1.2,
                              textAlign: "center",
                              ...vacationBadgeStyles[vacation.type],
                            }}
                          >
                            <span>{vacation.type}</span>
                            <span>{vacation.name}</span>
                          </span>
                        ))}
                        {jcheckPeople.map((name, index) => (
                          <span
                            className="schedule-assignment-day-badge"
                            key={`${day.dateKey}-jcheck-${name}-${index}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 5,
                              padding: "7px 16px",
                              borderRadius: 999,
                              border: "1px solid",
                              fontSize: 16,
                              fontWeight: 800,
                              lineHeight: 1.2,
                              textAlign: "center",
                              ...jcheckBadgeStyle,
                            }}
                          >
                            <span>제크</span>
                            <span>{name}</span>
                          </span>
                        ))}
                        {nightOffPeople.map((name, index) => (
                          <span
                            className="schedule-assignment-day-badge"
                            key={`${day.dateKey}-night-off-${name}-${index}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 5,
                              padding: "7px 16px",
                              borderRadius: 999,
                              border: "1px solid",
                              fontSize: 16,
                              fontWeight: 800,
                              lineHeight: 1.2,
                              textAlign: "center",
                              ...nightOffBadgeStyle,
                            }}
                          >
                            <span>야퇴</span>
                            <span>{name}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                <div className="schedule-assignment-day-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifySelf: "end" }}>
                  <span className="muted">{rows.length}명</span>
                </div>
              </div>

              <div className="schedule-assignment-table-wrap" style={{ overflowX: "auto" }}>
                <table className="table-like schedule-assignment-table" style={{ minWidth: 1140 }}>
                  <thead>
                    <tr>
                      <th className="schedule-assignment-name-column">이름</th>
                      <th className="schedule-assignment-duty-column">근무유형</th>
                      <th>출근</th>
                      <th>퇴근</th>
                      <th>일정 / 단독</th>
                      <th>일정갯수</th>
                      <th>출장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length > 0 ? rows.map((row) => {
                      const entry = monthEntries[row.key] ?? createDefaultScheduleAssignmentEntry();
                      const coverageScore = entry.coverageScore ?? 0;
                      const safeSchedules = getSafeSchedules(entry.schedules);
                      const safeExclusiveVideo = getSafeExclusiveVideo(entry.exclusiveVideo, safeSchedules.length);
                      const scheduleCount = safeSchedules.filter((item) => item.trim()).length;
                      const clockInFieldKey = `${row.key}:clockIn`;
                      const clockOutFieldKey = `${row.key}:clockOut`;
                      const showClockInActions = activeTimeField === clockInFieldKey || entry.clockInConfirmed;
                      const showClockOutActions = activeTimeField === clockOutFieldKey || entry.clockOutConfirmed;
                      const rowDutyOptions = row.duty && !dutyOptions.includes(row.duty) ? [row.duty, ...dutyOptions] : dutyOptions;
                      const baseTimes = getScheduleAssignmentBaseTimes(row.duty, day.dateKey, day);
                      const displayClockIn = entry.clockIn || baseTimes?.clockInText || "";
                      const displayClockOut = entry.clockOut || baseTimes?.clockOutText || "";
                      const clockInColor = getScheduleAssignmentTimeColor("clockIn", displayClockIn, row.duty, day.dateKey, day);
                      const clockOutColor = getScheduleAssignmentTimeColor("clockOut", displayClockOut, row.duty, day.dateKey, day);
                      const isDraftCustomRow =
                        isEditingPeople &&
                        row.isCustom &&
                        !storedDayRows.addedRows.some((item) => item.id === getCustomRowIdFromKey(row.key));
                      const visibleTripTag = visibleTripTagMap.get(row.key) ?? null;
                      const currentTripTagId = visibleTripTag?.tripTagId || entry.tripTagId;
                      const currentTripTagLabel = visibleTripTag?.tripTagLabel || entry.tripTagLabel;
                      const currentTripTravelType = visibleTripTag?.travelType || entry.travelType;
                      const currentTripPhase = visibleTripTag?.phase ?? entry.tripTagPhase;
                      const isEditingCurrentTripTag =
                        editingTripTag?.rowKey === row.key &&
                        editingTripTag.tripTagId === currentTripTagId;
                      const coverageNoteReadOnly = false;
                      const tripTagReadOnly = false;
                      const clockInLockState = getActiveCellLock(selectedMonthKey, day.dateKey, row.key, "clockIn");
                      const clockInLockedByOther =
                        Boolean(clockInLockState.lock?.locked_by) && clockInLockState.lock?.locked_by !== sessionUserId;
                      const clockInReadOnly = !isEditingPeople && clockInLockedByOther;
                      const clockOutLockState = getActiveCellLock(selectedMonthKey, day.dateKey, row.key, "clockOut");
                      const clockOutLockedByOther =
                        Boolean(clockOutLockState.lock?.locked_by) && clockOutLockState.lock?.locked_by !== sessionUserId;
                      const clockOutReadOnly = !isEditingPeople && clockOutLockedByOther;

                      return (
                        <tr key={row.key}>
                          <td className="schedule-assignment-name-cell" style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div
                              className="schedule-assignment-name-editor"
                              style={{
                                display: "grid",
                                gridTemplateColumns: isEditingPeople ? "38px minmax(0, 1fr) auto" : "38px minmax(0, 1fr)",
                                gap: 6,
                                alignItems: "start",
                              }}
                            >
                              <button
                                type="button"
                                className="btn"
                                title="가산점"
                                disabled={isEditingPeople}
                                onClick={() =>
                                  updateMonthEntry(row.key, (current) => {
                                    const nextCoverageScore = cycleCoverageScore(current.coverageScore ?? 0);
                                    return {
                                      ...current,
                                      coverageScore: nextCoverageScore,
                                      coverageNote: nextCoverageScore > 0 ? current.coverageNote : "",
                                    };
                                  })
                                }
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 38,
                                  minWidth: 38,
                                  height: 38,
                                  padding: 0,
                                  borderRadius: 10,
                                  border: "1px solid",
                                  fontSize: 13,
                                  fontWeight: 900,
                                  lineHeight: 1,
                                  ...getCoverageScoreStyle(coverageScore),
                                }}
                              >
                                {coverageScore === 0 ? "" : coverageScore}
                              </button>
                              {isDraftCustomRow ? (
                                <input
                                  className="field-input schedule-assignment-name-field"
                                  value={row.name}
                                  placeholder="이름 입력"
                                  style={{
                                    width: "clamp(84px, 9ch, 112px)",
                                    minWidth: 84,
                                    maxWidth: 112,
                                    textAlign: "center",
                                  }}
                                  onChange={(event) =>
                                    updateEditingCustomRow(day.dateKey, row.key, {
                                      name: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <div
                                  className="field-input schedule-assignment-name-field"
                                  style={{
                                    width: "clamp(84px, 9ch, 112px)",
                                    minWidth: 84,
                                    maxWidth: 112,
                                    textAlign: "center",
                                    justifyContent: "center",
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                >
                                  {row.name || "이름 없음"}
                                </div>
                              )}
                              {isEditingPeople ? (
                                <button
                                  type="button"
                                  className="btn"
                                  style={{
                                    padding: "0 10px",
                                    minWidth: 34,
                                    height: 38,
                                    borderColor: "rgba(248,113,113,.4)",
                                    background: "rgba(127,29,29,.18)",
                                    color: "#fecaca",
                                  }}
                                  onClick={() => removeEditingRow(day.dateKey, row)}
                                >
                                  -
                                </button>
                              ) : null}
                            {coverageScore > 0 ? (
                              <input
                                className="field-input"
                                value={entry.coverageNote}
                                placeholder="가점 사유 입력"
                                disabled={isEditingPeople}
                                readOnly={coverageNoteReadOnly}
                                style={{ gridColumn: "1 / -1" }}
                                onChange={(event) =>
                                  updateMonthEntry(row.key, (current) => ({
                                    ...current,
                                    coverageNote: event.target.value,
                                  }))
                                }
                              />
                            ) : null}
                            </div>
                          </td>
                          <td className="schedule-assignment-duty-cell" style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <select
                              className="field-select schedule-assignment-duty-select"
                              value={row.duty}
                              disabled={isEditingPeople && !isDraftCustomRow}
                              style={{ minWidth: 118, textAlign: "center", textAlignLast: "center" }}
                              onChange={(event) =>
                                isDraftCustomRow
                                  ? updateEditingCustomRow(day.dateKey, row.key, { duty: event.target.value })
                                  : updateRowDuty(day.dateKey, row, event.target.value)
                              }
                            >
                              <option value="">근무 선택</option>
                              {rowDutyOptions.map((option) => <option key={`${row.key}-${option}`} value={option}>{option}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              <input
                                disabled={isEditingPeople}
                                className="field-input"
                                type="text"
                                inputMode="numeric"
                                maxLength={5}
                                placeholder={
                                  clockInLockedByOther
                                    ? getScheduleAssignmentCellLockBlockedMessage(clockInLockState.lock)
                                    : "00:00"
                                }
                                value={displayClockIn}
                                readOnly={clockInReadOnly}
                                style={getLockAwareFieldStyle(
                                  { width: 84, minWidth: 84, textAlign: "center", ...(timeColorStyle(clockInColor) ?? {}) },
                                  clockInLockedByOther,
                                )}
                                onFocus={(event) => {
                                  if (isEditingPeople) return;
                                  if (clockInLockedByOther) {
                                    handleCellLockBlocked(clockInLockState.lock);
                                    return;
                                  }
                                  if (!entry.clockIn && baseTimes?.clockInText) {
                                    updateMonthEntry(row.key, (current) => ({
                                      ...current,
                                      clockIn: baseTimes.clockInText,
                                      clockInConfirmed: false,
                                      clockInColor: "",
                                    }));
                                  }
                                  setActiveTimeField(clockInFieldKey);
                                  event.currentTarget.select();
                                }}
                                onClick={() => setActiveTimeField(clockInFieldKey)}
                                onBlur={() => undefined}
                                onChange={(event) =>
                                  updateMonthEntry(row.key, (current) => ({
                                    ...current,
                                    clockIn: event.target.value,
                                    clockInConfirmed: false,
                                    clockInColor: "",
                                  }))
                                }
                              />
                              {showClockInActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockInConfirmed ? <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockIn || displayClockIn); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockIn: formatted, clockInConfirmed: Boolean(formatted), clockInColor: "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockIn: "", clockInColor: "", clockInConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              <input
                                disabled={isEditingPeople}
                                className="field-input"
                                type="text"
                                inputMode="numeric"
                                maxLength={5}
                                placeholder={
                                  clockOutLockedByOther
                                    ? getScheduleAssignmentCellLockBlockedMessage(clockOutLockState.lock)
                                    : "00:00"
                                }
                                value={displayClockOut}
                                readOnly={clockOutReadOnly}
                                style={getLockAwareFieldStyle(
                                  { width: 84, minWidth: 84, textAlign: "center", ...(timeColorStyle(clockOutColor) ?? {}) },
                                  clockOutLockedByOther,
                                )}
                                onFocus={(event) => {
                                  if (isEditingPeople) return;
                                  if (clockOutLockedByOther) {
                                    handleCellLockBlocked(clockOutLockState.lock);
                                    return;
                                  }
                                  if (!entry.clockOut && baseTimes?.clockOutText) {
                                    updateMonthEntry(row.key, (current) => ({
                                      ...current,
                                      clockOut: baseTimes.clockOutText,
                                      clockOutConfirmed: false,
                                      clockOutColor: "",
                                    }));
                                  }
                                  setActiveTimeField(clockOutFieldKey);
                                  event.currentTarget.select();
                                }}
                                onClick={() => setActiveTimeField(clockOutFieldKey)}
                                onBlur={() => undefined}
                                onChange={(event) =>
                                  updateMonthEntry(row.key, (current) => ({
                                    ...current,
                                    clockOut: event.target.value,
                                    clockOutConfirmed: false,
                                    clockOutColor: "",
                                  }))
                                }
                              />
                              {showClockOutActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockOutConfirmed ? <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockOut || displayClockOut); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockOut: formatted, clockOutConfirmed: Boolean(formatted), clockOutColor: "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockOut: "", clockOutColor: "", clockOutConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div
                              className="schedule-assignment-schedule-cell"
                              style={{
                                display: "grid",
                                gridTemplateColumns: visibleTripTag || entry.travelType ? "max-content minmax(0, 1fr)" : "minmax(0, 1fr)",
                                gap: 8,
                                minWidth: 560,
                                alignItems: "start",
                              }}
                            >
                              {visibleTripTag || entry.travelType || isEditingCurrentTripTag ? (
                                <div className="schedule-assignment-trip-tag" style={{ display: "grid", gap: 4, alignContent: "start", alignSelf: "start", width: "fit-content", minHeight: 32 }}>
                                  {visibleTripTag || isEditingCurrentTripTag ? (
                                    <>
                                      {isEditingCurrentTripTag ? (
                                        <>
                                          <input
                                            className="field-input"
                                            value={editingTripTag?.value ?? ""}
                                            disabled={isEditingPeople}
                                            placeholder={undefined}
                                            readOnly={tripTagReadOnly}
                                            style={{ minWidth: 0, width: 96, padding: "6px 8px", fontSize: 12, height: 32 }}
                                            onChange={(event) =>
                                              setEditingTripTag((current) =>
                                                current?.tripTagId === currentTripTagId
                                                  ? { ...current, value: event.target.value }
                                                  : current,
                                              )
                                            }
                                            onKeyDown={(event) => {
                                              if (event.key === "Enter") {
                                                event.preventDefault();
                                                if (currentTripTagId) {
                                                  saveTripTagLabel(currentTripTagId, editingTripTag?.value ?? "");
                                                }
                                              }
                                              if (event.key === "Escape") {
                                                event.preventDefault();
                                                setEditingTripTag(null);
                                              }
                                            }}
                                          />
                                          <button
                                            type="button"
                                            className="btn"
                                            disabled={isEditingPeople}
                                            style={{ padding: "4px 6px", fontSize: 11, minWidth: 42 }}
                                            onClick={() => {
                                              if (currentTripTagId) {
                                                saveTripTagLabel(currentTripTagId, editingTripTag?.value ?? "");
                                              }
                                            }}
                                          >
                                            확인
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            className="btn"
                                            disabled={isEditingPeople}
                                            onClick={() => {
                                              if (!visibleTripTag) return;
                                              if (visibleTripTag.travelType === "당일출장") return;
                                              cycleTripTag(row, entry, visibleTripTag);
                                            }}
                                            style={{
                                              padding: "7px 10px",
                                              fontSize: 12,
                                              borderRadius: 14,
                                              textAlign: "left",
                                              justifyContent: "flex-start",
                                              ...getTripTagStyle(currentTripTravelType, currentTripPhase),
                                              minWidth: 0,
                                            }}
                                          >
                                            {currentTripTagLabel}
                                            {currentTripTravelType !== "당일출장" && tripPhaseLabels[currentTripPhase]
                                              ? ` · ${tripPhaseLabels[currentTripPhase]}`
                                              : ""}
                                          </button>
                                          {currentTripTravelType !== "당일출장" ? (
                                            <button
                                              type="button"
                                              className="btn"
                                              disabled={isEditingPeople}
                                              style={{ padding: "2px 6px", fontSize: 10, whiteSpace: "nowrap", width: "fit-content" }}
                                              onClick={() => {
                                                if (!currentTripTagId) return;
                                                setEditingTripTag({ tripTagId: currentTripTagId, rowKey: row.key, value: currentTripTagLabel });
                                              }}
                                            >
                                              수정
                                            </button>
                                          ) : null}
                                        </>
                                      )}
                                    </>
                                  ) : entry.travelType ? (
                                    <button
                                      type="button"
                                      className="btn"
                                      disabled={isEditingPeople}
                                      style={{
                                        padding: "6px 8px",
                                        fontSize: 11,
                                        borderRadius: 14,
                                        ...getTripTagStyle(entry.travelType),
                                      }}
                                      onClick={() =>
                                        createTripTag(row.key, entry.travelType, {
                                          initialLabel: "",
                                          startEditing: true,
                                        })
                                      }
                                    >
                                      출장태그
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              <div style={{ display: "grid", gap: 3 }}>
                                {safeSchedules.map((schedule, index) => {
                                  const scheduleFieldKey = `schedule:${index}`;
                                  const scheduleCellKey = createScheduleAssignmentCellLockKey(
                                    selectedMonthKey,
                                    day.dateKey,
                                    row.key,
                                    scheduleFieldKey,
                                  );
                                  const scheduleLeader = scheduleInputLeaders[scheduleCellKey] ?? null;
                                  const scheduleLockedByOther =
                                    Boolean(scheduleLeader?.userId) && scheduleLeader.userId !== sessionUserId;
                                  const scheduleReadOnly = !isEditingPeople && scheduleLockedByOther;

                                  return (
                                    <div key={`${row.key}-schedule-${index}`} style={{ display: "grid", gap: 4 }}>
                                      <div className="schedule-assignment-schedule-row" style={{ display: "flex", gap: 3, alignItems: "center", minHeight: 32 }}>
                                        <input
                                          disabled={isEditingPeople}
                                          className="field-input"
                                          value={schedule}
                                          readOnly={scheduleReadOnly}
                                          style={getLockAwareFieldStyle({ flex: 1 }, scheduleLockedByOther)}
                                          data-schedule-input-cell-key={scheduleCellKey}
                                          placeholder={
                                            scheduleLockedByOther
                                              ? `${scheduleLeader?.userName || "다른 사용자"}님이 입력중...`
                                              : "일정 내용 입력"
                                          }
                                          onPointerDown={() => {
                                            if (isEditingPeople || scheduleLockedByOther) return;
                                            void claimScheduleInput(scheduleCellKey);
                                          }}
                                          onFocus={(event) => {
                                            if (isEditingPeople) return;
                                            if (scheduleLockedByOther) {
                                              setImportMessage({
                                                tone: "warn",
                                                text: `${scheduleLeader?.userName || "다른 사용자"}님이 입력중...`,
                                              });
                                              return;
                                            }
                                            void claimScheduleInput(scheduleCellKey).then((claimed) => {
                                              if (!claimed) {
                                                setImportMessage({
                                                  tone: "warn",
                                                  text: `${scheduleLeader?.userName || "다른 사용자"}님이 입력중...`,
                                                });
                                              }
                                            });
                                          }}
                                          onBlur={() => {
                                            if (ownedScheduleInputClaimRef.current?.cellKey === scheduleCellKey) {
                                              void clearOwnedScheduleInputClaim();
                                            }
                                          }}
                                          onChange={(event) =>
                                            updateMonthEntry(row.key, (current) => ({
                                              ...current,
                                              schedules: getSafeSchedules(current.schedules).map((item, itemIndex) => itemIndex === index ? event.target.value : item),
                                            }))
                                          }
                                        />
                                        <span style={{ minWidth: 30, textAlign: "center", fontSize: 11, color: "#94a3b8", letterSpacing: "-0.02em" }}>단독</span>
                                        <label style={{ display: "flex", justifyContent: "center", alignItems: "center", width: 32, minWidth: 32, height: 32, borderRadius: 10, border: safeExclusiveVideo[index] ? "1px solid rgba(132,204,22,.72)" : "1px solid rgba(203,213,225,.95)", background: safeExclusiveVideo[index] ? "rgba(217,249,157,.95)" : "#ffffff", transition: "background .18s ease, border-color .18s ease", cursor: isEditingPeople ? "default" : "pointer", overflow: "hidden", opacity: isEditingPeople ? 0.6 : 1 }}>
                                          <input disabled={isEditingPeople} type="checkbox" checked={safeExclusiveVideo[index]} style={{ appearance: "none", WebkitAppearance: "none", width: "100%", height: "100%", margin: 0, background: "transparent", border: "none", cursor: isEditingPeople ? "default" : "pointer" }} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, exclusiveVideo: getSafeExclusiveVideo(current.exclusiveVideo, getSafeSchedules(current.schedules).length).map((item, itemIndex) => itemIndex === index ? event.target.checked : item) }))} />
                                        </label>
                                        {!isEditingPeople ? (
                                          <ScheduleDeleteConfirmButton
                                            onConfirm={() =>
                                              updateMonthEntry(row.key, (current) => {
                                                const currentSchedules = getSafeSchedules(current.schedules);
                                                const nextSchedules = removeScheduleAt(currentSchedules, index);
                                                return {
                                                  ...current,
                                                  schedules: nextSchedules,
                                                  exclusiveVideo: removeExclusiveVideoAt(getSafeExclusiveVideo(current.exclusiveVideo, currentSchedules.length), index, nextSchedules.length),
                                                };
                                              })
                                            }
                                          />
                                        ) : null}
                                      </div>
                                      {scheduleLockedByOther ? (
                                        <div
                                          style={{
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: "#fca5a5",
                                            paddingLeft: 4,
                                          }}
                                        >
                                          {`${scheduleLeader?.userName || "다른 사용자"}님이 입력중...`}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                                {!isEditingPeople ? (
                                  <button type="button" className="btn" style={{ width: "fit-content", padding: "2px 6px", fontSize: 11, lineHeight: 1.1 }} onClick={() => updateMonthEntry(row.key, (current) => { const currentSchedules = getSafeSchedules(current.schedules); return { ...current, schedules: [...currentSchedules, ""], exclusiveVideo: [...getSafeExclusiveVideo(current.exclusiveVideo, currentSchedules.length), false] }; })}>+</button>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", textAlign: "center", verticalAlign: "middle" }}>{scheduleCount}</td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <select
                              disabled={isEditingPeople}
                              className="field-select"
                              value={entry.travelType}
                              style={{ minWidth: 118 }}
                              onChange={(event) => {
                                const nextTravelType = event.target.value as AssignmentTravelType;
                                if (!nextTravelType) {
                                  clearTripTag(row.key, entry.tripTagId);
                                  return;
                                }
                                if (nextTravelType === "당일출장") {
                                  createSingleDayTripTag(row.key, entry.tripTagId);
                                  return;
                                }
                                updateMonthEntry(row.key, (current) => ({ ...current, travelType: nextTravelType }));
                              }}
                            >
                              {travelOptions.map((option) => <option key={`${row.key}-${option.value || "default"}`} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7}><div className="status note">해당 날짜에는 근무자가 없습니다.</div></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          </article>
        );
      })}
      </div>
    </section>
  );
}
