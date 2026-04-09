import { HomeNewsCategory } from "@/components/home/home-news.types";
import { getNewsBriefingCategoryLabel, NEWS_BRIEFING_EVENT_STAGE_LABELS } from "@/lib/home-news/admin-types";
import {
  ExternalNewsCandidate,
  ExternalNewsScoringContext,
} from "@/lib/home-news/external-source-types";
import {
  getEventStageWeight,
  getPriorityWeight,
  toNewsTimestamp,
} from "@/lib/home-news/ranking";

const SEOUL_NATIONAL_PATTERNS = /(서울|여의도|용산|국회|정부|대통령실|대통령|총리|장관|헌재|헌법재판소|대검|서울중앙지검|서울경찰청|공수처|검찰|경찰|법원|대법원|한국은행|기획재정부|금융위원회|금감원|국세청|공정위|코스피|코스닥|환율|물가|금리|수출|관세|반도체|부동산|전국|대한민국|미국|중국|일본|유럽|러시아|우크라|가자|이스라엘|국제|외교|전쟁|안보|정상회담|무역|관세)/;
const REGIONAL_LOCAL_PATTERNS = /(부산|대구|광주|대전|울산|세종|인천|경기|용인|수원|성남|고양|화성|평택|강원|춘천|원주|충북|청주|충남|천안|전북|전주|전남|광양|목포|경북|대구경북|안동|포항|구미|경남|창원|김해|진주|제주|시화|대덕구|동천동|[가-힣]{2,}(시|군|구|동|읍|면))/;
const PROCEDURAL_CORE_PATTERNS = /(압수수색|체포|구속|기소|불구속 기소|영장실질심사|실질심사|영장 심사|영장 청구|영장 발부|영장 기각|압송|소환|출석|조사 중|신문 중|심문 중|재판|1심|2심|대법원|선고|파기환송|유죄|무죄|헌재 판단|탄핵 심판)/;
const NATIONAL_POLITICS_PATTERNS = /(대통령실|대통령|국회|정당|여당|야당|대표 회담|법안 처리|본회의|상임위|탄핵|총리|장관|청문회|선거|개헌|예산안)/;
const NATIONAL_ECONOMY_PATTERNS = /(증시|코스피|코스닥|환율|금리|물가|수출|관세|무역|반도체|대기업|삼성전자|SK하이닉스|부동산|가계부채|기준금리|고용|실업률|유가)/;
const MAJOR_DISASTER_PATTERNS = /(대형 화재|화재|산불|폭발|붕괴|침수|참사|지진|사망|실종|중상|고속도로|교통대란|정전|여객선|항공기|열차|추락|재난|비상사태)/;
const SEOUL_DOWNTOWN_RALLY_PATTERNS = /(서울|광화문|시청|여의도|용산|종로|중구).*(집회|시위|행진|대규모 집회|찬반 집회)|(?:집회|시위|행진).*(서울|광화문|시청|여의도|용산|종로|중구)/;
const MAJOR_WORLD_PATTERNS = /(전쟁|휴전|공습|미사일|무역 분쟁|관세 전쟁|정상회담|외교 갈등|안보 위기|제재|원유|국제유가|나토|중동|우크라이나|가자|대만)/;
const PROMOTIONAL_PATTERNS = /(지원 나섰다|지원한다|지원 확대|상담 지원|심리회복|회복 지원|기념|1주기|추모|캠페인|운영한다|운영 중|도입했다|프로그램|개최|개막|전시|교육|체험|공모|모집|설명회|포럼|세미나|홍보|협약|업무협약|MOU|인터뷰|대담|해설|분석|칼럼|기고|오피니언|사설|총력 대응|예방 총력|예방대책 강화|특별지시|대응체계|24시간 가동|점검 강화|안전 관리 강화|막았다)/;
const INSTITUTIONAL_PROMO_PATTERNS = /(센터|재단|진흥원|협회|공단|교육청|시청|군청|구청|백화점|지원센터|위원회).*(운영|지원|상담|도입|개최|홍보|가동|대응|예방|강화|지시)/;
const POST_EVENT_SUPPORT_PATTERNS = /(상담 지원|회복 지원|복구 지원|기념 행사|추모 행사|캠페인|봉사|지원금|성금|심리회복|재난심리|운영한다)/;
const SOFT_FEATURE_PATTERNS = /(르포|인터뷰|기획|탐방|이색|화제|눈길|주목|조명|해설|분석|투데이픽|이슈in|사설|시론|논설|오피니언)/;
const LOW_VALUE_INFORMATION_PATTERNS = /(기관이 지원|상담을 운영|기념행사를|캠페인을|프로그램을 시작|지역 축제|홍보 행사|지원 대책|사후 지원|복구 지원|추모 중심|생활 정보|날씨 정보|건강 정보|소비 트렌드|유행|맛집|여행|축제|예방의식|생활 속|확산해요|예방 캠페인)/;
const SOFT_TREND_PATTERNS = /(트렌드|인기|화제의|눈길|주목받는|MZ|맛집|나들이|여행지|패션|뷰티|리빙|레시피|반려동물)/;
const ENFORCEMENT_OPERATION_PATTERNS = /(불법튜닝|안전기준 위반|단속|특별단속|점검|적발)/;
const POLITICIAN_REACTION_PATTERNS = /(질타|비판|반발|공방|공세|맹공|직격|저격|성토|비난|일갈|작심 발언|작심발언)/;
const PARTY_LEADER_PATTERNS = /(당대표|원내대표|비대위원장|대통령|총리|당정|대표 회담)/;
const BIG_POLITICAL_EVENT_PATTERNS = /(탄핵|체포동의안|구속영장|압수수색|기소|선고|대법원|헌재|본회의|법안 처리|예산안|선거|개헌|계엄|국정조사|특검|청문회)/;
const NATIONAL_PROMINENCE_PATTERNS = /(대통령|대통령실|총리|장관|국회의원|당대표|원내대표|비대위원장|대기업|재벌|대형 병원|중앙부처|국회|헌재|대법원|대검|서울중앙지검|공수처|특검|선거|탄핵|특검|국정조사|전국민|전국적|한국사회|국가적|대형 참사|대형 재난)/;
const MAJOR_CASE_PATTERNS = /(참사|대형 화재|산불|지진|붕괴|폭발|침수|대형 사고|대형 사건|연쇄|사망 \d+명|실종 \d+명|전국적 파장|재계|정치권 파장|사회적 파장)/;
const CATEGORY_FALLBACK_POLITICS_PATTERNS = /(국회|정당|대통령실|대통령|총리|장관|당대표|원내대표|비대위원장|선거|탄핵|법안|본회의|예산안|국정조사|특검|김건희|영부인|명태균|공천개입|선거법|정치자금)/;
const CATEGORY_FALLBACK_WORLD_PATTERNS = /(미국|이란|이스라엘|가자|러시아|우크라이나|중국|대만|전쟁|휴전|공습|미사일|핵|관세 전쟁|무역 분쟁|정상회담|외교 갈등|안보 위기)/;
const CATEGORY_FALLBACK_ECONOMY_PATTERNS = /(코스피|코스닥|증시|환율|금리|물가|반도체|삼성전자|SK하이닉스|부동산|관세|무역|수출|고용|기준금리|유가)/;
const MAJOR_MEDIA_PATTERNS = /(연합뉴스|연합뉴스TV|뉴시스|뉴스1|JTBC|KBS|MBC|SBS|YTN|한겨레|경향신문|조선일보|중앙일보|동아일보|한국일보|한국경제|매일경제|서울경제|머니투데이|mt\.co\.kr|이데일리|파이낸셜뉴스|BBC|Reuters|로이터|AP|CNN|블룸버그|월스트리트저널|니혼게이자이)/i;
const LOW_TRUST_SOURCE_PATTERNS = /(위기브|블로그|브런치|티스토리|카페|유튜브|인스타그램|페이스북|홍보|보도자료)/i;
const LOCAL_ELECTION_MAJOR_RACE_PATTERNS = /(서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|경기지사|강원지사|제주도지사).*(후보 확정|공천 확정|경선 확정|전략공천|단수공천|후보 선출|후보 결정|지방선거)|(?:후보 확정|공천 확정|경선 확정|전략공천|단수공천|후보 선출|후보 결정|지방선거).*(서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|경기지사|강원지사|제주도지사)|((민주당|국민의힘|개혁신당|조국혁신당|진보당).*(경기도지사|서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사).*(후보|공천|경선))/;
const RALLY_LOCATION_PATTERNS = /(광화문|시청 앞|시청광장|서울광장|여의도|국회 앞|용산|대통령실 앞|종로|중구|세종대로|한남동|서초동|강남역|서울역|도심|서울 도심)/;
const RALLY_TIME_PATTERNS = /((오전|오후)\s*\d{1,2}시(?:\s*\d{1,2}분)?|\d{1,2}:\d{2}|오늘\s*(오전|오후)\s*\d{1,2}시)/;
const RALLY_SIZE_PATTERNS = /(\d+(만|천|백)?\s*(명|여명|여\s*명)|수천\s*명|수만\s*명|수백\s*명|참가자\s*\d+)/;
const RALLY_ORGANIZER_PATTERNS = /(민주노총|한국노총|전농|전국농민회총연맹|전장연|촛불행동|보수단체|진보단체|시민단체|노조|비대위|대책위|연대회의|집회 주최 측|주최 측)/;
const POLITICS_NEWSROOM_PRIORITY_PATTERNS = /(대통령실|대통령 발언|대통령|당대표|원내대표|비대위원장|본회의|법안 처리|탄핵|특검|국정조사|청문회|압수수색|소환|출석|체포|영장|기소|선고|광역시장|도지사|후보 확정|단일화|여론조사)/;
const SOCIETY_NEWSROOM_PRIORITY_PATTERNS = /(살인|흉악범죄|강력범죄|사망|중상|실종|화재|산불|폭발|붕괴|참사|교통사고|대형사고|압수수색|체포|구속|영장|기소|선고|아동학대|성범죄|집단피해)/;
const ECONOMY_NEWSROOM_PRIORITY_PATTERNS = /(기준금리|연준|FOMC|코스피|코스닥|환율|원\/달러|물가|유가|관세|반도체|삼성전자|SK하이닉스|부동산|대기업|실적 충격|고용|수출)/;
const WORLD_NEWSROOM_PRIORITY_PATTERNS = /(미국|중국|러시아|일본|이란|이스라엘|가자|우크라이나|전쟁|휴전|공습|미사일|관세|정상회담|외교 갈등|안보 위기|핵|공급망)/;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getExternalCandidateLocationScope(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  if (SEOUL_NATIONAL_PATTERNS.test(text)) {
    return "seoul_national";
  }
  if (REGIONAL_LOCAL_PATTERNS.test(text)) {
    return "regional_local";
  }
  return "neutral";
}

function isMajorRegionalException(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  return (
    LOCAL_ELECTION_MAJOR_RACE_PATTERNS.test(text) ||
    Boolean(candidate.eventStage) ||
    /(지진|참사|대형|폭발|붕괴|침수|산불|사망|실종|중상|구속영장|영장|소환|출석|조사|압수수색|재판|선고)/.test(text)
  );
}

function getRecencyWeight(timestamp: number, nowTs: number) {
  if (!timestamp) return 0;
  const diffHours = Math.max(0, (nowTs - timestamp) / (1000 * 60 * 60));
  if (diffHours <= 2) return 44;
  if (diffHours <= 6) return 34;
  if (diffHours <= 12) return 24;
  if (diffHours <= 24) return 14;
  if (diffHours <= 48) return 6;
  return 0;
}

function getUrgencyWeight(candidate: ExternalNewsCandidate, nowTs: number) {
  const occurredAtTs = toNewsTimestamp(candidate.occurredAt);
  if (!occurredAtTs) return 0;

  const diffHours = (occurredAtTs - nowTs) / (1000 * 60 * 60);
  const absHours = Math.abs(diffHours);

  if (diffHours >= -3 && diffHours <= 6) return 68;
  if (absHours <= 12) return 42;
  if (absHours <= 24) return 20;
  return 0;
}

function getCategoryWeight(candidate: ExternalNewsCandidate) {
  if (candidate.tags.some((tag) => ["지방선거", "후보확정"].includes(tag))) {
    return 30;
  }
  if (candidate.tags.some((tag) => ["집회", "서울도심"].includes(tag))) {
    return 26;
  }
  if (candidate.tags.some((tag) => ["재난", "사건사고", "지진", "화재", "산불"].includes(tag))) {
    return 34;
  }

  switch (candidate.category) {
    case "politics":
      return 20;
    case "society":
      return 18;
    case "economy":
      return 18;
    case "world":
      return 16;
    default:
      return 0;
  }
}

function getProceduralImportance(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  let score = 0;
  const hasProminentSubject = NATIONAL_PROMINENCE_PATTERNS.test(text);
  const hasMajorCase = MAJOR_CASE_PATTERNS.test(text);
  const hasQualifyingContext = hasProminentSubject || hasMajorCase;

  if (candidate.eventStage && hasQualifyingContext) {
    score = Math.max(score, clamp(getEventStageWeight(candidate.eventStage) + 18, 0, 95));
  }
  if (PROCEDURAL_CORE_PATTERNS.test(text) && hasQualifyingContext) {
    score = Math.max(score, 72);
  }
  if (/(압수수색|구속영장|영장실질심사|기소|선고|대법원)/.test(text) && hasQualifyingContext) {
    score = Math.max(score, 84);
  }
  if (/(소환|출석|조사 중|출석 중|심문 중)/.test(text) && hasQualifyingContext) {
    score = Math.max(score, 78);
  }
  if (!hasQualifyingContext && PROCEDURAL_CORE_PATTERNS.test(text)) {
    score = Math.max(score, 18);
  }

  return clamp(score, 0, 100);
}

function getNationalImpact(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  let score = 0;

  if (LOCAL_ELECTION_MAJOR_RACE_PATTERNS.test(text)) score = Math.max(score, 74);
  if (NATIONAL_POLITICS_PATTERNS.test(text)) score = Math.max(score, 82);
  if (NATIONAL_ECONOMY_PATTERNS.test(text)) score = Math.max(score, 78);
  if (MAJOR_WORLD_PATTERNS.test(text)) score = Math.max(score, 76);
  if (MAJOR_DISASTER_PATTERNS.test(text)) score = Math.max(score, 88);
  if (SEOUL_DOWNTOWN_RALLY_PATTERNS.test(text)) score = Math.max(score, 74);
  if (getExternalCandidateLocationScope(candidate) === "seoul_national") score = Math.max(score, 68);

  return clamp(score, 0, 100);
}

function getPromotionalPenalty(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  let penalty = 0;

  if (PROMOTIONAL_PATTERNS.test(text)) penalty = Math.max(penalty, 48);
  if (INSTITUTIONAL_PROMO_PATTERNS.test(text)) penalty = Math.max(penalty, 68);
  if (POST_EVENT_SUPPORT_PATTERNS.test(text)) penalty = Math.max(penalty, 82);
  if (SOFT_FEATURE_PATTERNS.test(text)) penalty = Math.max(penalty, 56);
  if (LOW_VALUE_INFORMATION_PATTERNS.test(text)) penalty = Math.max(penalty, 72);
  if (SOFT_TREND_PATTERNS.test(text)) penalty = Math.max(penalty, 74);
  if (ENFORCEMENT_OPERATION_PATTERNS.test(text) && !PROCEDURAL_CORE_PATTERNS.test(text)) penalty = Math.max(penalty, 58);

  return clamp(penalty, 0, 100);
}

function getNewsroomCategoryPriority(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();

  switch (candidate.category) {
    case "politics":
      if (POLITICS_NEWSROOM_PRIORITY_PATTERNS.test(text)) return 92;
      return PROCEDURAL_CORE_PATTERNS.test(text) ? 74 : 24;
    case "society":
      if (SOCIETY_NEWSROOM_PRIORITY_PATTERNS.test(text)) return 94;
      return PROCEDURAL_CORE_PATTERNS.test(text) || MAJOR_DISASTER_PATTERNS.test(text) ? 78 : 20;
    case "economy":
      if (ECONOMY_NEWSROOM_PRIORITY_PATTERNS.test(text)) return 90;
      return NATIONAL_ECONOMY_PATTERNS.test(text) ? 70 : 18;
    case "world":
      if (WORLD_NEWSROOM_PRIORITY_PATTERNS.test(text)) return 88;
      return MAJOR_WORLD_PATTERNS.test(text) ? 68 : 16;
    default:
      return 0;
  }
}

function getPoliticianReactionPenalty(candidate: ExternalNewsCandidate) {
  if (candidate.category !== "politics") return 0;

  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  if (!POLITICIAN_REACTION_PATTERNS.test(text)) return 0;

  const isLeaderLevel = PARTY_LEADER_PATTERNS.test(text);
  const hasBigPoliticalEvent = BIG_POLITICAL_EVENT_PATTERNS.test(text) || getProceduralImportance(candidate) >= 82;

  if (isLeaderLevel && hasBigPoliticalEvent) return 8;
  if (isLeaderLevel) return 28;
  if (hasBigPoliticalEvent) return 44;
  return 82;
}

function getLocalOnlyPenalty(candidate: ExternalNewsCandidate) {
  const scope = getExternalCandidateLocationScope(candidate);
  if (scope === "seoul_national") return 0;
  if (scope === "neutral") return 8;
  return isMajorRegionalException(candidate) ? 38 : 88;
}

function getSourceCredibilityScore(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.sourceUrl}`.trim();
  if (LOW_TRUST_SOURCE_PATTERNS.test(text)) return -42;
  if (MAJOR_MEDIA_PATTERNS.test(text)) return 22;
  if (/news|press|journal|일보|신문|방송|경제|times|herald/i.test(text)) return 8;
  return 0;
}

function isMajorMediaCandidate(candidate: ExternalNewsCandidate) {
  const text = `${candidate.source} ${candidate.sourceUrl} ${candidate.title}`.trim();
  return MAJOR_MEDIA_PATTERNS.test(text);
}

function hasTrueHeadlineStrength(candidate: ExternalNewsCandidate) {
  const breakdown = candidate.scoreBreakdown;
  if (!breakdown) return false;

  const isMajorMedia = isMajorMediaCandidate(candidate);
  const isNationalHeadline =
    breakdown.portalHeadlineLikelihood >= 64 &&
    breakdown.frontPageLikelihood >= 60 &&
    breakdown.newsroomRelevance >= 78 &&
    breakdown.promotionalPenalty <= 24 &&
    breakdown.localOnlyPenalty <= 18;
  const isStrongProceduralHeadline =
    breakdown.proceduralImportance >= 84 &&
    breakdown.portalHeadlineLikelihood >= 60 &&
    breakdown.frontPageLikelihood >= 58 &&
    breakdown.newsroomRelevance >= 82 &&
    breakdown.promotionalPenalty <= 24;
  const isMajorDisasterHeadline =
    breakdown.nationalImpact >= 86 &&
    breakdown.portalHeadlineLikelihood >= 60 &&
    breakdown.newsroomRelevance >= 80 &&
    breakdown.promotionalPenalty <= 20 &&
    breakdown.localOnlyPenalty <= 16;

  return isMajorMedia && (isNationalHeadline || isStrongProceduralHeadline || isMajorDisasterHeadline);
}

function getLocalElectionMajorRaceBoost(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  if (!LOCAL_ELECTION_MAJOR_RACE_PATTERNS.test(text)) return 0;
  return 34;
}

function getRallyDetailCompleteness(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();
  if (!SEOUL_DOWNTOWN_RALLY_PATTERNS.test(text)) return 100;

  let score = 0;
  if (RALLY_LOCATION_PATTERNS.test(text)) score += 32;
  if (RALLY_TIME_PATTERNS.test(text)) score += 28;
  if (RALLY_SIZE_PATTERNS.test(text)) score += 20;
  if (RALLY_ORGANIZER_PATTERNS.test(text)) score += 20;

  return clamp(score, 0, 100);
}

function getPortalHeadlineLikelihood(
  candidate: ExternalNewsCandidate,
  nationalImpact: number,
  proceduralImportance: number,
  urgencyWeight: number,
  recencyWeight: number,
  promotionalPenalty: number,
  localOnlyPenalty: number,
) {
  const disasterBonus = candidate.tags.some((tag) => ["재난", "사건사고", "화재", "산불", "지진"].includes(tag)) ? 12 : 0;
  const value =
    nationalImpact * 0.45 +
    proceduralImportance * 0.4 +
    urgencyWeight * 0.35 +
    recencyWeight * 0.2 +
    disasterBonus -
    promotionalPenalty * 0.55 -
    localOnlyPenalty * 0.4;

  return clamp(Math.round(value), 0, 100);
}

function getFrontPageLikelihood(
  candidate: ExternalNewsCandidate,
  nationalImpact: number,
  proceduralImportance: number,
  promotionalPenalty: number,
  localOnlyPenalty: number,
) {
  const categoryBonus =
    candidate.category === "politics" || candidate.category === "society"
      ? 10
      : candidate.category === "economy" || candidate.category === "world"
        ? 8
        : 0;
  const value =
    nationalImpact * 0.5 +
    proceduralImportance * 0.35 +
    categoryBonus -
    promotionalPenalty * 0.45 -
    localOnlyPenalty * 0.35;

  return clamp(Math.round(value), 0, 100);
}

function getNewsroomRelevance(
  candidate: ExternalNewsCandidate,
  nationalImpact: number,
  proceduralImportance: number,
  portalHeadlineLikelihood: number,
  frontPageLikelihood: number,
  urgencyWeight: number,
  promotionalPenalty: number,
  localOnlyPenalty: number,
) {
  const categoryPriority = getNewsroomCategoryPriority(candidate);
  const value =
    categoryPriority * 0.42 +
    nationalImpact * 0.22 +
    proceduralImportance * 0.24 +
    portalHeadlineLikelihood * 0.22 +
    frontPageLikelihood * 0.2 +
    urgencyWeight * 0.1 -
    promotionalPenalty * 0.28 -
    localOnlyPenalty * 0.2;

  return clamp(Math.round(value), 0, 100);
}

function buildTrendMaps(context: ExternalNewsScoringContext, nowTs: number) {
  const categoryMap = new Map<string, number>();
  const eventStageMap = new Map<string, number>();
  const tagMap = new Map<string, number>();

  context.existingItems.forEach((record) => {
    const likesCount = Math.max(record.likes_count ?? 0, 0);
    if (likesCount <= 0) return;

    const recencyBoost = 1 + getRecencyWeight(toNewsTimestamp(record.published_at), nowTs) / 50;
    const score = likesCount * recencyBoost;

    categoryMap.set(record.category, (categoryMap.get(record.category) ?? 0) + score);
    if (record.event_stage) {
      eventStageMap.set(record.event_stage, (eventStageMap.get(record.event_stage) ?? 0) + score);
    }
    (record.tags ?? []).forEach((tag) => {
      const normalized = tag.trim().toLowerCase();
      if (!normalized) return;
      tagMap.set(normalized, (tagMap.get(normalized) ?? 0) + score);
    });
  });

  return { categoryMap, eventStageMap, tagMap };
}

function buildTrendHints(context: ExternalNewsScoringContext, nowTs: number) {
  const trendMaps = buildTrendMaps(context, nowTs);
  const topCategory = [...trendMaps.categoryMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topStage = [...trendMaps.eventStageMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topTag = [...trendMaps.tagMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return [
    topCategory ? `최근 포털 관심은 ${getNewsBriefingCategoryLabel(topCategory as HomeNewsCategory)} 계열에 조금 더 쏠립니다.` : "",
    topStage && topStage in NEWS_BRIEFING_EVENT_STAGE_LABELS
      ? `절차 단계 '${NEWS_BRIEFING_EVENT_STAGE_LABELS[topStage as keyof typeof NEWS_BRIEFING_EVENT_STAGE_LABELS]}' 관련 관심이 이어지고 있습니다.`
      : "",
    topTag ? `최근 반복 관심 태그: ${topTag}` : "",
  ].filter(Boolean);
}

function buildSelectionReason(
  portalHeadlineLikelihood: number,
  frontPageLikelihood: number,
  proceduralImportance: number,
  newsroomRelevance: number,
  promotionalPenalty: number,
  localOnlyPenalty: number,
) {
  if (proceduralImportance >= 84 && newsroomRelevance >= 80) {
    return "수사·사법 절차가 실제로 진행된 메인급 뉴스로 판단했습니다.";
  }
  if (portalHeadlineLikelihood >= 72 || frontPageLikelihood >= 70 || newsroomRelevance >= 82) {
    return "포털 메인·신문 1면·속보급 판단에 가까운 전국 단위 뉴스입니다.";
  }
  if (promotionalPenalty >= 68) {
    return "기관 홍보성·후행 지원성 성격이 강해 우선순위를 낮췄습니다.";
  }
  if (localOnlyPenalty >= 70) {
    return "전국 파급력이 약한 지역 단신으로 판단해 우선순위를 낮췄습니다.";
  }
  return "포털 메인 적합성과 공공 중요도를 함께 반영한 후보입니다.";
}

function scoreCandidate(
  candidate: ExternalNewsCandidate,
  trendMaps: ReturnType<typeof buildTrendMaps>,
  nowTs: number,
) {
  const importanceHints: string[] = [];
  const personalizationHints: string[] = [];
  const priorityWeight = getPriorityWeight(candidate.priority);
  const eventStageWeight = getEventStageWeight(candidate.eventStage);
  const urgencyWeight = getUrgencyWeight(candidate, nowTs);
  const recencyWeight = getRecencyWeight(toNewsTimestamp(candidate.publishedAt), nowTs);
  const categoryWeight = getCategoryWeight(candidate);
  const disasterWeight = candidate.tags.some((tag) => ["재난", "사건사고", "지진", "화재", "산불"].includes(tag)) ? 28 : 0;
  const localElectionBoost = getLocalElectionMajorRaceBoost(candidate);
  const proceduralImportance = getProceduralImportance(candidate);
  const nationalImpact = getNationalImpact(candidate);
  const promotionalPenalty = getPromotionalPenalty(candidate);
  const politicianReactionPenalty = getPoliticianReactionPenalty(candidate);
  const localOnlyPenalty = getLocalOnlyPenalty(candidate);
  const sourceCredibilityScore = getSourceCredibilityScore(candidate);
  const rallyDetailCompleteness = getRallyDetailCompleteness(candidate);
  const rallyVaguenessPenalty =
    SEOUL_DOWNTOWN_RALLY_PATTERNS.test(`${candidate.title} ${candidate.excerpt}`) && rallyDetailCompleteness < 70
      ? 84 - rallyDetailCompleteness
      : 0;
  const portalHeadlineLikelihood = getPortalHeadlineLikelihood(
    candidate,
    nationalImpact,
    proceduralImportance,
    urgencyWeight,
    recencyWeight,
    promotionalPenalty + politicianReactionPenalty + rallyVaguenessPenalty - sourceCredibilityScore * 0.5,
    localOnlyPenalty,
  );
  const frontPageLikelihood = getFrontPageLikelihood(
    candidate,
    nationalImpact,
    proceduralImportance,
    promotionalPenalty + politicianReactionPenalty + rallyVaguenessPenalty - sourceCredibilityScore * 0.4,
    localOnlyPenalty,
  );
  const newsroomRelevance = getNewsroomRelevance(
    candidate,
    nationalImpact,
    proceduralImportance,
    portalHeadlineLikelihood,
    frontPageLikelihood,
    urgencyWeight,
    promotionalPenalty + politicianReactionPenalty + rallyVaguenessPenalty,
    localOnlyPenalty,
  );
  const categoryTrend = trendMaps.categoryMap.get(candidate.category) ?? 0;
  const stageTrend = candidate.eventStage ? trendMaps.eventStageMap.get(candidate.eventStage) ?? 0 : 0;
  const tagTrend = candidate.tags
    .map((tag) => trendMaps.tagMap.get(tag.trim().toLowerCase()) ?? 0)
    .reduce((sum, value) => sum + value, 0);
  const personalizationBoost = Math.min(categoryTrend * 0.12 + stageTrend * 0.16 + tagTrend * 0.04, 12);

  if (proceduralImportance >= 78) {
    importanceHints.push("수사·사법 절차 진행 뉴스로 중요도 높음");
  }
  if (urgencyWeight >= 36 && candidate.occurredAt) {
    importanceHints.push("실제 시각이 임박했거나 당일 일정에 해당합니다.");
  }
  if (nationalImpact >= 78) {
    importanceHints.push("전국 파급력이 큰 사안으로 판단됩니다.");
  }
  if (newsroomRelevance >= 82) {
    importanceHints.push("편집회의 전에 우선 확인할 만한 보도국 실무형 뉴스입니다.");
  }
  if (localElectionBoost > 0) {
    importanceHints.push("지방선거 핵심 광역단체장 후보 확정 뉴스로 정치 파급력이 큽니다.");
  }
  if (SEOUL_DOWNTOWN_RALLY_PATTERNS.test(`${candidate.title} ${candidate.excerpt}`)) {
    importanceHints.push("서울 도심 집회 예정 뉴스로 사회 파급력이 큽니다.");
  }
  if (rallyVaguenessPenalty >= 24) {
    importanceHints.push("집회 기사지만 장소·시각·주최·규모 정보가 부족해 우선순위를 낮췄습니다.");
  }
  if (portalHeadlineLikelihood >= 72) {
    importanceHints.push("포털 메인 톱감으로 볼 수 있는 강한 뉴스 가치가 있습니다.");
  }
  if (frontPageLikelihood >= 68) {
    importanceHints.push("주요 신문 1면·상단급 의제가 될 가능성이 높습니다.");
  }
  if (promotionalPenalty >= 68) {
    importanceHints.push("기관 홍보성·후행 지원성 성격이 강해 감점됩니다.");
  }
  if (politicianReactionPenalty >= 60) {
    importanceHints.push("개별 정치인 반응성 기사로 판단돼 우선순위를 낮췄습니다.");
  }
  if (localOnlyPenalty >= 70) {
    importanceHints.push("전국 파급력이 약한 지역 단신 성격이라 감점됩니다.");
  }

  if (personalizationBoost >= 8) {
    personalizationHints.push("최근 사용자 관심 유형과 겹칩니다.");
  }
  if (tagTrend >= 16 && candidate.tags.length > 0) {
    personalizationHints.push("반복 관심 태그가 포함됩니다.");
  }

  const score =
    priorityWeight +
    eventStageWeight +
    urgencyWeight +
    recencyWeight +
    categoryWeight +
    disasterWeight +
    localElectionBoost +
    nationalImpact * 1 +
    proceduralImportance * 1.25 +
    portalHeadlineLikelihood * 1.55 +
    frontPageLikelihood * 1.3 +
    newsroomRelevance * 1.45 +
    sourceCredibilityScore * 1.4 +
    personalizationBoost -
    promotionalPenalty * 1.5 -
    rallyVaguenessPenalty * 1.4 -
    politicianReactionPenalty * 1.45 -
    localOnlyPenalty * 1.3;

  const selectionReason = buildSelectionReason(
    portalHeadlineLikelihood,
    frontPageLikelihood,
    proceduralImportance,
    newsroomRelevance,
    promotionalPenalty + politicianReactionPenalty,
    localOnlyPenalty,
  );

  return {
    score,
    selectionReason,
    importanceHints,
    personalizationHints,
    recommendationReason:
      [...importanceHints, ...personalizationHints].slice(0, 3).join(" · ") ||
      "포털 메인 적합성과 공공 중요도를 함께 고려한 외부 후보입니다.",
    scoreBreakdown: {
      portalHeadlineLikelihood,
      frontPageLikelihood,
      proceduralImportance,
      promotionalPenalty: promotionalPenalty + politicianReactionPenalty + rallyVaguenessPenalty,
      localOnlyPenalty,
      nationalImpact,
      newsroomRelevance,
      urgency: urgencyWeight,
      freshness: recencyWeight,
    },
  };
}

function getHeadlineThreshold(candidate: ExternalNewsCandidate) {
  const breakdown = candidate.scoreBreakdown;
  if (!breakdown) return false;

  const isStrongProcedural =
    breakdown.proceduralImportance >= 84 &&
    breakdown.portalHeadlineLikelihood >= 60 &&
    breakdown.frontPageLikelihood >= 58 &&
    breakdown.newsroomRelevance >= 82 &&
    breakdown.promotionalPenalty <= 24;
  const isStrongHeadline =
    breakdown.portalHeadlineLikelihood >= 64 &&
    breakdown.frontPageLikelihood >= 60 &&
    breakdown.newsroomRelevance >= 78 &&
    breakdown.promotionalPenalty <= 24 &&
    breakdown.localOnlyPenalty <= 20;
  const isMajorDisaster =
    breakdown.nationalImpact >= 86 &&
    breakdown.portalHeadlineLikelihood >= 60 &&
    breakdown.newsroomRelevance >= 80 &&
    breakdown.promotionalPenalty <= 20;
  const isMajorEconomicOrWorld =
    (candidate.category === "economy" || candidate.category === "world") &&
    breakdown.nationalImpact >= 80 &&
    breakdown.portalHeadlineLikelihood >= 62 &&
    breakdown.frontPageLikelihood >= 58 &&
    breakdown.newsroomRelevance >= 80 &&
    breakdown.promotionalPenalty <= 22 &&
    breakdown.localOnlyPenalty <= 18;

  return isStrongProcedural || isStrongHeadline || isMajorDisaster || isMajorEconomicOrWorld;
}

function hasCategoryFallbackContext(candidate: ExternalNewsCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`.trim();

  switch (candidate.category) {
    case "politics":
      return CATEGORY_FALLBACK_POLITICS_PATTERNS.test(text);
    case "economy":
      return CATEGORY_FALLBACK_ECONOMY_PATTERNS.test(text);
    case "world":
      return CATEGORY_FALLBACK_WORLD_PATTERNS.test(text);
    case "society":
      return true;
    default:
      return false;
  }
}

export function shouldKeepForHomeLivePreview(candidate: ExternalNewsCandidate) {
  const breakdown = candidate.scoreBreakdown;
  if (!breakdown) return false;
  if (!getHeadlineThreshold(candidate)) return false;
  if (!isMajorMediaCandidate(candidate)) return false;
  if (breakdown.promotionalPenalty >= 24) return false;
  if (breakdown.localOnlyPenalty >= 20) return false;
  if (breakdown.newsroomRelevance < 80) return false;
  return hasTrueHeadlineStrength(candidate);
}

export function shouldKeepForHomeCategoryFallback(candidate: ExternalNewsCandidate) {
  const breakdown = candidate.scoreBreakdown;
  if (!breakdown) return false;
  if (!isMajorMediaCandidate(candidate)) return false;
  if (breakdown.promotionalPenalty >= 28) return false;
  if (breakdown.localOnlyPenalty >= 24) return false;
  if (!hasCategoryFallbackContext(candidate)) return false;

  switch (candidate.category) {
    case "politics":
      return (
        breakdown.frontPageLikelihood >= 66 ||
        breakdown.portalHeadlineLikelihood >= 68 ||
        breakdown.proceduralImportance >= 80 ||
        breakdown.newsroomRelevance >= 78 ||
        candidate.tags?.some((tag) => ["지방선거", "후보확정"].includes(tag))
      );
    case "economy":
      return (
        breakdown.nationalImpact >= 78 &&
        breakdown.newsroomRelevance >= 76 &&
        (breakdown.frontPageLikelihood >= 60 || breakdown.portalHeadlineLikelihood >= 62)
      );
    case "world":
      return (
        breakdown.nationalImpact >= 78 &&
        breakdown.newsroomRelevance >= 76 &&
        (breakdown.frontPageLikelihood >= 58 || breakdown.portalHeadlineLikelihood >= 60)
      );
    case "society":
      return (
        breakdown.portalHeadlineLikelihood >= 66 ||
        breakdown.frontPageLikelihood >= 62 ||
        breakdown.proceduralImportance >= 80 ||
        breakdown.newsroomRelevance >= 78 ||
        breakdown.nationalImpact >= 78 ||
        candidate.tags?.some((tag) => ["집회", "서울도심"].includes(tag))
      );
    default:
      return false;
  }
}

export function shouldPrioritizeForHomeLivePreview(candidate: ExternalNewsCandidate) {
  const breakdown = candidate.scoreBreakdown;
  if (!breakdown) return false;
  if (!shouldKeepForHomeLivePreview(candidate)) return false;
  return (
    breakdown.portalHeadlineLikelihood >= 74 ||
    breakdown.frontPageLikelihood >= 70 ||
    breakdown.proceduralImportance >= 88 ||
    breakdown.newsroomRelevance >= 88
  );
}

export function scoreExternalNewsCandidates(
  candidates: ExternalNewsCandidate[],
  context: ExternalNewsScoringContext,
) {
  const now = context.now ?? new Date();
  const nowTs = now.getTime();
  const trendMaps = buildTrendMaps(context, nowTs);
  const trendHints = buildTrendHints(context, nowTs);

  const scoredCandidates = candidates
    .map<ExternalNewsCandidate>((candidate) => {
      const scored = scoreCandidate(candidate, trendMaps, nowTs);
      return {
        ...candidate,
        score: scored.score,
        scoreBreakdown: scored.scoreBreakdown,
        selectionReason: scored.selectionReason,
        recommendationReason: scored.recommendationReason,
        importanceHints: scored.importanceHints,
        personalizationHints: scored.personalizationHints,
      };
    })
    .sort((left, right) => right.score - left.score);

  return {
    trendHints,
    candidates: scoredCandidates,
  };
}
