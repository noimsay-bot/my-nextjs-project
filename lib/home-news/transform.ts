import {
  HomeNewsCardItem,
  HomeNewsCategory,
  HomeNewsDataset,
  HomeNewsDatasetSourceKind,
  HomeNewsTemporarySection,
  HomeNewsTickerItem,
  HOME_NEWS_CATEGORIES,
} from "@/components/home/home-news.types";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";
import {
  MAX_HOME_NEWS_ITEMS,
  selectTopHomeNewsBriefings,
  sortHomeNewsByImportance,
  toNewsTimestamp,
} from "@/lib/home-news/ranking";

export type HomeNewsBriefingSlot = "morning_6" | "afternoon_3";

export type HomeNewsEventStage =
  | "summon_requested"
  | "summon_scheduled"
  | "attending"
  | "under_questioning"
  | "warrant_review_scheduled"
  | "warrant_requested"
  | "warrant_issued"
  | "warrant_denied"
  | "investigation_update"
  | null;

export type HomeNewsBriefingRecord = {
  id: string;
  category: HomeNewsCategory;
  title: string;
  summary_lines: string[] | null;
  why_it_matters: string | null;
  check_points: string[] | null;
  priority: "high" | "medium" | "low" | null;
  published_at: string | null;
  occurred_at: string | null;
  briefing_slot: HomeNewsBriefingSlot | null;
  briefing_text: string | null;
  is_active: boolean | null;
  source_label: string | null;
  tags: string[] | null;
  event_stage: HomeNewsEventStage;
  likes_count: number | null;
  dislikes_count?: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type BuildHomeNewsDatasetOptions = {
  respectInputOrder?: boolean;
  filterInactive?: boolean;
  sourceKind?: HomeNewsDatasetSourceKind;
  issueSet?: HomeNewsDataset["issueSet"];
  runtimeBriefing?: HomeNewsDataset["runtimeBriefing"];
};

const LOCAL_ELECTION_SECTION_EXPIRES_AT = "2026-06-05T00:00:00+09:00";
const LOCAL_ELECTION_SECTION_PATTERNS = /(지방선거|광역단체장|서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|후보 확정|공천 확정|경선 확정|전략공천|단수공천|후보 선출|후보 결정)/;
const LOCAL_ELECTION_OFFICE_PATTERNS = /(서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|경기지사|강원지사|제주도지사)/;
const LOCAL_ELECTION_PARTY_PATTERNS = /(국민의힘|더불어민주당|민주당|개혁신당|조국혁신당|진보당)/;
const LOCAL_ELECTION_SELECTION_PATTERNS = /(후보\s*확정|후보\s*결정|후보\s*선출|공천\s*확정|전략\s*공천|단수\s*공천|경선\s*확정|후보\s*[가-힣]{2,4})/;

export function sortHomeNewsBriefings(left: HomeNewsBriefingRecord, right: HomeNewsBriefingRecord) {
  return sortHomeNewsByImportance(left, right);
}

function formatOccurredAtLabel(value: string | null | undefined) {
  const timestamp = toNewsTimestamp(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(timestamp))
    .replace(/\s/g, " ")
    .trim();
}

function hasTimeReference(value: string) {
  return /(오전|오후)\s*\d{1,2}시|\d{1,2}시\s*\d{0,2}분?|\d{1,2}:\d{2}/.test(value);
}

function prependOccurredAt(value: string, occurredAt: string | null | undefined) {
  const label = formatOccurredAtLabel(occurredAt);
  if (!label) return value;
  if (hasTimeReference(value)) return value;
  return `${label} ${value}`.trim();
}

function sanitizeRecord(record: HomeNewsBriefingRecord): HomeNewsBriefingRecord | null {
  if (!record.id || !record.title || !record.category || !HOME_NEWS_CATEGORIES.includes(record.category)) return null;
  return {
    ...record,
    summary_lines: Array.isArray(record.summary_lines) ? record.summary_lines.filter(Boolean) : [],
    check_points: Array.isArray(record.check_points) ? record.check_points.filter(Boolean) : [],
    why_it_matters: record.why_it_matters ?? "",
    briefing_text: record.briefing_text ?? "",
    priority: record.priority ?? "medium",
    occurred_at: record.occurred_at ?? null,
    briefing_slot: record.briefing_slot ?? "morning_6",
    is_active: record.is_active ?? true,
  };
}

function normalizeHeadlineText(value: string) {
  return value
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[“"][^”"]+[”"]/g, " ")
    .replace(/[‘'][^’']+[’']/g, " ")
    .replace(/[-|]\s*[^-|]+$/g, " ")
    .replace(/후보(?:에|로|는|가|를|도)/g, "후보 ")
    .replace(/(?:현|전)\s*(시장|지사)/g, " ")
    .replace(/[“”"'`·,.:!?()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeHeadlineKey(value: string) {
  const normalized = normalizeHeadlineText(value);

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter((token) => !["검찰", "경찰", "법원", "정부", "국회", "관련", "속보"].includes(token))
    .slice(0, 6);

  return tokens.join(" ");
}

function extractLocalElectionCandidateName(value: string) {
  const normalized = normalizeHeadlineText(value);
  const candidatePatterns = [
    /후보\s*([가-힣]{2,4})/,
    /([가-힣]{2,4})\s+(?:국민의힘|더불어민주당|민주당|개혁신당|조국혁신당|진보당)?\s*(?:서울시장|부산시장|대구시장|인천시장|광주시장|대전시장|울산시장|세종시장|경기도지사|강원도지사|충북지사|충남지사|전북지사|전남지사|경북지사|경남지사|제주지사|경기지사|강원지사|제주도지사)\s*후보/,
  ];

  for (const pattern of candidatePatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function buildLocalElectionEventKey(record: HomeNewsBriefingRecord) {
  const combinedText = [record.title, ...(record.summary_lines ?? []), ...(record.tags ?? [])].join(" ");
  if (!LOCAL_ELECTION_SECTION_PATTERNS.test(combinedText)) {
    return "";
  }

  const normalized = normalizeHeadlineText(combinedText);
  const office = normalized.match(LOCAL_ELECTION_OFFICE_PATTERNS)?.[1] ?? "";
  const party = normalized.match(LOCAL_ELECTION_PARTY_PATTERNS)?.[1] ?? "";
  const candidate = extractLocalElectionCandidateName(combinedText);

  if (!office || !candidate || !LOCAL_ELECTION_SELECTION_PATTERNS.test(normalized)) {
    return "";
  }

  return ["local-election", party, office, candidate, "candidate_selected"].filter(Boolean).join("|");
}

function dedupeHomeNewsRecords(records: HomeNewsBriefingRecord[]) {
  const seenIds = new Set<string>();
  const seenHeadlineKeys = new Set<string>();
  const seenEventKeys = new Set<string>();

  return records.filter((record) => {
    if (seenIds.has(record.id)) return false;

    const eventKey = buildLocalElectionEventKey(record);
    if (eventKey && seenEventKeys.has(eventKey)) {
      return false;
    }

    const headlineKey = normalizeHeadlineKey(record.title);
    if (headlineKey && seenHeadlineKeys.has(headlineKey)) {
      return false;
    }

    seenIds.add(record.id);
    if (eventKey) {
      seenEventKeys.add(eventKey);
    }
    if (headlineKey) {
      seenHeadlineKeys.add(headlineKey);
    }
    return true;
  });
}

function isLocalElectionSectionEnabled(now: Date) {
  return now.getTime() < new Date(LOCAL_ELECTION_SECTION_EXPIRES_AT).getTime();
}

function isLocalElectionRecord(record: HomeNewsBriefingRecord) {
  const combinedText = `${record.title} ${record.summary_lines?.join(" ") ?? ""} ${(record.tags ?? []).join(" ")}`.trim();
  return LOCAL_ELECTION_SECTION_PATTERNS.test(combinedText);
}

function buildCardSummary(item: HomeNewsBriefingRecord) {
  const firstSummaryLine = item.summary_lines?.find((line) => line.trim().length > 0)?.trim() ?? "";
  const fallback = item.briefing_text?.trim() || item.title;
  const subtitle = firstSummaryLine || fallback;
  return [prependOccurredAt(subtitle, item.occurred_at)];
}

function toCardItem(item: HomeNewsBriefingRecord): HomeNewsCardItem {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    summary: buildCardSummary(item),
    sourceLabel: item.source_label?.trim() || undefined,
    whyItMatters: item.why_it_matters?.trim() || "추가 브리핑이 들어오면 이 영역에서 중요도를 함께 설명합니다.",
    checkPoints:
      item.check_points && item.check_points.length > 0
        ? item.check_points
        : ["후속 업데이트가 들어오면 이 자리에서 오늘 확인할 포인트를 안내합니다."],
    priority: item.priority ?? undefined,
    publishedAt: item.published_at ?? undefined,
    occurredAt: item.occurred_at ?? undefined,
    tags: item.tags ?? [],
    eventStage: item.event_stage,
    likesCount: item.likes_count ?? 0,
    viewerHasLiked: false,
  };
}

export function buildHomeNewsDataset(
  records: HomeNewsBriefingRecord[],
  now = new Date(),
  options: BuildHomeNewsDatasetOptions = {},
): HomeNewsDataset {
  const respectInputOrder = options.respectInputOrder ?? false;
  const filterInactive = options.filterInactive ?? true;
  const sourceKind = options.sourceKind ?? "active_fallback";

  const sanitized = records
    .map(sanitizeRecord)
    .filter((item): item is HomeNewsBriefingRecord => Boolean(item))
    .filter((item) => (filterInactive ? item.is_active : true));

  const ordered = respectInputOrder
    ? dedupeHomeNewsRecords(sanitized)
    : dedupeHomeNewsRecords(sanitized.slice().sort(sortHomeNewsBriefings));

  if (ordered.length === 0) {
    return {
      ...emptyHomeNewsDataset,
      sourceKind,
      issueSet: options.issueSet,
      runtimeBriefing: options.runtimeBriefing,
    };
  }

  const selected = respectInputOrder
    ? ordered.slice(0, MAX_HOME_NEWS_ITEMS)
    : selectTopHomeNewsBriefings(ordered);
  if (selected.length === 0) {
    return {
      ...emptyHomeNewsDataset,
      sourceKind,
      issueSet: options.issueSet,
      runtimeBriefing: options.runtimeBriefing,
    };
  }

  const tickerItems: HomeNewsTickerItem[] = selected.map((item) => ({
    id: item.id,
    category: item.category,
    text: prependOccurredAt(item.briefing_text?.trim() || item.title, item.occurred_at),
    priority: item.priority ?? undefined,
    publishedAt: item.published_at ?? undefined,
  }));

  const cardsByCategory = Object.fromEntries(
    HOME_NEWS_CATEGORIES.map((category) => [
      category,
      ordered
        .filter((item) => item.category === category)
        .filter((item) => !(category === "politics" && isLocalElectionSectionEnabled(now) && isLocalElectionRecord(item)))
        .map<HomeNewsCardItem>(toCardItem),
    ]),
  ) as HomeNewsDataset["cardsByCategory"];

  const temporarySections: HomeNewsTemporarySection[] = isLocalElectionSectionEnabled(now)
    ? [{
        id: "local_election" as const,
        label: "지방선거",
        items: ordered.filter(isLocalElectionRecord).slice(0, MAX_HOME_NEWS_ITEMS).map(toCardItem),
      }]
    : [];

  return {
    tickerItems,
    cardsByCategory,
    temporarySections,
    sourceKind,
    issueSet: options.issueSet,
    runtimeBriefing: options.runtimeBriefing,
  };
}
