import fs from "node:fs";
import path from "node:path";
import { markdownTable, rel, repoRoot, toPosix, writeGenerated } from "./utils.mjs";

const appDir = path.join(repoRoot, "app");
const routeFiles = new Set(["page.tsx", "layout.tsx", "route.ts", "loading.tsx", "error.tsx"]);
const records = [];

function routePathFromSegment(relativeDir) {
  const parts = toPosix(relativeDir)
    .split("/")
    .filter(Boolean)
    .filter((part) => !(part.startsWith("(") && part.endsWith(")")));
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

function groupFor(relativeDir) {
  const normalized = toPosix(relativeDir);
  if (normalized === "api" || normalized.startsWith("api/")) return "app/api";
  if (normalized === "(public)" || normalized.startsWith("(public)/")) return "app/(public)";
  if (normalized === "(portal)" || normalized.startsWith("(portal)/")) return "app/(portal)";
  if (normalized.startsWith("auth/")) return "app/auth";
  return "app/root";
}

function walk(current) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const hasRouteConvention = [...routeFiles].some((file) => files.has(file));
  const relativeDir = path.relative(appDir, current);

  if (hasRouteConvention) {
    records.push({
      group: groupFor(relativeDir),
      route: routePathFromSegment(relativeDir),
      segment: toPosix(relativeDir) || ".",
      page: files.has("page.tsx") ? "yes" : "",
      layout: files.has("layout.tsx") ? "yes" : "",
      routeHandler: files.has("route.ts") ? "yes" : "",
      loading: files.has("loading.tsx") ? "yes" : "",
      error: files.has("error.tsx") ? "yes" : "",
    });
  }

  for (const entry of entries) {
    if (entry.isDirectory()) walk(path.join(current, entry.name));
  }
}

if (fs.existsSync(appDir)) walk(appDir);

const byGroup = new Map();
for (const record of records) {
  if (!byGroup.has(record.group)) byGroup.set(record.group, []);
  byGroup.get(record.group).push(record);
}

const content = [
  "## 요약",
  "",
  `- 스캔 대상: \`${rel(appDir)}\``,
  `- 라우트 세그먼트 수: ${records.length}`,
  "- route group 괄호 세그먼트는 URL 경로에서 제외했습니다.",
  "",
  ...[...byGroup.entries()].flatMap(([group, groupRecords]) => [
    `## ${group}`,
    "",
    markdownTable(
      ["URL", "세그먼트", "page", "layout", "route", "loading", "error"],
      groupRecords.map((record) => [
        record.route,
        record.segment,
        record.page,
        record.layout,
        record.routeHandler,
        record.loading,
        record.error,
      ]),
    ),
    "",
  ]),
].join("\n");

writeGenerated("docs/generated/route-map.md", "generate-route-map.mjs", {
  title: "Route Map",
  content,
});

console.log(`route-map: ${records.length} route segments written`);
