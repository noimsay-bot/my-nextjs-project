import { GeneratedSchedule } from "@/lib/schedule/types";

export interface PublishedScheduleItem {
  monthKey: string;
  title: string;
  publishedAt: string;
  schedule: GeneratedSchedule;
}

export const PUBLISHED_SCHEDULES_KEY = "j-special-force-published-schedules-v1";
export const PUBLISHED_SCHEDULES_EVENT = "j-special-force-published-schedules-updated";

export function getPublishedSchedules(): PublishedScheduleItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(PUBLISHED_SCHEDULES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PublishedScheduleItem[];
  } catch {
    return [];
  }
}

export function savePublishedSchedules(items: PublishedScheduleItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PUBLISHED_SCHEDULES_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(PUBLISHED_SCHEDULES_EVENT));
}

export function publishSchedule(schedule: GeneratedSchedule) {
  const items = getPublishedSchedules();
  const nextItem: PublishedScheduleItem = {
    monthKey: schedule.monthKey,
    title: `${schedule.year}년 ${schedule.month}월 근무표`,
    publishedAt: new Date().toLocaleString("ko-KR"),
    schedule,
  };
  const next = [nextItem, ...items.filter((item) => item.monthKey !== schedule.monthKey)].sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );
  savePublishedSchedules(next);
  return nextItem;
}

export function removePublishedSchedule(monthKey: string) {
  const items = getPublishedSchedules();
  const next = items.filter((item) => item.monthKey !== monthKey);
  savePublishedSchedules(next);
  return next;
}
