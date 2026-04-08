"use server";

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { NewsAIDraftRequestInput, NewsAIDraftResponse, NewsAIDraftResult } from "@/lib/home-news/ai-draft-types";

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

type ServerAdminSession = {
  id: string;
  role: string;
  approved: boolean;
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

async function requireServerAdminSession(): Promise<ServerAdminSession> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("로그인된 관리자 세션을 확인하지 못했습니다.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, approved")
    .eq("id", user.id)
    .single<{ id: string; role: string; approved: boolean }>();

  if (profileError || !profile || profile.role !== "admin" || !profile.approved) {
    throw new Error("AI 초안 생성 권한이 없습니다.");
  }

  return profile;
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

export async function generateNewsAIDraft(input: NewsAIDraftRequestInput): Promise<NewsAIDraftResponse> {
  try {
    await requireServerAdminSession();

    if (!process.env.OPENAI_API_KEY) {
      return {
        ok: false,
        message: "OPENAI_API_KEY 환경변수가 없어 AI 초안을 생성할 수 없습니다.",
      };
    }

    if (!normalizeString(input.referenceText)) {
      return {
        ok: false,
        message: "참고 원문 또는 기사 메모를 입력해 주세요.",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response: Response;

    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
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
              content: buildNewsDraftPrompt(input),
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
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const errorMessage =
        payload && typeof payload === "object" && payload !== null && "error" in payload
          ? normalizeString((payload as { error?: { message?: string } }).error?.message)
          : "";

      return {
        ok: false,
        message: errorMessage || "OpenAI 응답을 처리하지 못했습니다.",
      };
    }

    const outputText = extractResponseText(payload);
    if (!outputText) {
      return {
        ok: false,
        message: "AI 응답 본문을 읽지 못했습니다.",
      };
    }

    const parsed = JSON.parse(outputText) as unknown;
    const draft = normalizeDraftPayload(parsed);
    if (!draft) {
      return {
        ok: false,
        message: "AI 초안 형식이 예상과 달라 적용할 수 없습니다.",
      };
    }

    return {
      ok: true,
      message: "AI 초안을 생성했습니다. 검수 후 저장해 주세요.",
      draft,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "AI 초안 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
        : error instanceof Error
          ? error.message
          : "AI 초안 생성에 실패했습니다.";

    return {
      ok: false,
      message,
    };
  }
}
