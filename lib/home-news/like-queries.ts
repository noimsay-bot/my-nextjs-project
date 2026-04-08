"use client";

import { HomeNewsCategory } from "@/components/home/home-news.types";
import { createEmptyHomeNewsLikeWorkspace, HomeNewsLikeWorkspace, HomeNewsPreferenceRecord } from "@/lib/home-news/like-types";
import { getPortalSession, getPortalSupabaseClient } from "@/lib/supabase/portal";
import { HomeNewsEventStage } from "@/lib/home-news/transform";

type BriefingPreferenceRow = {
  id: string;
  category: HomeNewsCategory;
  tags: string[] | null;
  event_stage: HomeNewsEventStage;
  priority: "high" | "medium" | "low" | null;
};

function buildPreferenceRecords(
  rows: Array<{ briefing_id: string; created_at: string }>,
  briefingRows: BriefingPreferenceRow[],
  preference: "like" | "dislike",
) {
  const briefingMap = new Map(briefingRows.map((row) => [row.id, row] as const));

  return rows
    .map<HomeNewsPreferenceRecord | null>((row) => {
      const briefing = briefingMap.get(row.briefing_id);
      if (!briefing) return null;

      return {
        briefingId: briefing.id,
        category: briefing.category,
        tags: briefing.tags ?? [],
        eventStage: briefing.event_stage ?? null,
        priority: briefing.priority ?? null,
        preference,
        createdAt: row.created_at,
      };
    })
    .filter((item): item is HomeNewsPreferenceRecord => Boolean(item));
}

export async function fetchHomeNewsLikeWorkspace(): Promise<HomeNewsLikeWorkspace> {
  const session = await getPortalSession();
  if (!session?.approved) {
    return createEmptyHomeNewsLikeWorkspace();
  }

  const supabase = await getPortalSupabaseClient();

  const [{ data: likeRows, error: likeError }, { data: dislikeRows, error: dislikeError }] = await Promise.all([
    supabase
      .from("home_news_briefing_likes")
      .select("briefing_id, created_at")
      .eq("profile_id", session.id)
      .order("created_at", { ascending: false })
      .returns<Array<{ briefing_id: string; created_at: string }>>(),
    supabase
      .from("home_news_briefing_dislikes")
      .select("briefing_id, created_at")
      .eq("profile_id", session.id)
      .order("created_at", { ascending: false })
      .returns<Array<{ briefing_id: string; created_at: string }>>(),
  ]);

  const safeLikeRows = !likeError && likeRows ? likeRows : [];
  const safeDislikeRows = !dislikeError && dislikeRows ? dislikeRows : [];

  if (safeLikeRows.length === 0 && safeDislikeRows.length === 0) {
    return createEmptyHomeNewsLikeWorkspace();
  }

  const briefingIds = Array.from(new Set([...safeLikeRows, ...safeDislikeRows].map((row) => row.briefing_id)));
  const { data: briefingRows, error: briefingError } = await supabase
    .from("home_news_briefings")
    .select("id, category, tags, event_stage, priority")
    .in("id", briefingIds)
    .returns<BriefingPreferenceRow[]>();

  if (briefingError || !briefingRows) {
    return {
      likedBriefingIds: Array.from(new Set(safeLikeRows.map((row) => row.briefing_id))),
      dislikedBriefingIds: Array.from(new Set(safeDislikeRows.map((row) => row.briefing_id))),
      preferences: [],
    };
  }

  return {
    likedBriefingIds: Array.from(new Set(safeLikeRows.map((row) => row.briefing_id))),
    dislikedBriefingIds: Array.from(new Set(safeDislikeRows.map((row) => row.briefing_id))),
    preferences: [
      ...buildPreferenceRecords(safeLikeRows, briefingRows, "like"),
      ...buildPreferenceRecords(safeDislikeRows, briefingRows, "dislike"),
    ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
  };
}
