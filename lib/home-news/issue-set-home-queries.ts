import { HomeNewsIssueSetMeta } from "@/components/home/home-news.types";
import { getCurrentHomeIssueSetDate, getCurrentHomeIssueSetSlotPriority } from "@/lib/home-news/current-issue-set";
import { HomeNewsBriefingRecord } from "@/lib/home-news/transform";
import { hasSupabaseEnv } from "@/lib/supabase/client";
import { getPortalSupabaseClient } from "@/lib/supabase/portal";

type HomeNewsIssueSetItemRow = {
  id: string;
  issue_set_id: string;
  briefing_id: string;
  display_order: number;
  briefing: HomeNewsBriefingRecord | null;
};

type HomeNewsIssueSetRow = {
  id: string;
  issue_date: string;
  briefing_slot: "morning_6" | "afternoon_3";
  title: string;
  status: "published" | "locked";
  published_at: string | null;
  items: HomeNewsIssueSetItemRow[];
};

const HOME_NEWS_ISSUE_SET_TABLE = "home_news_issue_sets";
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
  items:${HOME_NEWS_ISSUE_SET_ITEMS_TABLE} (
    id,
    issue_set_id,
    briefing_id,
    display_order,
    briefing:home_news_briefings (${HOME_NEWS_BRIEFING_SELECT})
  )
`;

export type CurrentHomeIssueSetResult = {
  issueSet: HomeNewsIssueSetMeta;
  records: HomeNewsBriefingRecord[];
};

function sortIssueSetItems(items: HomeNewsIssueSetItemRow[]) {
  return items
    .slice()
    .sort((left, right) => left.display_order - right.display_order)
    .filter((item): item is HomeNewsIssueSetItemRow & { briefing: HomeNewsBriefingRecord } => Boolean(item.briefing));
}

function toIssueSetMeta(row: HomeNewsIssueSetRow): HomeNewsIssueSetMeta {
  return {
    id: row.id,
    title: row.title,
    issueDate: row.issue_date,
    briefingSlot: row.briefing_slot,
    status: row.status,
    publishedAt: row.published_at ?? undefined,
  };
}

function isTemporaryRepairIssueSet(records: HomeNewsBriefingRecord[]) {
  return records.length > 0 && records.every((record) => record.source_label === "임시복구");
}

export async function fetchCurrentHomeIssueSet(now = new Date()): Promise<CurrentHomeIssueSetResult | null> {
  if (!hasSupabaseEnv()) {
    return null;
  }

  const supabase = await getPortalSupabaseClient();
  const issueDate = getCurrentHomeIssueSetDate(now);
  const slotPriority = getCurrentHomeIssueSetSlotPriority(now);
  const { data, error } = await supabase
    .from(HOME_NEWS_ISSUE_SET_TABLE)
    .select(HOME_NEWS_ISSUE_SET_SELECT)
    .eq("issue_date", issueDate)
    .in("status", ["published", "locked"])
    .returns<HomeNewsIssueSetRow[]>();

  if (error) {
    throw error;
  }

  const officialSets = data ?? [];
  const resolved = slotPriority
    .map((slot) => officialSets.find((item) => item.briefing_slot === slot))
    .find((item): item is HomeNewsIssueSetRow => Boolean(item));

  if (!resolved) {
    return null;
  }

  const records = sortIssueSetItems(resolved.items ?? []).map((item) => item.briefing);
  if (records.length === 0) {
    return null;
  }

  if (isTemporaryRepairIssueSet(records)) {
    return null;
  }

  return {
    issueSet: toIssueSetMeta(resolved),
    records,
  };
}
