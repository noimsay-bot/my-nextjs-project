"use client";

import { getKstDateKey } from "@/lib/home-news/admin-types";
import { getNewsIssueSetWorkspace } from "@/lib/home-news/issue-set-queries";
import {
  getDefaultNewsIssueSetTitle,
  NewsIssueSetMutationResult,
  NewsIssueSetRecord,
  NewsIssueSetStatus,
} from "@/lib/home-news/issue-set-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";
import { getPortalSession, getPortalSupabaseClient, getSupabaseStorageErrorMessage } from "@/lib/supabase/portal";

const HOME_NEWS_ISSUE_SETS_TABLE = "home_news_issue_sets";
const HOME_NEWS_ISSUE_SET_ITEMS_TABLE = "home_news_issue_set_items";
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
    briefing:home_news_briefings (
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
      created_at,
      updated_at
    )
  )
`;

type UpdateIssueSetItemsInput = {
  issueSetId: string;
  briefingIds: string[];
};

async function requireAdminSession() {
  const session = await getPortalSession();
  if (!session?.approved || session.role !== "admin") {
    throw new Error("발행 세트 관리자 권한이 없습니다.");
  }
  return session;
}

function sortIssueSetItems(issueSet: NewsIssueSetRecord): NewsIssueSetRecord {
  return {
    ...issueSet,
    items: (issueSet.items ?? []).slice().sort((left, right) => left.display_order - right.display_order),
  };
}

async function getIssueSetById(id: string) {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from(HOME_NEWS_ISSUE_SETS_TABLE)
    .select(HOME_NEWS_ISSUE_SET_SELECT)
    .eq("id", id)
    .single<NewsIssueSetRecord>();

  if (error || !data) {
    throw error ?? new Error("발행 세트를 찾지 못했습니다.");
  }

  return sortIssueSetItems(data);
}

async function buildWorkspaceResult(message: string, issueSet?: NewsIssueSetRecord): Promise<NewsIssueSetMutationResult> {
  const workspace = await getNewsIssueSetWorkspace();
  return {
    ok: true,
    message,
    issueSet,
    workspace,
  };
}

function isOfficialStatus(status: NewsIssueSetStatus) {
  return status === "published" || status === "locked";
}

export async function ensureTodayNewsIssueSet(slot: HomeNewsBriefingSlot): Promise<NewsIssueSetMutationResult> {
  try {
    const session = await requireAdminSession();
    const issueDate = getKstDateKey(new Date().toISOString());
    return createNewsIssueSetDraftInternal(session.id, issueDate, slot, false);
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "발행 세트"),
    };
  }
}

async function createNewsIssueSetDraftInternal(
  sessionId: string,
  issueDate: string,
  slot: HomeNewsBriefingSlot,
  forceCreate: boolean,
): Promise<NewsIssueSetMutationResult> {
  const supabase = await getPortalSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from(HOME_NEWS_ISSUE_SETS_TABLE)
    .select(HOME_NEWS_ISSUE_SET_SELECT)
    .eq("issue_date", issueDate)
    .eq("briefing_slot", slot)
    .order("created_at", { ascending: false })
    .returns<NewsIssueSetRecord[]>();

  if (existingError) {
    throw existingError;
  }

  const reusableSet = (existing ?? []).find((item) => item.status === "draft");
  if (!forceCreate && reusableSet) {
    return buildWorkspaceResult("오늘 초안 발행 세트를 불러왔습니다.", sortIssueSetItems(reusableSet));
  }

  if (!forceCreate && !reusableSet && existing && existing.length > 0) {
    return buildWorkspaceResult("오늘 발행 세트를 불러왔습니다.", sortIssueSetItems(existing[0]));
  }

  const { data, error } = await supabase
    .from(HOME_NEWS_ISSUE_SETS_TABLE)
    .insert({
      issue_date: issueDate,
      briefing_slot: slot,
      title: getDefaultNewsIssueSetTitle(issueDate, slot),
      status: "draft",
      created_by: sessionId,
      updated_by: sessionId,
    })
    .select(HOME_NEWS_ISSUE_SET_SELECT)
    .single<NewsIssueSetRecord>();

  if (error || !data) {
    throw error ?? new Error("오늘 발행 세트를 생성하지 못했습니다.");
  }

  return buildWorkspaceResult("오늘 발행 세트를 만들었습니다.", sortIssueSetItems(data));
}

export async function createNewsIssueSetDraft(slot: HomeNewsBriefingSlot): Promise<NewsIssueSetMutationResult> {
  try {
    const session = await requireAdminSession();
    const issueDate = getKstDateKey(new Date().toISOString());
    return createNewsIssueSetDraftInternal(session.id, issueDate, slot, true);
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "발행 세트"),
    };
  }
}

export async function saveNewsIssueSetItems(input: UpdateIssueSetItemsInput): Promise<NewsIssueSetMutationResult> {
  try {
    const session = await requireAdminSession();
    if (input.briefingIds.length > 3) {
      return {
        ok: false,
        message: "발행 세트에는 최대 3개까지만 담을 수 있습니다.",
      };
    }

    const uniqueBriefingIds = Array.from(new Set(input.briefingIds.filter(Boolean)));
    if (uniqueBriefingIds.length !== input.briefingIds.length) {
      return {
        ok: false,
        message: "같은 뉴스를 한 세트에 중복으로 넣을 수 없습니다.",
      };
    }

    const issueSet = await getIssueSetById(input.issueSetId);
    if (issueSet.status !== "draft") {
      return {
        ok: false,
        message: "초안 상태의 발행 세트만 구성할 수 있습니다.",
      };
    }

    const supabase = await getPortalSupabaseClient();
    const { error: deleteError } = await supabase
      .from(HOME_NEWS_ISSUE_SET_ITEMS_TABLE)
      .delete()
      .eq("issue_set_id", input.issueSetId);

    if (deleteError) {
      throw deleteError;
    }

    if (uniqueBriefingIds.length > 0) {
      const { error: insertError } = await supabase
        .from(HOME_NEWS_ISSUE_SET_ITEMS_TABLE)
        .insert(
          uniqueBriefingIds.map((briefingId, index) => ({
            issue_set_id: input.issueSetId,
            briefing_id: briefingId,
            display_order: index + 1,
          })),
        );

      if (insertError) {
        throw insertError;
      }
    }

    const { error: updateError } = await supabase
      .from(HOME_NEWS_ISSUE_SETS_TABLE)
      .update({
        updated_by: session.id,
      })
      .eq("id", input.issueSetId);

    if (updateError) {
      throw updateError;
    }

    return buildWorkspaceResult("발행 세트 구성을 저장했습니다.", await getIssueSetById(input.issueSetId));
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "발행 세트"),
    };
  }
}

export async function publishNewsIssueSet(issueSetId: string): Promise<NewsIssueSetMutationResult> {
  try {
    const session = await requireAdminSession();
    const issueSet = await getIssueSetById(issueSetId);
    if (issueSet.status === "locked") {
      return {
        ok: false,
        message: "잠금된 발행 세트는 다시 발행할 수 없습니다.",
      };
    }
    if (issueSet.status === "archived") {
      return {
        ok: false,
        message: "보관된 발행 세트는 다시 발행할 수 없습니다.",
      };
    }

    if (issueSet.items.length > 3) {
      return {
        ok: false,
        message: "발행 세트에는 최대 3개까지만 담을 수 있습니다.",
      };
    }

    const supabase = await getPortalSupabaseClient();
    const { error: archiveError } = await supabase
      .from(HOME_NEWS_ISSUE_SETS_TABLE)
      .update({
        status: "archived",
        updated_by: session.id,
      })
      .eq("issue_date", issueSet.issue_date)
      .eq("briefing_slot", issueSet.briefing_slot)
      .neq("id", issueSetId)
      .in("status", ["published", "locked"]);

    if (archiveError) {
      throw archiveError;
    }

    const { error: publishError } = await supabase
      .from(HOME_NEWS_ISSUE_SETS_TABLE)
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        updated_by: session.id,
      })
      .eq("id", issueSetId);

    if (publishError) {
      throw publishError;
    }

    return buildWorkspaceResult("발행 세트를 공식 발행 상태로 전환했습니다.", await getIssueSetById(issueSetId));
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "발행 세트"),
    };
  }
}

export async function lockNewsIssueSet(issueSetId: string): Promise<NewsIssueSetMutationResult> {
  try {
    const session = await requireAdminSession();
    const issueSet = await getIssueSetById(issueSetId);
    if (!isOfficialStatus(issueSet.status)) {
      return {
        ok: false,
        message: "발행된 세트만 잠글 수 있습니다.",
      };
    }

    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase
      .from(HOME_NEWS_ISSUE_SETS_TABLE)
      .update({
        status: "locked",
        updated_by: session.id,
      })
      .eq("id", issueSetId);

    if (error) {
      throw error;
    }

    return buildWorkspaceResult("발행 세트를 잠금 상태로 전환했습니다.", await getIssueSetById(issueSetId));
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "발행 세트"),
    };
  }
}
