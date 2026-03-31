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
  seedVacationSimulationRequests,
  setVacationCapacity,
  VACATION_EVENT,
  VACATION_STATUS_EVENT,
  VacationMonthState,
  VacationRequest,
  waitForVacationStoreWrite,
} from "@/lib/vacation/storage";
import { refreshScheduleState } from "@/lib/schedule/storage";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const VACATION_MANAGEMENT_SELECTION_KEY = "desk-vacation-management-selection-v1";

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
  if (!active) {
    return {
      background: "rgba(255,255,255,.1)",
      border: "1px solid rgba(255,255,255,.08)",
      color: "#d6dfef",
    };
  }

  if (tone === "annual") {
    return {
      background: "rgba(59,130,246,.28)",
      border: "1px solid rgba(125,211,252,.48)",
      color: "#eff6ff",
      boxShadow: "0 10px 24px rgba(59,130,246,.18)",
    };
  }

  return {
    background: "rgba(16,185,129,.28)",
    border: "1px solid rgba(74,222,128,.48)",
    color: "#ecfdf5",
    boxShadow: "0 10px 24px rgba(16,185,129,.16)",
  };
}

function countNamesByDateMap(map: Record<string, string[]>) {
  return Object.values(map).reduce((sum, names) => sum + names.length, 0);
}

function formatRequestDates(dateKeys: string[]) {
  return dateKeys
    .map((dateKey) => `${Number(dateKey.split("-")[2])}일`)
    .join(", ");
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
  const [requests, setRequests] = useState<VacationRequest[]>([]);
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
    await Promise.all([refreshScheduleState(), refreshVacationStore()]);
    const overview = getVacationApplicantsOverview(year, month);
    setMonthState(overview.monthState);
    setManagedDateKeys(overview.managedDateKeys);
    setDisplayDateKeys(overview.displayDateKeys);
    setHasGeneratedSchedule(overview.hasGeneratedSchedule);
    setAnnualApplicants(overview.annualApplicants);
    setCompensatoryApplicants(overview.compensatoryApplicants);
    setRequests(overview.requests);
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
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(VACATION_EVENT, onRefresh);
      window.removeEventListener(VACATION_STATUS_EVENT, onStatus);
    };
  }, [year, month]);

  const calendarCells = useMemo(() => buildCalendarCells(year, month, displayDateKeys), [displayDateKeys, month, year]);
  const managedDateSet = useMemo(() => new Set(managedDateKeys), [managedDateKeys]);
  const annualLotteryDone = Boolean(monthState && Object.values(monthState.annualWinners).some((names) => names.length > 0));
  const compensatoryLotteryDone = Boolean(monthState && Object.values(monthState.compensatoryWinners).some((names) => names.length > 0));
  const vacationLotteryDone = annualLotteryDone || compensatoryLotteryDone;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">DESK 휴가 관리</div>
              <strong style={{ fontSize: 22 }}>{year}년 {month}월 휴가 추첨 현황</strong>
              <span className="muted">
                DESK 페이지에서 작성한 근무표 날짜만 휴가 관리에 반영됩니다. 토요일과 일요일은 신청과 추첨에서 제외됩니다.
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
                const result = seedVacationSimulationRequests(year, month);
                const persistResult = await waitForVacationStoreWrite();
                await loadMonth();
                setMessage({
                  tone: result.ok && persistResult.ok ? "ok" : "warn",
                  text: persistResult.ok ? result.message : persistResult.message ?? result.message,
                });
              }}
            >
              시뮬레이션 채우기
            </button>
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
                  setMessage({ tone: "warn", text: `${year}년 ${month}월 DESK 근무표가 없어 휴가 추첨을 진행할 수 없습니다.` });
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
                  text: `${year}년 ${month}월 휴가 추첨이 완료되었습니다. 연차 ${annualWinnerCount}명, 대휴 ${compensatoryWinnerCount}명이 당첨되었습니다.`,
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
              {year}년 {month}월 DESK 근무표가 아직 작성되지 않았습니다. 먼저 DESK 페이지에서 근무표를 작성하면 같은 날짜의 평일 시트가 자동으로 만들어집니다.
            </div>
          ) : null}

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
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
                          연차 {annualNames.length}명 / 당첨 {annualWinners.length}명
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
                          대휴 {compensatoryNames.length}명 / 당첨 {compensatoryWinners.length}명
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

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div className="chip">제출된 휴가 신청</div>
          {requests.length > 0 ? (
            requests.map((request) => (
              <article
                key={request.id}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: 14,
                  borderRadius: 16,
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,.05)",
                }}
              >
                <strong>
                  {request.requesterName} · {request.type}
                </strong>
                <span>{formatRequestDates(request.dates)}</span>
                <span className="muted">{request.createdAt}</span>
              </article>
            ))
          ) : (
            <div className="status note">아직 접수된 휴가 신청이 없습니다.</div>
          )}
        </div>
      </section>
    </div>
  );
}

