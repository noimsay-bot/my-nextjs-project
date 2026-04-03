import { getUsers } from "@/lib/auth/storage";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";
import {
  emitTeamLeadStorageStatus,
  ContributionPersonCard,
  FinalCutPersonCard,
  getTeamLeadBestReportScoreMap,
  getContributionCards,
  getFinalCutCards,
  getTeamLeadSchedules,
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

interface TeamLeadScoreboardStore {
  broadcastAccident: Record<string, TeamLeadScoreItem[]>;
  liveSafety: Record<string, TeamLeadScoreItem[]>;
  selectedFinalCutQuarterKeys: string[];
}

interface TeamLeadStateRow {
  key: string;
  state: unknown;
}

let scoreboardCache = createEmptyScoreboardStore();
let videoReviewScoreCache = new Map<string, number>();
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

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
      }
      return;
    }

    const supabase = await getPortalSupabaseClient();
    const [{ data: stateRow, error: stateError }, nextVideoMap] = await Promise.all([
      supabase
        .from("team_lead_state")
        .select("key, state")
        .eq("key", TEAM_LEAD_SCOREBOARD_STATE_KEY)
        .maybeSingle<TeamLeadStateRow>(),
      getTeamLeadBestReportScoreMap(),
    ]);

    if (stateError) {
      const schemaError = stateError;

      if (isSupabaseSchemaMissingError(schemaError)) {
        console.warn(getSupabaseStorageErrorMessage(schemaError, "team_lead_state"));
        scoreboardCache = createEmptyScoreboardStore();
        videoReviewScoreCache = new Map();

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(TEAM_LEAD_SCOREBOARD_EVENT));
        }
        return;
      }

      throw new Error(stateError.message);
    }

    scoreboardCache = normalizeScoreboardStore(stateRow?.state);
    videoReviewScoreCache = nextVideoMap;

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

export function getOverallScoreCards() {
  const names = getEligibleUsers();
  const contributionMap = getContributionScoreMap();
  const videoReviewScoreMap = getVideoReviewScoreMap();
  const broadcastScoreMap = new Map(getBroadcastAccidentCards().map((card) => [card.name, card] as const));
  const liveScoreMap = new Map(getLiveSafetyCards().map((card) => [card.name, card] as const));
  const finalCutCards = new Map(getFinalCutCards().map((card) => [card.name, card] as const));
  const selectedQuarterKeys = getSelectedFinalCutQuarterKeys();

  return names
    .map((name) => {
      const contributionCard = contributionMap.get(name);
      const finalCutQuarterScores = getFinalCutQuarterScoreItems(finalCutCards.get(name), selectedQuarterKeys);
      const finalCutScore = roundScore(finalCutQuarterScores.reduce((sum, item) => sum + item.convertedScore, 0));
      const videoReviewScore = roundScore(videoReviewScoreMap.get(name) ?? 0);
      const contributionScore = roundScore(contributionCard?.totalScore ?? 0);
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
