import { HomeNewsCardItem, HomeNewsCategory } from "@/components/home/home-news.types";
import { NewsBriefingPriority } from "@/lib/home-news/admin-types";
import { HomeNewsEventStage } from "@/lib/home-news/transform";

export type HomeNewsPreferenceKind = "like" | "dislike";

export type HomeNewsLikeRow = {
  briefing_id: string;
  profile_id: string;
  created_at: string;
};

export type HomeNewsPreferenceRecord = {
  briefingId: string;
  category: HomeNewsCategory;
  tags: string[];
  eventStage: HomeNewsEventStage;
  priority: NewsBriefingPriority | null;
  preference: HomeNewsPreferenceKind;
  createdAt: string;
};

export type HomeNewsLikeWorkspace = {
  likedBriefingIds: string[];
  dislikedBriefingIds: string[];
  preferences: HomeNewsPreferenceRecord[];
};

export type ToggleHomeNewsPreferenceResult = {
  ok: boolean;
  message: string;
  preference?: HomeNewsPreferenceKind | null;
  likesCount?: number;
};

export function createEmptyHomeNewsLikeWorkspace(): HomeNewsLikeWorkspace {
  return {
    likedBriefingIds: [],
    dislikedBriefingIds: [],
    preferences: [],
  };
}

export function toHomeNewsPreferenceRecord(
  item: HomeNewsCardItem,
  preference: HomeNewsPreferenceKind,
  createdAt = new Date().toISOString(),
): HomeNewsPreferenceRecord {
  return {
    briefingId: item.id,
    category: item.category,
    tags: item.tags ?? [],
    eventStage: (item.eventStage as HomeNewsEventStage) ?? null,
    priority: item.priority ?? null,
    preference,
    createdAt,
  };
}
