"use client";

import { createEmptyHomeNewsLikeWorkspace, HomeNewsLikePreferenceRecord, HomeNewsLikeWorkspace } from "@/lib/home-news/like-types";
import { getPortalSession, getPortalSupabaseClient } from "@/lib/supabase/portal";
import { HomeNewsCategory } from "@/components/home/home-news.types";
import { HomeNewsEventStage } from "@/lib/home-news/transform";

type BriefingPreferenceRow = {
  id: string;
  category: HomeNewsCategory;
  tags: string[] | null;
  event_stage: HomeNewsEventStage;
  priority: "high" | "medium" | "low" | null;
};

function normalizePreferenceRows(
  likeRows: Array<{ briefing_id: string; created_at: string }>,
  briefingRows: BriefingPreferenceRow[],
) {
  const briefingMap = new Map(briefingRows.map((row) => [row.id, row] as const));

  return likeRows
    .map<HomeNewsLikePreferenceRecord | null>((likeRow) => {
      const briefing = briefingMap.get(likeRow.briefing_id);
      if (!briefing) return null;

      return {
        briefingId: briefing.id,
        category: briefing.category,
        tags: briefing.tags ?? [],
        eventStage: briefing.event_stage ?? null,
        priority: briefing.priority ?? null,
        createdAt: likeRow.created_at,
      };
    })
    .filter((item): item is HomeNewsLikePreferenceRecord => Boolean(item));
}

export async function fetchHomeNewsLikeWorkspace(): Promise<HomeNewsLikeWorkspace> {
  const session = await getPortalSession();
  if (!session?.approved) {
    return createEmptyHomeNewsLikeWorkspace();
  }

  const supabase = await getPortalSupabaseClient();
  const { data: likeRows, error: likeError } = await supabase
    .from("home_news_briefing_likes")
    .select("briefing_id, created_at")
    .eq("profile_id", session.id)
    .order("created_at", { ascending: false })
    .returns<Array<{ briefing_id: string; created_at: string }>>();

  if (likeError || !likeRows || likeRows.length === 0) {
    return createEmptyHomeNewsLikeWorkspace();
  }

  const briefingIds = Array.from(new Set(likeRows.map((row) => row.briefing_id)));
  const { data: briefingRows, error: briefingError } = await supabase
    .from("home_news_briefings")
    .select("id, category, tags, event_stage, priority")
    .in("id", briefingIds)
    .returns<BriefingPreferenceRow[]>();

  if (briefingError || !briefingRows) {
    return {
      likedBriefingIds: briefingIds,
      preferences: [],
    };
  }

  return {
    likedBriefingIds: briefingIds,
    preferences: normalizePreferenceRows(likeRows, briefingRows),
  };
}
