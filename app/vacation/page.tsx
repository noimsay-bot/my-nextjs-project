"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSession, hasDeskAccess } from "@/lib/auth/storage";
import { SCHEDULE_MONTHS, SCHEDULE_YEARS } from "@/lib/schedule/constants";
import { VacationType } from "@/lib/schedule/types";
import {
  createVacationRequest,
  getVacationManagedDateKeys,
  getVacationRequests,
  VACATION_EVENT,
  VacationRequest,
} from "@/lib/vacation/storage";

function formatDateList(dateKeys: string[]) {
  return dateKeys
    .map((dateKey) => `${Number(dateKey.split("-")[2])}일`)
    .join(", ");
}

function sanitizeVacationDateInput(value: string) {
  return value.replace(/[^0-9,]/g, "");
}

export default function VacationPage() {
  const session = getSession();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [annualDates, setAnnualDates] = useState("");
  const [compensatoryDates, setCompensatoryDates] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [managedDateKeys, setManagedDateKeys] = useState<string[]>([]);

  const loadRequests = () => {
    setRequests(getVacationRequests());
    setManagedDateKeys(getVacationManagedDateKeys(year, month));
  };

  useEffect(() => {
    loadRequests();
    const onRefresh = () => loadRequests();
    window.addEventListener("storage", onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener(VACATION_EVENT, onRefresh);
    return () => {
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(VACATION_EVENT, onRefresh);
    };
  }, [year, month]);

  const myRequests = useMemo(
    () => requests.filter((request) => (
      session?.id
        ? request.requesterId === session.id
        : request.requesterName === session?.username
    )),
    [requests, session?.id, session?.username],
  );
  const hasManagedSchedule = managedDateKeys.length > 0;
  const allowedDaySummary = managedDateKeys.length > 0
    ? `${Number(managedDateKeys[0].split("-")[2])}일 ~ ${Number(managedDateKeys[managedDateKeys.length - 1].split("-")[2])}일`
    : null;

  const submitRequest = (type: VacationType, rawDates: string) => {
    return createVacationRequest({
      requesterId: session?.id ?? null,
      requesterName: session?.username ?? "",
      type,
      year,
      month,
      rawDates,
    });
  };

  const handleSubmit = () => {
    const annualInput = annualDates.trim();
    const compensatoryInput = compensatoryDates.trim();

    if (!hasManagedSchedule) {
      setMessage({ tone: "warn", text: `${year}년 ${month}월 DESK 근무표가 아직 작성되지 않아 휴가를 신청할 수 없습니다.` });
      return;
    }

    if (!annualInput && !compensatoryInput) {
      setMessage({ tone: "warn", text: "연차 또는 대휴 날짜를 입력해 주세요." });
      return;
    }

    if (!window.confirm("휴가 신청을 제출하시겠습니까?")) {
      return;
    }

    const results: string[] = [];
    let hasSuccess = false;
    let hasFailure = false;

    if (annualInput) {
      const annualResult = submitRequest("연차", annualInput);
      results.push(`연차: ${annualResult.message}`);
      hasSuccess = hasSuccess || annualResult.ok;
      hasFailure = hasFailure || !annualResult.ok;
      if (annualResult.ok) setAnnualDates("");
    }

    if (compensatoryInput) {
      const compensatoryResult = submitRequest("대휴", compensatoryInput);
      results.push(`대휴: ${compensatoryResult.message}`);
      hasSuccess = hasSuccess || compensatoryResult.ok;
      hasFailure = hasFailure || !compensatoryResult.ok;
      if (compensatoryResult.ok) setCompensatoryDates("");
    }

    setMessage({
      tone: hasSuccess && !hasFailure ? "ok" : hasSuccess ? "note" : "warn",
      text: results.join(" "),
    });

    if (hasSuccess) {
      loadRequests();
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">휴가 신청</div>
              <strong style={{ fontSize: 22 }}>연차 / 대휴 신청 접수</strong>
              <span className="muted">
                숫자와 쉼표만 입력할 수 있습니다. 토요일과 일요일은 제외되며, DESK 근무표에 작성된 날짜만 신청할 수 있습니다.
              </span>
            </div>
            {hasDeskAccess(session?.role) ? (
              <Link href="/schedule/vacations" className="btn">
                DESK 휴가 관리
              </Link>
            ) : null}
          </div>

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
              신청 가능 날짜 범위: {allowedDaySummary} 평일만 접수됩니다.
            </div>
          ) : (
            <div className="status note">
              {year}년 {month}월 DESK 근무표가 아직 작성되지 않았습니다. 먼저 DESK 페이지에서 해당 월 근무표를 작성해 주세요.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <section
              style={{
                display: "grid",
                gap: 12,
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(125,211,252,.28)",
                background: "rgba(59,130,246,.08)",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <strong style={{ fontSize: 18 }}>연차 신청</strong>
                <span className="muted">연차로 신청할 날짜만 따로 입력해 주세요.</span>
              </div>
              <label style={{ display: "grid", gap: 8 }}>
                <span>연차 날짜</span>
                <input
                  className="field-input"
                  inputMode="numeric"
                  value={annualDates}
                  onChange={(event) => setAnnualDates(sanitizeVacationDateInput(event.target.value))}
                  placeholder="예: 1,3,5"
                />
              </label>
            </section>

            <section
              style={{
                display: "grid",
                gap: 12,
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(74,222,128,.28)",
                background: "rgba(16,185,129,.08)",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <strong style={{ fontSize: 18 }}>대휴 신청</strong>
                <span className="muted">대휴로 신청할 날짜만 따로 입력해 주세요.</span>
              </div>
              <label style={{ display: "grid", gap: 8 }}>
                <span>대휴 날짜</span>
                <input
                  className="field-input"
                  inputMode="numeric"
                  value={compensatoryDates}
                  onChange={(event) => setCompensatoryDates(sanitizeVacationDateInput(event.target.value))}
                  placeholder="예: 1,3,5"
                />
              </label>
            </section>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary" onClick={handleSubmit} disabled={!hasManagedSchedule}>
              휴가 신청
            </button>
            <span className="muted">
              입력한 날짜는 {year}년 {month}월 DESK 근무표의 평일 범위 안에서만 접수됩니다.
            </span>
          </div>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div className="chip">내 신청 내역</div>
          {myRequests.length > 0 ? (
            myRequests.map((request) => (
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
            ))
          ) : (
            <div className="status note">아직 제출한 휴가 신청이 없습니다.</div>
          )}
        </div>
      </section>
    </div>
  );
}
