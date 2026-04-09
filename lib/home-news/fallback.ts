import { homeNewsMockData } from "@/components/home/home-news.mock";
import { HomeNewsDataset, HOME_NEWS_CATEGORIES } from "@/components/home/home-news.types";

export const emptyHomeNewsDataset: HomeNewsDataset = {
  tickerItems: [],
  cardsByCategory: Object.fromEntries(HOME_NEWS_CATEGORIES.map((category) => [category, []])) as HomeNewsDataset["cardsByCategory"],
  temporarySections: [
    {
      id: "local_election",
      label: "지방선거",
      items: [],
    },
  ],
  sourceKind: "empty",
};

export type HomeNewsFallbackReason = "missing_env" | "query_error" | "schema_missing";

export function getHomeNewsFallbackDataset(_reason: HomeNewsFallbackReason): HomeNewsDataset {
  const cardsByCategory = Object.fromEntries(
    Object.entries(homeNewsMockData.cardsByCategory).map(([category, items]) => [
      category,
      (items ?? []).map((item) => ({
        ...item,
        summary: [...item.summary],
        checkPoints: [...item.checkPoints],
        tags: item.tags ? [...item.tags] : undefined,
      })),
    ]),
  ) as HomeNewsDataset["cardsByCategory"];

  return {
    ...homeNewsMockData,
    tickerItems: homeNewsMockData.tickerItems.map((item) => ({ ...item })),
    cardsByCategory,
    temporarySections: (homeNewsMockData.temporarySections ?? []).map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        summary: [...item.summary],
        checkPoints: [...item.checkPoints],
        tags: item.tags ? [...item.tags] : undefined,
      })),
    })),
  };
}
