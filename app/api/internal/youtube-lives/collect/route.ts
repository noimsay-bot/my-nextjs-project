import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { collectYoutubeLives } from "@/lib/youtube-lives/collect-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 매 실행마다 최근 3일치를 다시 모아 video_id 기준으로 upsert한다.
const COLLECT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const UPSERT_CHUNK_SIZE = 200;

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const matched = /^Bearer\s+(.+)$/i.exec(header);
  return matched?.[1]?.trim() ?? "";
}

async function collectRecentYoutubeLives(apiKey: string) {
  const collected = await collectYoutubeLives({
    apiKey,
    channelId: process.env.YOUTUBE_LIVE_CHANNEL_ID,
    sinceMs: Date.now() - COLLECT_WINDOW_MS,
  });

  // 체크 정보는 live_participation에 따로 있으므로 이 upsert로 덮어쓰이지 않는다.
  const admin = createAdminClient();
  const collectedAt = new Date().toISOString();
  for (let index = 0; index < collected.rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = collected.rows
      .slice(index, index + UPSERT_CHUNK_SIZE)
      .map((row) => ({ ...row, collected_at: collectedAt }));
    const { error } = await admin.from("youtube_lives").upsert(chunk, { onConflict: "video_id" });
    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    playlistId: collected.playlistId,
    scannedCount: collected.scannedCount,
    savedCount: collected.rows.length,
    truncated: collected.truncated,
  };
}

export async function GET(request: Request) {
  const expectedToken = process.env.CRON_SECRET?.trim();
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET 서버 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  if (getBearerToken(request) !== expectedToken) {
    return NextResponse.json({ ok: false, message: "인증이 필요합니다." }, { status: 401 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "YOUTUBE_API_KEY 서버 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  try {
    const result = await collectRecentYoutubeLives(apiKey);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "유튜브 라이브 수집에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
