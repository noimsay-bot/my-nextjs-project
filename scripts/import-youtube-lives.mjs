// DESK > 모바일 라이브: 채널 관리자에게 받은 영상 목록으로 오래된 구간을 채운다.
// YouTube 재생목록 API는 최근 약 2만 건(약 4개월)까지만 돌려주므로,
// 그 이전 라이브는 영상 ID/주소 목록을 받아 이 스크립트로 넣는다.
// 체크 정보(live_participation)는 건드리지 않는다.
//
//   node scripts/import-youtube-lives.mjs 목록.csv            # dry-run: 건수만 확인
//   node scripts/import-youtube-lives.mjs 목록.csv --apply    # 실제 DB에 upsert
//   node scripts/import-youtube-lives.mjs a.csv b.txt --since 2025-12-01 --until 2026-07-22 --apply
//
// 입력 파일: 텍스트/CSV(UTF-8). 한 줄에 영상 주소나 영상 ID가 들어 있으면 된다.
//   - https://www.youtube.com/watch?v=XXXXXXXXXXX, https://youtu.be/XXXXXXXXXXX, /live/XXXXXXXXXXX
//   - 유튜브 스튜디오 분석 내보내기 CSV(첫 열 '콘텐츠'가 영상 ID)
//   - 영상 ID만 한 줄에 하나씩
// 엑셀(.xlsx)은 읽지 못하므로 CSV로 저장해서 넣는다.
// 라이브가 아닌 영상(일반 업로드, 예정된 라이브)은 자동으로 제외된다.
//
// 기간: --since(기본 2025-12-01) 이상, --until(기본 오늘 다음 날) 미만. 둘 다 KST 날짜, 시작 시각 기준.
// 필요 환경변수(.env.local 또는 셸): YOUTUBE_API_KEY,
// --apply일 때는 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY도 필요하다.
// lib의 .ts를 직접 import하므로 Node 22.18 이상에서 실행한다. API 쿼터는 영상 50건당 1이다.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchYoutubeLivesByIds } from "../lib/youtube-lives/collect-core.ts";

const DEFAULT_SINCE_DATE = "2025-12-01";
const UPSERT_CHUNK_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const VALUE_FLAGS = new Set(["--since", "--until"]);
const URL_ID_PATTERN = /(?:[?&]v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/|\/video\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/g;
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

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

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

function parseArgs(argv) {
  const files = [];
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (VALUE_FLAGS.has(arg)) {
      values[arg] = argv[index + 1] ?? "";
      index += 1;
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }
  return { files, values, apply: argv.includes("--apply") };
}

function parseDateArg(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  return Date.parse(`${value}T00:00:00+09:00`);
}

function toKstDateKey(value) {
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 주소 안의 영상 ID를 우선 찾고, 주소가 없는 줄에서는 11자 ID 모양의 칸만 뽑는다. */
function extractVideoIds(text) {
  const ids = new Set();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const urlIds = [...line.matchAll(URL_ID_PATTERN)].map((match) => match[1]);
    if (urlIds.length > 0) {
      for (const id of urlIds) ids.add(id);
      continue;
    }
    for (const cell of line.split(/[,\t;]/)) {
      const value = cell.trim().replace(/^["']|["']$/g, "");
      if (BARE_ID_PATTERN.test(value)) ids.add(value);
    }
  }
  return [...ids];
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { files, values, apply } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    throw new Error("가져올 목록 파일을 지정해 주세요. 예: node scripts/import-youtube-lives.mjs 목록.csv");
  }
  const sinceDate = values["--since"] ?? DEFAULT_SINCE_DATE;
  const sinceIso = new Date(parseDateArg(sinceDate, "--since")).toISOString();
  const untilMs = values["--until"] ? parseDateArg(values["--until"], "--until") : Date.now() + DAY_MS;
  const untilIso = new Date(untilMs).toISOString();

  const candidateIds = new Set();
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`파일을 찾을 수 없습니다: ${file}`);
    const ids = extractVideoIds(readFileSync(file, "utf8"));
    console.log(`${file}: 영상 ID ${ids.length}건`);
    for (const id of ids) candidateIds.add(id);
  }
  if (candidateIds.size === 0) {
    throw new Error("파일에서 영상 ID나 주소를 찾지 못했습니다. UTF-8 텍스트/CSV인지 확인해 주세요.");
  }

  const apiKey = requireEnv("YOUTUBE_API_KEY");
  const supabase = apply
    ? createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  console.log(
    `조회 시작: 후보 ${candidateIds.size}건, 기간 ${sinceDate} ~ ${toKstDateKey(untilMs)}(미포함) KST (${apply ? "apply" : "dry-run"})`,
  );
  const lives = await fetchYoutubeLivesByIds([...candidateIds], apiKey, ({ requested, collected }) => {
    if (requested % 1000 === 0) console.log(`  ${requested}건 조회 / 라이브 ${collected}건`);
  });
  const rows = lives.filter((row) => row.started_at >= sinceIso && row.started_at < untilIso);

  console.log(`후보 ${candidateIds.size}건 중 라이브 ${lives.length}건 (라이브 아님·삭제·비공개 ${candidateIds.size - lives.length}건)`);
  console.log(`기간 안 ${rows.length}건, 기간 밖 ${lives.length - rows.length}건`);
  if (rows.length > 0) {
    console.log(`범위(KST): ${toKstDateKey(rows[0].started_at)} ~ ${toKstDateKey(rows[rows.length - 1].started_at)}`);
    const countByMonth = new Map();
    for (const row of rows) {
      const month = toKstDateKey(row.started_at).slice(0, 7);
      countByMonth.set(month, (countByMonth.get(month) ?? 0) + 1);
    }
    console.log(`월별: ${[...countByMonth].map(([month, count]) => `${month} ${count}건`).join(", ")}`);
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
