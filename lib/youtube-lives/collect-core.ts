// YouTube Data API v3로 채널 라이브 목록을 모으는 순수 로직.
// 서버 route와 scripts/backfill-youtube-lives.mjs가 함께 쓰므로
// import 없이, Node가 그대로 실행할 수 있는 문법만 사용한다.

export const JTBC_NEWS_CHANNEL_ID = "UCsU-I-vHLiaMfV_ceaYz5rQ";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const PAGE_SIZE = 50;
// 재생목록의 게시 시각과 실제 라이브 시작 시각이 어긋날 수 있어(예약 라이브 등) 여유를 둔다.
const PUBLISHED_AT_MARGIN_MS = 4 * 24 * 60 * 60 * 1000;

export interface YoutubeLiveRow {
  video_id: string;
  title: string;
  started_at: string;
  /** 수집 시점의 조회수. 비공개면 null. */
  view_count: number | null;
}

export interface CollectYoutubeLivesOptions {
  apiKey: string;
  channelId?: string;
  /** 이 시각(ms) 이후에 시작한 라이브만 모은다. */
  sinceMs: number;
  /**
   * "uploads"면 라이브 전용 재생목록을 건너뛰고 전체 업로드 재생목록을 쓴다.
   * 라이브 전용 재생목록은 API가 최근 일부만 돌려주므로 오래된 구간 백필에 쓴다.
   */
  source?: "auto" | "uploads";
  /** 재생목록 최대 페이지 수(페이지당 50건). */
  maxPages?: number;
  onPage?: (info: { page: number; scanned: number; collected: number }) => void;
}

export interface CollectYoutubeLivesResult {
  rows: YoutubeLiveRow[];
  playlistId: string;
  scannedCount: number;
  pageCount: number;
  /** maxPages에 걸려 sinceMs까지 못 내려간 경우 true. */
  truncated: boolean;
}

class YoutubeApiError extends Error {
  status: number;
  reason: string;

  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

async function youtubeGet(path: string, params: Record<string, string>, apiKey: string) {
  const query = new URLSearchParams({ ...params, key: apiKey });
  const response = await fetch(`${API_BASE}/${path}?${query.toString()}`, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = (body?.error ?? {}) as { message?: string; errors?: Array<{ reason?: string }> };
    const reason = error.errors?.[0]?.reason ?? "";
    // API 키가 섞이지 않도록 URL은 메시지에 넣지 않는다.
    throw new YoutubeApiError(
      response.status,
      reason,
      `YouTube API ${path} 실패 (${response.status}${reason ? ` ${reason}` : ""}): ${error.message ?? "알 수 없는 오류"}`,
    );
  }
  return body ?? {};
}

function isPlaylistMissing(error: unknown) {
  return error instanceof YoutubeApiError && (error.status === 404 || error.reason === "playlistNotFound");
}

interface PlaylistPage {
  items: Array<{ videoId: string; publishedMs: number }>;
  nextPageToken: string;
}

async function fetchPlaylistPage(playlistId: string, pageToken: string, apiKey: string): Promise<PlaylistPage> {
  const params: Record<string, string> = {
    part: "contentDetails",
    playlistId,
    maxResults: String(PAGE_SIZE),
  };
  if (pageToken) params.pageToken = pageToken;
  const body = await youtubeGet("playlistItems", params, apiKey);
  const rawItems = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  const items = rawItems
    .map((item) => {
      const details = (item.contentDetails ?? {}) as { videoId?: string; videoPublishedAt?: string };
      const publishedMs = details.videoPublishedAt ? Date.parse(details.videoPublishedAt) : Number.NaN;
      return { videoId: details.videoId ?? "", publishedMs };
    })
    .filter((item) => item.videoId);
  return { items, nextPageToken: typeof body.nextPageToken === "string" ? body.nextPageToken : "" };
}

async function fetchLiveRows(videoIds: string[], sinceMs: number, apiKey: string): Promise<YoutubeLiveRow[]> {
  if (videoIds.length === 0) return [];
  const body = await youtubeGet(
    "videos",
    { part: "snippet,liveStreamingDetails,statistics", id: videoIds.join(","), maxResults: String(PAGE_SIZE) },
    apiKey,
  );
  const rawItems = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  const rows: YoutubeLiveRow[] = [];
  for (const item of rawItems) {
    const id = typeof item.id === "string" ? item.id : "";
    const snippet = (item.snippet ?? {}) as { title?: string };
    const live = (item.liveStreamingDetails ?? {}) as { actualStartTime?: string };
    // 일반 업로드와 예정된 라이브는 actualStartTime이 없으므로 제외된다.
    const startedMs = live.actualStartTime ? Date.parse(live.actualStartTime) : Number.NaN;
    if (!id || !Number.isFinite(startedMs) || startedMs < sinceMs) continue;
    const statistics = (item.statistics ?? {}) as { viewCount?: string };
    const viewCount = statistics.viewCount === undefined ? Number.NaN : Number(statistics.viewCount);
    rows.push({
      video_id: id,
      title: (snippet.title ?? "").trim(),
      started_at: new Date(startedMs).toISOString(),
      view_count: Number.isFinite(viewCount) && viewCount >= 0 ? Math.trunc(viewCount) : null,
    });
  }
  return rows;
}

/** 채널 ID(UC...)에서 라이브 전용(UULV...) / 전체 업로드(UU...) 재생목록 ID를 만든다. */
export function getChannelPlaylistIds(channelId: string) {
  const suffix = channelId.startsWith("UC") ? channelId.slice(2) : channelId;
  return { live: `UULV${suffix}`, uploads: `UU${suffix}` };
}

export async function collectYoutubeLives(options: CollectYoutubeLivesOptions): Promise<CollectYoutubeLivesResult> {
  const channelId = options.channelId?.trim() || JTBC_NEWS_CHANNEL_ID;
  const maxPages = options.maxPages ?? 10;
  const playlistIds = getChannelPlaylistIds(channelId);
  const stopBeforeMs = options.sinceMs - PUBLISHED_AT_MARGIN_MS;

  // 라이브 전용 재생목록을 먼저 쓰고, API에서 찾지 못하면 전체 업로드 재생목록으로 내려간다.
  let playlistId = options.source === "uploads" ? playlistIds.uploads : playlistIds.live;
  let page: PlaylistPage;
  try {
    page = await fetchPlaylistPage(playlistId, "", options.apiKey);
  } catch (error) {
    if (playlistId === playlistIds.uploads || !isPlaylistMissing(error)) throw error;
    playlistId = playlistIds.uploads;
    page = await fetchPlaylistPage(playlistId, "", options.apiKey);
  }

  const rowsById = new Map<string, YoutubeLiveRow>();
  let scannedCount = 0;
  let pageCount = 0;
  let truncated = false;

  for (;;) {
    pageCount += 1;
    scannedCount += page.items.length;
    const rows = await fetchLiveRows(
      page.items.map((item) => item.videoId),
      options.sinceMs,
      options.apiKey,
    );
    for (const row of rows) rowsById.set(row.video_id, row);
    options.onPage?.({ page: pageCount, scanned: scannedCount, collected: rowsById.size });

    // 재생목록은 최신순이다. 페이지 전체가 기준 시각보다 충분히 오래됐으면 멈춘다.
    const datedItems = page.items.filter((item) => Number.isFinite(item.publishedMs));
    const pageIsOld = datedItems.length > 0 && datedItems.every((item) => item.publishedMs < stopBeforeMs);
    if (pageIsOld || !page.nextPageToken) break;
    if (pageCount >= maxPages) {
      truncated = true;
      break;
    }
    page = await fetchPlaylistPage(playlistId, page.nextPageToken, options.apiKey);
  }

  const rows = [...rowsById.values()].sort((left, right) => left.started_at.localeCompare(right.started_at));
  return { rows, playlistId, scannedCount, pageCount, truncated };
}
