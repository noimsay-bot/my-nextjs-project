"use client";

import { useEffect, useMemo, useState } from "react";
import { getSession } from "@/lib/auth/storage";
import { STORAGE_KEY, categories, defaultScheduleState } from "@/lib/schedule/constants";
import {
  CHANGE_REQUESTS_EVENT,
  getScheduleChangeRequests,
  isPendingRef,
  resolveScheduleChangeRequest,
} from "@/lib/schedule/change-requests";
import {
  addManualField,
  addPersonToCategory,
  autoRebalance,
  generateSchedule,
  getUniquePeople,
  movePerson,
  openSnapshot,
  removePersonFromCategory,
  sanitizeScheduleState,
  updateManualAssignment,
} from "@/lib/schedule/engine";
import { publishSchedule } from "@/lib/schedule/published";
import { DaySchedule, MessageState, ScheduleChangeRequest, ScheduleNameObject, SchedulePersonRef, ScheduleState } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];

function MessageBox({ message }: { message: MessageState | null }) {
  if (!message?.text) return null;
  return <div className={`status ${message.tone}`}>{message.text}</div>;
}

function dayBadge(day: DaySchedule) {
  if (day.isCustomHoliday) return "평일 휴일";
  if (day.isWeekdayHoliday) return "휴일";
  if (day.isHoliday) return "휴일";
  if (day.isWeekend) return "주말";
  return "";
}

function isManualField(category: string) {
  return ["휴가", "국회", "청사", "청와대"].includes(category) || category.startsWith("추가칸");
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

function describeRequest(request: ScheduleChangeRequest) {
  return `${request.source.dateKey} ${request.source.category} ${request.source.name} → ${request.target.dateKey} ${request.target.category} ${request.target.name}`;
}

export function ScheduleApp() {
  const [state, setState] = useState<ScheduleState>(defaultScheduleState);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [visibleMonthKey, setVisibleMonthKey] = useState<string | null>(null);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishMonthKey, setPublishMonthKey] = useState<string>("");
  const [requests, setRequests] = useState<ScheduleChangeRequest[]>([]);
  const session = getSession();

  const loadState = () => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setState(sanitizeScheduleState(JSON.parse(raw) as Partial<ScheduleState>));
        return;
      } catch {
        setState(defaultScheduleState);
        return;
      }
    }
    setState(defaultScheduleState);
  };

  const loadRequests = () => {
    setRequests(getScheduleChangeRequests());
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    loadState();
    loadRequests();
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [loaded, state]);

  useEffect(() => {
    if (!session?.username) return;
    setState((current) => {
      if (current.currentUser === session.username) return current;
      return { ...current, currentUser: session.username };
    });
  }, [session?.username]);

  useEffect(() => {
    const onRefresh = () => {
      loadRequests();
      loadState();
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

  useEffect(() => {
    if (state.generated?.monthKey) {
      setVisibleMonthKey(state.generated.monthKey);
      return;
    }
    if (state.generatedHistory.length > 0 && !visibleMonthKey) {
      setVisibleMonthKey(state.generatedHistory[state.generatedHistory.length - 1].monthKey);
    }
  }, [state.generated, state.generatedHistory, visibleMonthKey]);

  const uniquePeople = useMemo(() => getUniquePeople(state), [state]);
  const activeCount = uniquePeople.filter((name) => !state.offPeople.includes(name)).length;
  const visibleSchedule = useMemo(() => {
    if (state.generatedHistory.length === 0) return state.generated;
    return state.generatedHistory.find((item) => item.monthKey === visibleMonthKey) ?? state.generatedHistory[state.generatedHistory.length - 1];
  }, [state.generated, state.generatedHistory, visibleMonthKey]);
  const previousVisibleSchedule = useMemo(() => {
    if (!visibleSchedule) return null;
    const index = state.generatedHistory.findIndex((item) => item.monthKey === visibleSchedule.monthKey);
    if (index <= 0) return null;
    return state.generatedHistory[index - 1] ?? null;
  }, [state.generatedHistory, visibleSchedule]);
  const visibleDays = useMemo(
    () => (visibleSchedule ? buildDisplayDays(visibleSchedule.days, previousVisibleSchedule?.days, visibleSchedule.month) : []),
    [previousVisibleSchedule, visibleSchedule],
  );
  const visibleIndex = visibleSchedule ? state.generatedHistory.findIndex((item) => item.monthKey === visibleSchedule.monthKey) : -1;
  const pendingRequests = useMemo(
    () => requests.filter((item) => item.status === "pending" && (!visibleSchedule || item.monthKey === visibleSchedule.monthKey)),
    [requests, visibleSchedule],
  );

  const updateState = (recipe: (current: ScheduleState) => ScheduleState) => {
    setState((current) => sanitizeScheduleState(recipe(current)));
  };

  const saveCurrent = () => {
    if (!uniquePeople.length) {
      setMessage({ tone: "warn", text: "최소 한 칸 이상 이름을 입력해주세요." });
      return false;
    }
    setMessage({ tone: "ok", text: "저장되었습니다. 입력값과 오프 상태를 유지합니다." });
    return true;
  };

  const onGenerate = () => {
    if (!saveCurrent()) return;
    const targetMonthKey = `${state.year}-${String(state.month).padStart(2, "0")}`;
    const hasExistingMonth = state.generatedHistory.some((item) => item.monthKey === targetMonthKey);
    if (hasExistingMonth) {
      setOverwriteConfirmOpen(true);
      return;
    }
    const result = generateSchedule(state);
    setState(result.state);
    setVisibleMonthKey(result.state.generated?.monthKey ?? null);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const confirmGenerate = () => {
    setOverwriteConfirmOpen(false);
    const result = generateSchedule(state);
    setState(result.state);
    setVisibleMonthKey(result.state.generated?.monthKey ?? null);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const onRebalance = () => {
    const result = autoRebalance(state);
    setState(result.state);
    setVisibleMonthKey(result.state.generated?.monthKey ?? visibleMonthKey);
    setMessage({ tone: result.warningCount > 0 ? "warn" : "ok", text: result.message });
  };

  const onDownload = () => {
    if (typeof window === "undefined") return;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "schedule-integrated-config.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const confirmReset = () => {
    setState(defaultScheduleState);
    setVisibleMonthKey(null);
    setResetConfirmOpen(false);
    setMessage({ tone: "ok", text: "초기화했습니다." });
  };

  const confirmPublish = () => {
    const target = state.generatedHistory.find((item) => item.monthKey === publishMonthKey);
    if (!target) return;
    const published = publishSchedule(target);
    setPublishOpen(false);
    setMessage({ tone: "ok", text: `${published.title}를 홈 화면에 게시했습니다.` });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="btn primary" onClick={saveCurrent}>순번 확인</button>
            <button className="btn white" onClick={onGenerate}>작성</button>
            <button className="btn" onClick={onRebalance}>자동 재배치</button>
            <button className="btn" onClick={() => {
              setPublishMonthKey(visibleSchedule?.monthKey ?? state.generatedHistory[state.generatedHistory.length - 1]?.monthKey ?? "");
              setPublishOpen(true);
            }}>
              근무표 게시
            </button>
            <button className="btn" onClick={() => setResetConfirmOpen(true)}>
              초기화
            </button>
          </div>
          {overwriteConfirmOpen ? (
            <div className="status warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>이미 작성된 {state.month}월 근무표가 있습니다. 다시 작성하시겠습니까?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmGenerate}>작성</button>
                <button className="btn" onClick={() => setOverwriteConfirmOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
          {resetConfirmOpen ? (
            <div className="status warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span>초기화하시겠습니까?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmReset}>확인</button>
                <button className="btn" onClick={() => setResetConfirmOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
          {publishOpen ? (
            <div className="status note" style={{ display: "grid", gap: 12 }}>
              <strong>게시할 근무표를 선택하세요.</strong>
              <select className="field-select" value={publishMonthKey} onChange={(e) => setPublishMonthKey(e.target.value)}>
                {state.generatedHistory.map((item) => (
                  <option key={item.monthKey} value={item.monthKey}>
                    {item.year}년 {item.month}월
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={confirmPublish}>확인</button>
                <button className="btn" onClick={() => setPublishOpen(false)}>취소</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="subgrid-2">
        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="chip">근무표 설정</div>
          <div className="status note">
            연장은 주 단위로 유지됩니다. 한 주에 뽑힌 4명이 월요일부터 금요일까지 같고, 월말이 주중에 끝나면 그 주 일요일까지 자동 생성합니다.
            평일 휴일에 입력한 날짜는 `조근 / 일반 / 석근 / 야근 / 국회` 칸만 만들고 배치는 하지 않습니다.
          </div>
          <div className="subgrid-2">
            <label>
              <div style={{ marginBottom: 8 }}>연도</div>
              <input className="field-input" type="number" value={state.year} onChange={(e) => setState({ ...state, year: Number(e.target.value) || state.year })} />
            </label>
            <label>
              <div style={{ marginBottom: 8 }}>월</div>
              <input className="field-input" type="number" min={1} max={12} value={state.month} onChange={(e) => setState({ ...state, month: Number(e.target.value) || state.month })} />
            </label>
          </div>
          <div className="subgrid-2">
            <label>
              <div style={{ marginBottom: 8 }}>제크 인원</div>
              <select className="field-select" value={state.jcheckCount} onChange={(e) => setState({ ...state, jcheckCount: Number(e.target.value) })}>
                <option value={1}>1명</option>
                <option value={2}>2명</option>
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 8 }}>로그인 사용자</div>
              <input className="field-input" value={state.currentUser} onChange={(e) => setState({ ...state, currentUser: e.target.value })} />
            </label>
          </div>
          <label>
            <div style={{ marginBottom: 8 }}>평일 휴일</div>
            <textarea className="field-textarea" value={state.extraHolidays} onChange={(e) => setState({ ...state, extraHolidays: e.target.value })} placeholder="2,15,22" />
          </label>
            <MessageBox message={message} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div className="chip">근무수정요청</div>
            {visibleSchedule ? (
              pendingRequests.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {pendingRequests.map((request) => (
                    <div
                      key={request.id}
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 12,
                        borderRadius: 16,
                        border: "1px solid var(--line)",
                        background: "rgba(255,255,255,.05)",
                      }}
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <strong>{request.requesterName}</strong>
                        <span className="muted">{describeRequest(request)}</span>
                        <span className="muted">{request.createdAt}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="btn primary"
                          onClick={() => {
                            const result = resolveScheduleChangeRequest(request.id, "accepted", session?.username ?? "관리자");
                            loadRequests();
                            if (result.applied) loadState();
                            setMessage({ tone: "ok", text: "근무 변경 요청을 수락했습니다." });
                          }}
                        >
                          수락
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            resolveScheduleChangeRequest(request.id, "rejected", session?.username ?? "관리자");
                            loadRequests();
                            setMessage({ tone: "note", text: "근무 변경 요청을 거부했습니다." });
                          }}
                        >
                          거부
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="status note">현재 월에 들어온 근무 수정 요청이 없습니다.</div>
              )
            ) : (
              <div className="status note">근무표를 먼저 작성하면 요청 목록이 여기에 표시됩니다.</div>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="chip">근무표</div>
            {visibleSchedule ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" disabled={visibleIndex <= 0} onClick={() => setVisibleMonthKey(state.generatedHistory[visibleIndex - 1]?.monthKey ?? null)}>
                  ← 이전
                </button>
                <strong>{visibleSchedule.year}년 {visibleSchedule.month}월</strong>
                <button className="btn" disabled={visibleIndex < 0 || visibleIndex >= state.generatedHistory.length - 1} onClick={() => setVisibleMonthKey(state.generatedHistory[visibleIndex + 1]?.monthKey ?? null)}>
                  다음 →
                </button>
              </div>
            ) : null}
          </div>
          {visibleSchedule ? (
            <div style={{ overflowX: "auto", overflowY: "visible" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
                {weekdayLabels.map((label) => (
                  <div key={label} style={{ textAlign: "center", padding: "6px 4px", borderRadius: 12, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)", fontWeight: 800, fontSize: 12 }}>
                    {label}
                  </div>
                ))}
                {visibleDays.map((day) => {
                  const editMode = state.generated?.monthKey === visibleSchedule.monthKey && state.editDateKey === day.dateKey;
                  const currentUser = state.currentUser.trim();
                  const conflictSet = new Set(day.conflicts.map((item) => `${item.category}-${item.name}`));
                  const isWeekendLike = day.isWeekend || day.isHoliday;
                  const visibleAssignments = Object.entries(day.assignments).filter(([category]) => {
                    if (isWeekendLike) return category !== "휴가" && category !== "제크";
                    return !["국회", "청사", "청와대"].includes(category);
                  });

                  return (
                    <article
                      key={day.dateKey}
                      className="panel"
                      style={{
                        padding: 8,
                        minHeight: 220,
                        opacity: day.isOverflowMonth ? 0.55 : 1,
                        background: day.isOverflowMonth ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.14)",
                        border: "1px solid rgba(255,255,255,.18)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 17, fontWeight: 900 }}>{day.month}/{day.day}</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          {dayBadge(day) ? (
                            <span style={{ padding: "2px 7px", borderRadius: 999, background: day.isWeekend ? "rgba(245,158,11,.16)" : "rgba(239,68,68,.16)", fontSize: 10 }}>{dayBadge(day)}</span>
                          ) : null}
                          <button className="btn" style={{ padding: "5px 8px", fontSize: 12 }} disabled={state.generated?.monthKey !== visibleSchedule.monthKey} onClick={() => setState({ ...state, editDateKey: editMode ? null : day.dateKey, selectedPerson: null })}>
                            {editMode ? "닫기" : "수정"}
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {visibleAssignments.map(([category, names]) => (
                          <div
                            key={`${day.dateKey}-${category}`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              const payload = event.dataTransfer.getData("text/plain");
                              if (!payload) return;
                              const source = JSON.parse(payload) as { dateKey: string; category: string; index: number };
                              setState((current) => movePerson(current, source, { dateKey: day.dateKey, category }));
                            }}
                            style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: 6, background: "rgba(9,17,30,.34)" }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 0 }}>
                              <strong style={{ fontSize: 12, lineHeight: 1.2, minWidth: 42, paddingTop: 2 }}>{category}</strong>
                              {editMode && state.generated?.monthKey === visibleSchedule.monthKey ? (
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button className="btn" style={{ padding: "4px 9px" }} onClick={() => {
                                    const name = window.prompt(`${category}에 추가할 이름을 입력하세요.`);
                                    if (!name) return;
                                    setState((current) => addPersonToCategory(current, day.dateKey, category, name));
                                  }}>+</button>
                                  {isManualField(category) ? (
                                    <button className="btn" style={{ padding: "4px 9px" }} onClick={() => {
                                      const value = window.prompt(`${category} 이름을 쉼표로 입력하세요.`, names.join(", "));
                                      if (value === null) return;
                                      setState((current) => updateManualAssignment(current, day.dateKey, category, value));
                                    }}>입력</button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, justifyContent: "flex-start", alignContent: "flex-start", marginLeft: 48, marginTop: -16 }}>
                              {names.length > 0 ? (
                                names.map((name, index) => {
                                  const ref: SchedulePersonRef = {
                                    monthKey: visibleSchedule.monthKey,
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
                                  const selected =
                                    state.selectedPerson?.dateKey === day.dateKey &&
                                    state.selectedPerson?.category === category &&
                                    state.selectedPerson?.index === index;
                                  const highlighted = state.showMyWork && currentUser && currentUser === name;
                                  const conflicted = conflictSet.has(`${category}-${name}`) || selected || personObject.pending;
                                  return (
                                    <div
                                      key={personObject.key}
                                      draggable
                                      onClick={() => setState({ ...state, selectedPerson: selected ? null : { dateKey: day.dateKey, category, index } })}
                                      onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", JSON.stringify({ dateKey: day.dateKey, category, index }));
                                        setState({ ...state, selectedPerson: { dateKey: day.dateKey, category, index } });
                                      }}
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
                                            : conflicted
                                              ? "rgba(239,68,68,.22)"
                                              : "rgba(255,255,255,.16)",
                                        border: personObject.pending
                                          ? "1px solid rgba(245,158,11,.35)"
                                          : conflicted
                                            ? "1px solid rgba(239,68,68,.28)"
                                            : highlighted
                                              ? "1px solid rgba(34,211,238,.35)"
                                              : "1px solid transparent",
                                        color: "#f8fbff",
                                        fontWeight: 700,
                                        fontSize: 12,
                                        lineHeight: 1.2,
                                      }}
                                    >
                                      <span>{personObject.name}</span>
                                      {personObject.pending ? <span style={{ fontSize: 11 }}>근무변경요청중</span> : null}
                                      {editMode ? (
                                        <button className="btn" style={{ padding: "2px 7px" }} onClick={(event) => {
                                          event.stopPropagation();
                                          setState((current) => removePersonFromCategory(current, day.dateKey, category, index));
                                        }}>-</button>
                                      ) : null}
                                    </div>
                                  );
                                })
                              ) : (
                                <span className="muted">배정 없음</span>
                              )}
                            </div>
                          </div>
                        ))}
                        {editMode && state.generated?.monthKey === visibleSchedule.monthKey ? (
                          <button className="btn" onClick={() => {
                            const label = window.prompt("추가할 칸 이름을 입력하세요.", "추가칸");
                            if (label === null) return;
                            updateState((current) => addManualField(current, day.dateKey, label));
                          }}>
                            날짜 수동 칸 추가
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="status note">저장 후 작성 버튼을 누르면 근무표가 생성됩니다.</div>
          )}
        </div>
      </section>

      <div className="subgrid-2">
      <section style={{ display: "grid", gap: 16 }}>
        <section className="subgrid-4">
          <article className="kpi">
            <div className="kpi-label">대상 연도</div>
            <div className="kpi-value">{state.year}년</div>
          </article>
          <article className="kpi">
            <div className="kpi-label">대상 월</div>
            <div className="kpi-value">{state.month}월</div>
          </article>
          <article className="kpi">
            <div className="kpi-label">제크 인원</div>
            <div className="kpi-value">{state.jcheckCount}명</div>
          </article>
          <article className="kpi">
            <div className="kpi-label">활성 인원 수</div>
            <div className="kpi-value">{activeCount}명</div>
          </article>
        </section>

        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div className="chip">순번 입력</div>
            {categories.map((category) => (
              <article key={category.key} style={{ border: "1px solid var(--line)", borderRadius: 20, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <strong>{category.label}</strong>
                  <span className="muted">1~30 순번</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
                  {Array.from({ length: 30 }, (_, index) => (
                    <label key={`${category.key}-${index}`} style={{ display: "grid", gap: 6 }}>
                      <span className="muted" style={{ fontSize: 12 }}>{index + 1}번</span>
                      <input
                        className="field-input"
                        value={state.orders[category.key][index] ?? ""}
                        onChange={(e) => {
                          const orders = { ...state.orders, [category.key]: [...state.orders[category.key]] };
                          orders[category.key][index] = e.target.value;
                          setState({ ...state, orders });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section style={{ display: "grid", gap: 16 }}>
        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div className="chip">오프 / 미리보기</div>
            <div style={{ display: "grid", gap: 10, maxHeight: 360, overflow: "auto" }}>
              {uniquePeople.map((name) => {
                const isOff = state.offPeople.includes(name);
                return (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: 10, borderRadius: 14, background: "rgba(255,255,255,.04)" }}>
                    <strong>{name}</strong>
                    <button
                      className={`btn ${isOff ? "" : "white"}`}
                      onClick={() =>
                        setState({
                          ...state,
                          offPeople: isOff ? state.offPeople.filter((item) => item !== name) : [...state.offPeople, name],
                        })
                      }
                    >
                      {isOff ? "활성화" : "오프"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div className="chip">사본 보관함</div>
            {state.generated ? (
              (state.snapshots[state.generated.monthKey] ?? []).length > 0 ? (
                (state.snapshots[state.generated.monthKey] ?? []).map((snapshot) => (
                  <div key={snapshot.id} style={{ padding: 12, borderRadius: 14, border: "1px solid var(--line)" }}>
                    <strong>{snapshot.label}</strong>
                    <div className="muted" style={{ marginTop: 6 }}>{snapshot.createdAt}</div>
                    <button className="btn" style={{ marginTop: 10 }} onClick={() => {
                      const nextState = openSnapshot(state, snapshot.id);
                      setState(nextState);
                      const opened = (nextState.snapshots[nextState.generated?.monthKey ?? ""] ?? []).find((item) => item.id === snapshot.id);
                      setVisibleMonthKey(opened?.generated.monthKey ?? nextState.generated?.monthKey ?? null);
                      setMessage({ tone: "ok", text: `${snapshot.label} 사본을 열었습니다.` });
                    }}>
                      열기
                    </button>
                  </div>
                ))
              ) : (
                <div className="status note">저장된 사본이 없습니다.</div>
              )
            ) : (
              <div className="status note">먼저 근무표를 작성하세요.</div>
            )}
          </div>
        </section>

      </section>
      </div>
    </div>
  );
}
