"use server";

import { HomeNewsCategory, HomeNewsDataset } from "@/components/home/home-news.types";
import {
  createDefaultNewsAIDraftRequest,
  NewsAIDraftRequestInput,
  NewsAIDraftResult,
} from "@/lib/home-news/ai-draft-types";
import { buildExternalNewsWorkspace } from "@/lib/home-news/briefing-batch";
import { getCurrentHomeIssueSetSlot } from "@/lib/home-news/current-issue-set";
import {
  scoreExternalNewsCandidates,
  shouldKeepForHomeCategoryFallback,
  shouldKeepForHomeLivePreview,
  shouldPrioritizeForHomeLivePreview,
} from "@/lib/home-news/external-candidate-scoring";
import { fetchExternalNewsRawItems } from "@/lib/home-news/external-source-fetchers";
import { ExternalNewsCandidate } from "@/lib/home-news/external-source-types";
import { toExternalNewsCandidate } from "@/lib/home-news/external-source-transform";
import { buildHomeNewsDataset, HomeNewsBriefingRecord } from "@/lib/home-news/transform";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_NEWS_DRAFT_MODEL = process.env.OPENAI_NEWS_DRAFT_MODEL ?? "gpt-4o-mini";

const NEWS_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary_lines",
    "why_it_matters",
    "check_points",
    "tags",
    "priority",
    "briefing_text",
  ],
  properties: {
    title: { type: "string" },
    summary_lines: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 4,
    },
    why_it_matters: { type: "string" },
    check_points: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
    },
    tags: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
    },
    priority: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    briefing_text: { type: "string" },
  },
} as const;

export type TimedLivePreviewResult = {
  ok: boolean;
  message: string;
  data?: HomeNewsDataset;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildNewsDraftPrompt(input: NewsAIDraftRequestInput) {
  const timeGuide = input.eventTime
    ? `실제 사건/절차 시각: ${input.eventTime}`
    : "실제 사건/절차 시각: 제공되지 않음";
  const importanceHints = input.importanceHints.length > 0
    ? `중요도 힌트:\n- ${input.importanceHints.join("\n- ")}`
    : "중요도 힌트: 제공되지 않음";
  const personalizationHints = input.personalizationHints.length > 0
    ? `관심도 힌트:\n- ${input.personalizationHints.join("\n- ")}`
    : "관심도 힌트: 제공되지 않음";

  return [
    "다음 입력을 바탕으로 방송국 내부 포털용 뉴스 브리핑 초안을 한국어로 작성해 주세요.",
    "지방 매체 단신이나 기관 홍보성 기사보다, 포털 메인·통신사 주요뉴스·신문 1면급으로 올라갈 만한 뉴스만 우선 선별한다는 취지를 반영합니다.",
    "과장, 추측, 선정적 표현을 피하고 사실 중심으로 정리합니다.",
    "실제 사건/절차 시각이 제공되면 summary와 briefing_text에 자연스럽게 반영합니다.",
    "실제 시각이 제공되지 않았다면 시간을 만들어내지 않습니다.",
    "입력에 없는 시각, 시간대, 속보성 표현은 쓰지 않습니다. 예: 늦은 시간, 이날 오전, 오늘 오후, 방금, 조금 전.",
    "published_at은 기사 게시 시각 참고값일 뿐이며, 실제 사건 시각처럼 단정해서 쓰지 않습니다.",
    "수사 진행 뉴스라면 사건 단계가 제목과 요약에서 분명히 드러나게 작성합니다.",
    "why_it_matters는 후속 일정, 파장, 추가 확인 필요성을 중심으로 정리합니다.",
    "check_points는 오늘 추가 확인할 포인트가 바로 보이게 작성합니다.",
    "관심도 힌트는 보조 참고일 뿐이며, 공공적 중요도와 사실 관계를 우선합니다.",
    "summary_lines는 2~4개, check_points는 1~4개, tags는 핵심 키워드만 작성합니다.",
    "briefing_text는 전광판용으로 짧고 강하게 핵심만 적습니다.",
    `카테고리: ${input.category}`,
    `브리핑 슬롯: ${input.briefingSlot}`,
    `사건 단계: ${input.eventStage || "미지정"}`,
    timeGuide,
    `우선순위 힌트: ${input.priorityHint || "미지정"}`,
    `추천 이유: ${input.recommendationReason || "미지정"}`,
    importanceHints,
    personalizationHints,
    `출처 라벨: ${input.sourceLabel || "미지정"}`,
    `관련 인물/기관 키워드: ${input.relatedKeywords || "미지정"}`,
    `참고 원문 또는 기사 메모:\n${input.referenceText}`,
  ].join("\n");
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const blockRecord = block as Record<string, unknown>;
      if (typeof blockRecord.text === "string" && blockRecord.text.trim()) {
        return blockRecord.text.trim();
      }
      if (
        typeof blockRecord.type === "string" &&
        blockRecord.type.includes("text") &&
        typeof blockRecord.value === "string" &&
        blockRecord.value.trim()
      ) {
        return blockRecord.value.trim();
      }
    }
  }

  return "";
}

function normalizeDraftPayload(raw: unknown): NewsAIDraftResult | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = normalizeString(record.title);
  const summaryLines = normalizeArray(record.summary_lines, 4);
  const whyItMatters = normalizeString(record.why_it_matters);
  const checkPoints = normalizeArray(record.check_points, 4);
  const tags = normalizeArray(record.tags, 8);
  const priority = normalizeString(record.priority);
  const briefingText = normalizeString(record.briefing_text);

  if (!title || summaryLines.length === 0 || !whyItMatters || checkPoints.length === 0 || !briefingText) {
    return null;
  }

  return {
    title,
    summaryLines,
    whyItMatters,
    checkPoints,
    tags,
    priority: priority === "high" || priority === "medium" || priority === "low" ? priority : "medium",
    briefingText,
  };
}

async function generateDraftForCandidate(candidate: ExternalNewsCandidate, slot: "morning_6" | "afternoon_3") {
  const request: NewsAIDraftRequestInput = {
    ...createDefaultNewsAIDraftRequest(),
    category: candidate.category,
    briefingSlot: slot,
    referenceText: candidate.referenceText,
    relatedKeywords: candidate.tags.join(", "),
    eventStage: candidate.eventStage ?? "",
    eventTime: candidate.occurredAt ? candidate.occurredAt.slice(0, 16) : "",
    sourceLabel: candidate.source,
    priorityHint: candidate.priority,
    recommendationReason: candidate.recommendationReason,
    importanceHints: candidate.importanceHints,
    personalizationHints: candidate.personalizationHints,
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_NEWS_DRAFT_MODEL,
      input: [
        {
          role: "system",
          content:
            "당신은 방송국 내부 포털용 뉴스 브리핑 초안을 작성하는 편집 보조 시스템입니다. 사실 중심, 단정한 문체, 추측 금지, 선정성 금지 원칙을 지킵니다.",
        },
        {
          role: "user",
          content: buildNewsDraftPrompt(request),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "news_briefing_draft",
          strict: true,
          schema: NEWS_DRAFT_SCHEMA,
        },
      },
    }),
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && payload !== null && "error" in payload
        ? normalizeString((payload as { error?: { message?: string } }).error?.message)
        : "";
    throw new Error(errorMessage || "OpenAI 응답을 처리하지 못했습니다.");
  }

  const outputText = extractResponseText(payload);
  if (!outputText) {
    throw new Error("AI 응답 본문을 읽지 못했습니다.");
  }

  const draft = normalizeDraftPayload(JSON.parse(outputText) as unknown);
  if (!draft) {
    throw new Error("AI 초안 형식이 예상과 달라 적용할 수 없습니다.");
  }

  return draft;
}

function uniqueCandidates(candidates: ExternalNewsCandidate[]) {
  const seen = new Set<string>();
  const seenHeadlineKeys = new Set<string>();

  function toHeadlineKey(title: string) {
    const normalized = title
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/[-|]\s*[^-|]+$/g, " ")
      .replace(/[“”"'`·,.:!?()\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    const tokens = normalized
      .split(" ")
      .filter((token) => token.length >= 2)
      .filter((token) => !["검찰", "경찰", "법원", "정부", "국회", "관련", "속보"].includes(token))
      .slice(0, 6);

    return tokens.join(" ");
  }

  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    const headlineKey = toHeadlineKey(candidate.title);
    if (headlineKey && seenHeadlineKeys.has(headlineKey)) {
      return false;
    }
    seen.add(candidate.id);
    if (headlineKey) {
      seenHeadlineKeys.add(headlineKey);
    }
    return true;
  });
}

function toRecord(
  candidate: ExternalNewsCandidate,
  draft: NewsAIDraftResult,
  slot: "morning_6" | "afternoon_3",
  now: Date,
): HomeNewsBriefingRecord {
  return {
    id: `live-preview-${candidate.id}`,
    category: candidate.category,
    title: draft.title,
    summary_lines: draft.summaryLines,
    why_it_matters: draft.whyItMatters,
    check_points: draft.checkPoints,
    priority: draft.priority,
    published_at: now.toISOString(),
    occurred_at: candidate.occurredAt,
    briefing_slot: slot,
    briefing_text: draft.briefingText,
    is_active: true,
    source_label: candidate.source,
    tags: draft.tags,
    event_stage: candidate.eventStage,
    likes_count: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function pickCategoryCandidates(
  scoredCandidates: ExternalNewsCandidate[],
  slotCandidates: ExternalNewsCandidate[],
  fallbackCandidates: ExternalNewsCandidate[],
) {
  const categories: HomeNewsCategory[] = ["politics", "society", "economy", "world"];

  return categories
    .map((category) =>
      slotCandidates.find((item) => item.category === category) ??
      scoredCandidates.find((item) => item.category === category) ??
      fallbackCandidates.find((item) => item.category === category) ??
      null,
    )
    .filter((item): item is ExternalNewsCandidate => Boolean(item));
}

export async function generateTimedLivePreview(): Promise<TimedLivePreviewResult> {
  if (process.env.NODE_ENV !== "development") {
    return {
      ok: false,
      message: "개발 환경에서만 사용할 수 있습니다.",
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      message: "OPENAI_API_KEY 환경변수가 없어 현재 시각 기준 뉴스 요약을 생성할 수 없습니다.",
    };
  }

  const now = new Date();
  const slot = getCurrentHomeIssueSetSlot(now);

  try {
    const rawItems = await fetchExternalNewsRawItems();
    const scored = scoreExternalNewsCandidates(rawItems.map(toExternalNewsCandidate), {
      existingItems: [],
      now,
    });
    const strictCandidates = scored.candidates.filter(shouldPrioritizeForHomeLivePreview);
    const relaxedCandidates = scored.candidates.filter(shouldKeepForHomeLivePreview);
    const categoryFallbackCandidates = scored.candidates.filter(shouldKeepForHomeCategoryFallback);
    const sourceCandidates =
      strictCandidates.length > 0
        ? strictCandidates
        : relaxedCandidates.length > 0
          ? relaxedCandidates
          : [];
    if (sourceCandidates.length === 0) {
      return {
        ok: false,
        message: "포털 메인급으로 판단된 뉴스 후보가 없어 현재 브리핑을 비워 둡니다.",
      };
    }
    const workspace = buildExternalNewsWorkspace(now, sourceCandidates, scored.trendHints);
    const categoryWorkspace = buildExternalNewsWorkspace(
      now,
      categoryFallbackCandidates.length > 0 ? categoryFallbackCandidates : sourceCandidates,
      scored.trendHints,
    );
    const slotCandidates = workspace.batches[slot].items;
    const categorySlotCandidates = categoryWorkspace.batches[slot].items;
    if (slotCandidates.length === 0) {
      return {
        ok: false,
        message: "현재 슬롯에 사용할 외부 뉴스 후보가 없습니다.",
      };
    }

    const strictSlotCandidates = slotCandidates.filter(shouldPrioritizeForHomeLivePreview);
    const topThree = (strictSlotCandidates.length > 0 ? strictSlotCandidates : slotCandidates).slice(0, 3);
    const categoryCandidates = pickCategoryCandidates(
      categoryFallbackCandidates.length > 0 ? categoryFallbackCandidates : strictCandidates.length > 0 ? strictCandidates : sourceCandidates,
      categorySlotCandidates,
      categoryFallbackCandidates,
    );
    const selectedCandidates = uniqueCandidates([...topThree, ...categoryCandidates]);
    if (selectedCandidates.length === 0) {
      return {
        ok: false,
        message: "현재 시각 기준으로 메인급 뉴스 후보를 찾지 못했습니다.",
      };
    }

    const draftedRecords = await Promise.all(
      selectedCandidates.map(async (candidate) => ({
        candidate,
        draft: await generateDraftForCandidate(candidate, slot),
      })),
    );

    const orderMap = new Map(selectedCandidates.map((candidate, index) => [candidate.id, index]));
    const orderedRecords = draftedRecords
      .sort((left, right) => (orderMap.get(left.candidate.id) ?? 0) - (orderMap.get(right.candidate.id) ?? 0))
      .map(({ candidate, draft }) => toRecord(candidate, draft, slot, now));

    console.info(
      "[home-news] timed live preview selection",
      JSON.stringify(
        {
          slot,
          rawCount: rawItems.length,
          scoredCount: scored.candidates.length,
          strictCount: strictCandidates.length,
          relaxedCount: relaxedCandidates.length,
          categoryFallbackCount: categoryFallbackCandidates.length,
          slotCount: slotCandidates.length,
          selected: selectedCandidates.map((candidate) => ({
            title: candidate.title,
            category: candidate.category,
            eventStage: candidate.eventStage,
            priority: candidate.priority,
            occurredAt: candidate.occurredAt,
            score: candidate.score,
            scoreBreakdown: candidate.scoreBreakdown,
            selectionReason: candidate.selectionReason,
          })),
        },
        null,
        2,
      ),
    );

    return {
      ok: true,
      message: "현재 시각 기준 뉴스 요약을 생성했습니다.",
      data: buildHomeNewsDataset(orderedRecords, now, {
        respectInputOrder: true,
        filterInactive: false,
        sourceKind: "timed_live_preview",
        runtimeBriefing: {
          briefingSlot: slot,
          generatedAt: now.toISOString(),
        },
      }),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "현재 시각 기준 뉴스 요약 생성에 실패했습니다.",
    };
  }
}
