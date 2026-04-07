"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseVacationEntry } from "@/lib/schedule/engine";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import { vacationStyleTones } from "@/lib/schedule/vacation-styles";
import { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";
import {
  AssignmentTripTagPhase,
  AssignmentTimeColor,
  AssignmentTravelType,
  createDefaultScheduleAssignmentDayRows,
  createDefaultScheduleAssignmentEntry,
  getScheduleAssignmentVisibleTripTagMap,
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
  ScheduleAssignmentVisibleTripTag,
} from "@/lib/team-lead/storage";

const dutyOptions = [
  "조근",
  "일반",
  "연장",
  "석근",
  "철야",
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

const cycleClockInColor = (color: AssignmentTimeColor): AssignmentTimeColor => (color === "" ? "blue" : color === "blue" ? "red" : "");
const cycleClockOutColor = (color: AssignmentTimeColor): AssignmentTimeColor => (color === "" ? "yellow" : "");
const getSafeSchedules = (schedules: string[]) => (schedules.length > 0 ? schedules : [""]);
const removeScheduleAt = (schedules: string[], index: number) => getSafeSchedules(schedules.filter((_, i) => i !== index));
const getSafeExclusiveVideo = (values: boolean[], count: number) => Array.from({ length: Math.max(count, 1) }, (_, i) => values[i] ?? false);
const removeExclusiveVideoAt = (values: boolean[], index: number, nextCount: number) => getSafeExclusiveVideo(values.filter((_, i) => i !== index), nextCount);
const createCustomRowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const coverageScoreSteps = [0, 0.5, 1, 2] as const;
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
  const [schedules, setSchedules] = useState(() => getTeamLeadSchedules());
  const [store, setStore] = useState<ScheduleAssignmentDataStore>({ entries: {}, rows: {} });
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [activeTimeField, setActiveTimeField] = useState<string | null>(null);
  const [editingDayRows, setEditingDayRows] = useState<Record<string, ScheduleAssignmentDayRows>>({});
  const [editingTripTag, setEditingTripTag] = useState<{ tripTagId: string; rowKey: string; value: string } | null>(null);
  const [importMessage, setImportMessage] = useState<ImportMessage | null>(null);
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
      setEditingDayRows({});
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
      addedRows: [...dayRows.addedRows, { id: createCustomRowId(), name: "", duty: dutyOptions[0] ?? "" }],
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
    }));
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
    }));
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
    }));
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
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <strong style={{ fontSize: 22, color: day.dateKey === todayDateKey ? "#8fe7ff" : undefined }}>
                      {day.month}월 {day.day}일 일정배정
                    </strong>
                    {!isEditingPeople && (
                      <button type="button" className="btn" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => startPeopleEdit(day.dateKey)}>
                        인원 수정
                      </button>
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

                      return (
                        <tr key={row.key}>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div
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
                                  className="field-input"
                                  value={row.name}
                                  placeholder="이름 입력"
                                  onChange={(event) =>
                                    updateEditingCustomRow(day.dateKey, row.key, {
                                      name: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <div className="field-input" style={{ width: "100%", textAlign: "left" }}>
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
                            <select
                              className="field-select"
                              value={row.duty}
                              disabled={isEditingPeople && !isDraftCustomRow}
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
                              {entry.clockInConfirmed ? (
                                <button type="button" disabled={isEditingPeople} className="field-input" style={{ width: 84, minWidth: 84, textAlign: "center", cursor: isEditingPeople ? "default" : "pointer", ...(timeColorStyle(entry.clockInColor) ?? {}) }} onClick={() => updateMonthEntry(row.key, (current) => ({ ...current, clockInColor: cycleClockInColor(current.clockInColor) }))}>{entry.clockIn}</button>
                              ) : (
                                <input disabled={isEditingPeople} className="field-input" type="text" inputMode="numeric" maxLength={5} placeholder="00:00" value={entry.clockIn} style={{ width: 84, minWidth: 84, textAlign: "center" }} onFocus={() => setActiveTimeField(clockInFieldKey)} onClick={() => setActiveTimeField(clockInFieldKey)} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, clockIn: event.target.value, clockInConfirmed: false, clockInColor: "" }))} />
                              )}
                              {showClockInActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockInConfirmed ? <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockIn); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockIn: formatted, clockInConfirmed: Boolean(formatted), clockInColor: "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockIn: "", clockInColor: "", clockInConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              {entry.clockOutConfirmed ? (
                                <button type="button" disabled={isEditingPeople} className="field-input" style={{ width: 84, minWidth: 84, textAlign: "center", cursor: isEditingPeople ? "default" : "pointer", ...(timeColorStyle(entry.clockOutColor) ?? {}) }} onClick={() => updateMonthEntry(row.key, (current) => ({ ...current, clockOutColor: cycleClockOutColor(current.clockOutColor) }))}>{entry.clockOut}</button>
                              ) : (
                                <input disabled={isEditingPeople} className="field-input" type="text" inputMode="numeric" maxLength={5} placeholder="00:00" value={entry.clockOut} style={{ width: 84, minWidth: 84, textAlign: "center" }} onFocus={() => setActiveTimeField(clockOutFieldKey)} onClick={() => setActiveTimeField(clockOutFieldKey)} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, clockOut: event.target.value, clockOutConfirmed: false, clockOutColor: "" }))} />
                              )}
                              {showClockOutActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockOutConfirmed ? <button type="button" disabled={isEditingPeople} className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockOut); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockOut: formatted, clockOutConfirmed: Boolean(formatted), clockOutColor: formatted ? "yellow" : "" })); setActiveTimeField(null); }}>확인</button> : null}
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
                                {safeSchedules.map((schedule, index) => (
                                  <div key={`${row.key}-schedule-${index}`} style={{ display: "grid", gap: 4 }}>
                                  <div className="schedule-assignment-schedule-row" style={{ display: "flex", gap: 3, alignItems: "center", minHeight: 32 }}>
                                    <input disabled={isEditingPeople} className="field-input" value={schedule} style={{ flex: 1 }} placeholder="일정 내용 입력" onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, schedules: getSafeSchedules(current.schedules).map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} />
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
                                  </div>
                                ))}
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

              {isEditingPeople && (
                <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                  <button type="button" className="btn primary" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => confirmPeopleEdit(day.dateKey)}>
                    확인
                  </button>
                  <button type="button" className="btn" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => cancelPeopleEdit(day.dateKey)}>
                    취소
                  </button>
                  <button type="button" className="btn" style={{ padding: "6px 12px", minWidth: 44, fontSize: 13 }} onClick={() => addEditingRow(day.dateKey)}>
                    +
                  </button>
                </div>
              )}

            </div>
          </article>
        );
      })}
    </section>
  );
}
