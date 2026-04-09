"use client";

import { hasAdminAccess } from "@/lib/auth/storage";
import { HomeNewsCategory } from "@/components/home/home-news.types";
import {
  getKstDateKey,
  isValidNewsBriefingCategory,
  isValidNewsBriefingEventStage,
  isValidNewsBriefingPriority,
  isValidNewsBriefingSlot,
  NewsBriefingAdminRecord,
  NewsBriefingFormValues,
  splitMultilineField,
  splitTagField,
} from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";
import { getPortalSession, getPortalSupabaseClient, getSupabaseStorageErrorMessage } from "@/lib/supabase/portal";

const HOME_NEWS_TABLE = "home_news_briefings";
const SLOT_MAX_ACTIVE_ITEMS = 3;
const HOME_NEWS_RETURNING_SELECT =
  "id, category, title, summary_lines, why_it_matters, check_points, priority, published_at, occurred_at, briefing_slot, briefing_text, is_active, source_label, tags, event_stage, likes_count, dislikes_count, created_at, updated_at";

type NewsBriefingMutationResult = {
  ok: boolean;
  message: string;
  item?: NewsBriefingAdminRecord;
};

type SaveNewsBriefingInput = {
  id?: string;
  values: NewsBriefingFormValues;
};

function normalizeText(value: string) {
  return value.trim();
}

function buildBriefingText(summaryLines: string[], title: string) {
  return summaryLines[0] ?? title;
}

function toIsoDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

async function requireAdminSession() {
  const session = await getPortalSession();
  if (!session?.approved || !hasAdminAccess(session.role)) {
    throw new Error("뉴스 브리핑 관리자 권한이 없습니다.");
  }
  return session;
}

function validateFormValues(values: NewsBriefingFormValues) {
  if (!isValidNewsBriefingCategory(values.category)) {
    return "카테고리를 선택해 주세요.";
  }
  if (!normalizeText(values.title)) {
    return "제목을 입력해 주세요.";
  }

  const summaryLines = splitMultilineField(values.summary);
  if (summaryLines.length === 0) {
    return "요약을 한 줄 이상 입력해 주세요.";
  }

  if (!normalizeText(values.whyItMatters)) {
    return "왜 중요한지를 입력해 주세요.";
  }

  const checkPoints = splitMultilineField(values.checkPoints);
  if (checkPoints.length === 0) {
    return "체크 포인트를 한 줄 이상 입력해 주세요.";
  }

  if (!isValidNewsBriefingPriority(values.priority)) {
    return "우선순위를 선택해 주세요.";
  }

  if (!isValidNewsBriefingSlot(values.briefingSlot)) {
    return "브리핑 슬롯을 선택해 주세요.";
  }

  if (!values.publishedAt || !toIsoDateTime(values.publishedAt)) {
    return "발행 시각을 정확히 입력해 주세요.";
  }
  if (values.occurredAt && !toIsoDateTime(values.occurredAt)) {
    return "실제 발생 시각을 정확히 입력해 주세요.";
  }

  if (values.eventStage && !isValidNewsBriefingEventStage(values.eventStage)) {
    return "수사 진행 단계를 다시 선택해 주세요.";
  }

  return null;
}

async function ensureSlotCapacity(
  supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>,
  params: {
    currentId?: string;
    publishedAtIso: string;
    briefingSlot: HomeNewsBriefingSlot;
    isActive: boolean;
  },
) {
  if (!params.isActive) {
    return null;
  }

  const { data, error } = await supabase
    .from(HOME_NEWS_TABLE)
    .select("id, published_at, briefing_slot, is_active")
    .eq("briefing_slot", params.briefingSlot)
    .eq("is_active", true)
    .returns<Array<Pick<NewsBriefingAdminRecord, "id" | "published_at" | "briefing_slot" | "is_active">>>();

  if (error) {
    throw error;
  }

  const currentDateKey = getKstDateKey(params.publishedAtIso);
  const activeItemsForBatch = (data ?? []).filter((item) => {
    if (!item.id || item.id === params.currentId) return false;
    if (!item.published_at) return false;
    return getKstDateKey(item.published_at) === currentDateKey;
  });

  if (activeItemsForBatch.length >= SLOT_MAX_ACTIVE_ITEMS) {
    return `${params.briefingSlot === "morning_6" ? "오전 6시" : "오후 3시"} 슬롯에는 같은 날짜 기준 최대 3개까지만 활성화할 수 있습니다.`;
  }

  return null;
}

export async function saveNewsBriefing(input: SaveNewsBriefingInput): Promise<NewsBriefingMutationResult> {
  try {
    const session = await requireAdminSession();
    const validationMessage = validateFormValues(input.values);
    if (validationMessage) {
      return { ok: false, message: validationMessage };
    }

    const publishedAtIso = toIsoDateTime(input.values.publishedAt);
    if (!publishedAtIso) {
      return { ok: false, message: "발행 시각을 정확히 입력해 주세요." };
    }
    const occurredAtIso = input.values.occurredAt ? toIsoDateTime(input.values.occurredAt) : null;
    if (input.values.occurredAt && !occurredAtIso) {
      return { ok: false, message: "실제 발생 시각을 정확히 입력해 주세요." };
    }

    const supabase = await getPortalSupabaseClient();
    const summaryLines = splitMultilineField(input.values.summary);
    const checkPoints = splitMultilineField(input.values.checkPoints);
    const tags = splitTagField(input.values.tags);

    const slotLimitMessage = await ensureSlotCapacity(supabase, {
      currentId: input.id,
      publishedAtIso,
      briefingSlot: input.values.briefingSlot,
      isActive: input.values.isActive,
    });
    if (slotLimitMessage) {
      return { ok: false, message: slotLimitMessage };
    }

    const payload = {
      category: input.values.category as HomeNewsCategory,
      title: normalizeText(input.values.title),
      summary_lines: summaryLines,
      why_it_matters: normalizeText(input.values.whyItMatters),
      check_points: checkPoints,
      priority: input.values.priority,
      published_at: publishedAtIso,
      occurred_at: occurredAtIso,
      briefing_slot: input.values.briefingSlot,
      briefing_text: normalizeText(input.values.briefingText) || buildBriefingText(summaryLines, normalizeText(input.values.title)),
      is_active: input.values.isActive,
      source_label: normalizeText(input.values.sourceLabel),
      tags,
      event_stage: input.values.eventStage || null,
      updated_by: session.id,
    };

    const query = input.id
      ? supabase
          .from(HOME_NEWS_TABLE)
          .update(payload)
          .eq("id", input.id)
      : supabase.from(HOME_NEWS_TABLE).insert({
          ...payload,
          created_by: session.id,
        });

    const { data, error } = await query.select(HOME_NEWS_RETURNING_SELECT).single<NewsBriefingAdminRecord>();

    if (error || !data) {
      throw error ?? new Error("뉴스 브리핑 저장 결과를 확인하지 못했습니다.");
    }

    return {
      ok: true,
      message: input.id ? "뉴스 브리핑을 수정했습니다." : "뉴스 브리핑을 등록했습니다.",
      item: data,
    };
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "뉴스 브리핑"),
    };
  }
}

export async function toggleNewsBriefingActive(
  id: string,
  nextIsActive: boolean,
): Promise<NewsBriefingMutationResult> {
  try {
    const session = await requireAdminSession();
    const supabase = await getPortalSupabaseClient();

    const { data: existing, error: existingError } = await supabase
      .from(HOME_NEWS_TABLE)
      .select(HOME_NEWS_RETURNING_SELECT)
      .eq("id", id)
      .single<NewsBriefingAdminRecord>();

    if (existingError || !existing) {
      throw existingError ?? new Error("대상 뉴스 브리핑을 찾지 못했습니다.");
    }

    if (nextIsActive && existing.published_at && existing.briefing_slot) {
      const slotLimitMessage = await ensureSlotCapacity(supabase, {
        currentId: existing.id,
        publishedAtIso: existing.published_at,
        briefingSlot: existing.briefing_slot,
        isActive: true,
      });
      if (slotLimitMessage) {
        return { ok: false, message: slotLimitMessage };
      }
    }

    const { data, error } = await supabase
      .from(HOME_NEWS_TABLE)
      .update({
        is_active: nextIsActive,
        updated_by: session.id,
      })
      .eq("id", id)
      .select(HOME_NEWS_RETURNING_SELECT)
      .single<NewsBriefingAdminRecord>();

    if (error || !data) {
      throw error ?? new Error("뉴스 브리핑 상태를 저장하지 못했습니다.");
    }

    return {
      ok: true,
      message: nextIsActive ? "뉴스 브리핑을 다시 활성화했습니다." : "뉴스 브리핑을 비활성화했습니다.",
      item: data,
    };
  } catch (error) {
    return {
      ok: false,
      message: getSupabaseStorageErrorMessage(error, "뉴스 브리핑"),
    };
  }
}
