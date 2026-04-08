import type { HomeNewsEventStage } from "@/lib/home-news/transform";

export type HomeNewsRankingRecord = {
  priority: "high" | "medium" | "low" | null;
  event_stage: HomeNewsEventStage;
  occurred_at: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export const MAX_HOME_NEWS_ITEMS = 3;

export function toNewsTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getPriorityWeight(priority: HomeNewsRankingRecord["priority"]) {
  switch (priority) {
    case "high":
      return 300;
    case "medium":
      return 200;
    case "low":
      return 100;
    default:
      return 0;
  }
}

export function getEventStageWeight(eventStage: HomeNewsEventStage) {
  switch (eventStage) {
    case "attending":
    case "under_questioning":
    case "warrant_issued":
      return 80;
    case "summon_scheduled":
    case "warrant_review_scheduled":
    case "warrant_requested":
      return 60;
    case "summon_requested":
    case "warrant_denied":
    case "investigation_update":
      return 40;
    default:
      return 0;
  }
}

export function getEffectiveEventTimestamp(record: Pick<HomeNewsRankingRecord, "occurred_at" | "published_at">) {
  return toNewsTimestamp(record.occurred_at) || toNewsTimestamp(record.published_at);
}

export function sortHomeNewsByImportance<T extends HomeNewsRankingRecord>(left: T, right: T) {
  const priorityDiff = getPriorityWeight(right.priority) - getPriorityWeight(left.priority);
  if (priorityDiff !== 0) return priorityDiff;

  const stageDiff = getEventStageWeight(right.event_stage) - getEventStageWeight(left.event_stage);
  if (stageDiff !== 0) return stageDiff;

  const eventTimeDiff = getEffectiveEventTimestamp(right) - getEffectiveEventTimestamp(left);
  if (eventTimeDiff !== 0) return eventTimeDiff;

  const publishedDiff = toNewsTimestamp(right.published_at) - toNewsTimestamp(left.published_at);
  if (publishedDiff !== 0) return publishedDiff;

  return toNewsTimestamp(right.updated_at ?? right.created_at) - toNewsTimestamp(left.updated_at ?? left.created_at);
}

export function selectTopHomeNewsBriefings<T extends HomeNewsRankingRecord>(records: T[], limit = MAX_HOME_NEWS_ITEMS) {
  return records.slice().sort(sortHomeNewsByImportance).slice(0, limit);
}
