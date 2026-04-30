"use client";

import { createClient } from "@/lib/supabase/client";

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
  visited_at: string;
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

function buildMonthlyVisitRankPoints(rows: VisitRow[] | null, roleMap: Map<string, string | null>) {
  const visitCountMap = new Map<string, number>();

  (rows ?? []).forEach((row) => {
    const profileId = row.profile_id.trim();
    if (!profileId) return;
    if (LEVEL_RANK_EXCLUDED_ROLES.has(roleMap.get(profileId) ?? "")) return;
    visitCountMap.set(profileId, (visitCountMap.get(profileId) ?? 0) + 1);
  });

  return new Map(
    Array.from(visitCountMap.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([profileId], index) => [profileId, 10 - index] as const),
  );
}

export async function getMemberLevelMap(profileIds?: string[]) {
  const requestedProfileIds = new Set((profileIds ?? []).map((id) => id.trim()).filter(Boolean));

  try {
    const supabase = createClient();
    const monthStart = getCurrentMonthStartDate();
    const [{ data: restaurantRows }, { data: commentRows }, { data: visitRows }, { data: profileRows }] =
      await Promise.all([
        supabase.from("restaurants").select("author_id").returns<AuthorRow[]>(),
        supabase.from("restaurant_comments").select("author_id").returns<AuthorRow[]>(),
        supabase
          .from("page_visit_events")
          .select("profile_id, visited_at")
          .gte("visited_at", monthStart.toISOString())
          .returns<VisitRow[]>(),
        supabase.from("profiles").select("id, role").returns<ProfileRoleRow[]>(),
      ]);

    const roleMap = new Map((profileRows ?? []).map((row) => [row.id, row.role] as const));
    const restaurantPointMap = new Map<string, number>();
    const commentPointMap = new Map<string, number>();
    addAuthorPoints(restaurantPointMap, restaurantRows ?? [], RESTAURANT_CREATE_POINTS);
    addAuthorPoints(commentPointMap, commentRows ?? [], RESTAURANT_COMMENT_POINTS);
    const monthlyVisitRankPointMap = buildMonthlyVisitRankPoints(visitRows ?? [], roleMap);

    const allProfileIds = new Set([
      ...requestedProfileIds,
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

export async function getMemberLevelSnapshot(profileId: string) {
  const trimmedProfileId = profileId.trim();
  if (!trimmedProfileId) return createEmptySnapshot("");
  const levelMap = await getMemberLevelMap([trimmedProfileId]);
  return levelMap.get(trimmedProfileId) ?? createEmptySnapshot(trimmedProfileId);
}
