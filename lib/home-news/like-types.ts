import { HomeNewsCardItem, HomeNewsCategory } from "@/components/home/home-news.types";
import { NewsBriefingPriority } from "@/lib/home-news/admin-types";
import { HomeNewsEventStage } from "@/lib/home-news/transform";

export type HomeNewsLikeRow = {
  briefing_id: string;
  profile_id: string;
  created_at: string;
};

export type HomeNewsLikePreferenceRecord = {
  briefingId: string;
  category: HomeNewsCategory;
  tags: string[];
  eventStage: HomeNewsEventStage;
  priority: NewsBriefingPriority | null;
  createdAt: string;
};

export type HomeNewsLikeWorkspace = {
  likedBriefingIds: string[];
  preferences: HomeNewsLikePreferenceRecord[];
};

export type ToggleHomeNewsLikeResult = {
  ok: boolean;
  message: string;
  liked?: boolean;
  likesCount?: number;
};

export function createEmptyHomeNewsLikeWorkspace(): HomeNewsLikeWorkspace {
  return {
    likedBriefingIds: [],
    preferences: [],
  };
}

export function toHomeNewsLikePreferenceRecord(item: HomeNewsCardItem, createdAt = new Date().toISOString()): HomeNewsLikePreferenceRecord {
  return {
    briefingId: item.id,
    category: item.category,
    tags: item.tags ?? [],
    eventStage: (item.eventStage as HomeNewsEventStage) ?? null,
    priority: item.priority ?? null,
    createdAt,
  };
}
