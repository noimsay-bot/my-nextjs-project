import { HomeNewsCategory, HOME_NEWS_CATEGORY_LABELS, HOME_NEWS_CATEGORIES } from "@/components/home/home-news.types";
import {
  HomeNewsBriefingRecord,
  HomeNewsBriefingSlot,
  HomeNewsEventStage,
} from "@/lib/home-news/transform";

export const NEWS_BRIEFING_SLOTS = ["morning_6", "afternoon_3"] as const;
export const NEWS_BRIEFING_PRIORITIES = ["high", "medium", "low"] as const;
export const NEWS_BRIEFING_STATUS_FILTERS = ["all", "active", "inactive"] as const;

export type NewsBriefingPriority = (typeof NEWS_BRIEFING_PRIORITIES)[number];
export type NewsBriefingStatusFilter = (typeof NEWS_BRIEFING_STATUS_FILTERS)[number];

export type NewsBriefingAdminRecord = HomeNewsBriefingRecord;

export type NewsBriefingAdminFilters = {
  slot: HomeNewsBriefingSlot | "all";
  category: HomeNewsCategory | "all";
  status: NewsBriefingStatusFilter;
};

export type NewsBriefingFormValues = {
  category: HomeNewsCategory;
  title: string;
  summary: string;
  whyItMatters: string;
  checkPoints: string;
  priority: NewsBriefingPriority;
  publishedAt: string;
  occurredAt: string;
  briefingSlot: HomeNewsBriefingSlot;
  briefingText: string;
  isActive: boolean;
  sourceLabel: string;
  tags: string;
  eventStage: Exclude<HomeNewsEventStage, null> | "";
};

export const NEWS_BRIEFING_SLOT_LABELS: Record<HomeNewsBriefingSlot, string> = {
  morning_6: "오전 6시 브리핑",
  afternoon_3: "오후 3시 브리핑",
};

export const NEWS_BRIEFING_PRIORITY_LABELS: Record<NewsBriefingPriority, string> = {
  high: "상",
  medium: "중",
  low: "하",
};

export const NEWS_BRIEFING_EVENT_STAGE_LABELS: Record<Exclude<HomeNewsEventStage, null>, string> = {
  summon_requested: "경찰/검찰 소환",
  summon_scheduled: "소환 예정",
  attending: "출석 중",
  under_questioning: "조사 중",
  warrant_review_scheduled: "구속영장실질심사 예정",
  warrant_requested: "영장 청구",
  warrant_issued: "영장 발부",
  warrant_denied: "영장 기각",
  investigation_update: "수사 절차 진행",
};

export const NEWS_BRIEFING_EVENT_STAGE_OPTIONS = [
  { value: "", label: "선택 안 함" },
  ...Object.entries(NEWS_BRIEFING_EVENT_STAGE_LABELS).map(([value, label]) => ({
    value: value as Exclude<HomeNewsEventStage, null>,
    label,
  })),
] as const;

export const DEFAULT_NEWS_BRIEFING_FILTERS: NewsBriefingAdminFilters = {
  slot: "all",
  category: "all",
  status: "all",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function createDefaultNewsBriefingFormValues(): NewsBriefingFormValues {
  const now = new Date();
  const localValue = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return {
    category: "politics",
    title: "",
    summary: "",
    whyItMatters: "",
    checkPoints: "",
    priority: "high",
    publishedAt: localValue,
    occurredAt: "",
    briefingSlot: "morning_6",
    briefingText: "",
    isActive: true,
    sourceLabel: "",
    tags: "",
    eventStage: "",
  };
}

export function toLocalDateTimeInputValue(value: string | null | undefined) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toNewsBriefingFormValues(record: NewsBriefingAdminRecord): NewsBriefingFormValues {
  return {
    category: record.category,
    title: record.title ?? "",
    summary: (record.summary_lines ?? []).join("\n"),
    whyItMatters: record.why_it_matters ?? "",
    checkPoints: (record.check_points ?? []).join("\n"),
    priority: (record.priority ?? "medium") as NewsBriefingPriority,
    publishedAt: toLocalDateTimeInputValue(record.published_at),
    occurredAt: toLocalDateTimeInputValue(record.occurred_at),
    briefingSlot: (record.briefing_slot ?? "morning_6") as HomeNewsBriefingSlot,
    briefingText: record.briefing_text ?? "",
    isActive: record.is_active ?? true,
    sourceLabel: record.source_label ?? "",
    tags: (record.tags ?? []).join(", "),
    eventStage: record.event_stage ?? "",
  };
}

export function splitMultilineField(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitTagField(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function formatNewsBriefingDateTime(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatNewsBriefingSummaryPreview(record: NewsBriefingAdminRecord) {
  const summaryLine = record.summary_lines?.find((line) => line.trim().length > 0);
  if (summaryLine) return summaryLine;
  return record.briefing_text?.trim() || record.title;
}

export function hasNewsTextTimeReference(value: string) {
  return /(오전|오후)\s*\d{1,2}시|\d{1,2}시\s*\d{0,2}분?|\d{1,2}:\d{2}/.test(value);
}

export function isNewsBriefingFormEmpty(values: NewsBriefingFormValues) {
  return ![
    values.title,
    values.summary,
    values.whyItMatters,
    values.checkPoints,
    values.briefingText,
    values.sourceLabel,
    values.tags,
    values.occurredAt,
  ].some((item) => item.trim().length > 0);
}

export function getNewsBriefingCategoryLabel(category: HomeNewsCategory) {
  return HOME_NEWS_CATEGORY_LABELS[category];
}

export function isValidNewsBriefingCategory(value: string): value is HomeNewsCategory {
  return HOME_NEWS_CATEGORIES.includes(value as HomeNewsCategory);
}

export function isValidNewsBriefingSlot(value: string): value is HomeNewsBriefingSlot {
  return NEWS_BRIEFING_SLOTS.includes(value as HomeNewsBriefingSlot);
}

export function isValidNewsBriefingPriority(value: string): value is NewsBriefingPriority {
  return NEWS_BRIEFING_PRIORITIES.includes(value as NewsBriefingPriority);
}

export function isValidNewsBriefingEventStage(value: string): value is Exclude<HomeNewsEventStage, null> {
  return value in NEWS_BRIEFING_EVENT_STAGE_LABELS;
}

export function getKstDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
