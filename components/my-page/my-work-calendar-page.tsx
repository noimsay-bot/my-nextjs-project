"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchMyScheduleAssignmentsWithPartnerInfo,
  type MyScheduleAssignmentItem,
} from "@/lib/corporate-card/storage";
import { formatMonthKey } from "@/lib/corporate-card/schedule";
import { getSession, subscribeToAuth, type SessionUser } from "@/lib/auth/storage";
import {
  loadMyWorkCalendarCustomTexts,
  readLocalMyWorkCalendarCustomTexts,
  saveMyWorkCalendarCustomTexts,
  type MyWorkCalendarCustomTextMap,
} from "@/lib/my-page/work-calendar-custom-texts";
import {
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
} from "@/lib/supabase/portal";
import styles from "./MyWorkCalendar.module.css";

type CalendarDay = {
  date: Date;
  dateKey: string;
  inMonth: boolean;
};

type MyWorkEvent = {
  id: string;
  dateKey: string;
  category: string;
  label: string;
  name: string;
};

type MyWorkCalendarDaySummary = {
  dateKey: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isCustomHoliday: boolean;
  isWeekdayHoliday: boolean;
};

type MyWorkCalendarSummaryResponse = {
  monthKey: string;
  publishedAt: string;
  events: MyWorkEvent[];
  days: MyWorkCalendarDaySummary[];
};

type MessageState = {
  tone: "note" | "warn";
  text: string;
};

type CustomTextMap = MyWorkCalendarCustomTextMap;

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_GRID_DAYS = 42;
const HELP_DISMISSED_STORAGE_PREFIX = "jtbc-my-work-calendar-help-dismissed-v1";
const MAX_CUSTOM_TEXTS_PER_DAY = 5;
const CUSTOM_TEXT_HELP_MESSAGE = "날짜를 더블 클릭하면 입력할 수 있습니다. 입력 후 수정/삭제는 오른쪽 클릭해주세요.";
const MY_WORK_CALENDAR_RPC_FALLBACK_COOLDOWN_MS = 30_000;
const myWorkCalendarSummaryCache = new Map<string, MyWorkCalendarSummaryResponse>();
const myWorkCalendarSummaryPromises = new Map<string, Promise<MyWorkCalendarSummaryResponse>>();
let myWorkCalendarRpcRetryAfter = 0;

function getTodayDateKey() {
  return formatDateKey(new Date());
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function getMonthStart(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
}

function getMonthTitle(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year}년 ${Number(month)}월`;
}

function addMonths(monthKey: string, amount: number) {
  const next = getMonthStart(monthKey);
  next.setMonth(next.getMonth() + amount);
  return formatMonthKey(next.getFullYear(), next.getMonth() + 1);
}

function isSameMonthKey(dateKey: string, monthKey: string) {
  return dateKey.slice(0, 7) === monthKey;
}

function buildCalendarDays(monthKey: string): CalendarDay[] {
  const monthStart = getMonthStart(monthKey);
  const sundayOffset = monthStart.getDay();
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - sundayOffset);

  return Array.from({ length: MONTH_GRID_DAYS }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = formatDateKey(date);
    return {
      date,
      dateKey,
      inMonth: isSameMonthKey(dateKey, monthKey),
    };
  });
}

function groupByDate<T extends { dateKey?: string; scheduleDate?: string }>(items: T[]) {
  return items.reduce((map, item) => {
    const dateKey = item.dateKey ?? item.scheduleDate;
    if (!dateKey) return map;
    const next = map.get(dateKey) ?? [];
    next.push(item);
    map.set(dateKey, next);
    return map;
  }, new Map<string, T[]>());
}

function getScheduleItemPreview(item: MyScheduleAssignmentItem) {
  return item.scheduleContent.trim() || "일정";
}

function isRedCalendarDay(day: CalendarDay, scheduleDay?: { isWeekend: boolean; isHoliday: boolean; isCustomHoliday: boolean; isWeekdayHoliday: boolean }) {
  return Boolean(
    scheduleDay?.isWeekend ||
    scheduleDay?.isHoliday ||
    scheduleDay?.isCustomHoliday ||
    scheduleDay?.isWeekdayHoliday ||
    day.date.getDay() === 0 ||
    day.date.getDay() === 6,
  );
}

function getHelpDismissedStorageKey(sessionId: string | null | undefined) {
  return `${HELP_DISMISSED_STORAGE_PREFIX}:${sessionId || "anonymous"}`;
}

function readHelpDismissed(sessionId: string | null | undefined) {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(getHelpDismissedStorageKey(sessionId)) === "1";
}

function writeHelpDismissed(sessionId: string | null | undefined) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getHelpDismissedStorageKey(sessionId), "1");
}

function getCustomTextKey(dateKey: string, index: number) {
  return `${dateKey}:${index}`;
}

async function fetchMyWorkCalendarSummary(monthKey: string) {
  const cached = myWorkCalendarSummaryCache.get(monthKey);
  if (cached) return cached;

  const existingPromise = myWorkCalendarSummaryPromises.get(monthKey);
  if (existingPromise) return existingPromise;

  const requestPromise = fetchMyWorkCalendarSummaryDirect(monthKey)
    .catch(() => fetchMyWorkCalendarSummaryViaApi(monthKey))
    .then((summary) => {
      myWorkCalendarSummaryCache.set(monthKey, summary);
      return summary;
    })
    .finally(() => {
      myWorkCalendarSummaryPromises.delete(monthKey);
    });

  myWorkCalendarSummaryPromises.set(monthKey, requestPromise);
  return requestPromise;
}

function normalizeMyWorkCalendarSummaryPayload(monthKey: string, payload: unknown): MyWorkCalendarSummaryResponse {
  const record = Array.isArray(payload) ? payload[0] : payload;
  const value = record && typeof record === "object" ? record as Partial<MyWorkCalendarSummaryResponse> : {};
  return {
    monthKey,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : "",
    events: Array.isArray(value.events) ? value.events : [],
    days: Array.isArray(value.days) ? value.days : [],
  };
}

async function fetchMyWorkCalendarSummaryDirect(monthKey: string) {
  if (Date.now() < myWorkCalendarRpcRetryAfter) {
    throw new Error("내 일정 RPC 재시도 대기 중입니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase.rpc("get_my_work_calendar", { p_month_key: monthKey });
  if (error) {
    myWorkCalendarRpcRetryAfter = Date.now() + MY_WORK_CALENDAR_RPC_FALLBACK_COOLDOWN_MS;
    throw new Error(getSupabaseStorageErrorMessage(error, "get_my_work_calendar"));
  }

  return normalizeMyWorkCalendarSummaryPayload(monthKey, data);
}

async function fetchMyWorkCalendarSummaryViaApi(monthKey: string) {
  return fetch(`/api/schedule/my-work-calendar?monthKey=${encodeURIComponent(monthKey)}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      const payload = (await response.json().catch(() => null)) as (Partial<MyWorkCalendarSummaryResponse> & { message?: string }) | null;
      if (!response.ok) {
        throw new Error(payload?.message || "게시 근무표를 불러오지 못했습니다.");
      }
      return normalizeMyWorkCalendarSummaryPayload(monthKey, payload);
    });
}

export function MyWorkCalendarPage() {
  const todayKey = getTodayDateKey();
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [monthKey, setMonthKey] = useState(() => todayKey.slice(0, 7));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [workEvents, setWorkEvents] = useState<MyWorkEvent[]>(() => myWorkCalendarSummaryCache.get(todayKey.slice(0, 7))?.events ?? []);
  const [scheduleDays, setScheduleDays] = useState<MyWorkCalendarDaySummary[]>(() => myWorkCalendarSummaryCache.get(todayKey.slice(0, 7))?.days ?? []);
  const [scheduleItems, setScheduleItems] = useState<MyScheduleAssignmentItem[]>([]);
  const [customTexts, setCustomTexts] = useState<CustomTextMap>({});
  const [editingCustomTextDateKey, setEditingCustomTextDateKey] = useState<string | null>(null);
  const [editingCustomTextIndex, setEditingCustomTextIndex] = useState<number | null>(null);
  const [customTextDraft, setCustomTextDraft] = useState("");
  const [selectedCustomTextKey, setSelectedCustomTextKey] = useState<string | null>(null);
  const [customTextActionKey, setCustomTextActionKey] = useState<string | null>(null);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<MessageState | null>(null);

  useEffect(() => subscribeToAuth(setSession), []);

  useEffect(() => {
    let cancelled = false;
    setCustomTexts(readLocalMyWorkCalendarCustomTexts(session?.id, session?.username));
    setEditingCustomTextDateKey(null);
    setEditingCustomTextIndex(null);
    setCustomTextDraft("");
    setSelectedCustomTextKey(null);
    setCustomTextActionKey(null);
    setShowHelpDialog(!readHelpDismissed(session?.id));

    loadMyWorkCalendarCustomTexts(session?.id, session?.username)
      .then((texts) => {
        if (!cancelled) setCustomTexts(texts);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({
            tone: "warn",
            text: error instanceof Error ? error.message : "내 일정 입력 내용을 불러오지 못했습니다.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.id, session?.username]);

  useEffect(() => {
    setSelectedDateKey((current) => (isSameMonthKey(current, monthKey) ? current : `${monthKey}-01`));
  }, [monthKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);

    Promise.allSettled([
      fetchMyWorkCalendarSummary(monthKey),
      fetchMyScheduleAssignmentsWithPartnerInfo(monthKey),
    ])
      .then(([summaryResult, scheduleResult]) => {
        if (cancelled) return;
        if (summaryResult.status === "fulfilled") {
          setWorkEvents(summaryResult.value.events);
          setScheduleDays(summaryResult.value.days);
        } else {
          setWorkEvents([]);
          setScheduleDays([]);
          setMessage({
            tone: "warn",
            text: summaryResult.reason instanceof Error ? summaryResult.reason.message : "게시 근무표를 불러오지 못했습니다.",
          });
        }

        if (scheduleResult.status === "fulfilled") {
          setScheduleItems(scheduleResult.value);
        } else {
          setScheduleItems([]);
          if (summaryResult.status === "fulfilled") {
            setMessage({ tone: "note", text: "내 일정 상세를 불러오지 못해 근무표만 표시합니다." });
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  const calendarDays = useMemo(() => buildCalendarDays(monthKey), [monthKey]);
  const scheduleDayIndex = useMemo(() => new Map(scheduleDays.map((day) => [day.dateKey, day] as const)), [scheduleDays]);
  const workByDate = useMemo(() => groupByDate(workEvents), [workEvents]);
  const schedulesByDate = useMemo(() => groupByDate(scheduleItems), [scheduleItems]);
  const selectedDate = parseDateKey(selectedDateKey);
  const selectedWorkEvents = workByDate.get(selectedDateKey) ?? [];
  const selectedScheduleItems = schedulesByDate.get(selectedDateKey) ?? [];
  const selectedCustomTexts = customTexts[selectedDateKey] ?? [];
  const monthWorkCount = workEvents.filter((item) => isSameMonthKey(item.dateKey, monthKey)).length;
  const monthCustomTextCount = Object.entries(customTexts)
    .filter(([dateKey]) => isSameMonthKey(dateKey, monthKey))
    .reduce((total, [, values]) => total + values.length, 0);
  const monthScheduleCount = scheduleItems.filter((item) => isSameMonthKey(item.scheduleDate, monthKey)).length + monthCustomTextCount;

  const persistCustomTexts = (texts: CustomTextMap) => {
    saveMyWorkCalendarCustomTexts(texts, session?.id, session?.username).catch((error) => {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "내 일정 입력 내용을 저장하지 못했습니다.",
      });
    });
  };

  const startCustomTextEdit = (dateKey: string) => {
    setSelectedDateKey(dateKey);
    if ((customTexts[dateKey] ?? []).length >= MAX_CUSTOM_TEXTS_PER_DAY) {
      setMessage({ tone: "note", text: "직접 입력은 날짜별 최대 5개까지 가능합니다." });
      return;
    }
    setEditingCustomTextDateKey(dateKey);
    setEditingCustomTextIndex(null);
    setCustomTextDraft("");
    setSelectedCustomTextKey(null);
    setCustomTextActionKey(null);
  };

  const saveCustomTextDraft = () => {
    if (!editingCustomTextDateKey) return;
    const dateKey = editingCustomTextDateKey;
    const nextText = customTextDraft.trim();
    setCustomTexts((current) => {
      const next = { ...current };
      const currentValues = next[dateKey] ?? [];
      if (editingCustomTextIndex !== null) {
        if (nextText && editingCustomTextIndex >= 0 && editingCustomTextIndex < currentValues.length) {
          next[dateKey] = currentValues.map((value, index) => (index === editingCustomTextIndex ? nextText : value));
        }
      } else if (nextText) {
        if (currentValues.length >= MAX_CUSTOM_TEXTS_PER_DAY) {
          setMessage({ tone: "note", text: "직접 입력은 날짜별 최대 5개까지 가능합니다." });
          return current;
        }
        next[dateKey] = [...currentValues, nextText].slice(0, MAX_CUSTOM_TEXTS_PER_DAY);
      }
      persistCustomTexts(next);
      return next;
    });
    setEditingCustomTextDateKey(null);
    setEditingCustomTextIndex(null);
    setCustomTextDraft("");
    setCustomTextActionKey(null);
  };

  const cancelCustomTextEdit = () => {
    setEditingCustomTextDateKey(null);
    setEditingCustomTextIndex(null);
    setCustomTextDraft("");
  };

  const selectCustomText = (dateKey: string, index: number) => {
    setSelectedDateKey(dateKey);
    setSelectedCustomTextKey(getCustomTextKey(dateKey, index));
    setCustomTextActionKey(null);
  };

  const showCustomTextActions = (dateKey: string, index: number) => {
    const key = getCustomTextKey(dateKey, index);
    setSelectedDateKey(dateKey);
    setSelectedCustomTextKey(key);
    setCustomTextActionKey(key);
  };

  const startCustomTextUpdate = (dateKey: string, index: number) => {
    const text = customTexts[dateKey]?.[index];
    if (!text) return;
    setSelectedDateKey(dateKey);
    setSelectedCustomTextKey(getCustomTextKey(dateKey, index));
    setEditingCustomTextDateKey(dateKey);
    setEditingCustomTextIndex(index);
    setCustomTextDraft(text);
    setCustomTextActionKey(null);
  };

  const deleteCustomText = (dateKey: string, index: number) => {
    setCustomTexts((current) => {
      const currentValues = current[dateKey] ?? [];
      const nextValues = currentValues.filter((_, valueIndex) => valueIndex !== index);
      const next = { ...current };
      if (nextValues.length > 0) {
        next[dateKey] = nextValues;
      } else {
        delete next[dateKey];
      }
      persistCustomTexts(next);
      return next;
    });
    if (selectedCustomTextKey === getCustomTextKey(dateKey, index)) {
      setSelectedCustomTextKey(null);
    }
    if (customTextActionKey === getCustomTextKey(dateKey, index)) {
      setCustomTextActionKey(null);
    }
  };

  const dismissHelpDialog = () => {
    writeHelpDismissed(session?.id);
    setShowHelpDialog(false);
  };

  return (
    <section className={styles.page}>
      <article className="panel">
        <div className="panel-pad">
          <div className={styles.headerBar}>
            <div className={styles.header}>
              <span className="chip">내 일정</span>
              <h1 className={styles.title}>{getMonthTitle(monthKey)} 내 일정</h1>
              <p className={styles.description}>{CUSTOM_TEXT_HELP_MESSAGE}</p>
            </div>
            <div className={styles.headerActions}>
              <label className={styles.monthField}>
                <input
                  className="field-input"
                  type="month"
                  value={monthKey}
                  aria-label="월 선택"
                  onChange={(event) => setMonthKey(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad">
          <div className={styles.calendarToolbar}>
            <div className={styles.monthControls}>
              <button type="button" className="btn" onClick={() => setMonthKey(addMonths(monthKey, -1))}>
                이전
              </button>
              <button type="button" className="btn" onClick={() => {
                setMonthKey(todayKey.slice(0, 7));
                setSelectedDateKey(todayKey);
              }}>
                오늘
              </button>
              <button type="button" className="btn" onClick={() => setMonthKey(addMonths(monthKey, 1))}>
                다음
              </button>
            </div>
            <div className={styles.summary}>
              <span>근무 {monthWorkCount}건</span>
              <span>일정 {monthScheduleCount}건</span>
            </div>
          </div>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {loading ? <div className="status note">내 일정 달력을 불러오는 중입니다.</div> : null}

          <div className={styles.calendarGrid} aria-label={`${getMonthTitle(monthKey)} 내 일정 달력`}>
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className={styles.weekday}>
                {label}
              </div>
            ))}
            {calendarDays.map((day) => {
              const redDay = isRedCalendarDay(day, scheduleDayIndex.get(day.dateKey));
              const dayWorkEvents = workByDate.get(day.dateKey) ?? [];
              const dayScheduleItems = schedulesByDate.get(day.dateKey) ?? [];
              const customTextItems = customTexts[day.dateKey] ?? [];
              const isAddingCustomText = editingCustomTextDateKey === day.dateKey && editingCustomTextIndex === null;
              const selected = day.dateKey === selectedDateKey;
              const today = day.dateKey === todayKey;

              return (
                <div
                  key={day.dateKey}
                  role="button"
                  tabIndex={0}
                  className={[
                    styles.dayCell,
                    day.inMonth ? "" : styles.dayCellMuted,
                    redDay ? styles.dayCellRed : "",
                    selected ? styles.dayCellSelected : "",
                    today ? styles.dayCellToday : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelectedDateKey(day.dateKey);
                    setCustomTextActionKey(null);
                  }}
                  onDoubleClick={() => startCustomTextEdit(day.dateKey)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDateKey(day.dateKey);
                    }
                  }}
                  aria-pressed={selected}
                >
                  <span className={styles.dayHeader}>
                    <span className={styles.dayNumber}>{day.date.getDate()}</span>
                    {dayWorkEvents.slice(0, 3).map((event) => (
                      <span key={event.id} className={styles.workChip}>
                        {event.label}
                      </span>
                    ))}
                    {dayWorkEvents.length > 3 ? <span className={styles.moreChip}>+{dayWorkEvents.length - 3}</span> : null}
                  </span>
                  <span className={styles.dayContent}>
                    {dayScheduleItems.slice(0, 1).map((item) => (
                      <span key={item.scheduleItemId} className={styles.scheduleChip}>
                        {getScheduleItemPreview(item)}
                      </span>
                    ))}
                    {dayScheduleItems.length > 1 ? <span className={styles.moreChip}>일정 +{dayScheduleItems.length - 1}</span> : null}
                    {isAddingCustomText ? (
                      <input
                        className={styles.customTextInput}
                        value={customTextDraft}
                        autoFocus
                        maxLength={80}
                        placeholder="텍스트 입력"
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onChange={(event) => setCustomTextDraft(event.target.value)}
                        onBlur={saveCustomTextDraft}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveCustomTextDraft();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelCustomTextEdit();
                          }
                        }}
                      />
                    ) : null}
                    {customTextItems.map((customText, index) => {
                      const customTextKey = getCustomTextKey(day.dateKey, index);
                      const isUpdatingCustomText = editingCustomTextDateKey === day.dateKey && editingCustomTextIndex === index;
                      return (
                        <span key={customTextKey} className={styles.customTextActionGroup}>
                          {isUpdatingCustomText ? (
                            <input
                              className={styles.customTextInput}
                              value={customTextDraft}
                              autoFocus
                              maxLength={80}
                              placeholder="텍스트 입력"
                              onClick={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onChange={(event) => setCustomTextDraft(event.target.value)}
                              onBlur={saveCustomTextDraft}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveCustomTextDraft();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelCustomTextEdit();
                                }
                              }}
                            />
                          ) : (
                            <span
                              className={`${styles.customTextChip} ${selectedCustomTextKey === customTextKey ? styles.customTextChipSelected : ""}`.trim()}
                              title="클릭해서 선택, 오른쪽 클릭으로 수정/삭제 버튼 표시"
                              onClick={(event) => {
                                event.stopPropagation();
                                selectCustomText(day.dateKey, index);
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                showCustomTextActions(day.dateKey, index);
                              }}
                            >
                              {customText}
                            </span>
                          )}
                          {customTextActionKey === customTextKey ? (
                            <>
                              <button
                                type="button"
                                className={styles.customTextEditButton}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startCustomTextUpdate(day.dateKey, index);
                                }}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                className={styles.customTextDeleteButton}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deleteCustomText(day.dateKey, index);
                                }}
                              >
                                삭제
                              </button>
                            </>
                          ) : null}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad">
          <div className={styles.detailHead}>
            <div>
              <span className="chip">선택 날짜</span>
              <h2 className={styles.detailTitle}>
                {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
              </h2>
            </div>
            <span className={styles.detailSummary}>
              근무 {selectedWorkEvents.length}건 · 일정 {selectedScheduleItems.length + selectedCustomTexts.length}건
            </span>
          </div>

          <div className={styles.detailGrid}>
            <section className={styles.detailSection}>
              <h3>내 근무</h3>
              {selectedWorkEvents.length > 0 ? (
                <div className={styles.detailList}>
                  {selectedWorkEvents.map((event) => (
                    <div key={event.id} className={styles.detailItem}>
                      <strong>{event.label}</strong>
                      <span>{event.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="status note">이 날짜에 표시할 내 근무가 없습니다.</div>
              )}
            </section>

            <section className={styles.detailSection}>
              <h3>내 일정 전체 내용</h3>
              {selectedCustomTexts.length > 0 || selectedScheduleItems.length > 0 ? (
                <div className={styles.detailList}>
                  {selectedCustomTexts.map((customText, index) => (
                    <div
                      key={getCustomTextKey(selectedDateKey, index)}
                      className={`${styles.scheduleDetailItem} ${styles.customTextDetailItem} ${
                        selectedCustomTextKey === getCustomTextKey(selectedDateKey, index) ? styles.customTextDetailItemSelected : ""
                      }`.trim()}
                    >
                      <strong>직접 입력</strong>
                      <p>{customText}</p>
                    </div>
                  ))}
                  {selectedScheduleItems.map((item) => (
                    <div key={item.scheduleItemId} className={styles.scheduleDetailItem}>
                      <strong>{item.scheduleContent}</strong>
                      <span>오디오맨: {item.audioManName || "입력 대기"}</span>
                      <span>수송부: {item.seniorName || "입력 대기"}</span>
                      <p>{item.generatedText}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="status note">이 날짜에 배정된 내 일정이 없습니다.</div>
              )}
            </section>
          </div>
        </div>
      </article>

      {showHelpDialog ? (
        <div className={styles.helpBackdrop} role="presentation">
          <section className={styles.helpDialog} role="dialog" aria-modal="true" aria-labelledby="my-work-help-title">
            <h2 id="my-work-help-title">내 일정 입력 안내</h2>
            <p>{CUSTOM_TEXT_HELP_MESSAGE}</p>
            <button type="button" className="btn primary" onClick={dismissHelpDialog}>
              확인
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}
