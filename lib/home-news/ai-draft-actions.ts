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

type DraftValidationContext = {
  referenceText: string;
  eventTime: string;
  relatedKeywords: string;
};

const VAGUE_DRAFT_PATTERNS = [
  /^(이번|관련|해당|이 뉴스는|이 사안은)/,
  /(정치권|야권|여권|정부 안팎|주요 정당|긴장감|내부 토론|논의가 이어지고 있습니다|해석이 나옵니다|관측이 나옵니다|상황입니다)/,
  /(지원에 나섰|점검에 나섰|핵심 대응 포인트|중심으로 정리|의미를 짚어봅니다)/,
];

const GENERIC_INTERPRETATION_PATTERNS = [
  /(핵심 조치로 평가|첫 단계로|전환점이다|영향을 미칠 것으로 예상|기대된다|예고한다|사회적 관심이 크며|중요한 의미를 갖는다)/,
  /(파장이 예상된다|가능성이 높아졌다|주목된다|관심이 쏠린다)/,
  /(중요한 과정으로|여겨진다|위한 조치로|완화하고 .* 위한 조치|기여할 것으로 예상)/,
];

const TITLE_TOKEN_EXCLUDE = new Set([
  "속보",
  "단독",
  "종합",
  "관련",
  "정부",
  "정치",
  "사회",
  "경제",
  "세계",
  "뉴스",
  "기자",
  "검찰",
  "경찰",
  "법원",
  "사건",
  "이슈",
  "논란",
  "후보",
  "인선",
]);

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

function extractReferenceTitle(referenceText: string) {
  const titleLine = referenceText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("제목:"));

  return titleLine ? titleLine.replace(/^제목:\s*/, "").trim() : "";
}

function extractKeyTitleTokens(referenceText: string, relatedKeywords: string) {
  const title = extractReferenceTitle(referenceText);
  const titleTokens = title
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/["'“”‘’·,.:!?()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !TITLE_TOKEN_EXCLUDE.has(token))
    .slice(0, 8);

  const keywordTokens = relatedKeywords
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 5);

  return [...new Set([...titleTokens, ...keywordTokens])];
}

function extractReferenceContentTokens(referenceText: string, relatedKeywords: string) {
  const sourceText = [
    extractReferenceTitle(referenceText),
    ...referenceText
      .split("\n")
      .map((line) => line.replace(/^(요약|태그 후보|카테고리 후보|절차 단계 후보|출처|링크|게시 시각|실제 시각 추정\/추출):\s*/g, " ").trim())
      .filter(Boolean)
      .slice(0, 4),
    relatedKeywords,
  ].join(" ");

  return sourceText
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/["'“”‘’·,.:!?()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !TITLE_TOKEN_EXCLUDE.has(token))
    .slice(0, 18);
}

function extractLocationHints(referenceText: string) {
  const matches = referenceText.match(
    /(서울|광화문|시청|여의도|용산|종로|중구|서초동|대검찰청|서울중앙지검|서울중앙지법|국회|대통령실|경기도|부산|대구|인천|광주|대전|울산|세종|경찰서|검찰청|법원|청사)/g,
  );

  return [...new Set(matches ?? [])];
}

function containsTimeSignal(text: string) {
  return /(\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|오전\s*\d{1,2}시|오후\s*\d{1,2}시|\d{1,2}시(?:\s*\d{1,2}분)?)/.test(text);
}

function extractNumberTokens(text: string) {
  return (text.match(/\d+(?:[.,]\d+)?(?:%|명|건|원|개|차례|주|일|시간|분|시|포인트)?/g) ?? []).map((token) =>
    token.replace(/\s+/g, ""),
  );
}

function validateDraftFiveWsAndOneH(draft: NewsAIDraftResult, context: DraftValidationContext) {
  const summaryText = draft.summaryLines.join(" ");
  const firstLine = draft.summaryLines[0] ?? "";
  const combined = `${draft.title} ${summaryText} ${draft.briefingText}`;

  if (VAGUE_DRAFT_PATTERNS.some((pattern) => pattern.test(firstLine))) {
    return "요약 첫 줄이 정치권, 관련, 상황 같은 두루뭉술한 표현으로 시작합니다.";
  }

  if (VAGUE_DRAFT_PATTERNS.some((pattern) => pattern.test(summaryText))) {
    return "요약에 구체 사실보다 해석과 일반론이 많이 남아 있습니다.";
  }

  if (GENERIC_INTERPRETATION_PATTERNS.some((pattern) => pattern.test(summaryText))) {
    return "요약에 핵심 조치, 전환점, 예상된다 같은 추상 해석 문장이 남아 있습니다.";
  }

  const titleTokens = extractKeyTitleTokens(context.referenceText, context.relatedKeywords);
  if (titleTokens.length > 0 && !titleTokens.some((token) => combined.includes(token))) {
    return "입력 기사에 있는 핵심 주체나 대상이 제목과 요약에 충분히 드러나지 않습니다.";
  }

  const referenceTokens = extractReferenceContentTokens(context.referenceText, context.relatedKeywords);
  const missingConcreteLine = draft.summaryLines.find(
    (line) => !referenceTokens.some((token) => token && line.includes(token)),
  );
  if (missingConcreteLine) {
    return "요약 줄 중 하나가 입력 기사 고유 정보 없이 일반론으로만 작성됐습니다.";
  }

  const locationHints = extractLocationHints(context.referenceText);
  if (locationHints.length > 0 && !locationHints.some((location) => combined.includes(location))) {
    return "입력에 있는 장소 정보가 제목이나 요약에 반영되지 않았습니다.";
  }

  if (context.eventTime && !containsTimeSignal(summaryText) && !containsTimeSignal(draft.briefingText)) {
    return "입력에 있는 실제 시각 정보가 요약이나 전광판 문구에 반영되지 않았습니다.";
  }

  if (firstLine.length < 12) {
    return "요약 첫 줄이 너무 짧아 누가 무엇을 했는지 전달되지 않습니다.";
  }

  const referenceNumbers = new Set([
    ...extractNumberTokens(context.referenceText),
    ...extractNumberTokens(context.eventTime),
  ]);
  const newNumbers = extractNumberTokens(combined).filter((token) => !referenceNumbers.has(token));
  if (newNumbers.length > 0) {
    return "입력에 없는 수치나 시간 표현이 제목 또는 요약에 새로 들어갔습니다.";
  }

  return null;
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
    "제목과 요약 첫 줄에는 반드시 누가, 어떤 자리나 기관이, 무엇을 했는지 먼저 씁니다.",
    "예: 민주당은, 국민의힘은, 대통령실은, 검찰은, 법원은, 서울시는 처럼 주체를 바로 드러냅니다.",
    "인사 뉴스라면 반드시 어떤 자리의 인선인지 씁니다. 예: 국무총리 후보, 장관 후보, 대통령실 비서관 인선.",
    "절차 뉴스라면 반드시 누구에 대한 소환·기소·선고·영장인지 씁니다.",
    "집회·시위·행진 뉴스라면 반드시 어디서, 언제, 누가 주최하거나 참가하는지, 인원 규모가 확인되면 얼마나 모이는지부터 씁니다.",
    "집회 기사에서 장소, 시각, 주최 측, 참가 규모 정보가 입력에 없으면 일반론으로 뭉뚱그리지 말고, 확인된 사실만 짧게 씁니다.",
    "야권, 여권, 정치권, 정부 안팎, 후속 인선, 긴장감 같은 뭉뚱그린 표현만으로 문장을 시작하지 않습니다.",
    "입력에 구체 직책이나 대상이 없으면 만들어내지 말고, 확인되지 않았다는 식의 완곡한 표현 대신 해당 문장을 더 짧게 정리합니다.",
    "summary_lines는 육하원칙 기준으로 작성합니다. 확인 가능한 범위에서 언제, 어디서, 누가, 무엇을, 왜, 어떻게를 넣습니다.",
    "summary 첫 줄에는 최소 누가와 무엇을 반드시 넣고, 입력에 있으면 언제와 어디서도 함께 넣습니다.",
    "summary 둘째 줄에는 왜 중요한지와 어떻게 진행되는지, 또는 다음 절차가 무엇인지 씁니다.",
    "소환·출석·압수수색·기소·선고 기사라면 어느 기관이 누구를 어떻게 조치했는지, 장소가 확인되면 어느 청사나 법원·검찰청인지까지 넣습니다.",
    "제목과 요약은 기사 내용을 모르는 사람이 봐도 누가, 어디서, 무엇을 했는지 바로 알 수 있게 구체 명사로 씁니다.",
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
            "당신은 방송국 내부 포털용 뉴스 브리핑 초안을 작성하는 편집 보조 시스템입니다. 사실 중심, 단정한 문체, 추측 금지, 선정성 금지 원칙을 지킵니다.",
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
        retryResponse = await requestNewsDraft(
          [
            basePrompt,
            "",
            `직전 초안 문제: ${validationError}`,
            "다시 작성할 때는 요약 첫 줄에 누가, 어디서, 무엇을 했는지를 구체적으로 쓰고, 입력에 있으면 언제도 반드시 넣습니다.",
            "정치권, 해당 사안, 후속 인선, 내부 토론, 긴장감, 상황입니다 같은 표현은 쓰지 않습니다.",
            "입력에 없는 수치, 시간, 장소, 평가 문장을 절대 추가하지 않습니다.",
          ].join("\n"),
          retryController.signal,
        );
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
