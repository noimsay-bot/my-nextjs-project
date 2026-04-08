"use client";

import { ToggleHomeNewsLikeResult } from "@/lib/home-news/like-types";
import { getPortalSession, getPortalSupabaseClient } from "@/lib/supabase/portal";

export async function toggleHomeNewsBriefingLike(
  briefingId: string,
  nextLiked: boolean,
): Promise<ToggleHomeNewsLikeResult> {
  try {
    const session = await getPortalSession();
    if (!session?.approved) {
      return {
        ok: false,
        message: "좋아요를 저장하려면 로그인 상태를 확인해 주세요.",
      };
    }

    const supabase = await getPortalSupabaseClient();

    if (nextLiked) {
      const { error } = await supabase
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

      if (error) {
        throw error;
      }
    } else {
      const { error } = await supabase
        .from("home_news_briefing_likes")
        .delete()
        .eq("briefing_id", briefingId)
        .eq("profile_id", session.id);

      if (error) {
        throw error;
      }
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
      message: nextLiked ? "좋아요를 반영했습니다." : "좋아요를 취소했습니다.",
      liked: nextLiked,
      likesCount: briefingRow.likes_count,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "좋아요 처리에 실패했습니다.",
    };
  }
}
