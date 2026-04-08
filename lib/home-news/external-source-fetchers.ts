import { ExternalNewsRawItem, ExternalNewsSourceConfig } from "@/lib/home-news/external-source-types";
import { parseExternalNewsFeed } from "@/lib/home-news/external-source-transform";

const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss/search";

function createGoogleNewsSearchUrl(query: string) {
  const params = new URLSearchParams({
    q: query,
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko",
  });
  return `${GOOGLE_NEWS_RSS_BASE}?${params.toString()}`;
}

export function getDefaultExternalNewsSources(): ExternalNewsSourceConfig[] {
  return [
    {
      id: "google-investigation",
      label: "Google News 수사 동향",
      url: createGoogleNewsSearchUrl("검찰 소환 OR 경찰 소환 OR 조사 OR 출석"),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "politics",
      tags: ["검찰", "경찰", "수사"],
    },
    {
      id: "google-warrant",
      label: "Google News 영장·심사",
      url: createGoogleNewsSearchUrl("구속영장실질심사 OR 영장 청구 OR 영장 발부 OR 영장 기각"),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "politics",
      tags: ["영장", "법원", "심사"],
    },
    {
      id: "google-disaster",
      label: "Google News 재난·사고",
      url: createGoogleNewsSearchUrl("지진 OR 화재 OR 산불 OR 대형 사고 OR 재난"),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "society",
      tags: ["재난", "사건사고"],
    },
    {
      id: "google-economy",
      label: "Google News 경제",
      url: createGoogleNewsSearchUrl("환율 OR 증시 OR 금리 OR 물가 OR 수출"),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "economy",
      tags: ["경제"],
    },
    {
      id: "google-world",
      label: "Google News 국제",
      url: createGoogleNewsSearchUrl("미국 OR 중국 OR 일본 OR 유럽 외교 OR 전쟁 OR 정상회담"),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "world",
      tags: ["국제"],
    },
  ];
}

export function getConfiguredExternalNewsSources() {
  const configuredFeeds = process.env.HOME_NEWS_EXTERNAL_FEEDS
    ?.split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!configuredFeeds || configuredFeeds.length === 0) {
    return getDefaultExternalNewsSources();
  }

  return configuredFeeds.map<ExternalNewsSourceConfig>((url, index) => ({
    id: `configured-${index + 1}`,
    label: `외부 뉴스 피드 ${index + 1}`,
    url,
    slotHints: ["morning_6", "afternoon_3"],
  }));
}

async function fetchExternalNewsSource(source: ExternalNewsSourceConfig): Promise<ExternalNewsRawItem[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(source.url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "User-Agent": "news-briefing-admin-bot/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    return parseExternalNewsFeed(xml, {
      label: source.label,
      url: source.url,
      feedCategoryHint: source.categoryHint,
      feedEventStageHint: source.eventStageHint,
      feedTags: source.tags,
      slotHints: source.slotHints,
    }).slice(0, 10);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchExternalNewsRawItems() {
  const sources = getConfiguredExternalNewsSources();
  const results = await Promise.all(sources.map((source) => fetchExternalNewsSource(source)));
  const deduped = new Map<string, ExternalNewsRawItem>();

  results.flat().forEach((item) => {
    const dedupeKey = `${item.title.toLowerCase()}|${item.sourceUrl.toLowerCase()}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, item);
    }
  });

  return [...deduped.values()];
}
