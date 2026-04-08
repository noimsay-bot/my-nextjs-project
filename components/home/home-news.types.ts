export const HOME_NEWS_CATEGORIES = ["politics", "society", "economy", "world"] as const;

export type HomeNewsCategory = (typeof HOME_NEWS_CATEGORIES)[number];

export type HomeNewsTickerItem = {
  id: string;
  category: HomeNewsCategory;
  text: string;
  priority?: "high" | "medium" | "low";
  publishedAt?: string;
};

export type HomeNewsCardItem = {
  id: string;
  category: HomeNewsCategory;
  title: string;
  summary: string[];
  whyItMatters: string;
  checkPoints: string[];
  priority?: "high" | "medium" | "low";
  publishedAt?: string;
};

export type HomeNewsCardsByCategory = Record<HomeNewsCategory, HomeNewsCardItem[]>;

export type HomeNewsDataset = {
  tickerItems: HomeNewsTickerItem[];
  cardsByCategory: Partial<HomeNewsCardsByCategory>;
};

export const HOME_NEWS_CATEGORY_LABELS: Record<HomeNewsCategory, string> = {
  politics: "정치",
  society: "사회",
  economy: "경제",
  world: "세계",
};
