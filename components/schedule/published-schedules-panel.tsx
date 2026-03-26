"use client";

import { useEffect, useMemo, useState } from "react";
import { getSession, hasDeskAccess } from "@/lib/auth/storage";
import { getScheduleCategoryLabel } from "@/lib/schedule/constants";
import {
  CHANGE_REQUESTS_EVENT,
  createScheduleChangeRequest,
  getScheduleChangeRequests,
  isPendingRef,
} from "@/lib/schedule/change-requests";
import { parseVacationEntry } from "@/lib/schedule/engine";
import { getPublishedSchedules, PublishedScheduleItem, removePublishedSchedule } from "@/lib/schedule/published";
import { DaySchedule, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];

const vacationLegendStyles = {
  연차: {
    background: "rgba(59,130,246,.22)",
    border: "1px solid rgba(96,165,250,.5)",
    color: "#dbeafe",
  },
  대휴: {
    background: "rgba(16,185,129,.22)",
    border: "1px solid rgba(52,211,153,.5)",
    color: "#d1fae5",
  },
} as const;

function getAssignmentDisplay(category: string, value: string) {
  if (category !== "휴가") {
    return {
      name: value,
      chipStyle: null,
    };
  }
  const parsed = parseVacationEntry(value);
  return {
    name: parsed.name,
    chipStyle: vacationLegendStyles[parsed.type],
  };
}

function dayBadge(item: { isCustomHoliday: boolean; isWeekdayHoliday: boolean; isHoliday: boolean; isWeekend: boolean }) {
  if (item.isCustomHoliday || item.isWeekdayHoliday) return "평일 휴일";
  if (item.isHoliday) return "휴일";
  return "";
}

function getCenteredDayLabel(day: DaySchedule) {
  if (day.isWeekend) return "";
  return dayBadge(day);
}

function getDayCardStyle(day: DaySchedule) {
  const isRedDay = day.isWeekend || day.isWeekdayHoliday;
  if (isRedDay) {
    return {
      background: day.isOverflowMonth ? "rgba(239,68,68,.18)" : "rgba(239,68,68,.28)",
      border: "1px solid rgba(248,113,113,.45)",
    };
  }
  return {
    background: day.isOverflowMonth ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.14)",
    border: "1px solid rgba(255,255,255,.18)",
  };
}

function compactAssignments(item: PublishedScheduleItem, currentUser: string) {
  return item.schedule.days
    .filter((day) => Object.values(day.assignments).some((names) => names.includes(currentUser)))
    .map((day) => {
      const categories = Object.entries(day.assignments)
        .filter(([, names]) => names.includes(currentUser))
        .map(([category]) => getScheduleCategoryLabel(category))
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
  return `${ref.dateKey} ${getScheduleCategoryLabel(ref.category)} ${ref.name}`;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDateKey() {
  return toDateKey(new Date());
}

function getPreviousDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
}

function getNextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return toDateKey(date);
}

function buildDayIndex(items: PublishedScheduleItem[]) {
  const index = new Map<string, DaySchedule>();
  items.forEach((item) => {
    item.schedule.days.forEach((day) => {
      index.set(day.dateKey, day);
    });
  });
  return index;
}

function hasAssignmentOnDay(day: DaySchedule | undefined, name: string) {
  if (!day) return false;
  return Object.values(day.assignments).some((names) => names.includes(name));
}

function isHolidayLikeDay(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const day = dayIndex.get(dateKey);
  return Boolean(day && (day.isWeekend || day.isHoliday));
}

function isFridayDay(dayIndex: Map<string, DaySchedule>, dateKey: string) {
  const day = dayIndex.get(dateKey);
  return day?.dow === 5;
}

function hasWorkAfterNightShift(dayIndex: Map<string, DaySchedule>, name: string, dateKey: string) {
  const nextDay = dayIndex.get(getNextDateKey(dateKey));
  return hasAssignmentOnDay(nextDay, name);
}

function hadNightShiftPreviousDay(dayIndex: Map<string, DaySchedule>, name: string, dateKey: string) {
  const previousDay = dayIndex.get(getPreviousDateKey(dateKey));
  return (previousDay?.assignments["야근"] ?? []).includes(name);
}

function isSwapCandidateValid(
  source: SchedulePersonRef,
  target: SchedulePersonRef,
  dayIndex: Map<string, DaySchedule>,
  todayKey: string,
) {
  const categoryLabel = getScheduleCategoryLabel(source.category);
  if (source.category !== target.category) return false;
  if (source.name === target.name) return false;
  if (source.dateKey <= todayKey || target.dateKey <= todayKey) return false;
  if (source.dateKey === target.dateKey) return false;
  if ((categoryLabel === "야근" || categoryLabel === "조근") && isHolidayLikeDay(dayIndex, source.dateKey) !== isHolidayLikeDay(dayIndex, target.dateKey)) {
    return false;
  }
  if (categoryLabel === "야근" && isFridayDay(dayIndex, source.dateKey) !== isFridayDay(dayIndex, target.dateKey)) {
    return false;
  }
  if (hasAssignmentOnDay(dayIndex.get(source.dateKey), target.name)) return false;
  if (hasAssignmentOnDay(dayIndex.get(target.dateKey), source.name)) return false;
  if (hadNightShiftPreviousDay(dayIndex, target.name, source.dateKey)) return false;
  if (hadNightShiftPreviousDay(dayIndex, source.name, target.dateKey)) return false;
  if (categoryLabel === "야근") {
    if (hasWorkAfterNightShift(dayIndex, target.name, source.dateKey)) return false;
    if (hasWorkAfterNightShift(dayIndex, source.name, target.dateKey)) return false;
  }
  return true;
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
  const canDelete = hasDeskAccess(session?.role);
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
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const mine = selectedItem && username ? compactAssignments(selectedItem, username) : [];
  const allPendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);
  const publishedDayIndex = useMemo(() => buildDayIndex(items), [items]);
  const displayDays = useMemo(
    () => (selectedItem ? buildDisplayDays(selectedItem.schedule.days, previousSelectedItem?.schedule.days, selectedItem.schedule.month) : []),
    [previousSelectedItem, selectedItem],
  );
  const swapCandidates = useMemo(() => {
    if (!editMode || !selectedMineRef || !username) return [];
    return items
      .flatMap((item) =>
        item.schedule.days.flatMap((day) =>
          (day.assignments[selectedMineRef.category] ?? []).map((name, index) => ({
            monthKey: item.monthKey,
            dateKey: day.dateKey,
            category: selectedMineRef.category,
            index,
            name,
          })),
        ),
      )
      .filter((ref) => !sameRef(selectedMineRef, ref))
      .filter((ref) => !isPendingRef(allPendingRequests, ref))
      .filter((ref) => isSwapCandidateValid(selectedMineRef, ref, publishedDayIndex, todayKey))
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.name.localeCompare(right.name));
  }, [allPendingRequests, editMode, items, publishedDayIndex, selectedMineRef, todayKey, username]);

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
      if (person.ref.dateKey <= todayKey) {
        setRequestMessage("오늘 이후 근무만 변경할 수 있습니다.");
        return;
      }
      setSelectedMineRef(person.ref);
      setConfirmTargetRef(null);
      setRequestMessage("");
      return;
    }
    if (sameRef(selectedMineRef, person.ref)) {
      setSelectedMineRef(null);
      setConfirmTargetRef(null);
      return;
    }
    if (person.name === username) {
      if (person.ref.dateKey <= todayKey) {
        setRequestMessage("오늘 이후 근무만 변경할 수 있습니다.");
        return;
      }
      setSelectedMineRef(person.ref);
      setConfirmTargetRef(null);
      setRequestMessage("");
      return;
    }
    if (!isSwapCandidateValid(selectedMineRef, person.ref, publishedDayIndex, todayKey)) {
      setRequestMessage("같은 유형이고 날짜 충돌이나 야근 다음날 문제가 없는 근무만 바꿀 수 있습니다.");
      return;
    }
    setConfirmTargetRef(person.ref);
    setRequestMessage("");
  };

  const onConfirmRequest = () => {
    if (!session || !selectedMineRef || !confirmTargetRef) return;
    createScheduleChangeRequest({
      monthKey: selectedMineRef.monthKey,
      requesterId: session.id,
      requesterName: session.username,
      source: selectedMineRef,
      target: confirmTargetRef,
    });
    loadRequests();
    setRequestMessage("근무 변경 요청이 등록되었습니다.");
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
        {editMode && username ? (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 18,
              padding: 14,
              background: "rgba(255,255,255,.04)",
              display: "grid",
              gap: 10,
            }}
          >
            <strong>교체 가능 후보</strong>
            {selectedMineRef ? <div className="muted">{describeRef(selectedMineRef)}</div> : <div className="muted">내 이름을 누르면 후보가 여기에 표시됩니다.</div>}
            {selectedMineRef ? (
              swapCandidates.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {swapCandidates.map((candidate) => (
                    <button
                      key={`${candidate.monthKey}-${candidate.dateKey}-${candidate.category}-${candidate.index}-${candidate.name}`}
                      type="button"
                      className="btn"
                      onClick={() => {
                        setConfirmTargetRef(candidate);
                        setRequestMessage("");
                      }}
                      style={{
                        border: sameRef(confirmTargetRef, candidate) ? "1px solid rgba(56,189,248,.75)" : undefined,
                        background: sameRef(confirmTargetRef, candidate) ? "rgba(56,189,248,.16)" : undefined,
                      }}
                    >
                      {candidate.dateKey} {candidate.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="status note">조건에 맞는 교체 가능 근무가 없습니다.</div>
              )
            ) : null}
          </div>
        ) : null}

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
          <div className="status note">먼저 내 이름을 누르고 바꿀 상대 이름을 누르면 변경 요청 확인이 열립니다.</div>
        ) : null}
        {requestMessage ? <div className="status ok">{requestMessage}</div> : null}
        {confirmTargetRef && selectedMineRef ? (
          <div className="status warn" style={{ display: "grid", gap: 10 }}>
            <span>근무변경을 요청하시겠습니까?</span>
            <span className="muted">{describeRef(selectedMineRef)} ↔ {describeRef(confirmTargetRef)}</span>
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
                이전
              </button>
              <strong>{selectedItem.title}</strong>
              <button className="btn" disabled={selectedIndex < 0 || selectedIndex >= items.length - 1} onClick={() => setSelectedMonthKey(items[selectedIndex + 1]?.monthKey ?? null)}>
                다음 달
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
                {displayDays.map((day) => {
                  const dayCardStyle = getDayCardStyle(day);
                  const centeredDayLabel = getCenteredDayLabel(day);
                  const isToday = day.dateKey === todayKey;
                  return (
                    <article
                      key={day.dateKey}
                      className="panel"
                      style={{
                        padding: 8,
                        minHeight: 210,
                        opacity: day.isOverflowMonth ? 0.55 : 1,
                        background: isToday
                          ? "linear-gradient(180deg, rgba(34,211,238,.24), rgba(59,130,246,.18) 44%, rgba(255,255,255,.08))"
                          : dayCardStyle.background,
                        border: isToday ? "1px solid rgba(34,211,238,.88)" : dayCardStyle.border,
                        boxShadow: isToday ? "0 0 0 2px rgba(34,211,238,.16), 0 18px 36px rgba(2,132,199,.18)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 900,
                            padding: isToday ? "4px 10px" : 0,
                            borderRadius: isToday ? 999 : 0,
                            background: isToday ? "rgba(8,17,29,.72)" : "transparent",
                            color: isToday ? "#d8fbff" : undefined,
                            border: isToday ? "1px solid rgba(125,211,252,.34)" : "none",
                          }}
                        >
                          {day.month}/{day.day}
                        </div>
                      </div>
                      {centeredDayLabel ? (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            marginBottom: 8,
                            minHeight: 24,
                            textAlign: "center",
                            color: "#ffd7d7",
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        >
                          {centeredDayLabel}
                        </div>
                      ) : null}
                      <div style={{ display: "grid", gap: 2 }}>
                        {Object.entries(day.assignments).map(([category, names]) => (
                          <div key={`${day.dateKey}-${category}`} style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: 6, background: "rgba(9,17,30,.34)" }}>
                            <strong style={{ display: "block", marginBottom: 0, fontSize: 12, lineHeight: 1.2, minWidth: 42 }}>{getScheduleCategoryLabel(category)}</strong>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginLeft: 48, marginTop: -16 }}>
                              {names.length > 0 ? (
                                names.map((name, index) => {
                                  const assignmentDisplay = getAssignmentDisplay(category, name);
                                  const ref: SchedulePersonRef = {
                                    monthKey: selectedItem.monthKey,
                                    dateKey: day.dateKey,
                                    category,
                                    index,
                                    name,
                                  };
                                  const personObject: ScheduleNameObject = {
                                    key: `${category}-${name}-${index}`,
                                    name: assignmentDisplay.name,
                                    ref,
                                    pending: isPendingRef(allPendingRequests, ref),
                                  };
                                  const mineHighlighted = showMine && username && username === assignmentDisplay.name;
                                  const highlighted = mineHighlighted || (editMode && username && username === assignmentDisplay.name);
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
                                        padding: mineHighlighted ? "4px 10px" : "2px 6px",
                                        borderRadius: 999,
                                        background: personObject.pending
                                          ? "rgba(245,158,11,.18)"
                                          : highlighted
                                            ? mineHighlighted
                                              ? "rgba(56,189,248,.32)"
                                              : "rgba(34,211,238,.22)"
                                            : assignmentDisplay.chipStyle?.background ?? "rgba(255,255,255,.16)",
                                        border: selected
                                          ? "1px solid rgba(56,189,248,.8)"
                                          : personObject.pending
                                            ? "1px solid rgba(245,158,11,.35)"
                                            : highlighted
                                              ? "1px solid rgba(34,211,238,.35)"
                                              : assignmentDisplay.chipStyle?.border ?? "1px solid transparent",
                                        color: assignmentDisplay.chipStyle?.color ?? "#f8fbff",
                                        fontWeight: mineHighlighted ? 900 : 700,
                                        fontSize: mineHighlighted ? 15 : 12,
                                        lineHeight: 1.2,
                                        boxShadow: mineHighlighted ? "0 8px 20px rgba(14,165,233,.18)" : undefined,
                                        cursor: editMode && !personObject.pending ? "pointer" : "default",
                                      }}
                                    >
                                      <span>{assignmentDisplay.name}</span>
                                      {personObject.pending ? <span style={{ fontSize: 11 }}>근무변경요청중</span> : null}
                                    </button>
                                  );
                                })
                              ) : (
                                <span style={{ display: "inline-block", minHeight: 18 }} />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
