import { HomeNewsCategory } from "@/components/home/home-news.types";
import { NewsBriefingAdminRecord, NewsBriefingPriority } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot, HomeNewsEventStage } from "@/lib/home-news/transform";

export type ExternalNewsSourceConfig = {
  id: string;
  label: string;
  url: string;
  slotHints: HomeNewsBriefingSlot[];
  categoryHint?: HomeNewsCategory;
  eventStageHint?: Exclude<HomeNewsEventStage, null>;
  tags?: string[];
};

export type ExternalNewsRawItem = {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  feedCategoryHint?: HomeNewsCategory;
  feedEventStageHint?: Exclude<HomeNewsEventStage, null>;
  feedTags?: string[];
  slotHints: HomeNewsBriefingSlot[];
};

export type ExternalNewsCandidate = {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  occurredAt: string | null;
  category: HomeNewsCategory;
  eventStage: HomeNewsEventStage;
  tags: string[];
  priority: NewsBriefingPriority;
  slotHints: HomeNewsBriefingSlot[];
  suggestedSlot: HomeNewsBriefingSlot;
  score: number;
  scoreBreakdown?: {
    portalHeadlineLikelihood: number;
    frontPageLikelihood: number;
    proceduralImportance: number;
    promotionalPenalty: number;
    localOnlyPenalty: number;
    nationalImpact: number;
    urgency: number;
    freshness: number;
  };
  selectionReason?: string;
  recommendationReason: string;
  importanceHints: string[];
  personalizationHints: string[];
  referenceText: string;
};

export type ExternalNewsBatch = {
  slot: HomeNewsBriefingSlot;
  headline: string;
  items: ExternalNewsCandidate[];
};

export type ExternalNewsWorkspace = {
  generatedAt: string;
  trendHints: string[];
  candidates: ExternalNewsCandidate[];
  batches: Record<HomeNewsBriefingSlot, ExternalNewsBatch>;
};

export type ExternalNewsWorkspaceResponse = {
  ok: boolean;
  message: string;
  workspace?: ExternalNewsWorkspace;
};

export type ExternalNewsScoringContext = {
  existingItems: NewsBriefingAdminRecord[];
  now?: Date;
};
