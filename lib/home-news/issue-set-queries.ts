"use client";

import { hasAdminAccess } from "@/lib/auth/storage";
import { getKstDateKey } from "@/lib/home-news/admin-types";
import { NewsIssueSetRecord, NewsIssueSetWorkspace } from "@/lib/home-news/issue-set-types";
import { getPortalSession, getPortalSupabaseClient, getSupabaseStorageErrorMessage } from "@/lib/supabase/portal";

const HOME_NEWS_ISSUE_SETS_TABLE = "home_news_issue_sets";
const HOME_NEWS_ISSUE_SET_ITEMS_TABLE = "home_news_issue_set_items";
const HOME_NEWS_BRIEFING_SELECT = `
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

const HOME_NEWS_ISSUE_SET_SELECT = `
  id,
  issue_date,
  briefing_slot,
  title,
  status,
  published_at,
  created_at,
  updated_at,
  created_by,
  updated_by,
  items:${HOME_NEWS_ISSUE_SET_ITEMS_TABLE} (
    id,
    issue_set_id,
    briefing_id,
    display_order,
    created_at,
    updated_at,
    briefing:${"home_news_briefings"} (${HOME_NEWS_BRIEFING_SELECT})
  )
`;

function sortIssueSetItems(record: NewsIssueSetRecord): NewsIssueSetRecord {
  return {
    ...record,
    items: (record.items ?? []).slice().sort((left, right) => left.display_order - right.display_order),
  };
}

function getTodayKstDate() {
  return getKstDateKey(new Date().toISOString());
}

function pickCurrentIssueSet(records: NewsIssueSetRecord[], issueDate: string, slot: "morning_6" | "afternoon_3") {
  const candidates = records.filter((item) => item.issue_date === issueDate && item.briefing_slot === slot);
  return candidates.find((item) => item.status !== "archived") ?? candidates[0] ?? null;
}

export async function getNewsIssueSetWorkspace(): Promise<NewsIssueSetWorkspace> {
  const session = await getPortalSession();
  if (!session?.approved || !hasAdminAccess(session.role)) {
    throw new Error("발행 세트 관리자 권한이 없습니다.");
  }

  try {
    const todayKstDate = getTodayKstDate();
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from(HOME_NEWS_ISSUE_SETS_TABLE)
      .select(HOME_NEWS_ISSUE_SET_SELECT)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<NewsIssueSetRecord[]>();

    if (error) {
      throw error;
    }

    const issueSets = (data ?? []).map(sortIssueSetItems);
    const todayBySlot = {
      morning_6: pickCurrentIssueSet(issueSets, todayKstDate, "morning_6"),
      afternoon_3: pickCurrentIssueSet(issueSets, todayKstDate, "afternoon_3"),
    };

    return {
      todayKstDate,
      todayBySlot,
      history: issueSets.slice(0, 20),
    };
  } catch (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "발행 세트"));
  }
}
