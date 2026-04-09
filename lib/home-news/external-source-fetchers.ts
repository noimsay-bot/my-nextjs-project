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
      url: createGoogleNewsSearchUrl(
        "대통령실 OR 대통령 발언 OR 당대표 OR 원내대표 OR 비대위원장 OR 탄핵 OR 특검 OR 법안 처리 OR 압수수색 OR 소환 OR 출석 OR 체포 OR 구속영장 OR 기소 OR 선고 -인터뷰 -기획 -칼럼 -사설 -행사 -캠페인",
      ),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "politics",
      tags: ["검찰", "경찰", "수사"],
    },
    {
      id: "google-local-election-major-races",
      label: "Google News 지방선거 광역단체장",
      url: createGoogleNewsSearchUrl(
        "(민주당 OR 국민의힘 OR 개혁신당 OR 조국혁신당 OR 진보당) (서울시장 OR 부산시장 OR 대구시장 OR 인천시장 OR 광주시장 OR 대전시장 OR 울산시장 OR 세종시장 OR 경기도지사 OR 강원도지사 OR 충북지사 OR 충남지사 OR 전북지사 OR 전남지사 OR 경북지사 OR 경남지사 OR 제주지사) (후보 확정 OR 공천 확정 OR 경선 결과 OR 후보 선출 OR 단일화 OR 여론조사) -인터뷰 -기획 -칼럼 -사설 -행사 -캠페인",
      ),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "politics",
      tags: ["지방선거", "후보확정"],
    },
    {
      id: "google-warrant",
      label: "Google News 영장·심사",
      url: createGoogleNewsSearchUrl(
        "구속영장실질심사 OR 영장 청구 OR 영장 발부 OR 영장 기각 OR 압수수색 OR 소환 통보 OR 법원 선고 -인터뷰 -행사 -캠페인",
      ),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "politics",
      tags: ["영장", "법원", "심사"],
    },
    {
      id: "google-disaster",
      label: "Google News 재난·사고",
      url: createGoogleNewsSearchUrl(
        "살인 OR 강력범죄 OR 화재 OR 사망 OR 붕괴 OR 폭발 OR 산불 OR 대형 사고 OR 재난 OR 압수수색 OR 체포 OR 구속영장 OR 기소 OR 선고 -캠페인 -행사 -추모 -복구지원",
      ),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "society",
      tags: ["재난", "사건사고"],
    },
    {
      id: "google-economy",
      label: "Google News 경제",
      url: createGoogleNewsSearchUrl(
        "기준금리 OR FOMC OR 코스피 OR 코스닥 OR 환율 OR 물가 OR 유가 OR 관세 OR 반도체 OR 삼성전자 OR SK하이닉스 OR 부동산 -인터뷰 -생활정보 -행사",
      ),
      slotHints: ["morning_6", "afternoon_3"],
      categoryHint: "economy",
      tags: ["경제"],
    },
    {
      id: "google-world",
      label: "Google News 국제",
      url: createGoogleNewsSearchUrl(
        "미국 OR 중국 OR 러시아 OR 일본 OR 이란 OR 이스라엘 OR 가자 OR 우크라이나 OR 전쟁 OR 휴전 OR 공습 OR 미사일 OR 정상회담 OR 관세 -인터뷰 -분석 -칼럼",
      ),
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
