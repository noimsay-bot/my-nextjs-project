"use server";

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { NewsAIDraftRequestInput, NewsAIDraftResponse, NewsAIDraftResult } from "@/lib/home-news/ai-draft-types";
import {
  buildNewsDraftPrompt,
  buildNewsDraftRetryPrompt,
  DraftValidationContext,
  extractResponseText,
  NEWS_DRAFT_SCHEMA,
  normalizeDraftPayload,
  validateDraftFiveWsAndOneH,
} from "@/lib/home-news/newsroom-draft";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_NEWS_DRAFT_MODEL = process.env.OPENAI_NEWS_DRAFT_MODEL ?? "gpt-4o-mini";

type ServerAdminSession = {
  id: string;
  role: string;
  approved: boolean;
};

function hasAdminLikeRole(role: string | null | undefined) {
  return role === "admin" || role === "team_lead";
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

  if (profileError || !profile || !hasAdminLikeRole(profile.role) || !profile.approved) {
    throw new Error("AI 초안 생성 권한이 없습니다.");
  }

  return profile;
}

async function requestNewsDraft(prompt: string, signal: AbortSignal) {
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
    signal,
  });
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
    const basePrompt = buildNewsDraftPrompt(input);

    try {
      response = await requestNewsDraft(basePrompt, controller.signal);
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
    let draft = normalizeDraftPayload(parsed);
    if (!draft) {
      return {
        ok: false,
        message: "AI 초안 형식이 예상과 달라 적용할 수 없습니다.",
      };
    }

    const validationContext: DraftValidationContext = {
      referenceText: input.referenceText,
      eventTime: input.eventTime,
      relatedKeywords: input.relatedKeywords,
    };
    const validationError = validateDraftFiveWsAndOneH(draft, validationContext);

    if (validationError) {
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
      let retryResponse: Response;

      try {
        retryResponse = await requestNewsDraft(buildNewsDraftRetryPrompt(basePrompt, validationError), retryController.signal);
      } finally {
        clearTimeout(retryTimeoutId);
      }

      const retryPayload = (await retryResponse.json()) as unknown;
      if (!retryResponse.ok) {
        const retryErrorMessage =
          retryPayload && typeof retryPayload === "object" && retryPayload !== null && "error" in retryPayload
            ? normalizeString((retryPayload as { error?: { message?: string } }).error?.message)
            : "";

        return {
          ok: false,
          message: retryErrorMessage || "AI 초안 재생성에 실패했습니다.",
        };
      }

      const retryOutputText = extractResponseText(retryPayload);
      if (!retryOutputText) {
        return {
          ok: false,
          message: "AI 재생성 응답 본문을 읽지 못했습니다.",
        };
      }

      draft = normalizeDraftPayload(JSON.parse(retryOutputText) as unknown);
      if (!draft) {
        return {
          ok: false,
          message: "AI 재생성 초안 형식이 예상과 달라 적용할 수 없습니다.",
        };
      }

      const retryValidationError = validateDraftFiveWsAndOneH(draft, validationContext);
      if (retryValidationError) {
        return {
          ok: false,
          message: `AI 요약이 아직 구체성이 부족합니다: ${retryValidationError}`,
        };
      }
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
