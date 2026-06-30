"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getUsers, refreshUsers, type UserAccount } from "@/lib/auth/storage";
import { SCHEDULE_MONTHS, SCHEDULE_YEARS } from "@/lib/schedule/constants";
import {
  applyVacationMonthToSchedule,
  DEFAULT_VACATION_CAPACITY,
  getVacationApplicantsOverview,
  isVacationRequestOpen,
  refreshVacationStore,
  runVacationLottery,
  setVacationRequestOpen,
  setVacationCapacity,
  VACATION_EVENT,
  VACATION_STATUS_EVENT,
  VacationMonthState,
  waitForVacationStoreWrite,
} from "@/lib/vacation/storage";
import {
  applyExtraUnitToSchedule,
  createExtraUnit,
  DEFAULT_EXTRA_VACATION_CAPACITY,
  EXTRA_VACATION_EVENT,
  EXTRA_VACATION_STATUS_EVENT,
  getExtraApplicantsOverview,
  getExtraUnits,
  getExtraVacationHolidayDateSet,
  refreshExtraStore,
  resetExtraLottery,
  runExtraLottery,
  setExtraUnitLimit,
  setExtraUnitOpen,
  updateExtraUnitDateKeys,
  type VacationExtraUnit,
} from "@/lib/vacation/extra-storage";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState } from "@/lib/schedule/storage";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const VACATION_MANAGEMENT_SELECTION_KEY = "desk-vacation-management-selection-v1";
const vacationChipStyles = {
  annual: {
    borderColor: "rgba(96,165,250,.45)",
    background: "rgba(59,130,246,.16)",
    color: "#dbeafe",
  },
  compensatory: {
    borderColor: "rgba(52,211,153,.45)",
    background: "rgba(16,185,129,.16)",
    color: "#d1fae5",
  },
} as const;

function buildCalendarCells(year: number, month: number, displayDateKeys: string[]) {
  const firstDisplayDate = displayDateKeys.length > 0
    ? new Date(`${displayDateKeys[0]}T00:00:00`)
    : new Date(year, month - 1, 1);
  const lastDisplayDate = displayDateKeys.length > 0
    ? new Date(`${displayDateKeys[displayDateKeys.length - 1]}T00:00:00`)
    : new Date(year, month, 0);
  const leading = firstDisplayDate.getDay() === 0 ? 6 : firstDisplayDate.getDay() - 1;
  const cells: Array<{
    dateKey: string | null;
    day: number | null;
    label: string;
    isCurrentMonth: boolean;
    isWeekend: boolean;
    isOverflowMonth: boolean;
  }> = [];

  for (let index = 0; index < leading; index += 1) {
    cells.push({ dateKey: null, day: null, label: "", isCurrentMonth: false, isWeekend: false, isOverflowMonth: false });
  }

  for (const date = new Date(firstDisplayDate); date <= lastDisplayDate; date.setDate(date.getDate() + 1)) {
    const displayMonth = date.getMonth() + 1;
    const displayDay = date.getDate();
    cells.push({
      dateKey: `${date.getFullYear()}-${String(displayMonth).padStart(2, "0")}-${String(displayDay).padStart(2, "0")}`,
      day: displayDay,
      label: displayMonth === month ? String(displayDay) : `${displayMonth}/${displayDay}`,
      isCurrentMonth: displayMonth === month,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      isOverflowMonth: displayMonth !== month,
    });
  }

  const total = cells.length;
  const trailing = (7 - (total % 7)) % 7;
  for (let index = 0; index < trailing; index += 1) {
    cells.push({ dateKey: null, day: null, label: "", isCurrentMonth: false, isWeekend: false, isOverflowMonth: false });
  }

  return cells;
}

function highlightStyle(active: boolean, tone: "annual" | "compensatory") {
  const baseStyle = tone === "annual" ? vacationChipStyles.annual : vacationChipStyles.compensatory;
  if (!active) {
    return {
      background: baseStyle.background,
      border: `1px solid ${baseStyle.borderColor}`,
      color: baseStyle.color,
    };
  }

  return {
    background: tone === "annual" ? "rgba(37,99,235,.34)" : "rgba(5,150,105,.34)",
    border: "1px solid rgba(250,204,21,.78)",
    color: "#ffffff",
    boxShadow: tone === "annual" ? "0 10px 24px rgba(59,130,246,.28)" : "0 10px 24px rgba(16,185,129,.24)",
  };
}

function countNamesByDateMap(map: Record<string, string[]>) {
  return Object.values(map).reduce((sum, names) => sum + names.length, 0);
}

function countDaysByName(map: Record<string, string[]>) {
  const counts = new Map<string, number>();
  Object.values(map).forEach((names) => {
    Array.from(new Set(names)).forEach((name) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
  });
  return counts;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function formatWinnerDateLabel(dateKey: string) {
  const { month, day } = parseDateKey(dateKey);
  return `${month}/${day}`;
}

function buildWinnerRows(
  annualWinners: Record<string, string[]>,
  compensatoryWinners: Record<string, string[]>,
) {
  return Array.from(new Set([...Object.keys(annualWinners), ...Object.keys(compensatoryWinners)]))
    .sort((left, right) => left.localeCompare(right))
    .map((dateKey) => ({
      dateKey,
      label: formatWinnerDateLabel(dateKey),
      annualWinners: annualWinners[dateKey] ?? [],
      compensatoryWinners: compensatoryWinners[dateKey] ?? [],
    }))
    .filter((row) => row.annualWinners.length > 0 || row.compensatoryWinners.length > 0);
}

function buildCompensatorySummary(
  annualApplicants: Record<string, string[]>,
  compensatoryApplicants: Record<string, string[]>,
  annualWinners: Record<string, string[]>,
  compensatoryWinners: Record<string, string[]>,
) {
  const annualRequestedCounts = countDaysByName(annualApplicants);
  const compensatoryRequestedCounts = countDaysByName(compensatoryApplicants);
  const annualWinCounts = countDaysByName(annualWinners);
  const compensatoryWinCounts = countDaysByName(compensatoryWinners);

  return Array.from(
    new Set([
      ...annualRequestedCounts.keys(),
      ...compensatoryRequestedCounts.keys(),
      ...annualWinCounts.keys(),
      ...compensatoryWinCounts.keys(),
    ]),
  )
    .map((name) => ({
      name,
      annualRequestedCount: annualRequestedCounts.get(name) ?? 0,
      annualWinCount: annualWinCounts.get(name) ?? 0,
      compensatoryRequestedCount: compensatoryRequestedCounts.get(name) ?? 0,
      compensatoryWinCount: compensatoryWinCounts.get(name) ?? 0,
    }))
    .sort(
      (left, right) =>
        (right.annualRequestedCount + right.compensatoryRequestedCount) - (left.annualRequestedCount + left.compensatoryRequestedCount) ||
        (right.annualWinCount + right.compensatoryWinCount) - (left.annualWinCount + left.compensatoryWinCount) ||
        left.name.localeCompare(right.name, "ko"),
    );
}

// ── Extra unit helpers ────────────────────────────────────────────────────────

function getMonthWeekdays(
  year: number,
  month: number,
  holidayDateSet: Set<string>,
): Array<{ dateKey: string; isHoliday: boolean }> {
  const result: Array<{ dateKey: string; isHoliday: boolean }> = [];
  const last = new Date(year, month, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    result.push({ dateKey, isHoliday: holidayDateSet.has(dateKey) });
  }
  return result;
}

function expandDateRange(start: string, end: string, holidayDateSet: Set<string>): string[] {
  if (!start || !end || start > end) return [];
  const result: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cur <= last) {
    const dow = cur.getDay();
    const dk = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    if (dow !== 0 && dow !== 6 && !holidayDateSet.has(dk)) result.push(dk);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function formatDateKeyLabel(dk: string) {
  const [, m, d] = dk.split("-").map(Number);
  return `${m}/${d}`;
}

function countExtraNamesByDateMap(map: Record<string, string[]>) {
  return Object.values(map).reduce((s, ns) => s + ns.length, 0);
}

export default function ScheduleVacationsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [monthState, setMonthState] = useState<VacationMonthState | null>(null);
  const [managedDateKeys, setManagedDateKeys] = useState<string[]>([]);
  const [displayDateKeys, setDisplayDateKeys] = useState<string[]>([]);
  const [hasGeneratedSchedule, setHasGeneratedSchedule] = useState(false);
  const [annualApplicants, setAnnualApplicants] = useState<Record<string, string[]>>({});
  const [compensatoryApplicants, setCompensatoryApplicants] = useState<Record<string, string[]>>({});
  const [monthRequests, setMonthRequests] = useState<Array<{ requesterId: string | null; requesterName: string }>>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [vacationRequestOpen, setVacationRequestOpenState] = useState(() => isVacationRequestOpen());

  // Extra unit state
  const [extraUnits, setExtraUnits] = useState<VacationExtraUnit[]>([]);
  const [extraMessage, setExtraMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createYear, setCreateYear] = useState(year);
  const [createMonth, setCreateMonth] = useState(month);
  const [createSelectedDates, setCreateSelectedDates] = useState<string[]>([]);
  const [createRangeStart, setCreateRangeStart] = useState("");
  const [createRangeEnd, setCreateRangeEnd] = useState("");
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(VACATION_MANAGEMENT_SELECTION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { year?: number; month?: number };
        if (typeof parsed.year === "number") setYear(parsed.year);
        if (typeof parsed.month === "number") setMonth(parsed.month);
      } catch {
        // ignore invalid saved selection
      }
    }
    setSelectionLoaded(true);
  }, []);

  useEffect(() => {
    if (!selectionLoaded || typeof window === "undefined") return;
    window.localStorage.setItem(VACATION_MANAGEMENT_SELECTION_KEY, JSON.stringify({ year, month }));
  }, [selectionLoaded, year, month]);

  const loadExtraUnits = useCallback(async () => {
    await refreshExtraStore();
    setExtraUnits(getExtraUnits());
  }, []);

  const loadMonth = async () => {
    const [, , , loadedUsers] = await Promise.all([
      refreshScheduleState(),
      refreshPublishedSchedules({ repair: false }),
      refreshVacationStore(),
      refreshUsers(),
    ]);
    const overview = getVacationApplicantsOverview(year, month);
    setMonthState(overview.monthState);
    setManagedDateKeys(overview.managedDateKeys);
    setDisplayDateKeys(overview.displayDateKeys);
    setHasGeneratedSchedule(overview.hasGeneratedSchedule);
    setAnnualApplicants(overview.annualApplicants);
    setCompensatoryApplicants(overview.compensatoryApplicants);
    setMonthRequests(
      overview.requests.map((request) => ({
        requesterId: request.requesterId,
        requesterName: request.requesterName,
      })),
    );
    setUsers(Array.isArray(loadedUsers) ? loadedUsers : getUsers());
    setVacationRequestOpenState(isVacationRequestOpen());
  };

  useEffect(() => {
    void loadMonth();
  }, [year, month]);

  useEffect(() => {
    void loadExtraUnits();
  }, [loadExtraUnits]);

  useEffect(() => {
    const onRefresh = () => void loadMonth();
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };
    window.addEventListener("focus", onRefresh);
    window.addEventListener(VACATION_EVENT, onRefresh);
    window.addEventListener(VACATION_STATUS_EVENT, onStatus);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(VACATION_EVENT, onRefresh);
      window.removeEventListener(VACATION_STATUS_EVENT, onStatus);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, onRefresh);
    };
  }, [year, month]);

  useEffect(() => {
    const onExtraChange = () => setExtraUnits(getExtraUnits());
    const onExtraStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setExtraMessage({ tone: "warn", text: detail.message });
    };
    window.addEventListener(EXTRA_VACATION_EVENT, onExtraChange);
    window.addEventListener(EXTRA_VACATION_STATUS_EVENT, onExtraStatus);
    return () => {
      window.removeEventListener(EXTRA_VACATION_EVENT, onExtraChange);
      window.removeEventListener(EXTRA_VACATION_STATUS_EVENT, onExtraStatus);
    };
  }, []);

  const calendarCells = useMemo(() => buildCalendarCells(year, month, displayDateKeys), [displayDateKeys, month, year]);
  const managedDateSet = useMemo(() => new Set(managedDateKeys), [managedDateKeys]);
  const annualLotteryDone = Boolean(monthState && Object.values(monthState.annualWinners).some((names) => names.length > 0));
  const compensatoryLotteryDone = Boolean(monthState && Object.values(monthState.compensatoryWinners).some((names) => names.length > 0));
  const vacationLotteryDone = annualLotteryDone || compensatoryLotteryDone;
  const lotteryReport = useMemo(
    () =>
      buildCompensatorySummary(
        annualApplicants,
        compensatoryApplicants,
        monthState?.annualWinners ?? {},
        monthState?.compensatoryWinners ?? {},
      ),
    [annualApplicants, compensatoryApplicants, monthState?.annualWinners, monthState?.compensatoryWinners],
  );
  const winnerRows = useMemo(
    () => buildWinnerRows(monthState?.annualWinners ?? {}, monthState?.compensatoryWinners ?? {}),
    [monthState?.annualWinners, monthState?.compensatoryWinners],
  );
  const missingApplicants = useMemo(() => {
    const submittedIds = new Set<string>();
    const submittedNames = new Set<string>();

    monthRequests.forEach((request) => {
      if (request.requesterId) {
        submittedIds.add(request.requesterId);
      }
      const trimmedName = request.requesterName.trim();
      if (trimmedName) {
        submittedNames.add(trimmedName);
      }
    });

    return Array.from(
      new Set(
        users
          .filter(
            (user) =>
              user.status === "ACTIVE" &&
              (user.role === "member" || user.role === "outlet" || user.role === "reviewer"),
          )
          .filter((user) => !submittedIds.has(user.id) && !submittedNames.has(user.username.trim()))
          .map((user) => user.username.trim())
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right, "ko"));
  }, [monthRequests, users]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">DESK 휴가 관리</div>
              <strong style={{ fontSize: 22 }}>{year}년 {month}월 휴가 추첨 현황</strong>
              <span className="muted">
                홈에 게시된 근무표 날짜만 휴가 관리에 반영됩니다. 토요일과 일요일은 신청과 추첨에서 제외됩니다.
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`btn ${vacationRequestOpen ? "white" : ""}`}
                onClick={async () => {
                  const result = setVacationRequestOpen(!vacationRequestOpen);
                  const persistResult = await waitForVacationStoreWrite();
                  await loadMonth();
                  if (!persistResult.ok) {
                    setMessage({ tone: "warn", text: persistResult.message ?? "휴가 신청 오픈 상태 저장에 실패했습니다." });
                    return;
                  }
                  setMessage({ tone: "ok", text: result.message });
                }}
              >
                {vacationRequestOpen ? "오픈중" : "휴가 신청 오픈"}
              </button>
              <Link href="/schedule" className="btn">
                DESK 메인
              </Link>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(180px, 220px))", gap: 12 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span>연도</span>
              <select className="field-select" value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {SCHEDULE_YEARS.map((option) => (
                  <option key={option} value={option}>
                    {option}년
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span>월</span>
              <select className="field-select" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                {SCHEDULE_MONTHS.map((option) => (
                  <option key={option} value={option}>
                    {option}월
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn"
              disabled={!hasGeneratedSchedule}
              onClick={async () => {
                if (vacationLotteryDone) {
                  window.alert("이미 휴가 추첨했습니다.");
                  return;
                }
                if (!window.confirm("휴가 추첨하시겠습니까?")) return;
                const annualApplicantCount = countNamesByDateMap(annualApplicants);
                const compensatoryApplicantCount = countNamesByDateMap(compensatoryApplicants);
                const result = runVacationLottery(year, month);
                if (!result) {
                  setMessage({ tone: "warn", text: `${year}년 ${month}월 홈 게시 근무표가 없어 휴가 추첨을 진행할 수 없습니다.` });
                  return;
                }
                const annualWinnerCount = countNamesByDateMap(result.annualWinners ?? {});
                const compensatoryWinnerCount = countNamesByDateMap(result.compensatoryWinners ?? {});
                const persistResult = await waitForVacationStoreWrite();
                await loadMonth();
                if (!persistResult.ok) {
                  setMessage({ tone: "warn", text: persistResult.message ?? "휴가 추첨 저장에 실패했습니다." });
                  return;
                }
                if (annualApplicantCount === 0 && compensatoryApplicantCount === 0) {
                  setMessage({ tone: "warn", text: `${year}년 ${month}월에는 휴가 신청자가 없어 추첨할 내용이 없습니다.` });
                  return;
                }
                if (annualWinnerCount === 0 && compensatoryWinnerCount === 0) {
                  setMessage({ tone: "warn", text: `${year}년 ${month}월 휴가 추첨 결과 당첨자가 없습니다.` });
                  return;
                }
                setMessage({
                  tone: "ok",
                  text: `${year}년 ${month}월 휴가 추첨이 완료되었습니다. 연차 ${annualWinnerCount}명, 대휴 ${compensatoryWinnerCount}명이 당첨되었습니다. 아래 결과보고서에서 사람별 신청/당첨 현황을 확인하세요.`,
                });
              }}
            >
              휴가 추첨
            </button>
            <button
              className="btn primary"
              disabled={!hasGeneratedSchedule}
              onClick={async () => {
                const result = await applyVacationMonthToSchedule(year, month);
                setMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                const persistResult = await waitForVacationStoreWrite();
                await loadMonth();
                if (!persistResult.ok) {
                  setMessage({ tone: "warn", text: persistResult.message ?? "휴가 반영 저장에 실패했습니다." });
                  return;
                }
              }}
            >
              근무 반영
            </button>
            <div style={{ display: "grid", gap: 6, flex: "1 1 320px", minWidth: 240 }}>
              <strong style={{ fontSize: 13, color: "#f8fbff" }}>
                휴가 미제출 명단
              </strong>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {missingApplicants.length > 0 ? `휴가 미제출: ${missingApplicants.join(", ")}` : "휴가 미제출: 없음"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {missingApplicants.length > 0 ? (
                  missingApplicants.map((name) => (
                    <span
                      key={`missing-vacation-${name}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "4px 9px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        background: "rgba(248,113,113,.16)",
                        border: "1px solid rgba(248,113,113,.32)",
                        color: "#fecaca",
                      }}
                    >
                      {name}
                    </span>
                  ))
                ) : (
                  <span className="muted">제출 대상자는 전원 제출했습니다.</span>
                )}
              </div>
            </div>
            {monthState?.appliedAt ? <span className="muted">최근 반영: {monthState.appliedAt}</span> : null}
          </div>

          {!hasGeneratedSchedule ? (
            <div className="status note">
              {year}년 {month}월 홈 게시 근무표가 아직 없습니다. 먼저 DESK 페이지에서 근무표를 작성하고 홈에 게시하면 같은 날짜의 평일 시트가 자동으로 만들어집니다.
            </div>
          ) : null}

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}

          {winnerRows.length > 0 ? (
            <div className="status note" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <strong style={{ fontSize: 16, color: "var(--text)" }}>당첨자 명단</strong>
                <div className="muted">날짜별 연차/대휴 당첨자를 바로 확인할 수 있습니다.</div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {winnerRows.map((row) => (
                  <div
                    key={`winner-row-${row.dateKey}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "72px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "start",
                      padding: "12px",
                      borderRadius: 14,
                      border: "1px solid rgba(250,204,21,.38)",
                      background: "rgba(250,204,21,.1)",
                    }}
                  >
                    <strong style={{ fontSize: 16, color: "var(--text)" }}>{row.label}</strong>
                    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                        <span style={{ minWidth: 42, color: "var(--text)", fontSize: 13, fontWeight: 900 }}>연차</span>
                        {row.annualWinners.length > 0 ? (
                          row.annualWinners.map((name) => (
                            <span
                              key={`winner-annual-${row.dateKey}-${name}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                maxWidth: "100%",
                                padding: "5px 10px",
                                borderRadius: 999,
                                fontSize: 13,
                                fontWeight: 900,
                                background: "rgba(37,99,235,.28)",
                                border: "1px solid rgba(37,99,235,.55)",
                                color: "var(--text)",
                              }}
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="muted">없음</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                        <span style={{ minWidth: 42, color: "var(--text)", fontSize: 13, fontWeight: 900 }}>대휴</span>
                        {row.compensatoryWinners.length > 0 ? (
                          row.compensatoryWinners.map((name) => (
                            <span
                              key={`winner-compensatory-${row.dateKey}-${name}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                maxWidth: "100%",
                                padding: "5px 10px",
                                borderRadius: 999,
                                fontSize: 13,
                                fontWeight: 900,
                                background: "rgba(5,150,105,.28)",
                                border: "1px solid rgba(5,150,105,.55)",
                                color: "var(--text)",
                              }}
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="muted">없음</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {vacationLotteryDone && lotteryReport.length > 0 ? (
            <div className="status note" style={{ display: "grid", gap: 10 }}>
              <strong style={{ fontSize: 15 }}>휴가 추첨 결과보고서</strong>
              <div className="muted">사람별 연차/대휴 신청 수와 당첨 수를 함께 보여줍니다.</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["이름", "연차 신청", "연차 당첨", "대휴 신청", "대휴 당첨", "총 신청", "총 당첨"].map((label) => (
                        <th
                          key={label}
                          style={{
                            textAlign: "left",
                            padding: "10px 12px",
                            fontSize: 13,
                            color: "#9bb0c7",
                            borderBottom: "1px solid rgba(255,255,255,.1)",
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lotteryReport.map((entry) => (
                      <tr key={`lottery-report-${entry.name}`}>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)", fontWeight: 800 }}>
                          {entry.name}
                        </td>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{entry.annualRequestedCount}개</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{entry.annualWinCount}개</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{entry.compensatoryRequestedCount}개</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>{entry.compensatoryWinCount}개</td>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                          {entry.annualRequestedCount + entry.compensatoryRequestedCount}개
                        </td>
                        <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                          {entry.annualWinCount + entry.compensatoryWinCount}개
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div style={{ overflowX: "auto", overflowY: "visible" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
              {weekdayLabels.map((label) => (
                <div
                  key={label}
                  style={{
                    textAlign: "center",
                    padding: "10px 6px",
                    borderRadius: 12,
                    border: "1px solid var(--line)",
                    background: "rgba(255,255,255,.05)",
                    fontWeight: 900,
                    fontSize: 14,
                  }}
                >
                  {label}
                </div>
              ))}
              {calendarCells.map((cell, index) => {
                if (!cell.dateKey || !cell.day) {
                  return (
                    <article
                      key={`blank-${index}`}
                      className="panel"
                      style={{
                        minHeight: 228,
                        opacity: 0.28,
                        background: "rgba(255,255,255,.04)",
                        border: "1px solid rgba(255,255,255,.05)",
                      }}
                    />
                  );
                }

                if (cell.isWeekend || !managedDateSet.has(cell.dateKey)) {
                  return (
                    <article
                      key={cell.dateKey}
                      className="panel"
                      style={{
                        minHeight: 228,
                        padding: 10,
                        opacity: cell.isOverflowMonth ? 0.55 : 0.42,
                        background: "rgba(255,255,255,.05)",
                        border: "1px solid rgba(255,255,255,.08)",
                      }}
                    >
                      <strong style={{ fontSize: 20 }}>{cell.label}</strong>
                    </article>
                  );
                }

                const capacity = monthState?.limits[cell.dateKey] ?? DEFAULT_VACATION_CAPACITY;
                const annualNames = annualApplicants[cell.dateKey] ?? [];
                const compensatoryNames = compensatoryApplicants[cell.dateKey] ?? [];
                const annualWinners = monthState?.annualWinners[cell.dateKey] ?? [];
                const compensatoryWinners = monthState?.compensatoryWinners[cell.dateKey] ?? [];
                const dateKey = cell.dateKey;

                return (
                  <article
                    key={cell.dateKey}
                    className="panel"
                    style={{
                      minHeight: 228,
                      padding: 10,
                      opacity: cell.isOverflowMonth ? 0.9 : 1,
                      background: "rgba(255,255,255,.18)",
                      border: "1px solid rgba(255,255,255,.2)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ fontSize: cell.isOverflowMonth ? 18 : 20 }}>{cell.label}</strong>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
                        <span>휴가 인원</span>
                        <select
                          className="field-select"
                          style={{ minWidth: 68, padding: "8px 10px" }}
                          value={capacity}
                          onChange={(event) => {
                            setVacationCapacity(year, month, dateKey, Number(event.target.value));
                            void loadMonth();
                          }}
                        >
                          {Array.from({ length: 10 }, (_, optionIndex) => optionIndex + 1).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <strong style={{ fontSize: 13, color: "#bfdbfe" }}>
                          연차 {annualNames.length}명
                        </strong>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 32 }}>
                          {annualNames.length > 0 ? (
                            annualNames.map((name) => {
                              const isWinner = annualWinners.includes(name);
                              return (
                                <span
                                  key={`annual-${dateKey}-${name}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 6,
                                    maxWidth: "100%",
                                    minWidth: 0,
                                    padding: "4px 9px",
                                    borderRadius: 999,
                                    fontSize: 13,
                                    fontWeight: isWinner ? 800 : 700,
                                    ...highlightStyle(isWinner, "annual"),
                                  }}
                                >
                                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {name}
                                  </span>
                                  {isWinner ? (
                                    <strong
                                      style={{
                                        flex: "0 0 auto",
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: "rgba(250,204,21,.22)",
                                        color: "var(--text)",
                                        fontSize: 11,
                                        fontWeight: 900,
                                      }}
                                    >
                                      당첨
                                    </strong>
                                  ) : null}
                                </span>
                              );
                            })
                          ) : (
                            <span className="muted">신청 없음</span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <strong style={{ fontSize: 13, color: "#bbf7d0" }}>
                          대휴 {compensatoryNames.length}명
                        </strong>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 32 }}>
                          {compensatoryNames.length > 0 ? (
                            compensatoryNames.map((name) => {
                              const isWinner = compensatoryWinners.includes(name);
                              return (
                                <span
                                  key={`comp-${dateKey}-${name}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 6,
                                    maxWidth: "100%",
                                    minWidth: 0,
                                    padding: "4px 9px",
                                    borderRadius: 999,
                                    fontSize: 13,
                                    fontWeight: isWinner ? 800 : 700,
                                    ...highlightStyle(isWinner, "compensatory"),
                                  }}
                                >
                                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {name}
                                  </span>
                                  {isWinner ? (
                                    <strong
                                      style={{
                                        flex: "0 0 auto",
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: "rgba(250,204,21,.22)",
                                        color: "var(--text)",
                                        fontSize: 11,
                                        fontWeight: 900,
                                      }}
                                    >
                                      당첨
                                    </strong>
                                  ) : null}
                                </span>
                              );
                            })
                          ) : (
                            <span className="muted">신청 없음</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 추가 신청 단위 관리 ─────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">추가 신청</div>
              <strong style={{ fontSize: 20 }}>추가 휴가 신청 단위 관리</strong>
              <span className="muted">1차와 완전 독립. 임의 날짜 지정·별도 추첨·근무표에 얹기(union) 반영.</span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setShowCreateForm((v) => !v);
                setCreateLabel("");
                setCreateYear(year);
                setCreateMonth(month);
                setCreateSelectedDates([]);
                setCreateRangeStart("");
                setCreateRangeEnd("");
              }}
            >
              {showCreateForm ? "닫기" : "추가 신청 단위 만들기"}
            </button>
          </div>

          {extraMessage ? (
            <div className={`status ${extraMessage.tone}`}>{extraMessage.text}</div>
          ) : null}

          {/* ── 단위 생성 폼 ── */}
          {showCreateForm ? (() => {
            const holidaySet = getExtraVacationHolidayDateSet(createYear, createMonth);
            const weekdays = getMonthWeekdays(createYear, createMonth, holidaySet);
            const selectedSet = new Set(createSelectedDates);
            return (
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  padding: 16,
                  borderRadius: 16,
                  border: "1px solid rgba(250,204,21,.35)",
                  background: "rgba(250,204,21,.06)",
                }}
              >
                <strong style={{ fontSize: 15 }}>새 추가 신청 단위</strong>

                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted" style={{ fontSize: 13 }}>단위 이름 (선택)</span>
                  <input
                    className="field-input"
                    value={createLabel}
                    onChange={(e) => setCreateLabel(e.target.value)}
                    placeholder={`${createYear}년 ${createMonth}월 추가 신청`}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 180px))", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="muted" style={{ fontSize: 13 }}>반영 연도</span>
                    <select
                      className="field-select"
                      value={createYear}
                      onChange={(e) => { setCreateYear(Number(e.target.value)); setCreateSelectedDates([]); }}
                    >
                      {SCHEDULE_YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="muted" style={{ fontSize: 13 }}>반영 월</span>
                    <select
                      className="field-select"
                      value={createMonth}
                      onChange={(e) => { setCreateMonth(Number(e.target.value)); setCreateSelectedDates([]); }}
                    >
                      {SCHEDULE_MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <span className="muted" style={{ fontSize: 13 }}>
                    신청 가능 날짜 선택 (주말·공휴일 자동 제외)
                    {weekdays.some((d) => d.isHoliday) ? " · 빨간테두리=공휴일(자동제외)" : ""}
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {weekdays.map(({ dateKey, isHoliday }) => {
                      const selected = selectedSet.has(dateKey);
                      return (
                        <button
                          key={dateKey}
                          type="button"
                          disabled={isHoliday}
                          onClick={() => {
                            setCreateSelectedDates((prev) =>
                              selected ? prev.filter((d) => d !== dateKey) : [...prev, dateKey].sort(),
                            );
                          }}
                          style={{
                            padding: "5px 11px",
                            borderRadius: 999,
                            fontSize: 13,
                            fontWeight: 700,
                            border: isHoliday
                              ? "1px solid rgba(248,113,113,.6)"
                              : selected
                                ? "2px solid rgba(250,204,21,.9)"
                                : "1px solid rgba(255,255,255,.2)",
                            background: isHoliday
                              ? "rgba(248,113,113,.12)"
                              : selected
                                ? "rgba(250,204,21,.18)"
                                : "rgba(255,255,255,.06)",
                            color: isHoliday ? "#fca5a5" : selected ? "#fef08a" : "var(--text)",
                            cursor: isHoliday ? "not-allowed" : "pointer",
                            opacity: isHoliday ? 0.6 : 1,
                          }}
                        >
                          {formatDateKeyLabel(dateKey)}
                          {isHoliday ? " 공휴" : ""}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span className="muted" style={{ fontSize: 12 }}>범위 시작</span>
                      <input
                        type="date"
                        className="field-input"
                        style={{ minWidth: 140 }}
                        value={createRangeStart}
                        onChange={(e) => setCreateRangeStart(e.target.value)}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span className="muted" style={{ fontSize: 12 }}>범위 끝</span>
                      <input
                        type="date"
                        className="field-input"
                        style={{ minWidth: 140 }}
                        value={createRangeEnd}
                        onChange={(e) => setCreateRangeEnd(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const dates = expandDateRange(createRangeStart, createRangeEnd, holidaySet);
                        if (dates.length === 0) {
                          setExtraMessage({ tone: "warn", text: "유효한 평일 범위가 없습니다." });
                          return;
                        }
                        setCreateSelectedDates((prev) =>
                          Array.from(new Set([...prev, ...dates])).sort(),
                        );
                        setCreateRangeStart("");
                        setCreateRangeEnd("");
                      }}
                    >
                      범위 추가
                    </button>
                    {createSelectedDates.length > 0 ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setCreateSelectedDates([])}
                      >
                        전체 해제
                      </button>
                    ) : null}
                  </div>
                  {createSelectedDates.length > 0 ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      선택됨: {createSelectedDates.map(formatDateKeyLabel).join(", ")} ({createSelectedDates.length}일)
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>날짜를 선택하거나 범위를 추가하세요.</span>
                  )}
                </div>

                <button
                  type="button"
                  className="btn primary"
                  disabled={createSelectedDates.length === 0}
                  onClick={async () => {
                    const result = await createExtraUnit({
                      label: createLabel,
                      targetYear: createYear,
                      targetMonth: createMonth,
                      dateKeys: createSelectedDates,
                    });
                    setExtraMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                    if (result.ok) {
                      setShowCreateForm(false);
                      setExtraUnits(getExtraUnits());
                      if (result.unit) setExpandedUnitId(result.unit.id);
                    }
                  }}
                >
                  단위 생성
                </button>
              </div>
            );
          })() : null}

          {/* ── 기존 단위 목록 ── */}
          {extraUnits.length === 0 ? (
            <div className="status note">추가 신청 단위가 없습니다. 위 버튼으로 만들어 주세요.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {extraUnits.map((unit) => {
                const isExpanded = expandedUnitId === unit.id;
                const overview = isExpanded ? getExtraApplicantsOverview(unit.id) : null;
                const hasLottery = overview?.hasLotteryResults ?? false;

                return (
                  <article
                    key={unit.id}
                    style={{
                      display: "grid",
                      gap: 0,
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,.15)",
                      background: "rgba(255,255,255,.07)",
                      overflow: "hidden",
                    }}
                  >
                    {/* Unit header */}
                    <button
                      type="button"
                      onClick={() => setExpandedUnitId(isExpanded ? null : unit.id)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: "14px 16px",
                        background: "transparent",
                        border: "none",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          style={{
                            padding: "3px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 800,
                            background: unit.isOpen ? "rgba(74,222,128,.2)" : "rgba(255,255,255,.08)",
                            border: unit.isOpen ? "1px solid rgba(74,222,128,.4)" : "1px solid rgba(255,255,255,.15)",
                            color: unit.isOpen ? "#bbf7d0" : "#9bb0c7",
                          }}
                        >
                          {unit.isOpen ? "오픈중" : "마감"}
                        </span>
                        <strong style={{ fontSize: 15 }}>{unit.label}</strong>
                        <span className="muted" style={{ fontSize: 13 }}>
                          {unit.targetYear}년 {unit.targetMonth}월 · {unit.dateKeys.length}일
                        </span>
                        {unit.appliedAt ? (
                          <span className="muted" style={{ fontSize: 12 }}>반영: {unit.appliedAt}</span>
                        ) : null}
                      </div>
                      <span className="muted" style={{ fontSize: 13 }}>{isExpanded ? "▲" : "▼"}</span>
                    </button>

                    {/* Expanded content */}
                    {isExpanded && overview ? (
                      <div style={{ display: "grid", gap: 14, padding: "0 16px 16px" }}>
                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            type="button"
                            className={`btn ${unit.isOpen ? "white" : ""}`}
                            onClick={async () => {
                              const result = await setExtraUnitOpen(unit.id, !unit.isOpen);
                              setExtraMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                              setExtraUnits(getExtraUnits());
                            }}
                          >
                            {unit.isOpen ? "오픈중 (클릭: 마감)" : "마감 (클릭: 오픈)"}
                          </button>

                          {!hasLottery ? (
                            <button
                              type="button"
                              className="btn"
                              disabled={overview.requests.length === 0}
                              onClick={async () => {
                                if (!window.confirm(`'${unit.label}' 추가 추첨을 실행하시겠습니까?`)) return;
                                const result = await runExtraLottery(unit.id);
                                setExtraMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                                setExtraUnits(getExtraUnits());
                              }}
                            >
                              추가 추첨
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn primary"
                                onClick={async () => {
                                  if (!window.confirm(`'${unit.label}' 당첨자를 근무표에 얹기(union) 반영하시겠습니까?\n기존 1차 휴가는 보존됩니다.`)) return;
                                  const result = await applyExtraUnitToSchedule(unit.id);
                                  setExtraMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                                  setExtraUnits(getExtraUnits());
                                }}
                              >
                                근무표 반영 (얹기)
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={async () => {
                                  if (!window.confirm("추첨 결과를 초기화하고 재추첨하시겠습니까?")) return;
                                  const result = await resetExtraLottery(unit.id);
                                  setExtraMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                                  setExtraUnits(getExtraUnits());
                                }}
                              >
                                추첨 초기화
                              </button>
                            </>
                          )}
                        </div>

                        {/* Date list with applicants / winners */}
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <strong style={{ fontSize: 14 }}>날짜별 현황</strong>
                            {!hasLottery ? (
                              <span className="muted" style={{ fontSize: 12 }}>
                                정원 설정 후 추첨 가능 · 기본 {DEFAULT_EXTRA_VACATION_CAPACITY}명
                              </span>
                            ) : null}
                          </div>
                          {unit.dateKeys.map((dk) => {
                            const cap = unit.limits[dk] ?? DEFAULT_EXTRA_VACATION_CAPACITY;
                            const annualApplicants = overview.annualApplicants[dk] ?? [];
                            const compApplicants = overview.compensatoryApplicants[dk] ?? [];
                            const annualWinners = unit.annualWinners[dk] ?? [];
                            const compWinners = unit.compensatoryWinners[dk] ?? [];

                            return (
                              <div
                                key={dk}
                                style={{
                                  display: "grid",
                                  gap: 8,
                                  padding: 12,
                                  borderRadius: 12,
                                  border: "1px solid rgba(255,255,255,.1)",
                                  background: "rgba(255,255,255,.04)",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <strong style={{ fontSize: 15 }}>{formatDateKeyLabel(dk)}</strong>
                                  {!hasLottery ? (
                                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700 }}>
                                      <span>추가 정원</span>
                                      <select
                                        className="field-select"
                                        style={{ minWidth: 68, padding: "6px 10px" }}
                                        value={cap}
                                        onChange={async (e) => {
                                          await setExtraUnitLimit(unit.id, dk, Number(e.target.value));
                                          setExtraUnits(getExtraUnits());
                                        }}
                                      >
                                        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                                          <option key={n} value={n}>{n}명</option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : (
                                    <span className="muted" style={{ fontSize: 12 }}>정원 {cap}명</span>
                                  )}
                                </div>

                                <div style={{ display: "grid", gap: 6 }}>
                                  {[
                                    { label: "연차", applicants: annualApplicants, winners: annualWinners, color: "#bfdbfe" },
                                    { label: "대휴", applicants: compApplicants, winners: compWinners, color: "#bbf7d0" },
                                  ].map(({ label, applicants, winners, color }) => (
                                    <div key={label} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                      <span style={{ minWidth: 36, fontSize: 12, fontWeight: 800, color }}>
                                        {label} {applicants.length}명
                                      </span>
                                      {applicants.map((name) => {
                                        const won = hasLottery && winners.includes(name);
                                        return (
                                          <span
                                            key={name}
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: 4,
                                              padding: "3px 9px",
                                              borderRadius: 999,
                                              fontSize: 12,
                                              fontWeight: won ? 800 : 600,
                                              border: won ? "1px solid rgba(250,204,21,.7)" : "1px solid rgba(255,255,255,.15)",
                                              background: won ? "rgba(250,204,21,.14)" : "rgba(255,255,255,.06)",
                                              color: won ? "#fef08a" : "var(--text)",
                                            }}
                                          >
                                            {name}
                                            {won ? <strong style={{ fontSize: 10 }}>당첨</strong> : null}
                                          </span>
                                        );
                                      })}
                                      {applicants.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>신청 없음</span> : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {hasLottery ? (
                          <div className="status note" style={{ display: "grid", gap: 6 }}>
                            <strong style={{ fontSize: 14 }}>추첨 결과 요약</strong>
                            <span className="muted" style={{ fontSize: 13 }}>
                              연차 {countExtraNamesByDateMap(unit.annualWinners)}명, 대휴 {countExtraNamesByDateMap(unit.compensatoryWinners)}명 당첨
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

