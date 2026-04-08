import {
  HomeNewsCardsByCategory,
  HomeNewsCardItem,
  HomeNewsCategory,
  HomeNewsDataset,
  HOME_NEWS_CATEGORIES,
} from "@/components/home/home-news.types";
import { HomeNewsLikePreferenceRecord, HomeNewsLikeWorkspace } from "@/lib/home-news/like-types";

type PersonalizationProfile = {
  totalLikes: number;
  categoryWeights: Map<HomeNewsCategory, number>;
  eventStageWeights: Map<string, number>;
  tagWeights: Map<string, number>;
  priorityWeights: Map<string, number>;
};

function getRecencyWeight(createdAt: string) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) return 1.35;
  if (ageDays <= 14) return 1.15;
  return 1;
}

function buildPersonalizationProfile(preferences: HomeNewsLikePreferenceRecord[]): PersonalizationProfile | null {
  if (preferences.length === 0) return null;

  const categoryWeights = new Map<HomeNewsCategory, number>();
  const eventStageWeights = new Map<string, number>();
  const tagWeights = new Map<string, number>();
  const priorityWeights = new Map<string, number>();

  preferences.forEach((record) => {
    const weight = getRecencyWeight(record.createdAt);
    categoryWeights.set(record.category, (categoryWeights.get(record.category) ?? 0) + weight);

    if (record.eventStage) {
      eventStageWeights.set(record.eventStage, (eventStageWeights.get(record.eventStage) ?? 0) + weight * 1.2);
    }

    record.tags.forEach((tag) => {
      const normalizedTag = tag.trim().toLowerCase();
      if (!normalizedTag) return;
      tagWeights.set(normalizedTag, (tagWeights.get(normalizedTag) ?? 0) + weight * 0.8);
    });

    if (record.priority) {
      priorityWeights.set(record.priority, (priorityWeights.get(record.priority) ?? 0) + weight * 0.5);
    }
  });

  return {
    totalLikes: preferences.length,
    categoryWeights,
    eventStageWeights,
    tagWeights,
    priorityWeights,
  };
}

function getPersonalizationBoost(item: HomeNewsCardItem, profile: PersonalizationProfile | null) {
  if (!profile) return 0;

  let score = 0;
  score += (profile.categoryWeights.get(item.category) ?? 0) * 8;

  if (item.eventStage) {
    score += (profile.eventStageWeights.get(item.eventStage) ?? 0) * 11;
  }

  const matchingTagScore = (item.tags ?? [])
    .map((tag) => profile.tagWeights.get(tag.trim().toLowerCase()) ?? 0)
    .reduce((sum, weight) => sum + weight, 0);
  score += Math.min(matchingTagScore, 8) * 6;

  if (item.priority) {
    score += (profile.priorityWeights.get(item.priority) ?? 0) * 4;
  }

  if (item.viewerHasLiked) {
    score += 120;
  }

  return score;
}

function personalizeCategoryItems(items: HomeNewsCardItem[], profile: PersonalizationProfile | null) {
  if (!profile || profile.totalLikes === 0) {
    return items;
  }

  return items
    .map((item, index) => ({
      item,
      index,
      boost: getPersonalizationBoost(item, profile),
    }))
    .sort((left, right) => {
      const boostDiff = right.boost - left.boost;
      if (Math.abs(boostDiff) > 18) return boostDiff;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function chooseRecommendedCategory(cardsByCategory: Partial<HomeNewsCardsByCategory>, profile: PersonalizationProfile | null) {
  const categoriesWithItems = HOME_NEWS_CATEGORIES.filter((category) => (cardsByCategory[category] ?? []).length > 0);
  if (categoriesWithItems.length === 0) return undefined;
  if (!profile || profile.totalLikes === 0) return categoriesWithItems[0];

  return categoriesWithItems
    .map((category) => {
      const items = cardsByCategory[category] ?? [];
      const topScore = items.length > 0 ? getPersonalizationBoost(items[0], profile) : 0;
      const categoryAffinity = (profile.categoryWeights.get(category) ?? 0) * 10;
      return {
        category,
        score: topScore + categoryAffinity,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.category;
}

function chooseFirstCategory(cardsByCategory: Partial<HomeNewsCardsByCategory>) {
  return HOME_NEWS_CATEGORIES.find((category) => (cardsByCategory[category] ?? []).length > 0);
}

export function applyHomeNewsPersonalization(
  dataset: HomeNewsDataset,
  likeWorkspace: HomeNewsLikeWorkspace | null,
) {
  if (!likeWorkspace) {
    return dataset;
  }

  const likedIdSet = new Set(likeWorkspace.likedBriefingIds);
  const profile = buildPersonalizationProfile(likeWorkspace.preferences);
  const keepOfficialOrder =
    dataset.sourceKind === "official_issue_set" || dataset.sourceKind === "timed_live_preview";
  const nextCardsByCategory = Object.fromEntries(
    HOME_NEWS_CATEGORIES.map((category) => {
      const items = (dataset.cardsByCategory[category] ?? []).map((item) => ({
        ...item,
        viewerHasLiked: likedIdSet.has(item.id),
      }));

      return [category, keepOfficialOrder ? items : personalizeCategoryItems(items, profile)];
    }),
  ) as Partial<HomeNewsCardsByCategory>;

  return {
    ...dataset,
    cardsByCategory: nextCardsByCategory,
    recommendedCategory: keepOfficialOrder
      ? dataset.recommendedCategory ?? chooseFirstCategory(nextCardsByCategory)
      : chooseRecommendedCategory(nextCardsByCategory, profile),
  } satisfies HomeNewsDataset;
}
