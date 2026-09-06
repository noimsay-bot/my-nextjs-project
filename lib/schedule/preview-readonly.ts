import "server-only";

import type { PublishedScheduleItem } from "@/lib/schedule/published";
import type { DaySchedule, GeneratedSchedule, PointerState } from "@/lib/schedule/types";

const PREVIEW_BRANCH = "codex/mobile-schedule-pan-zoom";
const PREVIEW_DISPLAY_NAME = "정철원";

const previewPointers: PointerState = {
  morning: 0,
  extension: 0,
  evening: 0,
  nightWeekday: 0,
  nightFriday: 0,
  nightSaturday: 0,
  nightSunday: 0,
  jcheck: 0,
  holidayDuty: 0,
};

const previewNames = [PREVIEW_DISPLAY_NAME, "김하늘", "박서준", "이도윤", "최지우", "한유진"];

function getKoreaYearMonth(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function getPreviewAssignments(day: number, dow: number): Record<string, string[]> {
  const person = (offset: number) => previewNames[(day + offset) % previewNames.length];

  if (dow === 0 || dow === 6) {
    return {
      일반: [person(0), person(1)],
      뉴스대기: [person(2)],
      야근: [person(3)],
    };
  }

  return {
    조근: [person(0)],
    일반: [person(1), person(2)],
    석근: [person(3), person(4)],
    뉴스대기: [person(5)],
    청와대: [person(2)],
    국회: [person(4)],
    청사: [person(0)],
    야근: [person(3)],
  };
}

function createPreviewDay(year: number, month: number, day: number): DaySchedule {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();

  return {
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day,
    month,
    year,
    dow,
    isWeekend: dow === 0 || dow === 6,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: getPreviewAssignments(day, dow),
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
}

function createPreviewSchedule(now: Date): GeneratedSchedule {
  const { year, month } = getKoreaYearMonth(now);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return {
    year,
    month,
    monthKey,
    days: Array.from({ length: daysInMonth }, (_, index) => createPreviewDay(year, month, index + 1)),
    nextPointers: { ...previewPointers },
    nextStartDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export function isPreviewScheduleDemoEnabled() {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === PREVIEW_BRANCH &&
    process.env.PREVIEW_SCHEDULE_DEMO === "1"
  );
}

export function createPreviewReadonlyScheduleProps(now = new Date()) {
  const schedule = createPreviewSchedule(now);
  const item: PublishedScheduleItem = {
    monthKey: schedule.monthKey,
    title: `${schedule.year}년 ${schedule.month}월 근무표 (프리뷰)`,
    publishedAt: `${schedule.monthKey}-01T09:00:00+09:00`,
    schedule,
  };

  return {
    displayName: PREVIEW_DISPLAY_NAME,
    items: [item],
  };
}
