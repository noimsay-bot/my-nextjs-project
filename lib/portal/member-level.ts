"use client";

import { createClient } from "@/lib/supabase/client";
import { getSession, subscribeToAuth } from "@/lib/auth/storage";

export interface MemberLevelSnapshot {
  profileId: string;
  level: number;
  totalPoints: number;
  restaurantPoints: number;
  commentPoints: number;
  monthlyVisitRankPoints: number;
}

interface ProfileRoleRow {
  id: string;
  role: string | null;
}

interface AuthorRow {
  author_id: string | null;
}

interface VisitRow {
  profile_id: string;
}

const RESTAURANT_CREATE_POINTS = 10;
const RESTAURANT_COMMENT_POINTS = 3;
const LEVEL_THRESHOLDS = [
  { level: 10, points: 2000 },
  { level: 9, points: 1600 },
  { level: 8, points: 800 },
  { level: 7, points: 400 },
  { level: 6, points: 200 },
  { level: 5, points: 100 },
  { level: 4, points: 60 },
  { level: 3, points: 30 },
  { level: 2, points: 10 },
];
const LEVEL_RANK_EXCLUDED_ROLES = new Set(["admin", "team_lead", "desk"]);
const RANK_CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;
type LevelMap = Map<string, MemberLevelSnapshot>;
let sessionScope = "";
let scopeGeneration = 0;
let rankCache: { month: string; expiresAt: number; points: Map<string, number> } | null = null;
let rankRequest: { month: string; promise: Promise<Map<string, number>> } | null = null;
const levelRequests = new Map<string, Promise<LevelMap>>();

function syncSessionScope() {
  const session = getSession();
  const key = session?.approved ? `${session.id}:${session.actualRole}:${session.role}` : "";
  if (key !== sessionScope) {
    sessionScope = key;
    scopeGeneration += 1;
    rankCache = null;
    rankRequest = null;
    levelRequests.clear();
  }
  return key;
}

if (typeof window !== "undefined") subscribeToAuth(syncSessionScope);

function getCurrentMonthStartDate() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getMemberLevel(totalPoints: number) {
  return LEVEL_THRESHOLDS.find((threshold) => totalPoints >= threshold.points)?.level ?? 1;
}

export function getMemberLevelProgressPercent(totalPoints: number) {
  const level = getMemberLevel(totalPoints);
  if (level >= 10) return 100;

  const currentLevelPoints = LEVEL_THRESHOLDS.find((threshold) => threshold.level === level)?.points ?? 0;
  const nextLevelPoints = LEVEL_THRESHOLDS.find((threshold) => threshold.level === level + 1)?.points ?? 10;
  const progress = (totalPoints - currentLevelPoints) / Math.max(1, nextLevelPoints - currentLevelPoints);
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
}

export function getNextMemberLevel(totalPoints: number) {
  const level = getMemberLevel(totalPoints);
  return Math.min(10, level + 1);
}

function createEmptySnapshot(profileId: string): MemberLevelSnapshot {
  return {
    profileId,
    level: 1,
    totalPoints: 0,
    restaurantPoints: 0,
    commentPoints: 0,
    monthlyVisitRankPoints: 0,
  };
}

function addAuthorPoints(target: Map<string, number>, rows: AuthorRow[] | null, points: number) {
  (rows ?? []).forEach((row) => {
    const profileId = row.author_id?.trim();
    if (!profileId) return;
    target.set(profileId, (target.get(profileId) ?? 0) + points);
  });
}

async function readPages<T>(
  query: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  consume: (rows: T[]) => void,
) {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query(offset);
    if (error) throw error;
    const rows = data ?? [];
    consume(rows);
    if (rows.length < PAGE_SIZE) return;
  }
}

async function loadMonthlyVisitRankPoints(supabase: ReturnType<typeof createClient>, month: string) {
  const roleMap = new Map<string, string | null>();
  await readPages<ProfileRoleRow>(
    (offset) => supabase.from("profiles").select("id, role").order("id").range(offset, offset + PAGE_SIZE - 1).returns<ProfileRoleRow[]>(),
    (rows) => rows.forEach((row) => roleMap.set(row.id, row.role)),
  );
  const visitCountMap = new Map<string, number>();
  await readPages<VisitRow>(
    (offset) => supabase.from("page_visit_events").select("profile_id").gte("visited_at", month)
      .order("visited_at").order("id").range(offset, offset + PAGE_SIZE - 1).returns<VisitRow[]>(),
    (rows) => rows.forEach((row) => {
      const profileId = row.profile_id.trim();
      if (!profileId || LEVEL_RANK_EXCLUDED_ROLES.has(roleMap.get(profileId) ?? "")) return;
      visitCountMap.set(profileId, (visitCountMap.get(profileId) ?? 0) + 1);
    }),
  );

  return new Map(
    Array.from(visitCountMap.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([profileId], index) => [profileId, 10 - index] as const),
  );
}

function getMonthlyVisitRankPoints(supabase: ReturnType<typeof createClient>, generation: number) {
  const month = getCurrentMonthStartDate().toISOString();
  if (rankCache?.month === month && rankCache.expiresAt > Date.now()) return Promise.resolve(rankCache.points);
  if (rankRequest?.month === month) return rankRequest.promise;
  const promise = loadMonthlyVisitRankPoints(supabase, month).then((points) => {
    if (scopeGeneration === generation) rankCache = { month, expiresAt: Date.now() + RANK_CACHE_TTL_MS, points };
    return points;
  }).finally(() => {
    if (rankRequest?.promise === promise) rankRequest = null;
  });
  rankRequest = { month, promise };
  return promise;
}

async function getAuthorPointMap(supabase: ReturnType<typeof createClient>, table: string, ids: string[], points: number) {
  if (ids.length === 1) {
    const { count, error } = await supabase.from(table).select("author_id", { count: "exact", head: true }).eq("author_id", ids[0]);
    if (error) throw error;
    return new Map([[ids[0], (count ?? 0) * points]]);
  }
  const result = new Map<string, number>();
  await readPages<AuthorRow>((offset) => {
    let query = supabase.from(table).select("author_id").order("id").range(offset, offset + PAGE_SIZE - 1);
    if (ids.length > 0) query = query.in("author_id", ids);
    return query.returns<AuthorRow[]>();
  }, (rows) => addAuthorPoints(result, rows, points));
  return result;
}

async function loadMemberLevelMap(requestedProfileIds: Set<string>, generation: number) {

  try {
    const supabase = createClient();
    const ids = Array.from(requestedProfileIds);
    const [restaurantPointMap, commentPointMap, monthlyVisitRankPointMap] =
      await Promise.all([
        getAuthorPointMap(supabase, "restaurants", ids, RESTAURANT_CREATE_POINTS),
        getAuthorPointMap(supabase, "restaurant_comments", ids, RESTAURANT_COMMENT_POINTS),
        getMonthlyVisitRankPoints(supabase, generation),
      ]);
    if (scopeGeneration !== generation) return new Map<string, MemberLevelSnapshot>();

    const allProfileIds = requestedProfileIds.size > 0 ? requestedProfileIds : new Set([
      ...restaurantPointMap.keys(),
      ...commentPointMap.keys(),
      ...monthlyVisitRankPointMap.keys(),
    ]);

    return new Map(
      Array.from(allProfileIds).map((profileId) => {
        const restaurantPoints = restaurantPointMap.get(profileId) ?? 0;
        const commentPoints = commentPointMap.get(profileId) ?? 0;
        const monthlyVisitRankPoints = monthlyVisitRankPointMap.get(profileId) ?? 0;
        const totalPoints = restaurantPoints + commentPoints + monthlyVisitRankPoints;
        return [
          profileId,
          {
            profileId,
            level: getMemberLevel(totalPoints),
            totalPoints,
            restaurantPoints,
            commentPoints,
            monthlyVisitRankPoints,
          } satisfies MemberLevelSnapshot,
        ] as const;
      }),
    );
  } catch {
    return new Map(
      Array.from(requestedProfileIds).map((profileId) => [profileId, createEmptySnapshot(profileId)] as const),
    );
  }
}

export async function getMemberLevelMap(profileIds?: string[]) {
  const requestedProfileIds = new Set((profileIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (!syncSessionScope()) return new Map<string, MemberLevelSnapshot>();
  const key = JSON.stringify(Array.from(requestedProfileIds).sort());
  let request = levelRequests.get(key);
  if (!request) {
    request = loadMemberLevelMap(requestedProfileIds, scopeGeneration).finally(() => {
      if (levelRequests.get(key) === request) levelRequests.delete(key);
    });
    levelRequests.set(key, request);
  }
  const result = await request;
  return new Map(Array.from(result, ([id, snapshot]) => [id, { ...snapshot }]));
}

export async function getMemberLevelSnapshot(profileId: string) {
  const trimmedProfileId = profileId.trim();
  if (!trimmedProfileId) return createEmptySnapshot("");
  const levelMap = await getMemberLevelMap([trimmedProfileId]);
  return levelMap.get(trimmedProfileId) ?? createEmptySnapshot(trimmedProfileId);
}
