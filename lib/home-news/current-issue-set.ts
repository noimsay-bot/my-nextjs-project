import { getKstDateKey } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";

export const HOME_NEWS_AFTERNOON_SLOT_START_HOUR = 15;
export const HOME_NEWS_MORNING_SLOT_HOUR = 6;
export const HOME_NEWS_SLOT_WINDOW_HOURS = 24;

function getKstHour(now: Date) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

export function getCurrentHomeIssueSetSlot(now = new Date()): HomeNewsBriefingSlot {
  return getKstHour(now) >= HOME_NEWS_AFTERNOON_SLOT_START_HOUR ? "afternoon_3" : "morning_6";
}

export function getCurrentHomeIssueSetSlotPriority(now = new Date()): HomeNewsBriefingSlot[] {
  const primary = getCurrentHomeIssueSetSlot(now);
  const secondary = primary === "morning_6" ? "afternoon_3" : "morning_6";
  return [primary, secondary];
}

export function getCurrentHomeIssueSetDate(now = new Date()) {
  return getKstDateKey(now.toISOString());
}

function getKstDateParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return { year, month, day };
}

function toKstDate(year: string, month: string, day: string, hour: number) {
  return new Date(`${year}-${month}-${day}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

function shiftDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function getHomeNewsSlotReferenceTime(slot: HomeNewsBriefingSlot, now = new Date()) {
  const { year, month, day } = getKstDateParts(now);
  const slotHour = slot === "morning_6" ? HOME_NEWS_MORNING_SLOT_HOUR : HOME_NEWS_AFTERNOON_SLOT_START_HOUR;
  const currentDayReference = toKstDate(year, month, day, slotHour);

  if (now.getTime() >= currentDayReference.getTime()) {
    return currentDayReference;
  }

  return shiftDays(currentDayReference, -1);
}

export function getHomeNewsSlotTimeWindow(slot: HomeNewsBriefingSlot, now = new Date()) {
  const endsAt = getHomeNewsSlotReferenceTime(slot, now);
  const startsAt = new Date(endsAt.getTime() - HOME_NEWS_SLOT_WINDOW_HOURS * 60 * 60 * 1000);

  return {
    startsAt,
    endsAt,
  };
}
