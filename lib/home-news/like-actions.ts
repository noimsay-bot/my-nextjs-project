"use client";

import { ToggleHomeNewsPreferenceResult } from "@/lib/home-news/like-types";
import { getPortalSession, getPortalSupabaseClient } from "@/lib/supabase/portal";

export async function setHomeNewsBriefingPreference(
  briefingId: string,
  nextPreference: "like" | "dislike" | null,
): Promise<ToggleHomeNewsPreferenceResult> {
  try {
    const session = await getPortalSession();
    if (!session?.approved) {
      return {
        ok: false,
        message: "반응을 저장하려면 로그인 상태를 확인해 주세요.",
      };
    }

    const supabase = await getPortalSupabaseClient();

    if (nextPreference === "like") {
      const { error: likeError } = await supabase
        .from("home_news_briefing_likes")
        .upsert(
          {
            briefing_id: briefingId,
            profile_id: session.id,
          },
          {
            onConflict: "briefing_id,profile_id",
            ignoreDuplicates: false,
          },
        );

      if (likeError) throw likeError;

      const { error: dislikeDeleteError } = await supabase
        .from("home_news_briefing_dislikes")
        .delete()
        .eq("briefing_id", briefingId)
        .eq("profile_id", session.id);

      if (dislikeDeleteError) throw dislikeDeleteError;
    } else if (nextPreference === "dislike") {
      const { error: dislikeError } = await supabase
        .from("home_news_briefing_dislikes")
        .upsert(
          {
            briefing_id: briefingId,
            profile_id: session.id,
          },
          {
            onConflict: "briefing_id,profile_id",
            ignoreDuplicates: false,
          },
        );

      if (dislikeError) throw dislikeError;

      const { error: likeDeleteError } = await supabase
        .from("home_news_briefing_likes")
        .delete()
        .eq("briefing_id", briefingId)
        .eq("profile_id", session.id);

      if (likeDeleteError) throw likeDeleteError;
    } else {
      const { error: likeDeleteError } = await supabase
        .from("home_news_briefing_likes")
        .delete()
        .eq("briefing_id", briefingId)
        .eq("profile_id", session.id);

      if (likeDeleteError) throw likeDeleteError;

      const { error: dislikeDeleteError } = await supabase
        .from("home_news_briefing_dislikes")
        .delete()
        .eq("briefing_id", briefingId)
        .eq("profile_id", session.id);

      if (dislikeDeleteError) throw dislikeDeleteError;
    }

    const { data: briefingRow, error: briefingError } = await supabase
      .from("home_news_briefings")
      .select("likes_count")
      .eq("id", briefingId)
      .single<{ likes_count: number }>();

    if (briefingError) {
      throw briefingError;
    }

    return {
      ok: true,
      message:
        nextPreference === "like"
          ? "좋아요를 반영했습니다."
          : nextPreference === "dislike"
            ? "별로 의견을 반영했습니다."
            : "반응을 취소했습니다.",
      preference: nextPreference,
      likesCount: briefingRow.likes_count,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "반응 처리에 실패했습니다.",
    };
  }
}
