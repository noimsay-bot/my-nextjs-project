"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SCHEDULE_MONTHS, SCHEDULE_YEARS } from "@/lib/schedule/constants";
import {
  applyVacationMonthToSchedule,
  DEFAULT_VACATION_CAPACITY,
  getVacationApplicantsOverview,
  runAnnualVacationLottery,
  runCompensatoryVacationLottery,
  setVacationCapacity,
  VACATION_EVENT,
  VacationMonthState,
  VacationRequest,
} from "@/lib/vacation/storage";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];

function buildCalendarCells(year: number, month: number) {
  const firstDate = new Date(year, month - 1, 1);
  const monthDays = new Date(year, month, 0).getDate();
  const leading = firstDate.getDay() === 0 ? 6 : firstDate.getDay() - 1;
  const total = leading + monthDays;
  const trailing = (7 - (total % 7)) % 7;
  const cells: Array<{ dateKey: string | null; day: number | null; isCurrentMonth: boolean }> = [];

  for (let index = 0; index < leading; index += 1) {
    cells.push({ dateKey: null, day: null, isCurrentMonth: false });
  }

  for (let day = 1; day <= monthDays; day += 1) {
    cells.push({
      dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      day,
      isCurrentMonth: true,
    });
  }

  for (let index = 0; index < trailing; index += 1) {
    cells.push({ dateKey: null, day: null, isCurrentMonth: false });
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

function formatRequestDates(dateKeys: string[]) {
  return dateKeys
    .map((dateKey) => {
      const [, , day] = dateKey.split("-");
      return `${Number(day)}일`;
    })
    .join(", ");
}

export default function ScheduleVacationsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [monthState, setMonthState] = useState<VacationMonthState | null>(null);
  const [annualApplicants, setAnnualApplicants] = useState<Record<string, string[]>>({});
  const [compensatoryApplicants, setCompensatoryApplicants] = useState<Record<string, string[]>>({});
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  const loadMonth = () => {
    const overview = getVacationApplicantsOverview(year, month);
    setMonthState(overview.monthState);
    setAnnualApplicants(overview.annualApplicants);
    setCompensatoryApplicants(overview.compensatoryApplicants);
    setRequests(overview.requests);
  };

  useEffect(() => {
    loadMonth();
  }, [year, month]);

  useEffect(() => {
    const onRefresh = () => loadMonth();
    window.addEventListener("storage", onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener(VACATION_EVENT, onRefresh);
    return () => {
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(VACATION_EVENT, onRefresh);
    };
  }, [year, month]);

  const calendarCells = useMemo(() => buildCalendarCells(year, month), [month, year]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">DESK 휴가 관리</div>
              <strong style={{ fontSize: 22 }}>{year}년 {month}월 휴가 추첨 달력</strong>
              <span className="muted">기본 휴가 인원은 날짜별 5명입니다. 연차 추첨 후 남은 자리에 대휴 추첨을 진행합니다.</span>
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
              <span>년도</span>
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
              onClick={() => {
                runAnnualVacationLottery(year, month);
                loadMonth();
                setMessage({ tone: "ok", text: `${year}년 ${month}월 연차 추첨을 완료했습니다.` });
              }}
            >
              연차 추첨
            </button>
            <button
              className="btn"
              onClick={() => {
                runCompensatoryVacationLottery(year, month);
                loadMonth();
                setMessage({ tone: "ok", text: `${year}년 ${month}월 대휴 추첨을 완료했습니다.` });
              }}
            >
              대휴 추첨
            </button>
            <button
              className="btn primary"
              onClick={() => {
                const result = applyVacationMonthToSchedule(year, month);
                setMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                loadMonth();
              }}
            >
              근무 반영
            </button>
            {monthState?.appliedAt ? <span className="muted">최근 반영: {monthState.appliedAt}</span> : null}
          </div>

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
                if (!cell.isCurrentMonth || !cell.dateKey || !cell.day) {
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

                const capacity = monthState?.limits[cell.dateKey] ?? DEFAULT_VACATION_CAPACITY;
                const annualNames = annualApplicants[cell.dateKey] ?? [];
                const compensatoryNames = compensatoryApplicants[cell.dateKey] ?? [];
                const annualWinners = monthState?.annualWinners[cell.dateKey] ?? [];
                const compensatoryWinners = monthState?.compensatoryWinners[cell.dateKey] ?? [];

                return (
                  <article
                    key={cell.dateKey}
                    className="panel"
                    style={{
                      minHeight: 228,
                      padding: 10,
                      background: "rgba(255,255,255,.18)",
                      border: "1px solid rgba(255,255,255,.2)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ fontSize: 20 }}>{cell.day}</strong>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
                        <span>휴가 인원</span>
                        <select
                          className="field-select"
                          style={{ minWidth: 68, padding: "8px 10px" }}
                          value={capacity}
                          onChange={(event) => {
                            setVacationCapacity(year, month, cell.dateKey as string, Number(event.target.value));
                            loadMonth();
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
                                  key={`annual-${cell.dateKey}-${name}`}
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
                                  key={`comp-${cell.dateKey}-${name}`}
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
