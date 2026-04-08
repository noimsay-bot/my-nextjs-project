import { HomeNewsCategory } from "@/components/home/home-news.types";
import { NewsBriefingAdminRecord, NewsBriefingPriority } from "@/lib/home-news/admin-types";
import { HomeNewsEventStage } from "@/lib/home-news/transform";

export type NewsBriefingRecommendationCandidate = {
  id: string;
  category: HomeNewsCategory;
  title: string;
  priority: NewsBriefingPriority;
  eventStage: HomeNewsEventStage;
  occurredAt: string | null;
  publishedAt: string | null;
  likesCount: number;
  sourceLabel: string;
  tags: string[];
  referenceText: string;
  relatedKeywords: string;
  recommendationReason: string;
  importanceHints: string[];
  personalizationHints: string[];
  score: number;
  record: NewsBriefingAdminRecord;
};

export type NewsBriefingRecommendationWorkspace = {
  candidates: NewsBriefingRecommendationCandidate[];
  trendHints: string[];
};
