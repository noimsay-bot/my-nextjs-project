import { HomeNewsCategory } from "@/components/home/home-news.types";
import {
  NewsBriefingPriority,
} from "@/lib/home-news/admin-types";
import { ExternalNewsCandidate, ExternalNewsRawItem } from "@/lib/home-news/external-source-types";
import { HomeNewsEventStage } from "@/lib/home-news/transform";

function decodeHtmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeedItems(xml: string, tagName: "item" | "entry") {
  const pattern = new RegExp(`<${tagName}[\\s\\S]*?<\\/${tagName}>`, "gi");
  return xml.match(pattern) ?? [];
}

function readTagValue(block: string, tagNames: string[]) {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
    const match = block.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return "";
}

function readAtomLink(block: string) {
  const alternateMatch = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alternateMatch?.[1]) {
    return decodeHtmlEntities(alternateMatch[1]);
  }

  const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return hrefMatch?.[1] ? decodeHtmlEntities(hrefMatch[1]) : "";
}

function buildItemId(source: string, title: string, sourceUrl: string) {
  const seed = `${source}|${title}|${sourceUrl}`
    .toLowerCase()
    .replace(/[^\w가-힣]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return seed || `external-${Date.now()}`;
}

function normalizeDateValue(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toKstIso(date: Date, hour: number, minute: number) {
  const year = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(date);
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    day: "2-digit",
  }).format(date);

  return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`;
}

function extractOccurredAt(text: string, publishedAt: string | null) {
  if (!publishedAt) return null;

  const timeMatch = text.match(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[2] ?? "0");
  const minute = Number(timeMatch[3] ?? "0");
  const meridiem = timeMatch[1] ?? "";

  if (meridiem === "오전" && hour === 12) {
    hour = 0;
  } else if (meridiem === "오후" && hour < 12) {
    hour += 12;
  }

  if (hour > 23 || minute > 59) return null;
  return toKstIso(new Date(publishedAt), hour, minute);
}

const NATIONAL_POLITICS_CATEGORY_PATTERNS = /(대통령실|대통령|국회|정당|여당|야당|당대표|원내대표|비대위원장|총리|장관|청문회|탄핵|선거|법안|본회의|상임위|예산안|국정조사|개헌|당정|정권|개각)/;
const POLITICAL_JUDICIAL_PATTERNS = /(김건희|윤석열|이재명|한동훈|조국|명태균|영부인|대선자금|선거법|정치자금|공천개입|도이치모터스)/;
const CRIME_SOCIETY_PATTERNS = /(방화|폭행|살인|흉기|강도|납치|사망|부상|실종|피의자|용의자|피해자|사건|사고|참사|화재|산불|폭발|붕괴|침수|추락|구속영장|영장|소환|출석|조사|압수수색|기소|재판|선고|법원|검찰|경찰|공수처|특검)/;
const SEOUL_DOWNTOWN_RALLY_PATTERNS = /(서울|광화문|시청|여의도|용산|종로|중구).*(집회|시위|행진|대규모 집회|찬반 집회)|(?:집회|시위|행진).*(서울|광화문|시청|여의도|용산|종로|중구)/;
const LOCAL_ELECTION_MAJOR_RACE_PATTERNS = /(서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|경기지사|강원지사|제주도지사).*(후보 확정|공천 확정|경선 확정|전략공천|단수공천|후보 선출|후보 결정|지방선거)|(?:후보 확정|공천 확정|경선 확정|전략공천|단수공천|후보 선출|후보 결정|지방선거).*(서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|경기지사|강원지사|제주도지사)|((민주당|국민의힘|개혁신당|조국혁신당|진보당).*(경기도지사|서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사).*(후보|공천|경선))/;

function inferCategory(text: string, hint?: HomeNewsCategory): HomeNewsCategory {
  if (/(환율|증시|금리|물가|관세|반도체|실적|주가|수출|경제)/.test(text)) {
    return "economy";
  }
  if (/(미국|중국|일본|유럽|러시아|우크라|가자|이스라엘|이란|해외|세계|美|中|日|러시아|중동)/.test(text)) {
    return "world";
  }
  if (LOCAL_ELECTION_MAJOR_RACE_PATTERNS.test(text)) {
    return "politics";
  }
  if (SEOUL_DOWNTOWN_RALLY_PATTERNS.test(text)) {
    return "society";
  }
  if (POLITICAL_JUDICIAL_PATTERNS.test(text)) {
    return "politics";
  }
  if (CRIME_SOCIETY_PATTERNS.test(text) && !NATIONAL_POLITICS_CATEGORY_PATTERNS.test(text)) {
    return "society";
  }
  if (NATIONAL_POLITICS_CATEGORY_PATTERNS.test(text) || /(정부|대통령|국회|정당|장관|청문|탄핵|총리)/.test(text)) {
    return "politics";
  }
  if (hint) return hint;
  return "society";
}

function inferEventStage(text: string, hint?: Exclude<HomeNewsEventStage, null>): HomeNewsEventStage {
  if (hint) return hint;
  if (/(조사 중|조사중|신문 중|심문 중)/.test(text)) return "under_questioning";
  if (/(출석 중|출석중|소환 조사|소환조사)/.test(text)) return "attending";
  if (/(소환 예정|출석 예정|출석요구)/.test(text)) return "summon_scheduled";
  if (/(검찰 소환|경찰 소환|소환 통보)/.test(text)) return "summon_requested";
  if (/(구속영장실질심사|영장심사 예정|실질심사 예정)/.test(text)) return "warrant_review_scheduled";
  if (/(영장 청구|구속영장 청구)/.test(text)) return "warrant_requested";
  if (/(영장 발부|구속 결정)/.test(text)) return "warrant_issued";
  if (/(영장 기각|구속영장 기각)/.test(text)) return "warrant_denied";
  if (/(수사 확대|압수수색|추가 조사|사건 경위 조사)/.test(text)) return "investigation_update";
  return null;
}

function inferTags(text: string, feedTags: string[] = []) {
  const detected = new Set(feedTags.map((tag) => tag.trim()).filter(Boolean));
  const keywordMap: Array<[RegExp, string]> = [
    [/(검찰|검사)/, "검찰"],
    [/(경찰)/, "경찰"],
    [/(법원|재판부)/, "법원"],
    [/(소환)/, "소환"],
    [/(출석)/, "출석"],
    [/(조사)/, "조사"],
    [/(영장)/, "영장"],
    [/(실질심사|영장심사)/, "영장심사"],
    [/(지방선거|광역단체장)/, "지방선거"],
    [/(후보 확정|공천 확정|전략공천|단수공천|경선 확정)/, "후보확정"],
    [/(집회|시위|행진)/, "집회"],
    [/(광화문|시청|여의도|용산|종로)/, "서울도심"],
    [/(지진)/, "지진"],
    [/(화재|불길)/, "화재"],
    [/(산불)/, "산불"],
    [/(붕괴|폭발|침수|정전)/, "재난"],
    [/(참사|사고|충돌|추락)/, "사건사고"],
  ];

  keywordMap.forEach(([pattern, tag]) => {
    if (pattern.test(text)) {
      detected.add(tag);
    }
  });

  return [...detected].slice(0, 8);
}

function inferPriority(text: string, category: HomeNewsCategory, eventStage: HomeNewsEventStage): NewsBriefingPriority {
  if (/(지진|화재|참사|산불|폭발|대형 사고|재난|침수|붕괴)/.test(text)) {
    return "high";
  }
  if (LOCAL_ELECTION_MAJOR_RACE_PATTERNS.test(text)) {
    return "high";
  }
  if (SEOUL_DOWNTOWN_RALLY_PATTERNS.test(text)) {
    return "high";
  }
  if (eventStage === "attending" || eventStage === "under_questioning" || eventStage === "warrant_issued") {
    return "high";
  }
  if (eventStage) {
    return "medium";
  }
  if (category === "politics" || category === "society") {
    return "medium";
  }
  return "low";
}

function buildReferenceText(item: {
  source: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  occurredAt: string | null;
  category: HomeNewsCategory;
  eventStage: HomeNewsEventStage;
  tags: string[];
}) {
  return [
    `출처: ${item.source}`,
    item.sourceUrl ? `링크: ${item.sourceUrl}` : "",
    `제목: ${item.title}`,
    item.excerpt ? `요약: ${item.excerpt}` : "",
    item.publishedAt ? `게시 시각: ${item.publishedAt}` : "",
    item.occurredAt ? `실제 시각 추정/추출: ${item.occurredAt}` : "",
    `카테고리 후보: ${item.category}`,
    item.eventStage ? `절차 단계 후보: ${item.eventStage}` : "",
    item.tags.length > 0 ? `태그 후보: ${item.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseExternalNewsFeed(xml: string, source: {
  label: string;
  url: string;
  feedCategoryHint?: HomeNewsCategory;
  feedEventStageHint?: Exclude<HomeNewsEventStage, null>;
  feedTags?: string[];
  slotHints: ExternalNewsRawItem["slotHints"];
}) {
  const rssBlocks = parseFeedItems(xml, "item");
  const atomBlocks = parseFeedItems(xml, "entry");
  const blocks = rssBlocks.length > 0 ? rssBlocks : atomBlocks;

  return blocks
    .map<ExternalNewsRawItem | null>((block) => {
      const title = readTagValue(block, ["title"]);
      const excerpt = readTagValue(block, ["description", "summary", "content"]);
      const sourceUrl = rssBlocks.length > 0
        ? readTagValue(block, ["link"])
        : readAtomLink(block);
      const publishedAt = normalizeDateValue(readTagValue(block, ["pubDate", "published", "updated"]));

      if (!title || !sourceUrl) return null;

      return {
        id: buildItemId(source.label, title, sourceUrl),
        source: source.label,
        sourceUrl,
        title,
        excerpt,
        publishedAt,
        feedCategoryHint: source.feedCategoryHint,
        feedEventStageHint: source.feedEventStageHint,
        feedTags: source.feedTags,
        slotHints: source.slotHints,
      };
    })
    .filter((item): item is ExternalNewsRawItem => Boolean(item));
}

export function toExternalNewsCandidate(raw: ExternalNewsRawItem): ExternalNewsCandidate {
  const combinedText = `${raw.title} ${raw.excerpt}`.trim();
  const category = inferCategory(combinedText, raw.feedCategoryHint);
  const eventStage = inferEventStage(combinedText, raw.feedEventStageHint);
  const occurredAt = extractOccurredAt(combinedText, raw.publishedAt);
  const tags = inferTags(combinedText, raw.feedTags);
  const priority = inferPriority(combinedText, category, eventStage);

  return {
    id: raw.id,
    source: raw.source,
    sourceUrl: raw.sourceUrl,
    title: raw.title,
    excerpt: raw.excerpt,
    publishedAt: raw.publishedAt,
    occurredAt,
    category,
    eventStage,
    tags,
    priority,
    slotHints: raw.slotHints,
    suggestedSlot: "morning_6",
    score: 0,
    recommendationReason: "",
    importanceHints: [],
    personalizationHints: [],
    referenceText: buildReferenceText({
      source: raw.source,
      sourceUrl: raw.sourceUrl,
      title: raw.title,
      excerpt: raw.excerpt,
      publishedAt: raw.publishedAt,
      occurredAt,
      category,
      eventStage,
      tags,
    }),
  };
}
