import { getKstDateKey } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";

export const HOME_NEWS_AFTERNOON_SLOT_START_HOUR = 15;

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
