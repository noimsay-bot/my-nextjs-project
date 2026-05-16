import fs from "node:fs";
import path from "node:path";
import {
  codeFiles,
  isClientComponentSource,
  lineNumberForIndex,
  markdownTable,
  readTextIfExists,
  rel,
  repoRoot,
  writeGenerated,
} from "./utils.mjs";

const SERVER_ONLY_HINTS = [
  "SERVICE_ROLE",
  "OPENAI_API_KEY",
  "SMTP_",
  "EMAIL_FROM",
  "MAIL_",
  "TOKEN",
  "SECRET",
  "ASSEMBLY_EXPORT_",
  "HUB_ASSEMBLY_SYNC_TOKEN",
  "HOME_NEWS_EXTERNAL_FEEDS",
];

function classify(key) {
  if (key.startsWith("NEXT_PUBLIC_")) return "client-exposed";
  if (SERVER_ONLY_HINTS.some((hint) => key.includes(hint))) return "server-only";
  if (key === "NODE_ENV") return "runtime";
  return "server-only";
}

const envExample = readTextIfExists(".env.example");
const exampleKeys = new Set(
  envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.split("=")[0].trim()),
);

const usage = new Map();
const directEnvRegex = /process\.env\.([A-Z0-9_]+)/g;
const bracketEnvRegex = /process\.env\[['"]([A-Z0-9_]+)['"]\]/g;
const publicStringRegex = /NEXT_PUBLIC_[A-Z0-9_]+/g;

for (const file of codeFiles()) {
  const text = fs.readFileSync(file, "utf8");
  const relative = rel(file);
  const client = isClientComponentSource(text) || relative.startsWith("components/");
  const seenInFile = new Set();
  const collect = (key, index, kind) => {
    const itemKey = `${key}:${relative}:${lineNumberForIndex(text, index)}:${kind}`;
    if (seenInFile.has(itemKey)) return;
    seenInFile.add(itemKey);
    if (!usage.has(key)) usage.set(key, []);
    usage.get(key).push({
      file: relative,
      line: lineNumberForIndex(text, index),
      context: client ? "client/component" : "server/shared",
      kind,
    });
  };

  for (const match of text.matchAll(directEnvRegex)) collect(match[1], match.index ?? 0, "process.env");
  for (const match of text.matchAll(bracketEnvRegex)) collect(match[1], match.index ?? 0, "process.env[]");
  for (const match of text.matchAll(publicStringRegex)) collect(match[0], match.index ?? 0, "string");
}

for (const key of exampleKeys) {
  if (!usage.has(key)) usage.set(key, []);
}

const rows = [...usage.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, items]) => [
    key,
    classify(key),
    exampleKeys.has(key) ? "yes" : "no",
    items.length
      ? items
          .slice(0, 6)
          .map((item) => `${item.file}:${item.line} (${item.context})`)
          .join("<br>")
      : "미확인",
  ]);

const serverOnly = rows.filter((row) => row[1] === "server-only").map((row) => row[0]);
const clientExposed = rows.filter((row) => row[1] === "client-exposed").map((row) => row[0]);

const content = [
  "## 기준",
  "",
  "- 실제 `.env.local` 값은 읽지 않습니다.",
  "- `.env.example`의 키 이름과 코드의 `process.env.*` 사용처만 기록합니다.",
  "- `NEXT_PUBLIC_` 키는 브라우저 노출 가능 키로 분류합니다.",
  "- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, 토큰/SMTP/비밀성 키는 server-only로 분류합니다.",
  "",
  "## 요약",
  "",
  `- 환경 키 수: ${rows.length}`,
  `- client-exposed: ${clientExposed.length ? clientExposed.join(", ") : "없음"}`,
  `- server-only: ${serverOnly.length ? serverOnly.join(", ") : "없음"}`,
  "",
  "## Environment Map",
  "",
  markdownTable(["키", "분류", ".env.example", "확인된 사용처"], rows),
  "",
  "## 미확인/주의",
  "",
  "- `.env.local`, Vercel Project Settings의 실제 값은 확인하지 않았습니다.",
  "- 문자열로만 등장하는 키는 사용 준비 문맥일 수 있으므로 코드 확인이 필요합니다.",
].join("\n");

writeGenerated("docs/generated/env-map.md", "generate-env-map.mjs", {
  title: "Environment Map",
  content,
});

console.log(`env-map: ${rows.length} keys written`);
