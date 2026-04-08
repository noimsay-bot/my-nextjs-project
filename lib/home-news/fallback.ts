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
  return {
    ...emptyHomeNewsDataset,
    sourceKind: homeNewsMockData.sourceKind,
  };
}
