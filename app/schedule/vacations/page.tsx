"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SCHEDULE_MONTHS, SCHEDULE_YEARS } from "@/lib/schedule/constants";
import {
  applyVacationMonthToSchedule,
  DEFAULT_VACATION_CAPACITY,
  getVacationApplicantsOverview,
  refreshVacationStore,
  runVacationLottery,
  setVacationCapacity,
  VACATION_EVENT,
  VACATION_STATUS_EVENT,
  VacationMonthState,
  waitForVacationStoreWrite,
} from "@/lib/vacation/storage";
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
    background: baseStyle.background,
    border: `1px solid ${baseStyle.borderColor}`,
    color: baseStyle.color,
    boxShadow: tone === "annual" ? "0 10px 24px rgba(59,130,246,.18)" : "0 10px 24px rgba(16,185,129,.16)",
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
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

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

  const loadMonth = async () => {
    await Promise.all([refreshScheduleState(), refreshPublishedSchedules(), refreshVacationStore()]);
    const overview = getVacationApplicantsOverview(year, month);
    setMonthState(overview.monthState);
    setManagedDateKeys(overview.managedDateKeys);
    setDisplayDateKeys(overview.displayDateKeys);
    setHasGeneratedSchedule(overview.hasGeneratedSchedule);
    setAnnualApplicants(overview.annualApplicants);
    setCompensatoryApplicants(overview.compensatoryApplicants);
  };

  useEffect(() => {
    void loadMonth();
  }, [year, month]);

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
              <Link href="/vacation" className="btn">
                휴가 신청 페이지
              </Link>
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
                const result = applyVacationMonthToSchedule(year, month);
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
            {monthState?.appliedAt ? <span className="muted">최근 반영: {monthState.appliedAt}</span> : null}
          </div>

          {!hasGeneratedSchedule ? (
            <div className="status note">
              {year}년 {month}월 홈 게시 근무표가 아직 없습니다. 먼저 DESK 페이지에서 근무표를 작성하고 홈에 게시하면 같은 날짜의 평일 시트가 자동으로 만들어집니다.
            </div>
          ) : null}

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}

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
                                    padding: "4px 9px",
                                    borderRadius: 999,
                                    fontSize: 13,
                                    fontWeight: isWinner ? 800 : 700,
                                    ...highlightStyle(isWinner, "annual"),
                                  }}
                                >
                                  {name}
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
                                    padding: "4px 9px",
                                    borderRadius: 999,
                                    fontSize: 13,
                                    fontWeight: isWinner ? 800 : 700,
                                    ...highlightStyle(isWinner, "compensatory"),
                                  }}
                                >
                                  {name}
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
    </div>
  );
}

