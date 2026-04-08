import {
  HomeNewsCardItem,
  HomeNewsCategory,
  HomeNewsDataset,
  HomeNewsDatasetSourceKind,
  HomeNewsTickerItem,
  HOME_NEWS_CATEGORIES,
} from "@/components/home/home-news.types";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";
import {
  MAX_HOME_NEWS_ITEMS,
  selectTopHomeNewsBriefings,
  sortHomeNewsByImportance,
  toNewsTimestamp,
} from "@/lib/home-news/ranking";

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
  occurred_at: string | null;
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

type BuildHomeNewsDatasetOptions = {
  respectInputOrder?: boolean;
  filterInactive?: boolean;
  sourceKind?: HomeNewsDatasetSourceKind;
  issueSet?: HomeNewsDataset["issueSet"];
  runtimeBriefing?: HomeNewsDataset["runtimeBriefing"];
};

export function sortHomeNewsBriefings(left: HomeNewsBriefingRecord, right: HomeNewsBriefingRecord) {
  return sortHomeNewsByImportance(left, right);
}

function formatOccurredAtLabel(value: string | null | undefined) {
  const timestamp = toNewsTimestamp(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(timestamp))
    .replace(/\s/g, " ")
    .trim();
}

function hasTimeReference(value: string) {
  return /(오전|오후)\s*\d{1,2}시|\d{1,2}시\s*\d{0,2}분?|\d{1,2}:\d{2}/.test(value);
}

function prependOccurredAt(value: string, occurredAt: string | null | undefined) {
  const label = formatOccurredAtLabel(occurredAt);
  if (!label) return value;
  if (hasTimeReference(value)) return value;
  return `${label} ${value}`.trim();
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
    occurred_at: record.occurred_at ?? null,
    briefing_slot: record.briefing_slot ?? "morning_6",
    is_active: record.is_active ?? true,
  };
}

export function buildHomeNewsDataset(
  records: HomeNewsBriefingRecord[],
  now = new Date(),
  options: BuildHomeNewsDatasetOptions = {},
): HomeNewsDataset {
  const respectInputOrder = options.respectInputOrder ?? false;
  const filterInactive = options.filterInactive ?? true;
  const sourceKind = options.sourceKind ?? "active_fallback";

  const sanitized = records
    .map(sanitizeRecord)
    .filter((item): item is HomeNewsBriefingRecord => Boolean(item))
    .filter((item) => (filterInactive ? item.is_active : true));

  const ordered = respectInputOrder
    ? sanitized
    : sanitized.slice().sort(sortHomeNewsBriefings);

  if (ordered.length === 0) {
    return {
      ...emptyHomeNewsDataset,
      sourceKind,
      issueSet: options.issueSet,
      runtimeBriefing: options.runtimeBriefing,
    };
  }

  const selected = respectInputOrder
    ? ordered.slice(0, MAX_HOME_NEWS_ITEMS)
    : selectTopHomeNewsBriefings(ordered);
  if (selected.length === 0) {
    return {
      ...emptyHomeNewsDataset,
      sourceKind,
      issueSet: options.issueSet,
      runtimeBriefing: options.runtimeBriefing,
    };
  }

  const tickerItems: HomeNewsTickerItem[] = selected.map((item) => ({
    id: item.id,
    category: item.category,
    text: prependOccurredAt(item.briefing_text?.trim() || item.title, item.occurred_at),
    priority: item.priority ?? undefined,
    publishedAt: item.published_at ?? undefined,
  }));

  const cardsByCategory = Object.fromEntries(
    HOME_NEWS_CATEGORIES.map((category) => [
      category,
      ordered
        .filter((item) => item.category === category)
        .map<HomeNewsCardItem>((item) => ({
          id: item.id,
          category: item.category,
          title: item.title,
          summary:
            item.summary_lines && item.summary_lines.length > 0
              ? item.summary_lines.map((line, index) =>
                  index === 0 ? prependOccurredAt(line, item.occurred_at) : line,
                )
              : [prependOccurredAt(item.briefing_text?.trim() || item.title, item.occurred_at)],
          whyItMatters: item.why_it_matters?.trim() || "추가 브리핑이 들어오면 이 영역에서 중요도를 함께 설명합니다.",
          checkPoints:
            item.check_points && item.check_points.length > 0
              ? item.check_points
              : ["후속 업데이트가 들어오면 이 자리에서 오늘 확인할 포인트를 안내합니다."],
          priority: item.priority ?? undefined,
          publishedAt: item.published_at ?? undefined,
          occurredAt: item.occurred_at ?? undefined,
          tags: item.tags ?? [],
          eventStage: item.event_stage,
          likesCount: item.likes_count ?? 0,
          viewerHasLiked: false,
        })),
    ]),
  ) as HomeNewsDataset["cardsByCategory"];

  return {
    tickerItems,
    cardsByCategory,
    sourceKind,
    issueSet: options.issueSet,
    runtimeBriefing: options.runtimeBriefing,
  };
}
