import fs from "node:fs";
import path from "node:path";
import { listFiles, markdownTable, rel, repoRoot, writeGenerated } from "./utils.mjs";

const sqlFiles = listFiles("supabase", { extensions: [".sql"] });

function collect(regex, text, file) {
  return [...text.matchAll(regex)].map((match) => ({
    name: match[1] ?? match[0],
    file: rel(file),
  }));
}

const tables = [];
const enums = [];
const policies = [];
const functions = [];
const triggers = [];
const rls = [];
const grants = [];
const revokes = [];

for (const file of sqlFiles) {
  const text = fs.readFileSync(file, "utf8");
  tables.push(...collect(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi, text, file));
  enums.push(...collect(/create\s+type\s+([a-zA-Z0-9_."]+)\s+as\s+enum/gi, text, file));
  policies.push(...collect(/create\s+policy\s+"?([^"\n]+)"?/gi, text, file));
  functions.push(...collect(/create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."]+)/gi, text, file));
  triggers.push(...collect(/create\s+trigger\s+([a-zA-Z0-9_"]+)/gi, text, file));
  rls.push(...collect(/alter\s+table\s+([a-zA-Z0-9_."]+)\s+enable\s+row\s+level\s+security/gi, text, file));
  grants.push(...collect(/grant\s+execute\s+on\s+function\s+([a-zA-Z0-9_."]+\([^;]*?\))/gi, text, file));
  revokes.push(...collect(/revoke\s+execute\s+on\s+function\s+([a-zA-Z0-9_."]+\([^;]*?\))/gi, text, file));
}

function uniqueRows(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      const key = `${item.name}:${item.file}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.name}${a.file}`.localeCompare(`${b.name}${b.file}`))
    .map((item) => [item.name, item.file]);
}

const content = [
  "## 기준",
  "",
  "- Supabase SQL 파일에서 테이블, enum, policy, function, trigger, RLS 키워드를 요약합니다.",
  "- 실제 Supabase 프로젝트 상태는 확인하지 않았습니다. SQL 파일 기준의 가시성 문서입니다.",
  "",
  "## 요약",
  "",
  `- SQL 파일: ${sqlFiles.length}`,
  `- 테이블 선언: ${tables.length}`,
  `- enum 선언: ${enums.length}`,
  `- policy 선언: ${policies.length}`,
  `- function 선언: ${functions.length}`,
  `- trigger 선언: ${triggers.length}`,
  `- RLS enable 선언: ${rls.length}`,
  `- function execute grant 선언: ${grants.length}`,
  `- function execute revoke 선언: ${revokes.length}`,
  "",
  "## Tables",
  "",
  markdownTable(["이름", "파일"], uniqueRows(tables)),
  "",
  "## Enums",
  "",
  markdownTable(["이름", "파일"], uniqueRows(enums)),
  "",
  "## RLS Enabled Tables",
  "",
  markdownTable(["테이블", "파일"], uniqueRows(rls)),
  "",
  "## Policies",
  "",
  markdownTable(["정책", "파일"], uniqueRows(policies)),
  "",
  "## Functions",
  "",
  markdownTable(["함수", "파일"], uniqueRows(functions)),
  "",
  "## Function Execute Grants",
  "",
  markdownTable(["함수", "파일"], uniqueRows(grants)),
  "",
  "## Function Execute Revokes",
  "",
  markdownTable(["함수", "파일"], uniqueRows(revokes)),
  "",
  "## Triggers",
  "",
  markdownTable(["트리거", "파일"], uniqueRows(triggers)),
].join("\n");

writeGenerated("docs/generated/supabase-map.md", "generate-supabase-map.mjs", {
  title: "Supabase Map",
  content,
});

console.log(`supabase-map: ${sqlFiles.length} sql files scanned`);
