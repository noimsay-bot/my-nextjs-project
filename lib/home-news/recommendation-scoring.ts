import { HomeNewsCategory } from "@/components/home/home-news.types";
import {
  getNewsBriefingCategoryLabel,
  NewsBriefingAdminRecord,
  NewsBriefingPriority,
  NEWS_BRIEFING_EVENT_STAGE_LABELS,
} from "@/lib/home-news/admin-types";
import {
  getEffectiveEventTimestamp,
  getEventStageWeight,
  getPriorityWeight,
  toNewsTimestamp,
} from "@/lib/home-news/ranking";
import {
  NewsBriefingRecommendationCandidate,
  NewsBriefingRecommendationWorkspace,
} from "@/lib/home-news/recommendation-types";

function getRecencyWeight(timestamp: number, nowTs: number) {
  if (!timestamp) return 0;
  const diffHours = Math.max(0, (nowTs - timestamp) / (1000 * 60 * 60));
  if (diffHours <= 6) return 44;
  if (diffHours <= 24) return 34;
  if (diffHours <= 48) return 24;
  if (diffHours <= 96) return 12;
  return 4;
}

function getScheduleUrgencyWeight(record: NewsBriefingAdminRecord, nowTs: number) {
  const occurredAtTs = toNewsTimestamp(record.occurred_at);
  if (!occurredAtTs) return 0;

  const diffHours = (occurredAtTs - nowTs) / (1000 * 60 * 60);
  const absHours = Math.abs(diffHours);

  if (diffHours >= -4 && diffHours <= 8) return 60;
  if (absHours <= 24) return 36;
  if (absHours <= 48) return 18;
  return 0;
}

function getLikeSignalWeight(likesCount: number) {
  if (likesCount >= 20) return 24;
  if (likesCount >= 10) return 16;
  if (likesCount >= 5) return 10;
  if (likesCount >= 1) return 4;
  return 0;
}

function buildTrendMaps(records: NewsBriefingAdminRecord[], nowTs: number) {
  const categoryMap = new Map<string, number>();
  const eventStageMap = new Map<string, number>();
  const tagMap = new Map<string, number>();

  records.forEach((record) => {
    const likesWeight = Math.max(record.likes_count ?? 0, 0);
    if (likesWeight <= 0) return;

    const recencyWeight = 1 + getRecencyWeight(toNewsTimestamp(record.published_at), nowTs) / 50;
    const score = likesWeight * recencyWeight;

    categoryMap.set(record.category, (categoryMap.get(record.category) ?? 0) + score);
    if (record.event_stage) {
      eventStageMap.set(record.event_stage, (eventStageMap.get(record.event_stage) ?? 0) + score);
    }
    (record.tags ?? []).forEach((tag) => {
      const normalized = tag.trim().toLowerCase();
      if (!normalized) return;
      tagMap.set(normalized, (tagMap.get(normalized) ?? 0) + score);
    });
  });

  return { categoryMap, eventStageMap, tagMap };
}

function formatReasonText(importanceHints: string[], personalizationHints: string[]) {
  return [...importanceHints, ...personalizationHints].slice(0, 3).join(" · ");
}

function buildReferenceText(record: NewsBriefingAdminRecord) {
  return [
    record.title,
    ...(record.summary_lines ?? []),
    record.why_it_matters?.trim() ? `왜 중요한지: ${record.why_it_matters.trim()}` : "",
    ...(record.check_points ?? []).map((point) => `체크 포인트: ${point}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizePriority(priority: NewsBriefingAdminRecord["priority"]): NewsBriefingPriority {
  return priority === "high" || priority === "medium" || priority === "low" ? priority : "medium";
}

function getTrendHints(records: NewsBriefingAdminRecord[], nowTs: number) {
  const { categoryMap, eventStageMap, tagMap } = buildTrendMaps(records, nowTs);
  const topCategory = [...categoryMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topStage = [...eventStageMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topTag = [...tagMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return [
    topCategory ? `최근 관심 신호가 ${getNewsBriefingCategoryLabel(topCategory as HomeNewsCategory)} 카테고리에 상대적으로 몰립니다.` : "",
    topStage && topStage in NEWS_BRIEFING_EVENT_STAGE_LABELS
      ? `절차 단계 중 '${NEWS_BRIEFING_EVENT_STAGE_LABELS[topStage as keyof typeof NEWS_BRIEFING_EVENT_STAGE_LABELS]}' 관련 관심도가 높습니다.`
      : "",
    topTag ? `반복 관심 태그: ${topTag}` : "",
  ].filter(Boolean);
}

export function buildNewsBriefingRecommendationWorkspace(
  records: NewsBriefingAdminRecord[],
  now = new Date(),
): NewsBriefingRecommendationWorkspace {
  const nowTs = now.getTime();
  const sourceRecords = records
    .filter((record) => Boolean(record.title?.trim()))
    .filter((record) => (record.is_active ?? true))
    .slice();

  if (sourceRecords.length === 0) {
    return {
      candidates: [],
      trendHints: [],
    };
  }

  const trendMaps = buildTrendMaps(sourceRecords, nowTs);
  const candidates = sourceRecords
    .map<NewsBriefingRecommendationCandidate>((record) => {
      const importanceHints: string[] = [];
      const personalizationHints: string[] = [];
      const priorityWeight = getPriorityWeight(record.priority);
      const stageWeight = getEventStageWeight(record.event_stage);
      const eventTimestamp = getEffectiveEventTimestamp(record);
      const urgencyWeight = getScheduleUrgencyWeight(record, nowTs);
      const recencyWeight = getRecencyWeight(toNewsTimestamp(record.published_at), nowTs);
      const likesWeight = getLikeSignalWeight(record.likes_count ?? 0);

      if (priorityWeight >= 300) {
        importanceHints.push("우선순위 상으로 분류된 뉴스입니다.");
      }
      if (stageWeight >= 60 && record.event_stage) {
        importanceHints.push("수사 절차 진행 단계로 중요도 높음");
      }
      if (urgencyWeight >= 36 && record.occurred_at) {
        importanceHints.push("오늘 예정되었거나 임박한 실제 시각 정보가 포함됩니다.");
      }
      if (recencyWeight >= 24) {
        importanceHints.push("최근 업데이트된 브리핑입니다.");
      }

      const categoryTrend = trendMaps.categoryMap.get(record.category) ?? 0;
      const stageTrend = record.event_stage ? trendMaps.eventStageMap.get(record.event_stage) ?? 0 : 0;
      const tagTrend = (record.tags ?? [])
        .map((tag) => trendMaps.tagMap.get(tag.trim().toLowerCase()) ?? 0)
        .reduce((sum, value) => sum + value, 0);
      const personalizationBoost = Math.min(categoryTrend * 0.25 + stageTrend * 0.3 + tagTrend * 0.08, 26);

      if (likesWeight >= 10) {
        personalizationHints.push("최근 사용자 관심 신호가 누적된 뉴스입니다.");
      } else if (personalizationBoost >= 12) {
        personalizationHints.push("최근 관심도 높은 유형과 겹칩니다.");
      }
      if (tagTrend >= 20 && (record.tags ?? []).length > 0) {
        personalizationHints.push("반복 관심 태그가 포함됩니다.");
      }

      const score =
        priorityWeight +
        stageWeight +
        urgencyWeight +
        recencyWeight +
        likesWeight +
        personalizationBoost +
        Math.min(Math.max((eventTimestamp - nowTs) / (1000 * 60 * 60), -48), 48) * 0.05;

      return {
        id: record.id,
        category: record.category,
        title: record.title,
        priority: normalizePriority(record.priority),
        eventStage: record.event_stage,
        occurredAt: record.occurred_at,
        publishedAt: record.published_at,
        likesCount: record.likes_count ?? 0,
        sourceLabel: record.source_label ?? "",
        tags: record.tags ?? [],
        referenceText: buildReferenceText(record),
        relatedKeywords: (record.tags ?? []).join(", "),
        recommendationReason: formatReasonText(importanceHints, personalizationHints) || "공통 중요도와 관심 신호를 함께 고려한 후보입니다.",
        importanceHints,
        personalizationHints,
        score,
        record,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  return {
    candidates,
    trendHints: getTrendHints(sourceRecords, nowTs),
  };
}
