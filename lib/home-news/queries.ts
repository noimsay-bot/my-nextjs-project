import { HomeNewsDataset } from "@/components/home/home-news.types";
import { emptyHomeNewsDataset, getHomeNewsFallbackDataset } from "@/lib/home-news/fallback";
import { fetchCurrentHomeIssueSet } from "@/lib/home-news/issue-set-home-queries";
import { buildHomeNewsIssueSetDataset } from "@/lib/home-news/issue-set-home-transform";
import { buildHomeNewsDataset, HomeNewsBriefingRecord } from "@/lib/home-news/transform";
import { hasSupabaseEnv } from "@/lib/supabase/client";
import {
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

const HOME_NEWS_TABLE = "home_news_briefings";
const HOME_NEWS_SELECT = `
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

export type HomeNewsLoadResult = {
  data: HomeNewsDataset;
  source: "issue_set" | "supabase" | "fallback" | "empty";
  errorMessage?: string;
};

export async function fetchHomeNewsDataset(now = new Date()): Promise<HomeNewsLoadResult> {
  if (!hasSupabaseEnv()) {
    return {
      data: getHomeNewsFallbackDataset("missing_env"),
      source: "fallback",
      errorMessage: "Supabase 환경변수가 없어 목데이터로 홈 뉴스 브리핑을 표시합니다.",
    };
  }

  try {
    try {
      const officialIssueSet = await fetchCurrentHomeIssueSet(now);
      if (officialIssueSet) {
        const dataset = buildHomeNewsIssueSetDataset(
          officialIssueSet.records,
          officialIssueSet.issueSet,
          now,
        );
        if (dataset.tickerItems.length > 0) {
          return {
            data: dataset,
            source: "issue_set",
          };
        }
      }
    } catch {
      // Official issue set lookup is optional. If it fails, keep the existing active-news fallback path.
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from(HOME_NEWS_TABLE)
      .select(HOME_NEWS_SELECT)
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(24);

    if (error) {
      throw error;
    }

    const dataset = buildHomeNewsDataset((data ?? []) as HomeNewsBriefingRecord[], now);
    if (dataset.tickerItems.length === 0) {
      return {
        data: emptyHomeNewsDataset,
        source: "empty",
      };
    }

    return {
      data: dataset,
      source: "supabase",
    };
  } catch (error) {
    return {
      data: getHomeNewsFallbackDataset(isSupabaseSchemaMissingError(error) ? "schema_missing" : "query_error"),
      source: "fallback",
      errorMessage: getSupabaseStorageErrorMessage(error, "뉴스 브리핑"),
    };
  }
}
