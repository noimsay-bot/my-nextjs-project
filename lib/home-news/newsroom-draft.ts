import { NewsAIDraftRequestInput, NewsAIDraftResult } from "@/lib/home-news/ai-draft-types";

export const NEWS_DRAFT_SCHEMA = {
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
      minItems: 3,
      maxItems: 3,
    },
    why_it_matters: { type: "string" },
    check_points: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
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

export type DraftValidationContext = {
  referenceText: string;
  eventTime: string;
  relatedKeywords: string;
};

const VAGUE_DRAFT_PATTERNS = [
  /^(이번|관련|해당|이 뉴스는|이 사안은|상황은)/,
  /(정치권|야권|여권|정부 안팎|주요 정당|긴장감|내부 토론|논의가 이어지고 있습니다|해석이 나옵니다|관측이 나옵니다|상황입니다)/,
  /(지원에 나섰|점검에 나섰|핵심 대응 포인트|중심으로 정리|의미를 짚어봅니다|관심이 집중됩니다)/,
];

const GENERIC_INTERPRETATION_PATTERNS = [
  /(핵심 조치로 평가|첫 단계로|전환점이다|영향을 미칠 것으로 예상|기대된다|예고한다|사회적 관심이 크며|중요한 의미를 갖는다)/,
  /(파장이 예상된다|가능성이 높아졌다|주목된다|관심이 쏠린다|관심이 집중된다)/,
  /(중요한 과정으로|여겨진다|위한 조치로|완화하고 .* 위한 조치|기여할 것으로 예상)/,
  /(메인급 뉴스로 판단|1면급으로 볼 수 있|속보급 판단|우선 확인할 만한 뉴스)/,
];

const GENERIC_CHECKPOINT_PATTERNS = [
  /추가 상황/,
  /후속 상황/,
  /파장 여부/,
  /추가 반응/,
  /추이를 지켜볼/,
  /관계자 설명/,
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
      .map((line) =>
        line.replace(/^(요약|태그 후보|카테고리 후보|절차 단계 후보|출처|링크|게시 시각|실제 시각 추정\/추출):\s*/g, " ").trim(),
      )
      .filter(Boolean)
      .slice(0, 5),
    relatedKeywords,
  ].join(" ");

  return sourceText
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/["'“”‘’·,.:!?()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !TITLE_TOKEN_EXCLUDE.has(token))
    .slice(0, 24);
}

function extractLocationHints(referenceText: string) {
  const matches = referenceText.match(
    /(서울|광화문|시청|여의도|용산|종로|중구|서초동|대검찰청|서울중앙지검|서울중앙지법|국회|대통령실|경기도|부산|대구|인천|광주|대전|울산|세종|경찰서|검찰청|법원|청사|합참|백악관|크렘린궁|도쿄|베이징|워싱턴)/g,
  );

  return [...new Set(matches ?? [])];
}

function containsTimeSignal(text: string) {
  return /(\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|오전\s*\d{1,2}시|오후\s*\d{1,2}시|\d{1,2}시(?:\s*\d{1,2}분)?)/.test(text);
}

function extractNumberTokens(text: string) {
  return (text.match(/\d+(?:[.,]\d+)?(?:%|명|건|원|개|차례|주|일|시간|분|시|포인트|달러)?/g) ?? []).map((token) =>
    token.replace(/\s+/g, ""),
  );
}

export function extractResponseText(payload: unknown): string {
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

export function normalizeDraftPayload(raw: unknown): NewsAIDraftResult | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = normalizeString(record.title);
  const summaryLines = normalizeArray(record.summary_lines, 3);
  const whyItMatters = normalizeString(record.why_it_matters);
  const checkPoints = normalizeArray(record.check_points, 4);
  const tags = normalizeArray(record.tags, 8);
  const priority = normalizeString(record.priority);
  const briefingText = normalizeString(record.briefing_text);

  if (!title || summaryLines.length !== 3 || !whyItMatters || checkPoints.length < 2 || !briefingText) {
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

export function buildNewsDraftPrompt(input: NewsAIDraftRequestInput) {
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
    "이 요약은 일반 독자용 요약기가 아니라 보도국용 포털 메인 브리핑입니다.",
    "뉴스 존재 여부보다 뉴스 급, 전국 파급력, 절차 진행성, 편집회의 가치가 더 중요합니다.",
    "포털 메인급, 주요 신문 1면급, 연합뉴스 속보급 뉴스만 우선 선별한다는 전제를 유지합니다.",
    "지역 단신, 기관 홍보, 행사, 캠페인, 사후 미담, 해설성 기사, 생활정보성 기사, 소프트 트렌드 기사는 가치가 낮게 보이도록 작성하지 말고, 입력에 포함돼도 핵심 사실이 약하면 더 건조하게 압축합니다.",
    "문체는 방송 뉴스 데스크 회의용 메모처럼 짧지만 구체적으로 씁니다.",
    "과장, 추측, 전망성 문장, 감정어를 피하고 사실과 절차 중심으로 씁니다.",
    "제목은 원문 제목을 그대로 복사하지 말고, 누가 무엇을 했는지가 드러나는 뉴스룸식 제목으로 다시 씁니다.",
    "summary_lines는 반드시 3줄만 작성합니다.",
    "1줄: 언제, 어디서, 누가, 무엇을 했는지. 입력에 있는 정보만 넣고, 최소한 누가와 무엇은 반드시 넣습니다.",
    "2줄: 왜 벌어졌는지, 어떤 절차인지, 배경이나 쟁점이 무엇인지. 절차 기사라면 수사기관, 법원, 국회, 대통령실 등 실제 주체와 단계가 드러나야 합니다.",
    "3줄: 현재 진행 단계, 다음 절차, 후속 확인 포인트 중 가장 중요한 한 가지를 구체적으로 씁니다.",
    "정치 기사는 대통령 발언, 대통령실 발표, 여야 대표급 발언, 국회 충돌, 법안 강행 처리, 탄핵, 고위공직자 수사·재판 절차를 특히 중요하게 다룹니다.",
    "사회 기사는 사망자 발생 화재, 강력범죄, 대형 사고, 재난, 압수수색, 소환, 체포, 영장, 기소, 선고 등 실제 절차 진행 뉴스를 특히 중요하게 다룹니다.",
    "경제 기사는 기준금리, 코스피 급등락, 환율 급등락, 반도체, 대기업, 부동산, 물가, 유가, 관세, 정부 경제정책처럼 전국민 파급력이 큰 사안을 우선합니다.",
    "세계 기사는 전쟁, 휴전, 공습, 미사일, 주요국 정상 발언, 무역분쟁, 안보 위기처럼 한국에 직접 영향을 줄 국제 뉴스를 우선합니다.",
    "정치권, 관련 업계, 상황입니다, 파장이 예상됩니다, 관심이 쏠립니다 같은 빈 표현을 쓰지 않습니다.",
    "메인급 뉴스로 판단, 1면급 뉴스, 속보급 판단 같은 평가 문장을 요약 본문에 쓰지 않습니다.",
    "입력에 없는 시간, 장소, 숫자, 인명, 평가를 추정해서 쓰지 않습니다.",
    "실제 사건/절차 시각이 제공되면 1줄 또는 briefing_text에 자연스럽게 반영하고, 제공되지 않으면 시간을 만들지 않습니다.",
    "why_it_matters는 추상적인 의미 부여가 아니라 뉴스룸, 시청자, 사회적 파급 기준에서 왜 중요한지 한두 문장으로 구체적으로 씁니다.",
    "check_points는 후속 취재 관점에서 실제로 확인해야 할 항목만 2~4개 작성합니다. 예: 추가 인명피해 여부, 영장 청구 여부, 법원 판단, 정부 공식 입장, 증시·환율 실제 반응.",
    "briefing_text는 한 줄 속보 자막처럼 짧고 명확하게, 핵심 사실만 씁니다.",
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

export function buildNewsDraftRetryPrompt(basePrompt: string, validationError: string) {
  return [
    basePrompt,
    "",
    `직전 초안 문제: ${validationError}`,
    "다시 작성할 때는 3줄 요약을 유지하고, 첫 줄에 누가, 어디서, 무엇을 했는지를 기사에 있는 표현으로 더 구체적으로 씁니다.",
    "둘째 줄은 절차, 배경, 쟁점을 실제 기관명과 단계 중심으로 쓰고, 셋째 줄은 현재 진행 단계나 다음 확인 포인트를 추상어 없이 씁니다.",
    "정치권, 해당 사안, 후속 인선, 내부 토론, 긴장감, 상황입니다, 파장이 예상된다, 메인급 뉴스로 판단 같은 표현은 쓰지 않습니다.",
    "입력에 없는 수치, 시간, 장소, 평가 문장을 절대 추가하지 않습니다.",
  ].join("\n");
}

export function validateDraftFiveWsAndOneH(draft: NewsAIDraftResult, context: DraftValidationContext) {
  const summaryText = draft.summaryLines.join(" ");
  const firstLine = draft.summaryLines[0] ?? "";
  const secondLine = draft.summaryLines[1] ?? "";
  const thirdLine = draft.summaryLines[2] ?? "";
  const combined = `${draft.title} ${summaryText} ${draft.briefingText} ${draft.whyItMatters}`;

  if (draft.summaryLines.length !== 3) {
    return "요약 줄 수가 3줄 형식을 지키지 않았습니다.";
  }

  if (VAGUE_DRAFT_PATTERNS.some((pattern) => pattern.test(firstLine))) {
    return "요약 첫 줄이 정치권, 관련, 상황 같은 두루뭉술한 표현으로 시작합니다.";
  }

  if (VAGUE_DRAFT_PATTERNS.some((pattern) => pattern.test(summaryText))) {
    return "요약에 구체 사실보다 해석과 일반론이 많이 남아 있습니다.";
  }

  if (GENERIC_INTERPRETATION_PATTERNS.some((pattern) => pattern.test(summaryText)) || GENERIC_INTERPRETATION_PATTERNS.some((pattern) => pattern.test(draft.whyItMatters))) {
    return "요약 또는 중요도 설명에 추상 해석 문장이 남아 있습니다.";
  }

  if (draft.checkPoints.some((item) => GENERIC_CHECKPOINT_PATTERNS.some((pattern) => pattern.test(item)))) {
    return "확인 포인트에 '추가 상황'처럼 추상적인 문장이 포함돼 있습니다.";
  }

  const referenceTitle = extractReferenceTitle(context.referenceText);
  if (referenceTitle && draft.title === referenceTitle) {
    return "제목이 원문 제목을 그대로 복사한 형태입니다.";
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

  if (context.eventTime && !containsTimeSignal(firstLine) && !containsTimeSignal(draft.briefingText)) {
    return "입력에 있는 실제 시각 정보가 첫 줄이나 전광판 문구에 반영되지 않았습니다.";
  }

  if (firstLine.length < 16) {
    return "요약 첫 줄이 너무 짧아 언제, 어디서, 누가, 무엇을 했는지 전달되지 않습니다.";
  }

  if (secondLine.length < 14) {
    return "요약 둘째 줄이 너무 짧아 배경이나 절차가 충분히 드러나지 않습니다.";
  }

  if (thirdLine.length < 12) {
    return "요약 셋째 줄이 너무 짧아 현재 상태나 다음 확인 포인트가 드러나지 않습니다.";
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
