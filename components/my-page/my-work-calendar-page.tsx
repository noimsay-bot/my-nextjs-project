"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  fetchMyScheduleAssignmentsWithPartnerInfo,
  type MyScheduleAssignmentItem,
} from "@/lib/corporate-card/storage";
import { formatMonthKey } from "@/lib/corporate-card/schedule";
import { getSession, subscribeToAuth, type SessionUser } from "@/lib/auth/storage";
import { getAssignmentDisplayRank, getDayCategoryDisplayLabel } from "@/lib/schedule/constants";
import { getPublishedSchedules, refreshPublishedSchedules, type PublishedScheduleItem } from "@/lib/schedule/published";
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

type MessageState = {
  tone: "note" | "warn";
  text: string;
};

type CustomTextMap = Record<string, string[]>;

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_GRID_DAYS = 42;
const CUSTOM_TEXT_STORAGE_PREFIX = "jtbc-my-work-calendar-custom-text-v1";
const MAX_CUSTOM_TEXTS_PER_DAY = 5;

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

function normalizeActorName(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function getComparableAssignmentName(category: string, value: string) {
  const trimmed = value.trim();
  if (category !== "휴가") return trimmed;
  const matched = /^(연차|대휴|etc|기타|공가|근속휴가|건강검진|경조)\s*:(.+)$/.exec(trimmed);
  return matched ? matched[2].trim() : trimmed;
}

function isSameActorName(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeActorName(left);
  const normalizedRight = normalizeActorName(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function buildMyWorkEvents(items: PublishedScheduleItem[], username: string) {
  const events: MyWorkEvent[] = [];
  if (!username.trim()) return events;

  items.forEach((item) => {
    item.schedule.days.forEach((day) => {
      if (isSameActorName(day.headerName, username)) {
        events.push({
          id: `${day.dateKey}:header`,
          dateKey: day.dateKey,
          category: "데스크",
          label: "데스크",
          name: day.headerName,
        });
      }

      Object.entries(day.assignments ?? {}).forEach(([category, names]) => {
        names.forEach((name, index) => {
          const comparableName = getComparableAssignmentName(category, name);
          if (!isSameActorName(comparableName, username)) return;
          const label = getDayCategoryDisplayLabel(day, category);
          if (label === "일반" && !isRedScheduleDay(day)) return;
          events.push({
            id: `${day.dateKey}:${category}:${index}:${name}`,
            dateKey: day.dateKey,
            category,
            label,
            name: comparableName,
          });
        });
      });
    });
  });

  return events.sort((left, right) => (
    left.dateKey.localeCompare(right.dateKey) ||
    getAssignmentDisplayRank(left.category) - getAssignmentDisplayRank(right.category) ||
    left.label.localeCompare(right.label)
  ));
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

function buildDayScheduleIndex(items: PublishedScheduleItem[]) {
  const map = new Map<string, { isWeekend: boolean; isHoliday: boolean; isCustomHoliday: boolean; isWeekdayHoliday: boolean }>();
  items.forEach((item) => {
    item.schedule.days.forEach((day) => {
      map.set(day.dateKey, {
        isWeekend: day.isWeekend,
        isHoliday: day.isHoliday,
        isCustomHoliday: day.isCustomHoliday,
        isWeekdayHoliday: day.isWeekdayHoliday,
      });
    });
  });
  return map;
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

function isRedScheduleDay(day: { isWeekend: boolean; isHoliday: boolean; isCustomHoliday: boolean; isWeekdayHoliday: boolean }) {
  return day.isWeekend || day.isHoliday || day.isCustomHoliday || day.isWeekdayHoliday;
}

function getCustomTextStorageKey(sessionId: string | null | undefined) {
  return `${CUSTOM_TEXT_STORAGE_PREFIX}:${sessionId || "anonymous"}`;
}

function normalizeCustomTextList(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_TEXTS_PER_DAY);
}

function readCustomTexts(sessionId: string | null | undefined) {
  if (typeof window === "undefined") return {} as CustomTextMap;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getCustomTextStorageKey(sessionId)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([dateKey, value]) => [dateKey, normalizeCustomTextList(value)] as const)
        .filter(([dateKey, values]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && values.length > 0),
    ) as CustomTextMap;
  } catch {
    return {};
  }
}

function writeCustomTexts(sessionId: string | null | undefined, texts: CustomTextMap) {
  if (typeof window === "undefined") return;
  const normalized = Object.fromEntries(
    Object.entries(texts)
      .map(([dateKey, values]) => [dateKey, normalizeCustomTextList(values)] as const)
      .filter(([, values]) => values.length > 0),
  );
  window.localStorage.setItem(getCustomTextStorageKey(sessionId), JSON.stringify(normalized));
}

function getCustomTextKey(dateKey: string, index: number) {
  return `${dateKey}:${index}`;
}

export function MyWorkCalendarPage() {
  const todayKey = getTodayDateKey();
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [monthKey, setMonthKey] = useState(() => todayKey.slice(0, 7));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const visibleScheduleMonthKeys = useMemo(() => [addMonths(monthKey, -1), monthKey, addMonths(monthKey, 1)], [monthKey]);
  const [publishedItems, setPublishedItems] = useState<PublishedScheduleItem[]>(() => getPublishedSchedules([
    addMonths(todayKey.slice(0, 7), -1),
    todayKey.slice(0, 7),
    addMonths(todayKey.slice(0, 7), 1),
  ]));
  const [scheduleItems, setScheduleItems] = useState<MyScheduleAssignmentItem[]>([]);
  const [customTexts, setCustomTexts] = useState<CustomTextMap>({});
  const [editingCustomTextDateKey, setEditingCustomTextDateKey] = useState<string | null>(null);
  const [customTextDraft, setCustomTextDraft] = useState("");
  const [selectedCustomTextKey, setSelectedCustomTextKey] = useState<string | null>(null);
  const [deleteCustomTextKey, setDeleteCustomTextKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<MessageState | null>(null);

  useEffect(() => subscribeToAuth(setSession), []);

  useEffect(() => {
    setCustomTexts(readCustomTexts(session?.id));
    setEditingCustomTextDateKey(null);
    setCustomTextDraft("");
    setSelectedCustomTextKey(null);
    setDeleteCustomTextKey(null);
  }, [session?.id]);

  useEffect(() => {
    setSelectedDateKey((current) => (isSameMonthKey(current, monthKey) ? current : `${monthKey}-01`));
  }, [monthKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);

    Promise.allSettled([
      refreshPublishedSchedules({ monthKeys: visibleScheduleMonthKeys }),
      fetchMyScheduleAssignmentsWithPartnerInfo(monthKey),
    ])
      .then(([publishedResult, scheduleResult]) => {
        if (cancelled) return;
        if (publishedResult.status === "fulfilled") {
          setPublishedItems(publishedResult.value);
        } else {
          setPublishedItems([]);
          setMessage({
            tone: "warn",
            text: publishedResult.reason instanceof Error ? publishedResult.reason.message : "게시 근무표를 불러오지 못했습니다.",
          });
        }

        if (scheduleResult.status === "fulfilled") {
          setScheduleItems(scheduleResult.value);
        } else {
          setScheduleItems([]);
          if (publishedResult.status === "fulfilled") {
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
  }, [monthKey, visibleScheduleMonthKeys]);

  const calendarDays = useMemo(() => buildCalendarDays(monthKey), [monthKey]);
  const workEvents = useMemo(() => buildMyWorkEvents(publishedItems, session?.username ?? ""), [publishedItems, session?.username]);
  const scheduleDayIndex = useMemo(() => buildDayScheduleIndex(publishedItems), [publishedItems]);
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

  const startCustomTextEdit = (dateKey: string) => {
    setSelectedDateKey(dateKey);
    if ((customTexts[dateKey] ?? []).length >= MAX_CUSTOM_TEXTS_PER_DAY) {
      setMessage({ tone: "note", text: "직접 입력은 날짜별 최대 5개까지 가능합니다." });
      return;
    }
    setEditingCustomTextDateKey(dateKey);
    setCustomTextDraft("");
    setSelectedCustomTextKey(null);
    setDeleteCustomTextKey(null);
  };

  const saveCustomTextDraft = () => {
    if (!editingCustomTextDateKey) return;
    const dateKey = editingCustomTextDateKey;
    const nextText = customTextDraft.trim();
    setCustomTexts((current) => {
      const next = { ...current };
      if (nextText) {
        const currentValues = next[dateKey] ?? [];
        if (currentValues.length >= MAX_CUSTOM_TEXTS_PER_DAY) {
          setMessage({ tone: "note", text: "직접 입력은 날짜별 최대 5개까지 가능합니다." });
          return current;
        }
        next[dateKey] = [...currentValues, nextText].slice(0, MAX_CUSTOM_TEXTS_PER_DAY);
      }
      writeCustomTexts(session?.id, next);
      return next;
    });
    setEditingCustomTextDateKey(null);
    setCustomTextDraft("");
    setDeleteCustomTextKey(null);
  };

  const cancelCustomTextEdit = () => {
    setEditingCustomTextDateKey(null);
    setCustomTextDraft("");
  };

  const selectCustomText = (dateKey: string, index: number) => {
    setSelectedDateKey(dateKey);
    setSelectedCustomTextKey(getCustomTextKey(dateKey, index));
    setDeleteCustomTextKey(null);
  };

  const showCustomTextDeleteAction = (dateKey: string, index: number) => {
    const key = getCustomTextKey(dateKey, index);
    setSelectedDateKey(dateKey);
    setSelectedCustomTextKey(key);
    setDeleteCustomTextKey(key);
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
      writeCustomTexts(session?.id, next);
      return next;
    });
    if (selectedCustomTextKey === getCustomTextKey(dateKey, index)) {
      setSelectedCustomTextKey(null);
    }
    if (deleteCustomTextKey === getCustomTextKey(dateKey, index)) {
      setDeleteCustomTextKey(null);
    }
  };

  return (
    <section className={styles.page}>
      <article className="panel">
        <div className="panel-pad">
          <div className={styles.headerBar}>
            <div className={styles.header}>
              <span className="chip">내 일정</span>
              <h1 className={styles.title}>{getMonthTitle(monthKey)} 내 일정</h1>
              <p className={styles.description}>날짜를 더블 클릭하면 입력할 수 있습니다. 입력 후 삭제는 오른쪽 클릭해주세요.</p>
            </div>
            <div className={styles.headerActions}>
              <Link href="/me" className="btn">
                내 일정 보기
              </Link>
              <Link href="/me/work" className="btn primary">
                내 일정
              </Link>
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
              const isEditingCustomText = editingCustomTextDateKey === day.dateKey;
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
                    setDeleteCustomTextKey(null);
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
                    {isEditingCustomText ? (
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
                      return (
                        <span key={customTextKey} className={styles.customTextActionGroup}>
                          <span
                            className={`${styles.customTextChip} ${selectedCustomTextKey === customTextKey ? styles.customTextChipSelected : ""}`.trim()}
                            title="클릭해서 선택, 오른쪽 클릭으로 삭제 버튼 표시"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectCustomText(day.dateKey, index);
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              showCustomTextDeleteAction(day.dateKey, index);
                            }}
                          >
                            {customText}
                          </span>
                        {deleteCustomTextKey === customTextKey ? (
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
    </section>
  );
}
