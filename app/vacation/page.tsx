"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSession, hasDeskAccess } from "@/lib/auth/storage";
import { SCHEDULE_MONTHS, SCHEDULE_YEARS } from "@/lib/schedule/constants";
import { VacationType } from "@/lib/schedule/types";
import {
  createVacationRequest,
  getVacationRequests,
  VACATION_EVENT,
  VacationRequest,
} from "@/lib/vacation/storage";

function formatDateList(dateKeys: string[]) {
  return dateKeys
    .map((dateKey) => {
      const [, , day] = dateKey.split("-");
      return `${Number(day)}일`;
    })
    .join(", ");
}

export default function VacationPage() {
  const session = getSession();
  const today = new Date();
  const [type, setType] = useState<VacationType>("연차");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [rawDates, setRawDates] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [requests, setRequests] = useState<VacationRequest[]>([]);

  const loadRequests = () => {
    const next = getVacationRequests();
    setRequests(next);
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
  }, []);

  const myRequests = useMemo(
    () => requests.filter((request) => request.requesterName === session?.username),
    [requests, session?.username],
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">휴가 신청</div>
              <strong style={{ fontSize: 22 }}>연차 / 대휴 신청 접수</strong>
              <span className="muted">원하는 날짜를 쉼표로 구분해서 입력하면 DESK 휴가 달력으로 바로 전달됩니다.</span>
            </div>
            {hasDeskAccess(session?.role) ? (
              <Link href="/schedule/vacations" className="btn">
                DESK 휴가 관리
              </Link>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span>휴가 종류</span>
              <select className="field-select" value={type} onChange={(event) => setType(event.target.value as VacationType)}>
                <option value="연차">연차</option>
                <option value="대휴">대휴</option>
              </select>
            </label>
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
            <label style={{ display: "grid", gap: 8 }}>
              <span>신청자</span>
              <input className="field-input" value={session?.username ?? ""} disabled />
            </label>
          </div>

          <label style={{ display: "grid", gap: 8 }}>
            <span>원하는 날짜</span>
            <input
              className="field-input"
              value={rawDates}
              onChange={(event) => setRawDates(event.target.value)}
              placeholder="예: 4, 11, 18 또는 2026-06-04, 2026-06-11"
            />
            <span className="muted">입력한 날짜는 선택한 {year}년 {month}월 안에서만 접수됩니다.</span>
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn primary"
              onClick={() => {
                const result = createVacationRequest({
                  requesterId: session?.id ?? null,
                  requesterName: session?.username ?? "",
                  type,
                  year,
                  month,
                  rawDates,
                });
                setMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                if (result.ok) {
                  setRawDates("");
                  loadRequests();
                }
              }}
            >
              휴가 신청
            </button>
            <span className="muted">날짜별 추첨과 근무 반영은 DESK 휴가 관리 페이지에서 진행됩니다.</span>
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
