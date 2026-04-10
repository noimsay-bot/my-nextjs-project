export const HOME_NEWS_CATEGORIES = ["politics", "society", "economy", "world"] as const;
export const HOME_NEWS_TEMPORARY_SECTION_IDS = ["notice", "local_election"] as const;

export type HomeNewsCategory = (typeof HOME_NEWS_CATEGORIES)[number];
export type HomeNewsTemporarySectionId = (typeof HOME_NEWS_TEMPORARY_SECTION_IDS)[number];

export type HomeNewsDatasetSourceKind =
  | "official_issue_set"
  | "timed_live_preview"
  | "active_fallback"
  | "fallback_mock"
  | "empty";

export type HomeNewsRuntimeBriefingMeta = {
  briefingSlot: "morning_6" | "afternoon_3";
  generatedAt: string;
};

export type HomeNewsIssueSetMeta = {
  id: string;
  title: string;
  issueDate: string;
  briefingSlot: "morning_6" | "afternoon_3";
  status: "published" | "locked";
  publishedAt?: string;
};

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
  sourceLabel?: string;
  whyItMatters: string;
  checkPoints: string[];
  priority?: "high" | "medium" | "low";
  publishedAt?: string;
  occurredAt?: string;
  tags?: string[];
  eventStage?: string | null;
  likesCount?: number;
  viewerHasLiked?: boolean;
  viewerHasDisliked?: boolean;
  badgeLabel?: string;
  tagLabel?: string;
  noticeTone?: "normal" | "urgent";
  disablePreferenceActions?: boolean;
};

export type HomeNewsCardsByCategory = Record<HomeNewsCategory, HomeNewsCardItem[]>;

export type HomeNewsTemporarySection = {
  id: HomeNewsTemporarySectionId;
  label: string;
  items: HomeNewsCardItem[];
};

export type HomeNewsDataset = {
  tickerItems: HomeNewsTickerItem[];
  cardsByCategory: Partial<HomeNewsCardsByCategory>;
  temporarySections?: HomeNewsTemporarySection[];
  recommendedCategory?: HomeNewsCategory;
  sourceKind?: HomeNewsDatasetSourceKind;
  issueSet?: HomeNewsIssueSetMeta;
  runtimeBriefing?: HomeNewsRuntimeBriefingMeta;
};

export const HOME_NEWS_CATEGORY_LABELS: Record<HomeNewsCategory, string> = {
  politics: "정치",
  society: "사회",
  economy: "경제",
  world: "세계",
};
