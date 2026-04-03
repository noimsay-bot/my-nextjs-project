import { getUsers } from "@/lib/auth/storage";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";
import {
  emitTeamLeadStorageStatus,
  FinalCutPersonCard,
  getContributionCards,
  getContributionPeriod,
  getFinalCutCards,
  getTeamLeadBestReportResultsWorkspace,
  getTeamLeadSchedules,
  TeamLeadBestReportReviewer,
  TeamLeadBestReportReviewerDetailRow,
} from "@/lib/team-lead/storage";

export const TEAM_LEAD_SCOREBOARD_EVENT = "j-team-lead-scoreboard-updated";
const TEAM_LEAD_SCOREBOARD_STATE_KEY = "scoreboard_v1";
export const TEAM_LEAD_SCORE_BASE = 20;

export type TeamLeadManualScoreCategory = "broadcastAccident" | "liveSafety";

export interface TeamLeadScoreItem {
  id: string;
  label: string;
  score: number;
}

export interface TeamLeadManualScoreCard {
  name: string;
  baseScore: number;
  manualScore: number;
  totalScore: number;
  items: TeamLeadScoreItem[];
}

export interface FinalCutQuarterGroup {
  key: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  monthKeys: string[];
}

export interface FinalCutQuarterScoreItem {
  key: string;
  label: string;
  itemCount: number;
  earnedScore: number;
  ratePercent: number;
  convertedScore: number;
}

export interface TeamLeadOverallScoreCard {
  name: string;
  totalScore: number;
  finalCutScore: number;
  videoReviewScore: number;
  contributionScore: number;
  broadcastAccidentScore: number;
  liveSafetyScore: number;
  finalCutQuarterScores: FinalCutQuarterScoreItem[];
}

export type TeamLeadSummaryQuarterKey = "12-2" | "3-5" | "6-8" | "9-11";

export interface TeamLeadQuarterSummaryScore {
  key: TeamLeadSummaryQuarterKey;
  label: string;
  score: number;
}

export interface TeamLeadWeightedQuarterSummaryRow {
  name: string;
  totalScore: number;
  convertedScore: number;
  quarterScores: TeamLeadQuarterSummaryScore[];
}

export interface TeamLeadFinalCutSummaryQuarter {
  key: TeamLeadSummaryQuarterKey;
  label: string;
  itemCount: number;
  earnedScore: number;
  ratePercent: number;
}

export interface TeamLeadFinalCutSummaryRow {
  name: string;
  totalItemCount: number;
  totalEarnedScore: number;
  overallRatePercent: number;
  convertedScore: number;
  quarterScores: TeamLeadFinalCutSummaryQuarter[];
}

interface TeamLeadScoreboardStore {
  broadcastAccident: Record<string, TeamLeadScoreItem[]>;
  liveSafety: Record<string, TeamLeadScoreItem[]>;
  selectedFinalCutQuarterKeys: string[];
}

interface TeamLeadStateRow {
  key: string;
  state: unknown;
}

const SUMMARY_QUARTERS = [
  { key: "12-2", label: "12-2월" },
  { key: "3-5", label: "3-5월" },
  { key: "6-8", label: "6-8월" },
  { key: "9-11", label: "9-11월" },
] as const satisfies ReadonlyArray<{ key: TeamLeadSummaryQuarterKey; label: string }>;

let scoreboardCache = createEmptyScoreboardStore();
let videoReviewScoreCache = new Map<string, number>();
let videoReviewReviewerCache: TeamLeadBestReportReviewer[] = [];
let videoReviewReviewerDetailCache: TeamLeadBestReportReviewerDetailRow[] = [];
let scoreboardRefreshPromise: Promise<void> | null = null;

function roundScore(score: number) {
  return Math.round(score * 10) / 10;
}

function createEmptyScoreboardStore(): TeamLeadScoreboardStore {
  return {
    broadcastAccident: {},
    liveSafety: {},
    selectedFinalCutQuarterKeys: [],
  };
}

function normalizeScoreItem(item: Partial<TeamLeadScoreItem> | undefined): TeamLeadScoreItem | null {
  if (!item) return null;
  const label = typeof item.label === "string" ? item.label.trim() : "";
  if (!label) return null;

  return {
    id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    score: roundScore(Number(item.score) || 0),
  };
}

function normalizeManualScoreStore(store: unknown) {
  if (!store || typeof store !== "object") return {} as Record<string, TeamLeadScoreItem[]>;

  return Object.fromEntries(
    Object.entries(store as Record<string, unknown>).map(([name, items]) => [
      name,
      Array.isArray(items)
        ? items
            .map((item) => normalizeScoreItem(item as Partial<TeamLeadScoreItem> | undefined))
            .filter((item): item is TeamLeadScoreItem => Boolean(item))
        : [],
    ]),
  ) as Record<string, TeamLeadScoreItem[]>;
}

function normalizeSelectedQuarterKeys(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeScoreboardStore(store: unknown): TeamLeadScoreboardStore {
  if (!store || typeof store !== "object") return createEmptyScoreboardStore();

  const record = store as Partial<TeamLeadScoreboardStore>;
  return {
    broadcastAccident: normalizeManualScoreStore(record.broadcastAccident),
    liveSafety: normalizeManualScoreStore(record.liveSafety),
    selectedFinalCutQuarterKeys: normalizeSelectedQuarterKeys(record.selectedFinalCutQuarterKeys),
  };
}

function getScoreboardStore() {
  return normalizeScoreboardStore(scoreboardCache);
}

function saveScoreboardStore(store: TeamLeadScoreboardStore) {
  const normalized = normalizeScoreboardStore(store);
  const previous = normalizeScoreboardStore(scoreboardCache);
  scoreboardCache = normalized;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
  }

  void (async () => {
    try {
      const session = await getPortalSession();
      if (!session?.approved) {
        throw new Error("승인된 로그인 세션이 필요합니다.");
      }

      const supabase = await getPortalSupabaseClient();
      const { error } = await supabase.from("team_lead_state").upsert({
        key: TEAM_LEAD_SCOREBOARD_STATE_KEY,
        state: normalized,
        updated_by: session.id,
      });

      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      emitTeamLeadStorageStatus({
        ok: false,
        message: error instanceof Error ? error.message : "종합 점수 저장에 실패했습니다. DB 기준 상태로 복구합니다.",
      });
      scoreboardCache = previous;

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
      }

      await refreshScoreboardState();
    }
  })();
}

export async function refreshScoreboardState() {
  if (scoreboardRefreshPromise) {
    return scoreboardRefreshPromise;
  }

  scoreboardRefreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      scoreboardCache = createEmptyScoreboardStore();
      videoReviewScoreCache = new Map();
      videoReviewReviewerCache = [];
      videoReviewReviewerDetailCache = [];

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
      }
      return;
    }

    const supabase = await getPortalSupabaseClient();
    const [{ data: stateRow, error: stateError }, nextVideoWorkspace] = await Promise.all([
      supabase
        .from("team_lead_state")
        .select("key, state")
        .eq("key", TEAM_LEAD_SCOREBOARD_STATE_KEY)
        .maybeSingle<TeamLeadStateRow>(),
      getTeamLeadBestReportResultsWorkspace(),
    ]);

    if (stateError) {
      const schemaError = stateError;

      if (isSupabaseSchemaMissingError(schemaError)) {
        console.warn(getSupabaseStorageErrorMessage(schemaError, "team_lead_state"));
        scoreboardCache = createEmptyScoreboardStore();
        videoReviewScoreCache = new Map();
        videoReviewReviewerCache = [];
        videoReviewReviewerDetailCache = [];

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
        }
        return;
      }

      throw new Error(stateError.message);
    }

    scoreboardCache = normalizeScoreboardStore(stateRow?.state);
    videoReviewScoreCache = new Map(
      nextVideoWorkspace.rows.map((row) => [row.authorName.trim(), roundScore(row.trimmedAverage ?? 0)] as const),
    );
    videoReviewReviewerCache = [...nextVideoWorkspace.reviewers];
    videoReviewReviewerDetailCache = [...nextVideoWorkspace.reviewerDetails];

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
    }
  })().finally(() => {
    scoreboardRefreshPromise = null;
  });

  return scoreboardRefreshPromise;
}

function getManualStoreByCategory(store: TeamLeadScoreboardStore, category: TeamLeadManualScoreCategory) {
  return category === "broadcastAccident" ? store.broadcastAccident : store.liveSafety;
}

function setManualStoreByCategory(
  store: TeamLeadScoreboardStore,
  category: TeamLeadManualScoreCategory,
  nextManualStore: Record<string, TeamLeadScoreItem[]>,
) {
  if (category === "broadcastAccident") {
    return { ...store, broadcastAccident: nextManualStore };
  }
  return { ...store, liveSafety: nextManualStore };
}

function getEligibleUsers() {
  return getUsers()
    .filter((user) => user.status === "ACTIVE")
    .filter((user) => user.role !== "team_lead" && user.role !== "desk")
    .map((user) => user.username.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "ko"));
}

export function getTeamLeadManualScoreItems(category: TeamLeadManualScoreCategory, name: string) {
  const store = getScoreboardStore();
  const manualStore = getManualStoreByCategory(store, category);
  return [...(manualStore[name.trim()] ?? [])];
}

export function updateTeamLeadManualScoreItems(
  category: TeamLeadManualScoreCategory,
  name: string,
  items: TeamLeadScoreItem[],
) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  const store = getScoreboardStore();
  const manualStore = getManualStoreByCategory(store, category);
  const nextManualStore = {
    ...manualStore,
    [trimmedName]: items
      .map((item) => normalizeScoreItem(item))
      .filter((item): item is TeamLeadScoreItem => Boolean(item)),
  };

  saveScoreboardStore(setManualStoreByCategory(store, category, nextManualStore));
}

function getManualScoreCards(category: TeamLeadManualScoreCategory) {
  const names = getEligibleUsers();
  const store = getScoreboardStore();
  const manualStore = getManualStoreByCategory(store, category);

  return names.map((name) => {
    const items = [...(manualStore[name] ?? [])];
    const manualScore = roundScore(items.reduce((sum, item) => sum + item.score, 0));

    return {
      name,
      baseScore: TEAM_LEAD_SCORE_BASE,
      manualScore,
      totalScore: roundScore(TEAM_LEAD_SCORE_BASE + manualScore),
      items,
    } satisfies TeamLeadManualScoreCard;
  });
}

export function getBroadcastAccidentCards() {
  return getManualScoreCards("broadcastAccident");
}

export function getLiveSafetyCards() {
  return getManualScoreCards("liveSafety");
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function getQuarterMeta(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);

  if (month === 12) {
    return { year: year + 1, quarter: 1 as const };
  }
  if (month >= 1 && month <= 2) {
    return { year, quarter: 1 as const };
  }
  if (month >= 3 && month <= 5) {
    return { year, quarter: 2 as const };
  }
  if (month >= 6 && month <= 8) {
    return { year, quarter: 3 as const };
  }
  return { year, quarter: 4 as const };
}

export function getQuarterKey(monthKey: string) {
  const meta = getQuarterMeta(monthKey);
  return `${meta.year}-Q${meta.quarter}`;
}

export function getFinalCutQuarterGroups() {
  const monthKeys = getTeamLeadSchedules().map((schedule) => schedule.monthKey);
  const quarterMap = new Map<string, FinalCutQuarterGroup>();

  monthKeys.forEach((monthKey) => {
    const meta = getQuarterMeta(monthKey);
    const key = getQuarterKey(monthKey);
    const current = quarterMap.get(key);

    if (current) {
      current.monthKeys.push(monthKey);
      return;
    }

    quarterMap.set(key, {
      key,
      year: meta.year,
      quarter: meta.quarter,
      monthKeys: [monthKey],
    });
  });

  return Array.from(quarterMap.values())
    .map((group) => ({
      ...group,
      monthKeys: [...group.monthKeys].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.year - right.year || left.quarter - right.quarter);
}

export function formatFinalCutQuarterLabel(group: FinalCutQuarterGroup) {
  return `${group.year}년 ${group.quarter}분기`;
}

export function getSelectedFinalCutQuarterKeys() {
  return [...getScoreboardStore().selectedFinalCutQuarterKeys];
}

export function addSelectedFinalCutQuarter(quarterKey: string) {
  const trimmedKey = quarterKey.trim();
  if (!trimmedKey) return;

  const store = getScoreboardStore();
  if (store.selectedFinalCutQuarterKeys.includes(trimmedKey)) return;

  saveScoreboardStore({
    ...store,
    selectedFinalCutQuarterKeys: [...store.selectedFinalCutQuarterKeys, trimmedKey],
  });
}

export function removeSelectedFinalCutQuarter(quarterKey: string) {
  const trimmedKey = quarterKey.trim();
  if (!trimmedKey) return;

  const store = getScoreboardStore();
  saveScoreboardStore({
    ...store,
    selectedFinalCutQuarterKeys: store.selectedFinalCutQuarterKeys.filter((item) => item !== trimmedKey),
  });
}

function getDecisionWeight(decision: FinalCutPersonCard["items"][number]["decision"]) {
  if (decision === "circle") return 1;
  if (decision === "triangle") return 0.5;
  return 0;
}

function getFinalCutQuarterScoreItems(card: FinalCutPersonCard | undefined, selectedQuarterKeys: string[]) {
  const quarterGroups = new Map(getFinalCutQuarterGroups().map((group) => [group.key, group] as const));

  return selectedQuarterKeys.map((quarterKey) => {
    const group = quarterGroups.get(quarterKey);
    const quarterItems = (card?.items ?? []).filter((item) => getQuarterKey(item.dateKey.slice(0, 7)) === quarterKey);
    const itemCount = quarterItems.length;
    const earnedScore = roundScore(quarterItems.reduce((sum, item) => sum + getDecisionWeight(item.decision), 0));
    const ratePercent = itemCount > 0 ? roundScore((earnedScore / itemCount) * 100) : 0;
    const convertedScore = itemCount > 0 ? roundScore((earnedScore / itemCount) * 10) : 0;

    return {
      key: quarterKey,
      label: group ? formatFinalCutQuarterLabel(group) : quarterKey,
      itemCount,
      earnedScore,
      ratePercent,
      convertedScore,
    } satisfies FinalCutQuarterScoreItem;
  });
}

function getContributionScoreMap() {
  return new Map(getContributionCards().map((card) => [card.name.trim(), card] as const));
}

function getVideoReviewScoreMap() {
  return new Map(videoReviewScoreCache);
}

function isMonthKeyInContributionPeriod(monthKey: string, startMonthKey: string, endMonthKey: string) {
  return monthKey >= startMonthKey && monthKey <= endMonthKey;
}

function getSummaryQuarterKey(monthKey: string): TeamLeadSummaryQuarterKey {
  const { month } = parseMonthKey(monthKey);
  if (month === 12 || month <= 2) return "12-2";
  if (month >= 3 && month <= 5) return "3-5";
  if (month >= 6 && month <= 8) return "6-8";
  return "9-11";
}

function getSummaryQuarterKeyInCurrentPeriod(monthKey: string) {
  const period = getContributionPeriod();
  if (!isMonthKeyInContributionPeriod(monthKey, period.startMonthKey, period.endMonthKey)) {
    return null;
  }
  return getSummaryQuarterKey(monthKey);
}

function getTrimmedQuarterAverage(scores: number[]) {
  if (scores.length < 3) return 0;
  const sorted = [...scores].sort((left, right) => left - right);
  const middleScores = sorted.slice(1, -1);
  if (middleScores.length === 0) return 0;
  return roundScore(middleScores.reduce((sum, score) => sum + score, 0) / middleScores.length);
}

export function getVideoReviewSummaryRows() {
  const eligibleNames = getEligibleUsers();
  const authorQuarterReviewerScores = new Map<string, Map<TeamLeadSummaryQuarterKey, Map<string, number>>>();

  videoReviewReviewerDetailCache.forEach((detail) => {
    const authorName = detail.authorName.trim();
    if (!authorName) return;

    detail.reports.forEach((report) => {
      const monthKey = report.completedAt.slice(0, 7);
      const quarterKey = getSummaryQuarterKeyInCurrentPeriod(monthKey);
      if (!quarterKey) return;

      const quarterMap = authorQuarterReviewerScores.get(authorName) ?? new Map<TeamLeadSummaryQuarterKey, Map<string, number>>();
      const reviewerMap = quarterMap.get(quarterKey) ?? new Map<string, number>();
      reviewerMap.set(detail.reviewerId, Math.max(reviewerMap.get(detail.reviewerId) ?? 0, roundScore(report.score)));
      quarterMap.set(quarterKey, reviewerMap);
      authorQuarterReviewerScores.set(authorName, quarterMap);
    });
  });

  return eligibleNames
    .map((name) => {
      const reviewerQuarterMap = authorQuarterReviewerScores.get(name) ?? new Map();
      const quarterScores = SUMMARY_QUARTERS.map((quarter) => {
        const reviewerMap = reviewerQuarterMap.get(quarter.key) ?? new Map<string, number>();
        const scores = videoReviewReviewerCache
          .map((reviewer) => reviewerMap.get(reviewer.id))
          .filter((score): score is number => Number.isFinite(score));

        return {
          key: quarter.key,
          label: quarter.label,
          score: getTrimmedQuarterAverage(scores),
        } satisfies TeamLeadQuarterSummaryScore;
      });
      const totalScore = roundScore(quarterScores.reduce((sum, item) => sum + item.score, 0));

      return {
        name,
        totalScore,
        convertedScore: roundScore(totalScore * 0.2),
        quarterScores,
      } satisfies TeamLeadWeightedQuarterSummaryRow;
    })
    .sort(
      (left, right) =>
        right.convertedScore - left.convertedScore ||
        right.totalScore - left.totalScore ||
        left.name.localeCompare(right.name, "ko"),
    );
}

export function getContributionSummaryRows() {
  const contributionCards = new Map(getContributionCards().map((card) => [card.name.trim(), card] as const));
  const rows = getEligibleUsers()
    .map((name) => {
      const card = contributionCards.get(name);
      const quarterScoreMap = new Map<TeamLeadSummaryQuarterKey, number>();

      (card?.items ?? []).forEach((item) => {
        const quarterKey = getSummaryQuarterKeyInCurrentPeriod(item.monthKey);
        if (!quarterKey) return;
        quarterScoreMap.set(quarterKey, roundScore((quarterScoreMap.get(quarterKey) ?? 0) + item.totalScore));
      });

      const quarterScores = SUMMARY_QUARTERS.map((quarter) => ({
        key: quarter.key,
        label: quarter.label,
        score: roundScore(quarterScoreMap.get(quarter.key) ?? 0),
      })) satisfies TeamLeadQuarterSummaryScore[];
      const totalScore = roundScore(quarterScores.reduce((sum, item) => sum + item.score, 0));

      return {
        name,
        totalScore,
        convertedScore: 0,
        quarterScores,
      } satisfies TeamLeadWeightedQuarterSummaryRow;
    });

  const maxTotalScore = Math.max(...rows.map((row) => row.totalScore), 0);

  return rows
    .map((row) => ({
      ...row,
      convertedScore: maxTotalScore > 0 ? roundScore((row.totalScore / maxTotalScore) * 30) : 0,
    }))
    .sort(
      (left, right) =>
        right.convertedScore - left.convertedScore ||
        right.totalScore - left.totalScore ||
        left.name.localeCompare(right.name, "ko"),
    );
}

export function getFinalCutSummaryRows() {
  const finalCutCards = new Map(getFinalCutCards().map((card) => [card.name.trim(), card] as const));

  return getEligibleUsers()
    .map((name) => {
      const card = finalCutCards.get(name);
      const quarterItemsMap = new Map<TeamLeadSummaryQuarterKey, FinalCutPersonCard["items"]>();

      (card?.items ?? []).forEach((item) => {
        const quarterKey = getSummaryQuarterKeyInCurrentPeriod(item.dateKey.slice(0, 7));
        if (!quarterKey) return;
        const current = quarterItemsMap.get(quarterKey) ?? [];
        current.push(item);
        quarterItemsMap.set(quarterKey, current);
      });

      const quarterScores = SUMMARY_QUARTERS.map((quarter) => {
        const items = quarterItemsMap.get(quarter.key) ?? [];
        const itemCount = items.length;
        const earnedScore = roundScore(items.reduce((sum, item) => sum + getDecisionWeight(item.decision), 0));
        const ratePercent = itemCount > 0 ? roundScore((earnedScore / itemCount) * 100) : 0;

        return {
          key: quarter.key,
          label: quarter.label,
          itemCount,
          earnedScore,
          ratePercent,
        } satisfies TeamLeadFinalCutSummaryQuarter;
      });

      const totalItemCount = quarterScores.reduce((sum, item) => sum + item.itemCount, 0);
      const totalEarnedScore = roundScore(quarterScores.reduce((sum, item) => sum + item.earnedScore, 0));
      const overallRatePercent = totalItemCount > 0 ? roundScore((totalEarnedScore / totalItemCount) * 100) : 0;

      return {
        name,
        totalItemCount,
        totalEarnedScore,
        overallRatePercent,
        convertedScore: totalItemCount > 0 ? roundScore((totalEarnedScore / totalItemCount) * 10) : 0,
        quarterScores,
      } satisfies TeamLeadFinalCutSummaryRow;
    })
    .sort(
      (left, right) =>
        right.convertedScore - left.convertedScore ||
        right.overallRatePercent - left.overallRatePercent ||
        left.name.localeCompare(right.name, "ko"),
    );
}

export function getOverallScoreCards() {
  const names = getEligibleUsers();
  const contributionSummaryRows = new Map(getContributionSummaryRows().map((row) => [row.name, row] as const));
  const videoReviewScoreMap = getVideoReviewScoreMap();
  const broadcastScoreMap = new Map(getBroadcastAccidentCards().map((card) => [card.name, card] as const));
  const liveScoreMap = new Map(getLiveSafetyCards().map((card) => [card.name, card] as const));
  const finalCutCards = new Map(getFinalCutCards().map((card) => [card.name, card] as const));
  const selectedQuarterKeys = getSelectedFinalCutQuarterKeys();

  return names
    .map((name) => {
      const contributionSummaryRow = contributionSummaryRows.get(name);
      const finalCutQuarterScores = getFinalCutQuarterScoreItems(finalCutCards.get(name), selectedQuarterKeys);
      const finalCutScore = roundScore(finalCutQuarterScores.reduce((sum, item) => sum + item.convertedScore, 0));
      const videoReviewScore = roundScore(videoReviewScoreMap.get(name) ?? 0);
      const contributionScore = roundScore(contributionSummaryRow?.convertedScore ?? 0);
      const broadcastAccidentScore = roundScore(broadcastScoreMap.get(name)?.totalScore ?? TEAM_LEAD_SCORE_BASE);
      const liveSafetyScore = roundScore(liveScoreMap.get(name)?.totalScore ?? TEAM_LEAD_SCORE_BASE);

      return {
        name,
        totalScore: roundScore(
          finalCutScore + videoReviewScore + contributionScore + broadcastAccidentScore + liveSafetyScore,
        ),
        finalCutScore,
        videoReviewScore,
        contributionScore,
        broadcastAccidentScore,
        liveSafetyScore,
        finalCutQuarterScores,
      } satisfies TeamLeadOverallScoreCard;
    })
    .sort((left, right) => right.totalScore - left.totalScore || left.name.localeCompare(right.name, "ko"));
}
