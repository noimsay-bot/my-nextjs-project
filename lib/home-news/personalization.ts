import {
  HomeNewsCardsByCategory,
  HomeNewsDataset,
  HOME_NEWS_CATEGORIES,
} from "@/components/home/home-news.types";
import { HomeNewsLikeWorkspace } from "@/lib/home-news/like-types";

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
  const dislikedIdSet = new Set(likeWorkspace.dislikedBriefingIds);
  const nextCardsByCategory = Object.fromEntries(
    HOME_NEWS_CATEGORIES.map((category) => [
      category,
      (dataset.cardsByCategory[category] ?? []).map((item) => ({
        ...item,
        viewerHasLiked: likedIdSet.has(item.id),
        viewerHasDisliked: dislikedIdSet.has(item.id),
      })),
    ]),
  ) as Partial<HomeNewsCardsByCategory>;
  const nextTemporarySections = (dataset.temporarySections ?? []).map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      viewerHasLiked: likedIdSet.has(item.id),
      viewerHasDisliked: dislikedIdSet.has(item.id),
    })),
  }));

  return {
    ...dataset,
    cardsByCategory: nextCardsByCategory,
    temporarySections: nextTemporarySections,
    recommendedCategory: dataset.recommendedCategory ?? chooseFirstCategory(nextCardsByCategory),
  } satisfies HomeNewsDataset;
}
