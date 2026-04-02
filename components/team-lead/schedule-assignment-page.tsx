"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { defaultPointers } from "@/lib/schedule/constants";
import { parseVacationEntry } from "@/lib/schedule/engine";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { readStoredScheduleState, refreshScheduleState, saveScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";
import {
  AssignmentTimeColor,
  AssignmentTravelType,
  createDefaultScheduleAssignmentDayRows,
  createDefaultScheduleAssignmentEntry,
  getScheduleAssignmentRows,
  getScheduleAssignmentStore,
  getTeamLeadSchedules,
  refreshTeamLeadState,
  saveScheduleAssignmentStore,
  TEAM_LEAD_STORAGE_STATUS_EVENT,
  ScheduleAssignmentDataStore,
  ScheduleAssignmentDayRows,
  ScheduleAssignmentEntry,
  ScheduleAssignmentRow,
} from "@/lib/team-lead/storage";

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

const cycleClockInColor = (color: AssignmentTimeColor): AssignmentTimeColor => (color === "" ? "blue" : color === "blue" ? "red" : "");
const cycleClockOutColor = (color: AssignmentTimeColor): AssignmentTimeColor => (color === "" ? "yellow" : "");
const getSafeSchedules = (schedules: string[]) => (schedules.length > 0 ? schedules : [""]);
const removeScheduleAt = (schedules: string[], index: number) => getSafeSchedules(schedules.filter((_, i) => i !== index));
const getSafeExclusiveVideo = (values: boolean[], count: number) => Array.from({ length: Math.max(count, 1) }, (_, i) => values[i] ?? false);
const removeExclusiveVideoAt = (values: boolean[], index: number, nextCount: number) => getSafeExclusiveVideo(values.filter((_, i) => i !== index), nextCount);
const createCustomRowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const coverageScoreSteps = [0, 0.5, 1, 2] as const;
const csvTemplateHeaders = [
  "monthKey",
  "dateKey",
  "name",
  "duty",
  "clockIn",
  "clockOut",
  "schedules",
  "travelType",
  "exclusiveVideoFlags",
  "coverageScore",
  "coverageNote",
  "rowType",
] as const;

type ImportMessageTone = "ok" | "warn" | "note";

interface ImportMessage {
  tone: ImportMessageTone;
  text: string;
}

interface ScheduleAssignmentImportRow {
  monthKey: string;
  dateKey: string;
  name: string;
  duty: string;
  clockIn: string;
  clockOut: string;
  schedules: string[];
  travelType: AssignmentTravelType;
  exclusiveVideoFlags: boolean[];
  coverageScore: number;
  coverageNote: string;
  rowType: "base" | "custom";
}

interface ParsedCsvRow {
  values: string[];
  lineNumber: number;
}
const vacationBadgeStyles = {
  연차: {
    borderColor: "rgba(96,165,250,.45)",
    background: "rgba(59,130,246,.16)",
    color: "#dbeafe",
  },
  대휴: {
    borderColor: "rgba(52,211,153,.45)",
    background: "rgba(16,185,129,.16)",
    color: "#d1fae5",
  },
  근속휴가: {
    borderColor: "rgba(252,211,77,.45)",
    background: "rgba(251,191,36,.16)",
    color: "#fde68a",
  },
  건강검진: {
    borderColor: "rgba(251,113,133,.45)",
    background: "rgba(244,114,182,.14)",
    color: "#ffe4e6",
  },
  경조: {
    borderColor: "rgba(196,181,253,.45)",
    background: "rgba(167,139,250,.14)",
    color: "#ede9fe",
  },
} as const;
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

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsvRows(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  const rows: ParsedCsvRow[] = [];

  rawLines.forEach((line, index) => {
    if (!line.trim()) return;
    rows.push({
      values: parseCsvLine(line),
      lineNumber: index + 1,
    });
  });

  return rows;
}

async function parseWorksheetRows(buffer: ArrayBuffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [] as ParsedCsvRow[];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  return matrix
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row, index) => ({
      values: row.map((cell) => String(cell ?? "").trim()),
      lineNumber: index + 1,
    }));
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function getImportValue(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[normalizeHeader(key)];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

function normalizeTravelType(value: string): AssignmentTravelType {
  if (value === "국내출장" || value === "해외출장" || value === "당일출장") return value as AssignmentTravelType;
  return "";
}

function normalizeCoverageScore(value: string) {
  const parsed = Number(value.trim());
  return coverageScoreSteps.includes(parsed as (typeof coverageScoreSteps)[number]) ? parsed : 0;
}

function normalizeExclusiveVideoFlags(values: string[], scheduleCount: number) {
  const normalized = Array.from({ length: Math.max(scheduleCount, 1) }, (_, index) => {
    const value = values[index]?.trim().toLowerCase() ?? "";
    return value === "1" || value === "true" || value === "y" || value === "yes";
  });
  return normalized;
}

function parseScheduleAssignmentImportRow(parsedRow: ParsedCsvRow, headerMap: string[]) {
  const record = Object.fromEntries(
    headerMap.map((header, index) => [header, parsedRow.values[index] ?? ""]),
  );
  const monthKey = getImportValue(record, "monthKey", "month", "월");
  const dateKey = getImportValue(record, "dateKey", "date", "날짜");
  const name = getImportValue(record, "name", "person", "username", "이름");
  const duty = getImportValue(record, "duty", "근무", "근무유형");
  const clockIn = getImportValue(record, "clockIn", "출근");
  const clockOut = getImportValue(record, "clockOut", "퇴근");
  const schedules = getImportValue(record, "schedules", "schedule", "일정")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  const travelType = normalizeTravelType(getImportValue(record, "travelType", "출장"));
  const exclusiveVideoFlags = normalizeExclusiveVideoFlags(
    getImportValue(record, "exclusiveVideoFlags", "exclusiveVideo", "단독", "단독여부")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean),
    schedules.length,
  );
  const coverageScore = normalizeCoverageScore(getImportValue(record, "coverageScore", "가점"));
  const coverageNote = getImportValue(record, "coverageNote", "가점사유");
  const rowTypeValue = getImportValue(record, "rowType", "행구분").toLowerCase();

  if (!dateKey || !name) {
    throw new Error(`${parsedRow.lineNumber}행: dateKey와 name은 필수입니다.`);
  }

  const normalizedClockIn = clockIn ? formatManualTime(clockIn) : "";
  const normalizedClockOut = clockOut ? formatManualTime(clockOut) : "";

  if (normalizedClockIn === null) {
    throw new Error(`${parsedRow.lineNumber}행: clockIn 형식이 올바르지 않습니다.`);
  }
  if (normalizedClockOut === null) {
    throw new Error(`${parsedRow.lineNumber}행: clockOut 형식이 올바르지 않습니다.`);
  }

  return {
    monthKey: monthKey || dateKey.slice(0, 7),
    dateKey,
    name,
    duty,
    clockIn: normalizedClockIn,
    clockOut: normalizedClockOut,
    schedules,
    travelType,
    exclusiveVideoFlags,
    coverageScore,
    coverageNote,
    rowType: rowTypeValue === "custom" ? "custom" : "base",
  } satisfies ScheduleAssignmentImportRow;
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

function createEmptyGeneratedSchedule(monthKey: string): GeneratedSchedule {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return {
    year,
    month,
    monthKey,
    days: Array.from({ length: lastDay }, (_, index) => createEmptyDaySchedule(new Date(year, month - 1, index + 1))),
    nextPointers: { ...defaultPointers },
    nextStartDate: `${monthKey}-01`,
  };
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

function ensureImportedMonthsExist(monthKeys: string[]) {
  if (monthKeys.length === 0 || typeof window === "undefined") return false;

  const state = readStoredScheduleState();
  const existing = new Set([
    ...(state.generated ? [state.generated.monthKey] : []),
    ...state.generatedHistory.map((schedule) => schedule.monthKey),
  ]);
  const missingMonthKeys = Array.from(new Set(monthKeys.filter((monthKey) => monthKey && !existing.has(monthKey))));
  if (missingMonthKeys.length === 0) return false;

  const nextState = {
    ...state,
    generatedHistory: [...state.generatedHistory, ...missingMonthKeys.map(createEmptyGeneratedSchedule)].sort((left, right) =>
      left.monthKey.localeCompare(right.monthKey),
    ),
  };

  void saveScheduleState(nextState).catch(() => undefined);
  return true;
}

function ScheduleDeleteConfirmButton({
  onConfirm,
}: {
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return open ? (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", borderRadius: 10, border: "1px solid rgba(248,113,113,.28)", background: "rgba(127,29,29,.12)" }}>
      <span style={{ fontSize: 12, color: "#fecaca", fontWeight: 700 }}>삭제 하시겠습니까</span>
      <button
        type="button"
        className="btn"
        style={{ padding: "3px 8px", fontSize: 11 }}
        onClick={() => {
          onConfirm();
          setOpen(false);
        }}
      >
        확인
      </button>
      <button type="button" className="btn" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setOpen(false)}>
        취소
      </button>
    </div>
  ) : (
    <button type="button" className="btn" style={{ padding: "3px 6px", fontSize: 11 }} onClick={() => setOpen(true)}>
      삭제
    </button>
  );
}

export function ScheduleAssignmentPage() {
  const [schedules, setSchedules] = useState(() => getTeamLeadSchedules());
  const [store, setStore] = useState<ScheduleAssignmentDataStore>({ entries: {}, rows: {} });
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [activeTimeField, setActiveTimeField] = useState<string | null>(null);
  const [selectedDeleteRowKey, setSelectedDeleteRowKey] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<ImportMessage | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const todayCardRef = useRef<HTMLElement | null>(null);
  const autoScrolledMonthKeyRef = useRef<string | null>(null);
  const todayDateKey = useMemo(() => getTodayDateKey(), []);
  const todayMonthKey = useMemo(() => getTodayMonthKey(), []);

  useEffect(() => {
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
      setSelectedDeleteRowKey(null);
    };
    const refreshSchedules = async () => {
      await Promise.all([refreshScheduleState(), refreshPublishedSchedules(), refreshTeamLeadState()]);
      syncFromCache();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setImportMessage({ tone: "warn", text: detail.message });
    };
    syncFromCache();
    void refreshSchedules();
    window.addEventListener("focus", refreshSchedules);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    window.addEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
    window.addEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener("focus", refreshSchedules);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
      window.removeEventListener(SCHEDULE_STATE_EVENT, syncFromCache);
      window.removeEventListener(TEAM_LEAD_STORAGE_STATUS_EVENT, onStatus);
    };
  }, [todayMonthKey]);

  const selectedMonth = useMemo(() => schedules.find((schedule) => schedule.monthKey === selectedMonthKey) ?? null, [schedules, selectedMonthKey]);
  const monthEntries = store.entries[selectedMonthKey] ?? {};
  const monthRows = store.rows[selectedMonthKey] ?? {};
  const monthDays = useMemo(() => buildMonthDays(selectedMonth), [selectedMonth]);
  const selectedMonthDayIndex = useMemo(
    () => new Map(monthDays.map((day) => [day.dateKey, day])),
    [monthDays],
  );

  const dutyOptions = useMemo(() => {
    const set = new Set<string>();
    schedules.forEach((schedule) => schedule.days.forEach((day) => getScheduleAssignmentRows(day).forEach((row) => row.duty && set.add(row.duty))));
    Object.values(store.rows).forEach((month) => Object.values(month).forEach((dayRows) => {
      dayRows.addedRows.forEach((row) => row.duty && set.add(row.duty));
      Object.values(dayRows.rowOverrides).forEach((row) => row.duty && set.add(row.duty));
    }));
    return Array.from(set);
  }, [schedules, store.rows]);

  useEffect(() => {
    if (selectedMonthKey !== todayMonthKey) return;
    if (!monthDays.some((day) => day.dateKey === todayDateKey)) return;
    if (autoScrolledMonthKeyRef.current === selectedMonthKey) return;

    autoScrolledMonthKeyRef.current = selectedMonthKey;

    const timer = window.setTimeout(() => {
      todayCardRef.current?.scrollIntoView({ block: "start" });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [monthDays, selectedMonthKey, todayDateKey, todayMonthKey]);

  const updateStore = (recipe: (current: ScheduleAssignmentDataStore) => ScheduleAssignmentDataStore) => {
    setStore((current) => {
      const next = recipe(current);
      saveScheduleAssignmentStore(next);
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
  };

  const deleteRow = (dateKey: string, row: ScheduleAssignmentRow) => {
    updateDayRows(dateKey, (dayRows) => {
      if (row.isCustom) {
        const customId = row.key.split("::custom::")[1];
        return { ...dayRows, addedRows: dayRows.addedRows.filter((item) => item.id !== customId) };
      }
      return {
        ...dayRows,
        deletedRowKeys: dayRows.deletedRowKeys.includes(row.key) ? dayRows.deletedRowKeys : [...dayRows.deletedRowKeys, row.key],
      };
    });
  };

  const addRow = (dateKey: string) => {
    const name = window.prompt("추가할 사람 이름을 입력하세요.");
    const trimmedName = name?.trim() ?? "";
    if (!trimmedName) return;
    updateDayRows(dateKey, (dayRows) => ({
      ...dayRows,
      addedRows: [...dayRows.addedRows, { id: createCustomRowId(), name: trimmedName, duty: dutyOptions[0] ?? "" }],
    }));
  };

  const downloadXlsxTemplate = () => {
    void (async () => {
      const XLSX = await import("xlsx");
      const rows = [
        [...csvTemplateHeaders],
        [
          "2025-12",
          "2025-12-03",
          "홍길동",
          "조근",
          "07:30",
          "16:10",
          "국회 백브리핑|대통령실 브리핑",
          "국내출장",
          "0|1",
          "1",
          "현장 대응",
          "base",
        ],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "schedule-assignment");
      XLSX.writeFile(workbook, "schedule-assignment-template.xlsx");
      setImportMessage({
        tone: "note",
        text: "XLSX 양식을 다운로드했습니다. monthKey,dateKey,name,duty는 반드시 채워 주세요.",
      });
    })();
  };

  const importParsedRows = (parsedRows: ParsedCsvRow[]) => {
    if (parsedRows.length < 2) {
      throw new Error("헤더와 데이터가 포함된 파일이 필요합니다.");
    }

    const headerMap = parsedRows[0].values.map((value) => normalizeHeader(value));
    const validRows: ScheduleAssignmentImportRow[] = [];
    const skippedMessages: string[] = [];

    parsedRows.slice(1).forEach((row) => {
      try {
        validRows.push(parseScheduleAssignmentImportRow(row, headerMap));
      } catch (error) {
        skippedMessages.push(error instanceof Error ? error.message : `${row.lineNumber}행: 형식을 읽을 수 없습니다.`);
      }
    });

    const createdMissingMonths = ensureImportedMonthsExist(validRows.map((row) => row.monthKey));
    const nextSchedules = createdMissingMonths ? getTeamLeadSchedules() : schedules;
    const scheduleMap = new Map(nextSchedules.map((schedule) => [schedule.monthKey, schedule] as const));

    if (createdMissingMonths) {
      setSchedules(nextSchedules);
      setSelectedMonthKey((current) =>
        nextSchedules.some((schedule) => schedule.monthKey === current)
          ? current
          : nextSchedules[0]?.monthKey || "",
      );
    }

    let nextStore = store;
    let importedCount = 0;

    validRows.forEach((row) => {
      try {
        const monthSchedule = scheduleMap.get(row.monthKey);
        if (!monthSchedule) {
          throw new Error(`${row.dateKey}: 근무표가 없는 monthKey입니다. (${row.monthKey})`);
        }

        const day = monthSchedule.days.find((item) => item.dateKey === row.dateKey);
        if (!day) {
          throw new Error(`${row.dateKey}: 해당 날짜가 ${row.monthKey} 근무표에 없습니다.`);
        }

        const currentMonthRows = nextStore.rows[row.monthKey] ?? {};
        const currentDayRows = currentMonthRows[row.dateKey] ?? createDefaultScheduleAssignmentDayRows();
        const existingRows = getScheduleAssignmentRows(day, currentDayRows);
        const normalizedName = row.name.trim();
        const normalizedDuty = row.duty.trim();
        const exactMatch = existingRows.find(
          (item) => item.name.trim() === normalizedName && (!normalizedDuty || item.duty.trim() === normalizedDuty),
        );
        const sameNameRows = existingRows.filter((item) => item.name.trim() === normalizedName);

        let targetRow = exactMatch ?? (sameNameRows.length === 1 && row.rowType !== "custom" ? sameNameRows[0] : null);
        let nextDayRows = currentDayRows;

        if (!targetRow) {
          const customId = createCustomRowId();
          nextDayRows = {
            ...currentDayRows,
            addedRows: [
              ...currentDayRows.addedRows,
              { id: customId, name: normalizedName, duty: normalizedDuty },
            ],
          };
          targetRow = {
            key: `${row.dateKey}::custom::${customId}`,
            name: normalizedName,
            duty: normalizedDuty,
            isCustom: true,
          };
        } else if (!targetRow.isCustom && (normalizedName !== targetRow.name || (normalizedDuty && normalizedDuty !== targetRow.duty))) {
          nextDayRows = {
            ...currentDayRows,
            rowOverrides: {
              ...currentDayRows.rowOverrides,
              [targetRow.key]: {
                name: normalizedName,
                duty: normalizedDuty || targetRow.duty,
              },
            },
          };
        }

        const currentMonthEntries = nextStore.entries[row.monthKey] ?? {};
        const currentEntry = currentMonthEntries[targetRow.key] ?? createDefaultScheduleAssignmentEntry();
        const nextSchedules = row.schedules.length > 0 ? row.schedules : [""];
        const nextExclusiveVideo = Array.from(
          { length: Math.max(nextSchedules.length, 1) },
          (_, index) => row.exclusiveVideoFlags[index] ?? false,
        );

        nextStore = {
          entries: {
            ...nextStore.entries,
            [row.monthKey]: {
              ...currentMonthEntries,
              [targetRow.key]: {
                ...currentEntry,
                clockIn: row.clockIn,
                clockInConfirmed: Boolean(row.clockIn),
                clockInColor: row.clockIn ? currentEntry.clockInColor : "",
                clockOut: row.clockOut,
                clockOutConfirmed: Boolean(row.clockOut),
                clockOutColor: row.clockOut ? (currentEntry.clockOutColor || "yellow") : "",
                schedules: nextSchedules,
                travelType: row.travelType,
                exclusiveVideo: nextExclusiveVideo,
                coverageScore: row.coverageScore,
                coverageNote: row.coverageScore > 0 ? row.coverageNote : "",
              },
            },
          },
          rows: {
            ...nextStore.rows,
            [row.monthKey]: {
              ...currentMonthRows,
              [row.dateKey]: nextDayRows,
            },
          },
        };
        importedCount += 1;
      } catch (error) {
        skippedMessages.push(error instanceof Error ? error.message : `${row.dateKey}: 가져오지 못했습니다.`);
      }
    });

    if (importedCount > 0) {
      saveScheduleAssignmentStore(nextStore);
      setStore(nextStore);
    }

    const skippedPreview = skippedMessages.slice(0, 3).join(" / ");
    if (importedCount === 0) {
      setImportMessage({
        tone: "warn",
        text: skippedMessages.length > 0
          ? `반영된 행이 없습니다. 제외 ${skippedMessages.length}건. ${skippedPreview}`
          : "반영된 행이 없습니다.",
      });
      return;
    }

    setImportMessage({
      tone: skippedMessages.length > 0 ? "warn" : "ok",
      text:
        skippedMessages.length > 0
          ? `${importedCount}건 반영, ${skippedMessages.length}건 제외했습니다. ${skippedPreview}`
          : `${importedCount}건을 반영했습니다.`,
    });
  };

  const handleSpreadsheetUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const lowerName = file.name.toLowerCase();
      const parsedRows = lowerName.endsWith(".csv")
        ? parseCsvRows(await file.text())
        : await parseWorksheetRows(await file.arrayBuffer());
      importParsedRows(parsedRows);
    } catch (error) {
      setImportMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "업로드 중 오류가 발생했습니다.",
      });
    } finally {
      event.target.value = "";
    }
  };

  if (schedules.length === 0) {
    return <section className="panel"><div className="panel-pad"><div className="status note">게시되었거나 작성된 근무표가 없어 일정배정표를 만들 수 없습니다.</div></div></section>;
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">일정배정</div>
              <strong style={{ fontSize: 24 }}>월별 일정배정</strong>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={downloadXlsxTemplate}>
                XLSX 양식
              </button>
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                XLSX 업로드
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                style={{ display: "none" }}
                onChange={handleSpreadsheetUpload}
              />
              {schedules.map((schedule) => (
                <button key={schedule.monthKey} type="button" className={`btn ${selectedMonthKey === schedule.monthKey ? "white" : ""}`} onClick={() => setSelectedMonthKey(schedule.monthKey)}>
                  {schedule.year}년 {schedule.month}월
                </button>
              ))}
            </div>
          </div>
          <div className="status note">근무표의 해당 날짜 근무자를 자동으로 불러오고, 사람 추가와 삭제, 근무유형 변경까지 이 페이지에서 직접 관리합니다.</div>
          {importMessage ? <div className={`status ${importMessage.tone}`}>{importMessage.text}</div> : null}
        </div>
      </article>

      {monthDays.map((day) => {
        const dayRows = monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows();
        const rows = getScheduleAssignmentRows(day, dayRows);
        const selectedRow = rows.find((row) => row.key === selectedDeleteRowKey) ?? null;
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
              if (day.dateKey === todayDateKey) {
                todayCardRef.current = element;
              }
            }}
          >
            <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, auto) minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: 4, justifySelf: "start" }}>
                  <div className="chip">{day.dateKey}</div>
                  <strong style={{ fontSize: 22, color: day.dateKey === todayDateKey ? "#8fe7ff" : undefined }}>
                    {day.month}월 {day.day}일 일정배정
                  </strong>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
                  {vacationPeople.length > 0 || jcheckPeople.length > 0 || nightOffPeople.length > 0 ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
                        {vacationPeople.map((vacation, index) => (
                          <span
                            key={`${day.dateKey}-vacation-${vacation.type}-${vacation.name}-${index}`}
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
                              ...vacationBadgeStyles[vacation.type],
                            }}
                          >
                            <span>{vacation.type}</span>
                            <span>{vacation.name}</span>
                          </span>
                        ))}
                        {jcheckPeople.map((name, index) => (
                          <span
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
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifySelf: "end" }}>
                  <span className="muted">{rows.length}명</span>
                  <button type="button" className="btn" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => addRow(day.dateKey)}>
                    사람 추가
                  </button>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="table-like" style={{ minWidth: 1140 }}>
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>근무유형</th>
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

                      return (
                        <tr key={row.key}>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "38px minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
                              <button
                                type="button"
                                className="btn"
                                title="가산점"
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
                            <button
                              type="button"
                              className="field-input"
                              style={{
                                width: "100%",
                                textAlign: "left",
                                cursor: "pointer",
                                borderColor: selectedDeleteRowKey === row.key ? "rgba(248,113,113,.52)" : undefined,
                                background: selectedDeleteRowKey === row.key ? "rgba(127,29,29,.18)" : undefined,
                                color: selectedDeleteRowKey === row.key ? "#fee2e2" : undefined,
                              }}
                              onClick={() => setSelectedDeleteRowKey((current) => (current === row.key ? null : row.key))}
                            >
                              {row.name || "이름 없음"}
                            </button>
                            {coverageScore > 0 ? (
                              <input
                                className="field-input"
                                value={entry.coverageNote}
                                placeholder="가점 사유 입력"
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
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <select className="field-select" value={row.duty} onChange={(event) => updateRowDuty(day.dateKey, row, event.target.value)}>
                              <option value="">근무 선택</option>
                              {rowDutyOptions.map((option) => <option key={`${row.key}-${option}`} value={option}>{option}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              {entry.clockInConfirmed ? (
                                <button type="button" className="field-input" style={{ width: 84, minWidth: 84, textAlign: "center", cursor: "pointer", ...(timeColorStyle(entry.clockInColor) ?? {}) }} onClick={() => updateMonthEntry(row.key, (current) => ({ ...current, clockInColor: cycleClockInColor(current.clockInColor) }))}>{entry.clockIn}</button>
                              ) : (
                                <input className="field-input" type="text" inputMode="numeric" maxLength={5} placeholder="00:00" value={entry.clockIn} style={{ width: 84, minWidth: 84, textAlign: "center" }} onFocus={() => setActiveTimeField(clockInFieldKey)} onClick={() => setActiveTimeField(clockInFieldKey)} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, clockIn: event.target.value, clockInConfirmed: false, clockInColor: "" }))} />
                              )}
                              {showClockInActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockInConfirmed ? <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockIn); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockIn: formatted, clockInConfirmed: Boolean(formatted), clockInColor: "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockIn: "", clockInColor: "", clockInConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              {entry.clockOutConfirmed ? (
                                <button type="button" className="field-input" style={{ width: 84, minWidth: 84, textAlign: "center", cursor: "pointer", ...(timeColorStyle(entry.clockOutColor) ?? {}) }} onClick={() => updateMonthEntry(row.key, (current) => ({ ...current, clockOutColor: cycleClockOutColor(current.clockOutColor) }))}>{entry.clockOut}</button>
                              ) : (
                                <input className="field-input" type="text" inputMode="numeric" maxLength={5} placeholder="00:00" value={entry.clockOut} style={{ width: 84, minWidth: 84, textAlign: "center" }} onFocus={() => setActiveTimeField(clockOutFieldKey)} onClick={() => setActiveTimeField(clockOutFieldKey)} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, clockOut: event.target.value, clockOutConfirmed: false, clockOutColor: "" }))} />
                              )}
                              {showClockOutActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockOutConfirmed ? <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockOut); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockOut: formatted, clockOutConfirmed: Boolean(formatted), clockOutColor: formatted ? "yellow" : "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockOut: "", clockOutColor: "", clockOutConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 3, minWidth: 460 }}>
                              {safeSchedules.map((schedule, index) => (
                                <div key={`${row.key}-schedule-${index}`} style={{ display: "grid", gap: 4 }}>
                                  <div style={{ display: "flex", gap: 3, alignItems: "center", minHeight: 32 }}>
                                    <input className="field-input" value={schedule} style={{ flex: 1 }} placeholder="일정 내용 입력" onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, schedules: getSafeSchedules(current.schedules).map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} />
                                    <span style={{ minWidth: 30, textAlign: "center", fontSize: 11, color: "#94a3b8", letterSpacing: "-0.02em" }}>단독</span>
                                    <label style={{ display: "flex", justifyContent: "center", alignItems: "center", width: 32, minWidth: 32, height: 32, borderRadius: 10, border: safeExclusiveVideo[index] ? "1px solid rgba(132,204,22,.72)" : "1px solid rgba(203,213,225,.95)", background: safeExclusiveVideo[index] ? "rgba(217,249,157,.95)" : "#ffffff", transition: "background .18s ease, border-color .18s ease", cursor: "pointer", overflow: "hidden" }}>
                                      <input type="checkbox" checked={safeExclusiveVideo[index]} style={{ appearance: "none", WebkitAppearance: "none", width: "100%", height: "100%", margin: 0, background: "transparent", border: "none", cursor: "pointer" }} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, exclusiveVideo: getSafeExclusiveVideo(current.exclusiveVideo, getSafeSchedules(current.schedules).length).map((item, itemIndex) => itemIndex === index ? event.target.checked : item) }))} />
                                    </label>
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
                                  </div>
                                </div>
                              ))}
                              <button type="button" className="btn" style={{ width: "fit-content", padding: "2px 6px", fontSize: 11, lineHeight: 1.1 }} onClick={() => updateMonthEntry(row.key, (current) => { const currentSchedules = getSafeSchedules(current.schedules); return { ...current, schedules: [...currentSchedules, ""], exclusiveVideo: [...getSafeExclusiveVideo(current.exclusiveVideo, currentSchedules.length), false] }; })}>+</button>
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", textAlign: "center", verticalAlign: "middle" }}>{scheduleCount}</td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <select className="field-select" value={entry.travelType} style={{ minWidth: 118 }} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, travelType: event.target.value as AssignmentTravelType }))}>
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

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "5px 10px", fontSize: 12, opacity: selectedRow ? 1 : 0.45 }}
                  disabled={!selectedRow}
                  onClick={() => {
                    if (!selectedRow) return;
                    deleteRow(day.dateKey, selectedRow);
                    setSelectedDeleteRowKey(null);
                  }}
                >
                  사람 삭제
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
