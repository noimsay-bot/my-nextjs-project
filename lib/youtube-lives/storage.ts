"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";
import type { UserRole } from "@/lib/auth/storage";
import { getKstDayRange, type LivePeriod } from "@/lib/youtube-lives/periods";

export interface YoutubeLiveItem {
  videoId: string;
  title: string;
  startedAt: string;
  /** 수집 시점의 조회수. 없으면 null. */
  viewCount: number | null;
  checked: boolean;
}

const LIVES_TABLE = "youtube_lives";
const PARTICIPATION_TABLE = "live_participation";
const PAGE_SIZE = 1000;
const SCHEMA_MESSAGE =
  "모바일 라이브 테이블 또는 조회수 컬럼이 아직 없습니다. Supabase SQL Editor에서 supabase/incremental_youtube_lives.sql, supabase/incremental_youtube_lives_view_count.sql을 실행해 주세요.";

/** DESK 메뉴 접근 권한(AuthGate의 /schedule)과 같은 기준이다. 실제 강제는 RLS가 한다. */
export function canCheckLiveParticipation(role: UserRole | null | undefined) {
  return role === "desk" || role === "team_lead";
}

function toStorageError(error: unknown, table: string) {
  if (isSupabaseSchemaMissingError(error)) {
    return new Error(SCHEMA_MESSAGE);
  }
  return new Error(getSupabaseStorageErrorMessage(error, table));
}

function hasEmbeddedRow(value: unknown) {
  // 1:1 관계라 객체로 오지만, 배열로 오는 경우도 함께 처리한다.
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** KST 하루(시작 시각 기준)의 라이브 목록을 시작 시각 순으로 돌려준다. */
export async function listYoutubeLivesByDate(dateKey: string): Promise<YoutubeLiveItem[]> {
  const { startIso, endIso } = getKstDayRange(dateKey);
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from(LIVES_TABLE)
    .select(`video_id, title, started_at, view_count, ${PARTICIPATION_TABLE}(video_id)`)
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .order("started_at", { ascending: true })
    .order("video_id", { ascending: true });

  if (error) throw toStorageError(error, LIVES_TABLE);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    videoId: String(row.video_id ?? ""),
    title: String(row.title ?? ""),
    startedAt: String(row.started_at ?? ""),
    viewCount: row.view_count === null || row.view_count === undefined ? null : Number(row.view_count),
    checked: hasEmbeddedRow(row[PARTICIPATION_TABLE]),
  }));
}

export async function setLiveParticipation(videoId: string, checked: boolean) {
  const supabase = await getPortalSupabaseClient();

  if (!checked) {
    const { error } = await supabase.from(PARTICIPATION_TABLE).delete().eq("video_id", videoId);
    if (error) throw toStorageError(error, PARTICIPATION_TABLE);
    return;
  }

  const session = await getPortalSession();
  if (!session?.id) {
    throw new Error("로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
  }
  // 다른 데스크가 먼저 체크했어도 오류 없이 지나가도록 중복은 무시한다.
  const { error } = await supabase
    .from(PARTICIPATION_TABLE)
    .upsert({ video_id: videoId, checked_by: session.id }, { onConflict: "video_id", ignoreDuplicates: true });
  if (error) throw toStorageError(error, PARTICIPATION_TABLE);
}

/** 구간 안에서 체크된 라이브의 시작 시각만 가져온다(통계용, 제목 등은 받지 않는다). */
export async function listCheckedLiveStartTimes(period: LivePeriod): Promise<string[]> {
  const supabase = await getPortalSupabaseClient();
  const startedAtList: string[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(PARTICIPATION_TABLE)
      .select(`video_id, ${LIVES_TABLE}!inner(started_at)`)
      .gte(`${LIVES_TABLE}.started_at`, period.startIso)
      .lt(`${LIVES_TABLE}.started_at`, period.endIso)
      .order("video_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw toStorageError(error, PARTICIPATION_TABLE);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const embedded = row[LIVES_TABLE];
      const live = (Array.isArray(embedded) ? embedded[0] : embedded) as { started_at?: string } | null | undefined;
      if (live?.started_at) startedAtList.push(new Date(live.started_at).toISOString());
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return startedAtList;
}
