// DESK > 모바일 라이브 1회성 백필.
// 2025-12-01 00:00 KST부터 현재까지의 JTBC News 라이브를 youtube_lives에 upsert한다.
// 체크 정보(live_participation)는 건드리지 않는다.
//
//   node scripts/backfill-youtube-lives.mjs            # dry-run: 건수만 확인
//   node scripts/backfill-youtube-lives.mjs --apply    # 실제 DB에 upsert
//   node scripts/backfill-youtube-lives.mjs --since 2026-03-01 --apply
//
// 필요 환경변수(.env.local 또는 셸): YOUTUBE_API_KEY,
// --apply일 때는 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY도 필요하다.
// lib의 .ts를 직접 import하므로 Node 22.18 이상(타입 스트리핑 기본 지원)에서 실행한다.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { collectYoutubeLives } from "../lib/youtube-lives/collect-core.ts";

const DEFAULT_SINCE_DATE = "2025-12-01";
const UPSERT_CHUNK_SIZE = 200;
// 페이지당 50건. 1년치 라이브를 넉넉히 덮는다(API 쿼터는 페이지당 2 unit).
const MAX_PAGES = 600;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

function toKstDateKey(iso) {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const sinceDate = readArgValue(argv, "--since") ?? DEFAULT_SINCE_DATE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    throw new Error("--since는 YYYY-MM-DD 형식이어야 합니다.");
  }
  const sinceMs = Date.parse(`${sinceDate}T00:00:00+09:00`);

  const apiKey = requireEnv("YOUTUBE_API_KEY");
  const supabase = apply
    ? createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  console.log(`수집 시작: ${sinceDate} 00:00 KST ~ 현재 (${apply ? "apply" : "dry-run"})`);
  const collected = await collectYoutubeLives({
    apiKey,
    channelId: process.env.YOUTUBE_LIVE_CHANNEL_ID,
    sinceMs,
    maxPages: MAX_PAGES,
    onPage: ({ page, scanned, collected: count }) => {
      if (page % 10 === 0) console.log(`  ${page}페이지 / 확인 ${scanned}건 / 라이브 ${count}건`);
    },
  });

  const rows = collected.rows;
  console.log(`재생목록: ${collected.playlistId}`);
  console.log(`확인 ${collected.scannedCount}건 중 라이브 ${rows.length}건`);
  if (rows.length > 0) {
    console.log(`범위(KST): ${toKstDateKey(rows[0].started_at)} ~ ${toKstDateKey(rows[rows.length - 1].started_at)}`);
  }
  if (collected.truncated) {
    console.warn(`주의: 최대 페이지(${MAX_PAGES})에 걸려 ${sinceDate}까지 내려가지 못했습니다.`);
  }

  if (!supabase) {
    console.log("dry-run이라 저장하지 않았습니다. 저장하려면 --apply를 붙여 다시 실행하세요.");
    return;
  }

  const collectedAt = new Date().toISOString();
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE).map((row) => ({ ...row, collected_at: collectedAt }));
    const { error } = await supabase.from("youtube_lives").upsert(chunk, { onConflict: "video_id" });
    if (error) {
      throw new Error(`youtube_lives upsert 실패: ${error.message}`);
    }
  }
  console.log(`저장 완료: ${rows.length}건 upsert`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
