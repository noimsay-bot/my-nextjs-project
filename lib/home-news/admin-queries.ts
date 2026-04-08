"use client";

import { NewsBriefingAdminRecord } from "@/lib/home-news/admin-types";
import { getPortalSession, getPortalSupabaseClient, getSupabaseStorageErrorMessage } from "@/lib/supabase/portal";

const HOME_NEWS_TABLE = "home_news_briefings";
const HOME_NEWS_ADMIN_SELECT = `
  id,
  category,
  title,
  summary_lines,
  why_it_matters,
  check_points,
  priority,
  published_at,
  occurred_at,
  briefing_slot,
  briefing_text,
  is_active,
  source_label,
  tags,
  event_stage,
  likes_count,
  dislikes_count,
  created_at,
  updated_at
`;

export type NewsBriefingAdminWorkspace = {
  items: NewsBriefingAdminRecord[];
};

export async function getNewsBriefingAdminWorkspace(): Promise<NewsBriefingAdminWorkspace> {
  const session = await getPortalSession();
  if (!session?.approved || session.role !== "admin") {
    throw new Error("뉴스 브리핑 관리자 권한이 없습니다.");
  }

  try {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from(HOME_NEWS_TABLE)
      .select(HOME_NEWS_ADMIN_SELECT)
      .order("published_at", { ascending: false })
      .order("updated_at", { ascending: false })
      .returns<NewsBriefingAdminRecord[]>();

    if (error) {
      throw error;
    }

    return {
      items: data ?? [],
    };
  } catch (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "뉴스 브리핑"));
  }
}
