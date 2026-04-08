import { NewsBriefingAdminRecord } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";

export const NEWS_ISSUE_SET_STATUSES = ["draft", "published", "locked", "archived"] as const;

export type NewsIssueSetStatus = (typeof NEWS_ISSUE_SET_STATUSES)[number];

export type NewsIssueSetItemRecord = {
  id: string;
  issue_set_id: string;
  briefing_id: string;
  display_order: number;
  created_at: string | null;
  updated_at: string | null;
  briefing: NewsBriefingAdminRecord | null;
};

export type NewsIssueSetRecord = {
  id: string;
  issue_date: string;
  briefing_slot: HomeNewsBriefingSlot;
  title: string;
  status: NewsIssueSetStatus;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  items: NewsIssueSetItemRecord[];
};

export type NewsIssueSetWorkspace = {
  todayKstDate: string;
  todayBySlot: Record<HomeNewsBriefingSlot, NewsIssueSetRecord | null>;
  history: NewsIssueSetRecord[];
};

export type NewsIssueSetMutationResult = {
  ok: boolean;
  message: string;
  issueSet?: NewsIssueSetRecord;
  workspace?: NewsIssueSetWorkspace;
};

export function getNewsIssueSetStatusLabel(status: NewsIssueSetStatus) {
  switch (status) {
    case "draft":
      return "초안";
    case "published":
      return "발행";
    case "locked":
      return "잠금";
    case "archived":
      return "보관";
    default:
      return status;
  }
}

export function getDefaultNewsIssueSetTitle(issueDate: string, slot: HomeNewsBriefingSlot) {
  return `${issueDate} ${slot === "morning_6" ? "오전 6시" : "오후 3시"} 브리핑`;
}
