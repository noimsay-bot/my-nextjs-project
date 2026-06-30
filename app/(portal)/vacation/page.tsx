"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSession, isReadOnlyPortalRole } from "@/lib/auth/storage";
import { SCHEDULE_MONTHS, SCHEDULE_YEARS } from "@/lib/schedule/constants";
import { VacationType } from "@/lib/schedule/types";
import { vacationStyleTones } from "@/lib/schedule/vacation-styles";
import {
  getVacationCalendarDateItems,
  getVacationManagedDateKeys,
  getVacationRequests,
  refreshVacationStore,
  submitVacationRequests,
  VACATION_EVENT,
  VACATION_STATUS_EVENT,
  VacationCalendarDateItem,
  VacationRequest,
} from "@/lib/vacation/storage";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import {
  EXTRA_VACATION_EVENT,
  EXTRA_VACATION_STATUS_EVENT,
  getExtraRequestsForUnit,
  getOpenExtraUnits,
  refreshExtraStore,
  submitExtraRequest,
  type VacationExtraUnit,
} from "@/lib/vacation/extra-storage";

const vacationWeekdayLabels = ["월", "화", "수", "목", "금"];

type VacationApplicantBadge = {
  name: string;
  type: Extract<VacationType, "연차" | "대휴">;
};

function getDefaultVacationTargetMonth(baseDate = new Date()) {
  const nextDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
  return {
    year: nextDate.getFullYear(),
    month: nextDate.getMonth() + 1,
  };
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function formatDateLabel(dateKey: string) {
  const { month, day } = parseDateKey(dateKey);
  return `${month}월 ${day}일`;
}

function formatDateList(dateKeys: string[]) {
  return dateKeys
    .map((dateKey) => formatDateLabel(dateKey))
    .join(", ");
}

function formatAllowedDateSummary(dateKeys: string[]) {
  if (dateKeys.length === 0) return null;
  const first = formatDateLabel(dateKeys[0]);
  const last = formatDateLabel(dateKeys[dateKeys.length - 1]);
  return first === last ? first : `${first} ~ ${last}`;
}

function buildVacationCalendarCells(dateItems: VacationCalendarDateItem[]) {
  if (dateItems.length === 0) return [] as Array<{ dateKey: string | null; day: number | null; blocked: boolean; myDutyLabels: string[] }>;
  const firstDate = new Date(`${dateItems[0]?.dateKey}T00:00:00`);
  const firstDayOfWeek = firstDate.getDay();
  const leadingBlankCount = firstDayOfWeek === 0 ? 0 : Math.max(0, firstDayOfWeek - 1);
  const cells: Array<{ dateKey: string | null; day: number | null; blocked: boolean; myDutyLabels: string[] }> = [];

  for (let index = 0; index < leadingBlankCount; index += 1) {
    cells.push({ dateKey: null, day: null, blocked: false, myDutyLabels: [] });
  }

  dateItems.forEach(({ dateKey, blocked, myDutyLabels }) => {
    cells.push({
      dateKey,
      day: parseDateKey(dateKey).day,
      blocked,
      myDutyLabels,
    });
  });

  const trailingBlankCount = (5 - (cells.length % 5)) % 5;
  for (let index = 0; index < trailingBlankCount; index += 1) {
    cells.push({ dateKey: null, day: null, blocked: false, myDutyLabels: [] });
  }

  return cells;
}

function getSelectedVacationDateKeys(requests: VacationRequest[], type: Extract<VacationType, "연차" | "대휴">) {
  return Array.from(
    new Set(
      requests
        .filter((request) => request.type === type)
        .flatMap((request) => request.dates),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export default function VacationPage() {
  const session = getSession();
  const isReadOnlyUser = Boolean(session?.approved && isReadOnlyPortalRole(session.role));
  const defaultTarget = getDefaultVacationTargetMonth();
  const [year, setYear] = useState(defaultTarget.year);
  const [month, setMonth] = useState(defaultTarget.month);
  const [activeType, setActiveType] = useState<VacationType>("연차");
  const [annualSelectedDateKeys, setAnnualSelectedDateKeys] = useState<string[]>([]);
  const [compensatorySelectedDateKeys, setCompensatorySelectedDateKeys] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [calendarDateItems, setCalendarDateItems] = useState<VacationCalendarDateItem[]>([]);
  const [managedDateKeys, setManagedDateKeys] = useState<string[]>([]);

  // Extra unit state
  const [openExtraUnits, setOpenExtraUnits] = useState<VacationExtraUnit[]>([]);
  const [extraMessage, setExtraMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  // Per-unit selected dates and type: keyed by unitId
  const [extraSelections, setExtraSelections] = useState<Record<string, { dates: string[]; type: "연차" | "대휴" }>>({});

  const syncFromCache = useCallback(() => {
    setRequests(getVacationRequests());
    setCalendarDateItems(getVacationCalendarDateItems(year, month, session?.username ?? ""));
    setManagedDateKeys(getVacationManagedDateKeys(year, month));
  }, [month, session?.username, year]);

  const loadRequests = useCallback(async () => {
    await Promise.all([refreshPublishedSchedules({ repair: false }), refreshVacationStore()]);
    syncFromCache();
  }, [syncFromCache]);

  const syncExtraFromCache = useCallback(() => {
    const units = getOpenExtraUnits();
    setOpenExtraUnits(units);
    // Pre-populate selections from existing own requests
    setExtraSelections((prev) => {
      const next = { ...prev };
      units.forEach((unit) => {
        if (next[unit.id]) return;
        const ownReqs = getExtraRequestsForUnit(unit.id).filter(
          (r) => r.requesterId === session?.id || r.requesterName === session?.username,
        );
        if (ownReqs.length > 0) {
          const firstReq = ownReqs[0];
          next[unit.id] = { dates: firstReq.dates, type: firstReq.type === "대휴" ? "대휴" : "연차" };
        } else {
          next[unit.id] = { dates: [], type: "연차" };
        }
      });
      return next;
    });
  }, [session?.id, session?.username]);

  const loadExtraUnits = useCallback(async () => {
    await refreshExtraStore();
    syncExtraFromCache();
  }, [syncExtraFromCache]);

  useEffect(() => {
    void loadRequests();
    void loadExtraUnits();
    const onFocusRefresh = () => { void loadRequests(); void loadExtraUnits(); };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail || detail.ok) return;
      setMessage({ tone: "warn", text: detail.message });
    };
    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(VACATION_EVENT, syncFromCache);
    window.addEventListener(VACATION_STATUS_EVENT, onStatus);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(VACATION_EVENT, syncFromCache);
      window.removeEventListener(VACATION_STATUS_EVENT, onStatus);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncFromCache);
    };
  }, [loadRequests, syncFromCache, loadExtraUnits]);

  useEffect(() => {
    const onExtraChange = () => syncExtraFromCache();
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
  }, [syncExtraFromCache]);

  useEffect(() => {
    const selectableDateSet = new Set(
      calendarDateItems
        .filter((item) => !item.blocked)
        .map((item) => item.dateKey),
    );
    setAnnualSelectedDateKeys((current) => current.filter((dateKey) => selectableDateSet.has(dateKey)));
    setCompensatorySelectedDateKeys((current) => current.filter((dateKey) => selectableDateSet.has(dateKey)));
  }, [calendarDateItems]);

  const monthRequests = useMemo(
    () => requests.filter((request) => request.year === year && request.month === month),
    [requests, year, month],
  );
  const myMonthRequests = useMemo(
    () => monthRequests.filter((request) => (
      session?.id
        ? request.requesterId === session.id
        : request.requesterName === session?.username
    )),
    [monthRequests, session?.id, session?.username],
  );
  const requestCalendarCells = useMemo(() => buildVacationCalendarCells(calendarDateItems), [calendarDateItems]);
  const requestLoadByDate = useMemo(() => {
    const map = new Map<string, VacationApplicantBadge[]>();
    monthRequests.forEach((request) => {
      request.dates.forEach((dateKey) => {
        const current = map.get(dateKey) ?? [];
        const applicant = {
          name: request.requesterName,
          type: request.type === "대휴" ? "대휴" : "연차",
        } satisfies VacationApplicantBadge;
        if (!current.some((item) => item.name === applicant.name && item.type === applicant.type)) {
          current.push(applicant);
        }
        map.set(
          dateKey,
          current.sort((left, right) => left.name.localeCompare(right.name, "ko") || left.type.localeCompare(right.type, "ko")),
        );
      });
    });
    return map;
  }, [monthRequests]);
  const hasManagedSchedule = managedDateKeys.length > 0;
  const allowedDaySummary = useMemo(() => formatAllowedDateSummary(managedDateKeys), [managedDateKeys]);
  const annualSelectedDateSummary = useMemo(() => formatDateList(annualSelectedDateKeys), [annualSelectedDateKeys]);
  const compensatorySelectedDateSummary = useMemo(() => formatDateList(compensatorySelectedDateKeys), [compensatorySelectedDateKeys]);

  useEffect(() => {
    setAnnualSelectedDateKeys(getSelectedVacationDateKeys(myMonthRequests, "연차"));
    setCompensatorySelectedDateKeys(getSelectedVacationDateKeys(myMonthRequests, "대휴"));
  }, [myMonthRequests]);

  const handleSubmit = () => {
    if (isReadOnlyUser) {
      setMessage({ tone: "warn", text: "현재 계정은 조회 전용이라 휴가 신청을 제출할 수 없습니다." });
      return;
    }
    if (!hasManagedSchedule) {
      setMessage({ tone: "warn", text: `${year}년 ${month}월 홈 게시 근무표가 아직 없어 휴가를 신청할 수 없습니다.` });
      return;
    }

    if (annualSelectedDateKeys.length === 0 && compensatorySelectedDateKeys.length === 0) {
      setMessage({ tone: "warn", text: "연차 또는 대휴 날짜를 달력에서 선택해 주세요." });
      return;
    }

    if (!window.confirm("신청하시겠습니까?")) {
      return;
    }

    const result = submitVacationRequests({
      requesterId: session?.id ?? null,
      requesterName: session?.username ?? "",
      year,
      month,
      annualRawDates: annualSelectedDateKeys.join(","),
      compensatoryRawDates: compensatorySelectedDateKeys.join(","),
    });

    setMessage({
      tone: result.ok ? "ok" : "warn",
      text: result.message,
    });

    if (result.ok) {
      void loadRequests();
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">휴가 신청</div>
            </div>
          </div>
          {isReadOnlyUser ? <div className="status note">현재 계정은 조회 전용이라 날짜 선택과 신청 제출을 할 수 없습니다.</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
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
            <label style={{ display: "grid", gap: 8 }}>
              <span>신청자</span>
              <input className="field-input" value={session?.username ?? ""} disabled />
            </label>
          </div>

          {hasManagedSchedule ? (
            <div className="status note">
              신청 가능 날짜 범위: {allowedDaySummary}. 이 범위 안에서 신청가능합니다.
            </div>
          ) : (
            <div className="status note">
              {year}년 {month}월 홈 게시 근무표가 아직 없습니다. 먼저 DESK 페이지에서 해당 월 근무표를 작성하고 홈에 게시해 주세요.
            </div>
          )}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted">신청 종류</span>
              {(["연차", "대휴"] as VacationType[]).map((type) => {
                const selected = activeType === type;
                const toneStyle = type === "연차"
                  ? {
                      border: selected ? "2px solid #ffffff" : "1px solid rgba(96,165,250,.35)",
                      background: selected ? "rgba(59,130,246,.22)" : "rgba(59,130,246,.08)",
                      color: selected ? "#ffffff" : "#bfdbfe",
                      fontWeight: selected ? 800 : undefined,
                    }
                  : {
                      border: selected ? "2px solid #ffffff" : "1px solid rgba(74,222,128,.35)",
                      background: selected ? "rgba(16,185,129,.22)" : "rgba(16,185,129,.08)",
                      color: selected ? "#ffffff" : "#bbf7d0",
                      fontWeight: selected ? 800 : undefined,
                    };
                return (
                  <button
                    key={type}
                    type="button"
                    className="btn"
                    disabled={isReadOnlyUser}
                    onClick={() => setActiveType(type)}
                    style={toneStyle}
                  >
                    {type}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              <span className="muted">
                {annualSelectedDateKeys.length > 0 ? `연차: ${annualSelectedDateSummary}` : "연차: 선택 없음"}
              </span>
              <span className="muted">
                {compensatorySelectedDateKeys.length > 0 ? `대휴: ${compensatorySelectedDateSummary}` : "대휴: 선택 없음"}
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8, minWidth: 600 }}>
                {vacationWeekdayLabels.map((label) => (
                  <div
                    key={`selector-${label}`}
                    style={{
                      textAlign: "center",
                      padding: "6px 4px",
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "rgba(255,255,255,.03)",
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  >
                    {label}
                  </div>
                ))}
                {requestCalendarCells.map((cell, index) => {
                  if (!cell.dateKey || !cell.day) {
                    return <div key={`selector-blank-${index}`} style={{ minHeight: 104 }} />;
                  }
                  const annualSelected = annualSelectedDateKeys.includes(cell.dateKey);
                  const compensatorySelected = compensatorySelectedDateKeys.includes(cell.dateKey);
                  const selected = annualSelected || compensatorySelected;
                  const myDutyPreview = cell.myDutyLabels.join(", ");
                  const selectionTone = annualSelected
                    ? {
                        border: "1px solid rgba(96,165,250,.56)",
                        background: "rgba(59,130,246,.22)",
                        color: "#dbeafe",
                      }
                    : compensatorySelected
                      ? {
                        border: "1px solid rgba(74,222,128,.48)",
                        background: "rgba(16,185,129,.2)",
                        color: "#d1fae5",
                      }
                      : null;

                  return (
                    <button
                      key={`selector-${cell.dateKey}`}
                      type="button"
                      disabled={cell.blocked || isReadOnlyUser}
                      onClick={() => {
                        if (isReadOnlyUser) return;
                        const dateKey = cell.dateKey as string;
                        if (annualSelected || compensatorySelected) {
                          setAnnualSelectedDateKeys((current) => current.filter((item) => item !== dateKey));
                          setCompensatorySelectedDateKeys((current) => current.filter((item) => item !== dateKey));
                          return;
                        }
                        if (activeType === "연차") {
                          setAnnualSelectedDateKeys((current) =>
                            [...current, dateKey].sort((left, right) => left.localeCompare(right)),
                          );
                          setCompensatorySelectedDateKeys((current) => current.filter((item) => item !== dateKey));
                          return;
                        }
                        setCompensatorySelectedDateKeys((current) =>
                          [...current, dateKey].sort((left, right) => left.localeCompare(right)),
                        );
                        setAnnualSelectedDateKeys((current) => current.filter((item) => item !== dateKey));
                      }}
                      style={{
                        minHeight: 104,
                        padding: 10,
                        borderRadius: 16,
                        border: cell.blocked
                          ? "1px solid rgba(248,113,113,.5)"
                          : selected
                            ? selectionTone?.border
                            : "1px solid rgba(255,255,255,.08)",
                        background: cell.blocked
                          ? "rgba(248,113,113,.2)"
                          : selected
                            ? selectionTone?.background
                            : "rgba(255,255,255,.03)",
                        color: cell.blocked ? "#fecaca" : selected ? selectionTone?.color : "#f8fbff",
                        display: "grid",
                        gap: 6,
                        alignContent: "start",
                        textAlign: "left",
                        cursor: cell.blocked ? "not-allowed" : "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <strong style={{ fontSize: 16 }}>{cell.day}</strong>
                        {selected ? (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 800,
                              lineHeight: 1.2,
                            }}
                          >
                            {annualSelected ? "연차" : compensatorySelected ? "대휴" : ""}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                        {cell.blocked ? "신청불가" : selected ? `${annualSelected ? "연차" : "대휴"} 선택됨` : `${activeType}로 선택`}
                      </div>
                      {myDutyPreview ? (
                        <div
                          style={{
                            fontSize: 13,
                            lineHeight: 1.45,
                            color: cell.blocked ? "#fecaca" : "#9bd1ff",
                            wordBreak: "keep-all",
                          }}
                        >
                          내 근무:{" "}
                          {cell.myDutyLabels.map((label, labelIndex) => (
                            <span key={`${cell.dateKey}-my-duty-${label}-${labelIndex}`}>
                              {labelIndex > 0 ? ", " : ""}
                              {label === "일반" ? <strong>{label}</strong> : label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary" onClick={handleSubmit} disabled={isReadOnlyUser || !hasManagedSchedule}>
              신청
            </button>
          </div>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div className="chip">내 신청 내역</div>
          {myMonthRequests.length > 0 ? (
            <>
              {myMonthRequests.map((request) => (
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
                    {request.year}년 {request.month}월 · {request.type}
                  </strong>
                  <span>{formatDateList(request.dates)}</span>
                  <span className="muted">{request.createdAt}</span>
                </article>
              ))}
            </>
          ) : (
            <div className="status note">
              {year}년 {month}월에 제출한 휴가 신청이 없습니다.
            </div>
          )}

          <section style={{ display: "grid", gap: 12, marginTop: 8 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className="chip">전체 신청 현황</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8, minWidth: 600 }}>
                {vacationWeekdayLabels.map((label) => (
                  <div
                    key={label}
                    style={{
                      textAlign: "center",
                      padding: "6px 4px",
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "rgba(255,255,255,.03)",
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  >
                    {label}
                  </div>
                ))}
                {requestCalendarCells.map((cell, index) => {
                  if (!cell.dateKey || !cell.day) {
                    return <div key={`blank-${index}`} style={{ minHeight: 104 }} />;
                  }
                  const applicants = requestLoadByDate.get(cell.dateKey) ?? [];
                  const blocked = cell.blocked;
                  return (
                    <article
                      key={cell.dateKey}
                      style={{
                        minHeight: 104,
                        padding: 10,
                        borderRadius: 16,
                        border: blocked
                          ? "1px solid rgba(248,113,113,.5)"
                          : applicants.length > 0
                            ? "1px solid rgba(34,211,238,.34)"
                            : "1px solid rgba(255,255,255,.08)",
                        background: "transparent",
                        display: "grid",
                        gap: 6,
                        alignContent: "start",
                        opacity: 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <strong style={{ fontSize: 16, color: blocked ? "#fecaca" : undefined }}>{cell.day}</strong>
                        {!blocked && applicants.length > 0 ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: 28,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "rgba(8,145,178,.18)",
                              color: "#cffafe",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {applicants.length}명
                          </span>
                        ) : null}
                      </div>
                      {blocked ? (
                        <div
                          className="muted"
                          style={{ fontSize: 12, lineHeight: 1.5, color: "#fecaca" }}
                        >
                          신청불가
                        </div>
                      ) : applicants.length > 0 ? (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "flex-start" }}>
                          {applicants.map((applicant) => {
                            const tone = vacationStyleTones[applicant.type];
                            return (
                              <span
                                key={`${cell.dateKey}-${applicant.type}-${applicant.name}`}
                                title={`${applicant.name} · ${applicant.type}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  maxWidth: "100%",
                                  padding: "2px 7px",
                                  borderRadius: 999,
                                  border: tone.border,
                                  background: tone.background,
                                  color: tone.color,
                                  fontSize: 12,
                                  fontWeight: 800,
                                  lineHeight: 1.35,
                                  wordBreak: "keep-all",
                                }}
                              >
                                {applicant.name}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                          신청 없음
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </section>

      {/* ── 추가 휴가 신청 ─────────────────────────────────────────────────── */}
      {openExtraUnits.length > 0 ? (
        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">추가 신청</div>
              <strong style={{ fontSize: 20 }}>추가 휴가 신청</strong>
              <span className="muted">DESK에서 지정한 날짜에 한해 별도 추첨으로 반영합니다.</span>
            </div>

            {extraMessage ? (
              <div className={`status ${extraMessage.tone}`}>{extraMessage.text}</div>
            ) : null}

            {openExtraUnits.map((unit) => {
              const sel = extraSelections[unit.id] ?? { dates: [], type: "연차" as const };
              const unitDateSet = new Set(unit.dateKeys);
              const myOwnReqs = getExtraRequestsForUnit(unit.id).filter(
                (r) => r.requesterId === session?.id || r.requesterName === session?.username,
              );
              const alreadySubmitted = myOwnReqs.length > 0;
              const hasLottery =
                Object.values(unit.annualWinners).some((ns) => ns.length > 0) ||
                Object.values(unit.compensatoryWinners).some((ns) => ns.length > 0);
              const myWinners = hasLottery
                ? myOwnReqs
                    .flatMap((r) =>
                      r.dates.filter((dk) => {
                        const winners =
                          r.type === "대휴"
                            ? unit.compensatoryWinners[dk] ?? []
                            : unit.annualWinners[dk] ?? [];
                        return winners.includes(r.requesterName);
                      }),
                    )
                    .sort()
                : [];

              return (
                <article
                  key={unit.id}
                  style={{
                    display: "grid",
                    gap: 14,
                    padding: 16,
                    borderRadius: 16,
                    border: "1px solid rgba(250,204,21,.25)",
                    background: "rgba(250,204,21,.05)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong style={{ fontSize: 16 }}>{unit.label}</strong>
                      <span className="muted" style={{ fontSize: 13 }}>
                        {unit.targetYear}년 {unit.targetMonth}월 · {unit.dateKeys.length}일 신청 가능
                      </span>
                    </div>
                    {alreadySubmitted ? (
                      <span
                        style={{
                          padding: "4px 12px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 800,
                          background: "rgba(74,222,128,.2)",
                          border: "1px solid rgba(74,222,128,.4)",
                          color: "#bbf7d0",
                        }}
                      >
                        신청 완료
                      </span>
                    ) : null}
                  </div>

                  {/* 당첨 결과 표시 */}
                  {hasLottery ? (
                    <div
                      className="status note"
                      style={{ display: "grid", gap: 6 }}
                    >
                      <strong style={{ fontSize: 14 }}>추첨 결과</strong>
                      {myWinners.length > 0 ? (
                        <span>
                          당첨 날짜: {myWinners.map((dk) => {
                            const [, m, d] = dk.split("-").map(Number);
                            return `${m}/${d}`;
                          }).join(", ")}
                        </span>
                      ) : (
                        <span className="muted">이번 추가 추첨에서 당첨되지 않았습니다.</span>
                      )}
                    </div>
                  ) : null}

                  {/* 신청 폼 (추첨 전에만 표시) */}
                  {!hasLottery ? (
                    <>
                      {isReadOnlyUser ? (
                        <div className="status note">현재 계정은 조회 전용이라 신청할 수 없습니다.</div>
                      ) : null}

                      {/* 휴가 종류 선택 */}
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>종류</span>
                        {(["연차", "대휴"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            disabled={isReadOnlyUser}
                            onClick={() =>
                              setExtraSelections((prev) => ({
                                ...prev,
                                [unit.id]: { ...sel, type: t },
                              }))
                            }
                            style={{
                              padding: "6px 16px",
                              borderRadius: 999,
                              fontSize: 13,
                              fontWeight: 700,
                              border:
                                sel.type === t
                                  ? "2px solid rgba(250,204,21,.8)"
                                  : "1px solid rgba(255,255,255,.2)",
                              background:
                                sel.type === t
                                  ? "rgba(250,204,21,.15)"
                                  : "rgba(255,255,255,.06)",
                              color: sel.type === t ? "#fef08a" : "var(--text)",
                              cursor: isReadOnlyUser ? "not-allowed" : "pointer",
                              opacity: isReadOnlyUser ? 0.5 : 1,
                            }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>

                      {/* 날짜 선택 */}
                      <div style={{ display: "grid", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>날짜 선택 (복수 가능)</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {unit.dateKeys.filter((dk) => unitDateSet.has(dk)).map((dk) => {
                            const [, m, d] = dk.split("-").map(Number);
                            const selected = sel.dates.includes(dk);
                            return (
                              <button
                                key={dk}
                                type="button"
                                disabled={isReadOnlyUser}
                                onClick={() =>
                                  setExtraSelections((prev) => {
                                    const cur = prev[unit.id] ?? { dates: [], type: "연차" as const };
                                    const next = selected
                                      ? cur.dates.filter((d2) => d2 !== dk)
                                      : [...cur.dates, dk].sort();
                                    return { ...prev, [unit.id]: { ...cur, dates: next } };
                                  })
                                }
                                style={{
                                  padding: "6px 13px",
                                  borderRadius: 999,
                                  fontSize: 13,
                                  fontWeight: 700,
                                  border: selected
                                    ? "2px solid rgba(250,204,21,.8)"
                                    : "1px solid rgba(255,255,255,.2)",
                                  background: selected
                                    ? "rgba(250,204,21,.15)"
                                    : "rgba(255,255,255,.06)",
                                  color: selected ? "#fef08a" : "var(--text)",
                                  cursor: isReadOnlyUser ? "not-allowed" : "pointer",
                                  opacity: isReadOnlyUser ? 0.5 : 1,
                                }}
                              >
                                {m}/{d}
                              </button>
                            );
                          })}
                        </div>
                        {sel.dates.length > 0 ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            선택: {sel.dates.map((dk) => {
                              const [, m, d] = dk.split("-").map(Number);
                              return `${m}/${d}`;
                            }).join(", ")} ({sel.dates.length}일)
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>날짜를 선택해 주세요.</span>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn primary"
                        disabled={isReadOnlyUser || sel.dates.length === 0}
                        onClick={async () => {
                          if (!window.confirm(`'${unit.label}'에 ${sel.type} 추가 신청하시겠습니까?`)) return;
                          const result = await submitExtraRequest({
                            unitId: unit.id,
                            requesterName: session?.username ?? "",
                            type: sel.type,
                            dates: sel.dates,
                          });
                          setExtraMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                          if (result.ok) await loadExtraUnits();
                        }}
                      >
                        {alreadySubmitted ? "수정 신청" : "추가 신청"}
                      </button>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
