import {
  HomeNewsCardItem,
  HomeNewsCategory,
  HomeNewsDataset,
  HomeNewsTickerItem,
  HOME_NEWS_CATEGORIES,
} from "@/components/home/home-news.types";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";

export type HomeNewsBriefingSlot = "morning_6" | "afternoon_3";

export type HomeNewsEventStage =
  | "summon_requested"
  | "summon_scheduled"
  | "attending"
  | "under_questioning"
  | "warrant_review_scheduled"
  | "warrant_requested"
  | "warrant_issued"
  | "warrant_denied"
  | "investigation_update"
  | null;

export type HomeNewsBriefingRecord = {
  id: string;
  category: HomeNewsCategory;
  title: string;
  summary_lines: string[] | null;
  why_it_matters: string | null;
  check_points: string[] | null;
  priority: "high" | "medium" | "low" | null;
  published_at: string | null;
  briefing_slot: HomeNewsBriefingSlot | null;
  briefing_text: string | null;
  is_active: boolean | null;
  source_label: string | null;
  tags: string[] | null;
  event_stage: HomeNewsEventStage;
  likes_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const MAX_HOME_NEWS_ITEMS = 3;

function getPriorityWeight(priority: HomeNewsBriefingRecord["priority"]) {
  switch (priority) {
    case "high":
      return 30;
    case "medium":
      return 20;
    case "low":
      return 10;
    default:
      return 0;
  }
}

function getEventStageWeight(eventStage: HomeNewsEventStage) {
  // 수사 진행 단계 뉴스는 이후 개인화/가중치 확장 시 이 함수에서 우선순위를 강화하면 됩니다.
  switch (eventStage) {
    case "attending":
    case "under_questioning":
    case "warrant_issued":
      return 4;
    case "summon_scheduled":
    case "warrant_review_scheduled":
    case "warrant_requested":
      return 3;
    case "summon_requested":
    case "warrant_denied":
    case "investigation_update":
      return 2;
    default:
      return 0;
  }
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getKstDateKey(value: string | null | undefined) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return "0000-00-00";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function getPreferredBriefingSlots(now = new Date()): HomeNewsBriefingSlot[] {
  const hour = now.getHours();
  if (hour >= 15) return ["afternoon_3", "morning_6"];
  if (hour >= 6) return ["morning_6", "afternoon_3"];
  return ["afternoon_3", "morning_6"];
}

export function sortHomeNewsBriefings(left: HomeNewsBriefingRecord, right: HomeNewsBriefingRecord) {
  const publishedDiff = toTimestamp(right.published_at) - toTimestamp(left.published_at);
  if (publishedDiff !== 0) return publishedDiff;

  const priorityDiff = getPriorityWeight(right.priority) - getPriorityWeight(left.priority);
  if (priorityDiff !== 0) return priorityDiff;

  const stageDiff = getEventStageWeight(right.event_stage) - getEventStageWeight(left.event_stage);
  if (stageDiff !== 0) return stageDiff;

  return toTimestamp(right.updated_at ?? right.created_at) - toTimestamp(left.updated_at ?? left.created_at);
}

function sanitizeRecord(record: HomeNewsBriefingRecord): HomeNewsBriefingRecord | null {
  if (!record.id || !record.title || !record.category || !HOME_NEWS_CATEGORIES.includes(record.category)) return null;
  return {
    ...record,
    summary_lines: Array.isArray(record.summary_lines) ? record.summary_lines.filter(Boolean) : [],
    check_points: Array.isArray(record.check_points) ? record.check_points.filter(Boolean) : [],
    why_it_matters: record.why_it_matters ?? "",
    briefing_text: record.briefing_text ?? "",
    priority: record.priority ?? "medium",
    briefing_slot: record.briefing_slot ?? "morning_6",
    is_active: record.is_active ?? true,
  };
}

function pickBriefingBatch(records: HomeNewsBriefingRecord[], now = new Date()) {
  const preferredSlots = getPreferredBriefingSlots(now);
  const grouped = new Map<string, HomeNewsBriefingRecord[]>();

  records.forEach((record) => {
    const dateKey = getKstDateKey(record.published_at);
    const slot = record.briefing_slot ?? "morning_6";
    const batchKey = `${dateKey}:${slot}`;
    const current = grouped.get(batchKey) ?? [];
    current.push(record);
    grouped.set(batchKey, current);
  });

  const batches = Array.from(grouped.entries())
    .map(([batchKey, items]) => ({
      batchKey,
      slot: (items[0]?.briefing_slot ?? "morning_6") as HomeNewsBriefingSlot,
      items: items.slice().sort(sortHomeNewsBriefings),
      latestPublishedAt: Math.max(...items.map((item) => toTimestamp(item.published_at))),
    }))
    .sort((left, right) => right.latestPublishedAt - left.latestPublishedAt);

  const preferredBatch =
    preferredSlots
      .map((slot) => batches.find((batch) => batch.slot === slot))
      .find(Boolean) ?? batches[0];

  return preferredBatch?.items.slice(0, MAX_HOME_NEWS_ITEMS) ?? [];
}

export function buildHomeNewsDataset(records: HomeNewsBriefingRecord[], now = new Date()): HomeNewsDataset {
  const sanitized = records
    .map(sanitizeRecord)
    .filter((item): item is HomeNewsBriefingRecord => Boolean(item))
    .filter((item) => item.is_active)
    .sort(sortHomeNewsBriefings);

  if (sanitized.length === 0) return emptyHomeNewsDataset;

  const selected = pickBriefingBatch(sanitized, now);
  if (selected.length === 0) return emptyHomeNewsDataset;

  const tickerItems: HomeNewsTickerItem[] = selected.map((item) => ({
    id: item.id,
    category: item.category,
    text: item.briefing_text?.trim() || item.title,
    priority: item.priority ?? undefined,
    publishedAt: item.published_at ?? undefined,
  }));

  const cardsByCategory = Object.fromEntries(
    HOME_NEWS_CATEGORIES.map((category) => [
      category,
      selected
        .filter((item) => item.category === category)
        .map<HomeNewsCardItem>((item) => ({
          id: item.id,
          category: item.category,
          title: item.title,
          summary: item.summary_lines && item.summary_lines.length > 0 ? item.summary_lines : [item.briefing_text?.trim() || item.title],
          whyItMatters: item.why_it_matters?.trim() || "추가 브리핑이 들어오면 이 영역에서 중요도를 함께 설명합니다.",
          checkPoints:
            item.check_points && item.check_points.length > 0
              ? item.check_points
              : ["후속 업데이트가 들어오면 이 자리에서 오늘 확인할 포인트를 안내합니다."],
          priority: item.priority ?? undefined,
          publishedAt: item.published_at ?? undefined,
        })),
    ]),
  ) as HomeNewsDataset["cardsByCategory"];

  return {
    tickerItems,
    cardsByCategory,
  };
}
