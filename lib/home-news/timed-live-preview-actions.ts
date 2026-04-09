"use server";

import { HomeNewsDataset } from "@/components/home/home-news.types";
import {
  createDefaultNewsAIDraftRequest,
  NewsAIDraftRequestInput,
  NewsAIDraftResult,
} from "@/lib/home-news/ai-draft-types";
import { buildExternalNewsWorkspace } from "@/lib/home-news/briefing-batch";
import { getCurrentHomeIssueSetSlot, getCurrentHomeIssueSetSlotPriority } from "@/lib/home-news/current-issue-set";
import {
  scoreExternalNewsCandidates,
  shouldKeepForHomeLivePreview,
  shouldPrioritizeForHomeLivePreview,
} from "@/lib/home-news/external-candidate-scoring";
import { fetchExternalNewsRawItems } from "@/lib/home-news/external-source-fetchers";
import { ExternalNewsCandidate } from "@/lib/home-news/external-source-types";
import { toExternalNewsCandidate } from "@/lib/home-news/external-source-transform";
import {
  buildNewsDraftPrompt,
  buildNewsDraftRetryPrompt,
  DraftValidationContext,
  extractResponseText,
  NEWS_DRAFT_SCHEMA,
  normalizeDraftPayload,
  validateDraftFiveWsAndOneH,
} from "@/lib/home-news/newsroom-draft";
import { NEWS_BRIEFING_EVENT_STAGE_LABELS } from "@/lib/home-news/admin-types";
import { buildHomeNewsDataset, HomeNewsBriefingRecord } from "@/lib/home-news/transform";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_NEWS_DRAFT_MODEL = process.env.OPENAI_NEWS_DRAFT_MODEL ?? "gpt-4o-mini";

export type TimedLivePreviewResult = {
  ok: boolean;
  message: string;
  data?: HomeNewsDataset;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requestNewsDraft(prompt: string) {
  return fetch(OPENAI_RESPONSES_URL, {
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
            "당신은 보도국용 포털 메인 브리핑 초안을 작성하는 편집 보조 시스템입니다. 일반 독자용 요약이 아니라 편집회의용 메모를 쓴다는 관점으로, 사실 중심, 단정한 문체, 추측 금지, 선정성 금지 원칙을 지킵니다.",
        },
        {
          role: "user",
          content: prompt,
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

  const basePrompt = buildNewsDraftPrompt(request);
  const response = await requestNewsDraft(basePrompt);

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

  let draft = normalizeDraftPayload(JSON.parse(outputText) as unknown);
  if (!draft) {
    throw new Error("AI 초안 형식이 예상과 달라 적용할 수 없습니다.");
  }

  const validationContext: DraftValidationContext = {
    referenceText: request.referenceText,
    eventTime: request.eventTime,
    relatedKeywords: request.relatedKeywords,
  };
  const validationError = validateDraftFiveWsAndOneH(draft, validationContext);

  if (validationError) {
    const retryResponse = await requestNewsDraft(buildNewsDraftRetryPrompt(basePrompt, validationError));
    const retryPayload = (await retryResponse.json()) as unknown;
    if (!retryResponse.ok) {
      const retryErrorMessage =
        retryPayload && typeof retryPayload === "object" && retryPayload !== null && "error" in retryPayload
          ? normalizeString((retryPayload as { error?: { message?: string } }).error?.message)
          : "";
      throw new Error(retryErrorMessage || "OpenAI 재생성 응답을 처리하지 못했습니다.");
    }

    const retryOutputText = extractResponseText(retryPayload);
    if (!retryOutputText) {
      throw new Error("AI 재생성 응답 본문을 읽지 못했습니다.");
    }

    draft = normalizeDraftPayload(JSON.parse(retryOutputText) as unknown);
    if (!draft) {
      throw new Error("AI 재생성 초안 형식이 예상과 달라 적용할 수 없습니다.");
    }

    const retryValidationError = validateDraftFiveWsAndOneH(draft, validationContext);
    if (retryValidationError) {
      throw new Error(`AI 요약이 아직 구체성이 부족합니다: ${retryValidationError}`);
    }
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

function cleanFallbackLine(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHeadlineSource(title: string) {
  return cleanFallbackLine(title).replace(/\s*[-|]\s*[^-|]+$/, "").trim();
}

function toComparableHeadline(value: string) {
  return stripHeadlineSource(value)
    .replace(/[“”"'`·,.:!?()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getFallbackStatusLine(candidate: ExternalNewsCandidate) {
  if (candidate.eventStage) {
    const stageLabel = NEWS_BRIEFING_EVENT_STAGE_LABELS[candidate.eventStage];
    return `${stageLabel} 단계로 넘어갔는지와 법원·수사기관의 다음 절차 발표 여부가 핵심입니다.`;
  }
  if (candidate.category === "economy") {
    return "증시, 환율, 정책 발표 이후 실제 시장 반응과 정부 추가 메시지가 핵심입니다.";
  }
  if (candidate.category === "world") {
    return "관련국의 추가 군사행동, 정상 발언, 외교 일정 변화 여부를 바로 확인해야 합니다.";
  }
  if (candidate.category === "politics") {
    return "대통령실, 국회, 여야 지도부의 후속 입장과 실제 절차 변화가 핵심입니다.";
  }
  return "추가 인명피해, 수사 단계 변화, 당국 발표가 이어지는지 확인이 필요합니다.";
}

function getFallbackContextLine(candidate: ExternalNewsCandidate) {
  if (candidate.eventStage) {
    const stageLabel = NEWS_BRIEFING_EVENT_STAGE_LABELS[candidate.eventStage];
    return `${stageLabel} 관련 기사로, 당사자와 수사기관·법원 대응이 어디까지 진행됐는지가 쟁점입니다.`;
  }
  if (candidate.category === "society") {
    return "인명피해 규모와 사고 원인, 현장 관리 책임 규명으로 이어질지 확인이 필요합니다.";
  }
  if (candidate.category === "politics") {
    return "정국 흐름에 미칠 영향보다 실제 발언 주체와 후속 절차가 어디까지 이어지는지가 더 중요합니다.";
  }
  if (candidate.category === "economy") {
    return "시장 지표와 정부·기업 대응이 실제로 움직였는지 확인할 가치가 있는 경제 이슈입니다.";
  }
  return "한국 외교·안보·시장에 어떤 직접 영향이 있는지 확인할 가치가 있는 국제 이슈입니다.";
}

function splitExcerptToSentences(excerpt: string) {
  return cleanFallbackLine(excerpt)
    .trim()
    .split(/(?<=[.!?。])\s+|(?<=다\.)\s+| · /)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildFallbackSummaryLines(candidate: ExternalNewsCandidate) {
  const strippedTitle = stripHeadlineSource(candidate.title);
  const titleComparable = toComparableHeadline(strippedTitle);
  const sentences = splitExcerptToSentences(candidate.excerpt);
  const secondLine =
    sentences.find((line) => {
      const comparable = toComparableHeadline(line);
      if (!comparable) return false;
      if (comparable === titleComparable) return false;
      if (comparable.startsWith(titleComparable) || titleComparable.startsWith(comparable)) return false;
      if (comparable.length < 18) return false;
      if (/메인급|1면급|속보급|판단/.test(line)) return false;
      return true;
    }) ||
    getFallbackContextLine(candidate);

  return [
    strippedTitle,
    secondLine || getFallbackContextLine(candidate),
    getFallbackStatusLine(candidate),
  ].map((line) => cleanFallbackLine(line));
}

function buildFallbackWhyItMatters(candidate: ExternalNewsCandidate) {
  if (candidate.category === "politics") {
    return "대통령실, 국회, 여야 지도부, 고위공직자 절차와 연결될 경우 오늘 정국 흐름과 편집 판단에 직접 영향을 줄 수 있습니다.";
  }
  if (candidate.category === "society") {
    return "인명피해나 수사 절차가 걸린 사안이면 후속 수사와 책임 규명, 추가 피해 가능성을 함께 봐야 합니다.";
  }
  if (candidate.category === "economy") {
    return "시장 지표와 정부 정책, 생활물가, 대기업 실적에 연쇄 영향을 줄 수 있는 경제 이슈일 가능성이 큽니다.";
  }
  return "전쟁, 외교, 공급망, 유가, 안보 변수와 연결되면 국내 경제와 외교 판단에도 직접 영향을 줄 수 있습니다.";
}

function buildFallbackCheckPoints(candidate: ExternalNewsCandidate) {
  if (candidate.eventStage) {
    return [
      "수사기관 또는 법원의 다음 절차 발표 여부",
      "피의자·당사자 출석, 영장, 기소, 선고 단계 변화",
    ];
  }

  if (candidate.category === "economy") {
    return [
      "코스피·환율·금리 등 실제 시장 반응",
      "정부 또는 기업의 추가 공식 입장",
    ];
  }

  if (candidate.category === "world") {
    return [
      "관련국 정상·정부의 추가 공식 발언",
      "군사행동, 제재, 외교 일정의 추가 변화",
    ];
  }

  if (candidate.category === "politics") {
    return [
      "대통령실·여야 지도부의 추가 입장",
      "국회 처리 일정과 실제 절차 변화",
    ];
  }

  return [
    "추가 인명피해 또는 현장 통제 상황 변화",
    "경찰·소방·지자체의 공식 브리핑 여부",
  ];
}

function buildFallbackDraft(candidate: ExternalNewsCandidate): NewsAIDraftResult {
  const summaryLines = buildFallbackSummaryLines(candidate);

  return {
    title: stripHeadlineSource(candidate.title),
    summaryLines,
    whyItMatters: buildFallbackWhyItMatters(candidate),
    checkPoints: buildFallbackCheckPoints(candidate),
    tags: candidate.tags.slice(0, 8),
    priority: candidate.priority,
    briefingText: summaryLines[0],
  };
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

export async function generateTimedLivePreview(): Promise<TimedLivePreviewResult> {
  const now = new Date();
  const slot = getCurrentHomeIssueSetSlot(now);
  const slotPriority = getCurrentHomeIssueSetSlotPriority(now);
  const canUseOpenAI = Boolean(process.env.OPENAI_API_KEY);

  try {
    const rawItems = await fetchExternalNewsRawItems();
    const scored = scoreExternalNewsCandidates(rawItems.map(toExternalNewsCandidate), {
      existingItems: [],
      now,
    });
    const strictCandidates = scored.candidates.filter(shouldPrioritizeForHomeLivePreview);
    const relaxedCandidates = scored.candidates.filter(shouldKeepForHomeLivePreview);
    const candidateSource = strictCandidates.length > 0 ? strictCandidates : relaxedCandidates;

    if (candidateSource.length === 0) {
      return {
        ok: false,
        message: "현재 기준으로 포털 메인급·신문 1면급·속보급 후보가 없어 브리핑을 비워 둡니다.",
      };
    }

    const workspace = buildExternalNewsWorkspace(now, candidateSource, scored.trendHints);
    const selectedSlot =
      slotPriority.find((candidateSlot) => workspace.batches[candidateSlot].items.length > 0) ?? slot;
    const slotCandidates = workspace.batches[selectedSlot].items;
    const selectedPool = slotCandidates.length > 0 ? slotCandidates : candidateSource;
    const strictPool = selectedPool.filter(shouldPrioritizeForHomeLivePreview);
    const selectedCandidates = uniqueCandidates(strictPool.length > 0 ? strictPool : selectedPool).slice(0, 3);

    if (selectedCandidates.length === 0) {
      return {
        ok: false,
        message: "현재 시각 기준으로 메인급 뉴스 후보를 찾지 못했습니다.",
      };
    }

    const draftedResults = await Promise.all(
      selectedCandidates.map(async (candidate) => {
        if (!canUseOpenAI) {
          return {
            candidate,
            draft: buildFallbackDraft(candidate),
            error: null,
          };
        }

        try {
          return {
            candidate,
            draft: await generateDraftForCandidate(candidate, selectedSlot),
            error: null,
          };
        } catch (error) {
          return {
            candidate,
            draft: buildFallbackDraft(candidate),
            error: error instanceof Error ? error.message : "AI 초안 생성에 실패했습니다. 외부 기사 요약으로 대체합니다.",
          };
        }
      }),
    );

    const draftedRecords = draftedResults
      .map(({ candidate, draft }) => ({ candidate, draft }))
      .filter((result): result is { candidate: ExternalNewsCandidate; draft: NewsAIDraftResult } => Boolean(result.draft));
    const orderMap = new Map(selectedCandidates.map((candidate, index) => [candidate.id, index]));
    const orderedRecords = draftedRecords
      .sort((left, right) => (orderMap.get(left.candidate.id) ?? 0) - (orderMap.get(right.candidate.id) ?? 0))
      .map(({ candidate, draft }) => toRecord(candidate, draft, selectedSlot, now));

    console.info(
      "[home-news] timed live preview selection",
      JSON.stringify(
        {
          slot,
          selectedSlot,
          rawCount: rawItems.length,
          scoredCount: scored.candidates.length,
          strictCount: strictCandidates.length,
          relaxedCount: relaxedCandidates.length,
          slotCount: slotCandidates.length,
          selectedPoolCount: selectedPool.length,
          selected: selectedCandidates.map((candidate) => ({
            title: candidate.title,
            category: candidate.category,
            eventStage: candidate.eventStage,
            priority: candidate.priority,
            occurredAt: candidate.occurredAt,
            score: candidate.score,
            scoreBreakdown: candidate.scoreBreakdown,
            selectionReason: candidate.selectionReason,
            recommendationReason: candidate.recommendationReason,
          })),
          draftFailures: draftedResults
            .filter((result) => result.error)
            .map((result) => ({
              title: result.candidate.title,
              error: result.error,
            })),
        },
        null,
        2,
      ),
    );

    return {
      ok: true,
      message: canUseOpenAI
        ? "현재 시각 기준 뉴스 브리핑을 생성했습니다."
        : "OPENAI_API_KEY 없이 외부 기사 기반 최신 뉴스 브리핑을 생성했습니다.",
      data: buildHomeNewsDataset(orderedRecords, now, {
        respectInputOrder: true,
        filterInactive: false,
        sourceKind: "timed_live_preview",
        runtimeBriefing: {
          briefingSlot: selectedSlot,
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
