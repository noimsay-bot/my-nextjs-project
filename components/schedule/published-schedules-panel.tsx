"use client";

import { useEffect, useMemo, useState } from "react";
import { getSession } from "@/lib/auth/storage";
import {
  CHANGE_REQUESTS_EVENT,
  createScheduleChangeRequest,
  getScheduleChangeRequests,
  isPendingRef,
} from "@/lib/schedule/change-requests";
import { getPublishedSchedules, PublishedScheduleItem, removePublishedSchedule } from "@/lib/schedule/published";
import { DaySchedule, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];

function dayBadge(item: { isCustomHoliday: boolean; isWeekdayHoliday: boolean; isHoliday: boolean; isWeekend: boolean }) {
  if (item.isCustomHoliday) return "평일 휴일";
  if (item.isWeekdayHoliday) return "휴일";
  if (item.isHoliday) return "휴일";
  if (item.isWeekend) return "주말";
  return "";
}

function compactAssignments(item: PublishedScheduleItem, currentUser: string) {
  return item.schedule.days
    .filter((day) => Object.values(day.assignments).some((names) => names.includes(currentUser)))
    .map((day) => {
      const categories = Object.entries(day.assignments)
        .filter(([, names]) => names.includes(currentUser))
        .map(([category]) => category)
        .join(", ");
      return `${day.month}/${day.day} - ${categories}`;
    });
}

function buildDisplayDays(days: DaySchedule[], previousDays?: DaySchedule[], targetMonth?: number) {
  if (days.length === 0) return days;
  const first = days[0];
  if (targetMonth && first.month !== targetMonth) return days;
  const firstDate = new Date(first.year, first.month - 1, first.day);
  const firstDow = firstDate.getDay();
  const mondayOffset = firstDow === 0 ? 6 : firstDow - 1;
  if (mondayOffset === 0) return days;

  const leading: DaySchedule[] = [];
  for (let offset = mondayOffset; offset >= 1; offset -= 1) {
    const date = new Date(firstDate);
    date.setDate(firstDate.getDate() - offset);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const matched = previousDays?.find((item) => item.dateKey === dateKey);
    if (matched) {
      leading.push({ ...matched, isOverflowMonth: true });
      continue;
    }
    leading.push({
      dateKey,
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      dow: date.getDay(),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      isHoliday: false,
      isCustomHoliday: false,
      isWeekdayHoliday: false,
      isOverflowMonth: true,
      vacations: [],
      assignments: {},
      manualExtras: [],
      conflicts: [],
    });
  }

  return [...leading, ...days];
}

function sameRef(left: SchedulePersonRef | null, right: SchedulePersonRef | null) {
  if (!left || !right) return false;
  return (
    left.monthKey === right.monthKey &&
    left.dateKey === right.dateKey &&
    left.category === right.category &&
    left.index === right.index &&
    left.name === right.name
  );
}

function describeRef(ref: SchedulePersonRef | null) {
  if (!ref) return "";
  return `${ref.dateKey} ${ref.category} ${ref.name}`;
}

export function PublishedSchedulesPanel() {
  const [items, setItems] = useState<PublishedScheduleItem[]>([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedMineRef, setSelectedMineRef] = useState<SchedulePersonRef | null>(null);
  const [confirmTargetRef, setConfirmTargetRef] = useState<SchedulePersonRef | null>(null);
  const [requests, setRequests] = useState<ScheduleChangeRequest[]>([]);
  const [requestMessage, setRequestMessage] = useState("");
  const session = getSession();
  const canDelete = session?.role === "desk";
  const username = session?.username ?? "";

  const loadItems = () => {
    const nextItems = getPublishedSchedules();
    setItems(nextItems);
    setSelectedMonthKey((current) => current ?? nextItems[nextItems.length - 1]?.monthKey ?? null);
  };

  const loadRequests = () => {
    setRequests(getScheduleChangeRequests());
  };

  useEffect(() => {
    loadItems();
    loadRequests();
  }, []);

  useEffect(() => {
    const onRefresh = () => {
      loadItems();
      loadRequests();
    };
    window.addEventListener("storage", onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener(CHANGE_REQUESTS_EVENT, onRefresh);
    return () => {
      window.removeEventListener("storage", onRefresh);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(CHANGE_REQUESTS_EVENT, onRefresh);
    };
  }, []);

  const selectedItem = useMemo(() => {
    if (items.length === 0) return null;
    return items.find((item) => item.monthKey === selectedMonthKey) ?? items[items.length - 1];
  }, [items, selectedMonthKey]);

  const previousSelectedItem = useMemo(() => {
    if (!selectedItem) return null;
    const index = items.findIndex((item) => item.monthKey === selectedItem.monthKey);
    if (index <= 0) return null;
    return items[index - 1] ?? null;
  }, [items, selectedItem]);

  const selectedIndex = selectedItem ? items.findIndex((item) => item.monthKey === selectedItem.monthKey) : -1;
  const mine = selectedItem && username ? compactAssignments(selectedItem, username) : [];
  const pendingRequests = useMemo(
    () => requests.filter((item) => item.status === "pending" && (!selectedItem || item.monthKey === selectedItem.monthKey)),
    [requests, selectedItem],
  );
  const displayDays = useMemo(
    () => (selectedItem ? buildDisplayDays(selectedItem.schedule.days, previousSelectedItem?.schedule.days, selectedItem.schedule.month) : []),
    [previousSelectedItem, selectedItem],
  );

  const toggleEditMode = () => {
    setEditMode((current) => {
      const next = !current;
      if (!next) {
        setSelectedMineRef(null);
        setConfirmTargetRef(null);
      }
      return next;
    });
    setRequestMessage("");
  };

  const handleNameClick = (person: ScheduleNameObject) => {
    if (!editMode || !username || person.pending) return;
    if (!selectedMineRef) {
      if (person.name !== username) return;
      setSelectedMineRef(person.ref);
      setRequestMessage("");
      return;
    }
    if (sameRef(selectedMineRef, person.ref)) {
      setSelectedMineRef(null);
      setConfirmTargetRef(null);
      return;
    }
    if (person.name === username) {
      setSelectedMineRef(person.ref);
      setConfirmTargetRef(null);
      return;
    }
    setConfirmTargetRef(person.ref);
    setRequestMessage("");
  };

  const onConfirmRequest = () => {
    if (!session || !selectedItem || !selectedMineRef || !confirmTargetRef) return;
    createScheduleChangeRequest({
      monthKey: selectedItem.monthKey,
      requesterId: session.id,
      requesterName: session.username,
      source: selectedMineRef,
      target: confirmTargetRef,
    });
    loadRequests();
    setRequestMessage("근무 변경 요청을 등록했습니다.");
    setSelectedMineRef(null);
    setConfirmTargetRef(null);
  };

  if (items.length === 0) {
    return (
      <section className="panel">
        <div className="panel-pad">
          <div className="chip">게시된 근무표</div>
          <div className="status note" style={{ marginTop: 16 }}>게시된 근무표가 없습니다.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div className="chip">게시된 근무표</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">{username ? `${username} 기준` : "로그인 사용자 없음"}</span>
            <button className="btn" disabled={!username} onClick={() => setShowMine((current) => !current)}>
              {showMine ? "전체 보기" : "내 근무 보기"}
            </button>
            <button className={`btn ${editMode ? "white" : ""}`} disabled={!username} onClick={toggleEditMode}>
              {editMode ? "근무 수정 완료" : "근무 수정"}
            </button>
          </div>
        </div>

        {editMode && username ? (
          <div className="status note">먼저 내 이름을 누르고, 바꿀 상대 이름을 누르면 변경 요청 확인이 뜹니다.</div>
        ) : null}
        {requestMessage ? <div className="status ok">{requestMessage}</div> : null}
        {confirmTargetRef && selectedMineRef ? (
          <div className="status warn" style={{ display: "grid", gap: 10 }}>
            <span>근무변경을 요청하시겠습니까?</span>
            <span className="muted">{describeRef(selectedMineRef)} → {describeRef(confirmTargetRef)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" onClick={onConfirmRequest}>확인</button>
              <button className="btn" onClick={() => setConfirmTargetRef(null)}>취소</button>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {items.map((item) => (
              <button
                key={item.monthKey}
                className={`btn ${selectedItem?.monthKey === item.monthKey ? "white" : ""}`}
                onClick={() => setSelectedMonthKey(item.monthKey)}
              >
                {item.schedule.year}년 {item.schedule.month}월
              </button>
            ))}
          </div>
          {selectedItem ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn" disabled={selectedIndex <= 0} onClick={() => setSelectedMonthKey(items[selectedIndex - 1]?.monthKey ?? null)}>
                ← 이전
              </button>
              <strong>{selectedItem.title}</strong>
              <button className="btn" disabled={selectedIndex < 0 || selectedIndex >= items.length - 1} onClick={() => setSelectedMonthKey(items[selectedIndex + 1]?.monthKey ?? null)}>
                다음 →
              </button>
              {canDelete ? (
                <button
                  className="btn"
                  onClick={() => {
                    const ok = window.confirm(`${selectedItem.title} 게시를 삭제하시겠습니까?`);
                    if (!ok) return;
                    const next = removePublishedSchedule(selectedItem.monthKey);
                    setItems(next);
                    setSelectedMonthKey(next[next.length - 1]?.monthKey ?? null);
                  }}
                >
                  게시 삭제
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {selectedItem ? (
          <>
            <div className="muted">게시 {selectedItem.publishedAt}</div>

            {showMine && username ? (
              mine.length > 0 ? (
                <div className="status ok">{mine.join(" | ")}</div>
              ) : (
                <div className="status note">내 이름으로 배정된 근무가 없습니다.</div>
              )
            ) : null}

            <div style={{ overflowX: "auto", overflowY: "visible" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
                {weekdayLabels.map((label) => (
                  <div key={label} style={{ textAlign: "center", padding: "6px 4px", borderRadius: 12, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)", fontWeight: 800, fontSize: 12 }}>
                    {label}
                  </div>
                ))}
                {displayDays.map((day) => (
                  <article
                    key={day.dateKey}
                    className="panel"
                    style={{
                      padding: 8,
                      minHeight: 210,
                      opacity: day.isOverflowMonth ? 0.55 : 1,
                      background: day.isOverflowMonth ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.14)",
                      border: "1px solid rgba(255,255,255,.18)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 17, fontWeight: 900 }}>{day.month}/{day.day}</div>
                      {dayBadge(day) ? (
                        <span style={{ padding: "2px 7px", borderRadius: 999, background: day.isWeekend ? "rgba(245,158,11,.16)" : "rgba(239,68,68,.16)", fontSize: 10 }}>
                          {dayBadge(day)}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {Object.entries(day.assignments).map(([category, names]) => (
                        <div key={`${day.dateKey}-${category}`} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: 6, background: "rgba(9,17,30,.34)" }}>
                          <strong style={{ display: "block", marginBottom: 0, fontSize: 12, lineHeight: 1.2, minWidth: 42 }}>{category}</strong>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginLeft: 48, marginTop: -16 }}>
                            {names.length > 0 ? (
                              names.map((name, index) => {
                                const ref: SchedulePersonRef = {
                                  monthKey: selectedItem.monthKey,
                                  dateKey: day.dateKey,
                                  category,
                                  index,
                                  name,
                                };
                                const personObject: ScheduleNameObject = {
                                  key: `${category}-${name}-${index}`,
                                  name,
                                  ref,
                                  pending: isPendingRef(pendingRequests, ref),
                                };
                                const highlighted =
                                  (showMine && username && username === name) ||
                                  (editMode && username && username === name);
                                const selected = sameRef(selectedMineRef, ref);
                                return (
                                  <button
                                    key={personObject.key}
                                    type="button"
                                    onClick={() => handleNameClick(personObject)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 6,
                                      padding: "2px 6px",
                                      borderRadius: 999,
                                      background: personObject.pending
                                        ? "rgba(245,158,11,.18)"
                                        : highlighted
                                          ? "rgba(34,211,238,.22)"
                                          : "rgba(255,255,255,.16)",
                                      border: selected
                                        ? "1px solid rgba(56,189,248,.8)"
                                        : personObject.pending
                                          ? "1px solid rgba(245,158,11,.35)"
                                          : highlighted
                                            ? "1px solid rgba(34,211,238,.35)"
                                            : "1px solid transparent",
                                      color: "#f8fbff",
                                      fontWeight: 700,
                                      fontSize: 12,
                                      lineHeight: 1.2,
                                      cursor: editMode && !personObject.pending ? "pointer" : "default",
                                    }}
                                  >
                                    <span>{personObject.name}</span>
                                    {personObject.pending ? <span style={{ fontSize: 11 }}>근무변경요청중</span> : null}
                                  </button>
                                );
                              })
                            ) : (
                              <span className="muted">배정 없음</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
