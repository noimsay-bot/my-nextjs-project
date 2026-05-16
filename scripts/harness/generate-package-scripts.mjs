import fs from "node:fs";
import path from "node:path";
import { markdownTable, repoRoot, writeGenerated } from "./utils.mjs";

const packagePath = path.join(repoRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const scripts = pkg.scripts ?? {};

function category(name, command) {
  const text = `${name} ${command}`.toLowerCase();
  if (text.includes("build")) return "build";
  if (text.includes("lint") || text.includes("eslint")) return "lint";
  if (text.includes("typecheck") || text.includes("tsc")) return "typecheck";
  if (text.includes("test") || text.includes("playwright")) return "test";
  if (text.includes("dev") || text.includes("start")) return "dev/runtime";
  if (text.includes("harness")) return "harness";
  return "other";
}

const rows = Object.entries(scripts)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, command]) => [name, category(name, command), command]);

const content = [
  "## 기준",
  "",
  "- `package.json`의 scripts만 읽어 분류합니다.",
  "- 명령 실행 여부는 이 문서가 아니라 검증 로그에서 확인합니다.",
  "",
  "## Scripts",
  "",
  markdownTable(["스크립트", "분류", "명령"], rows),
].join("\n");

writeGenerated("docs/generated/package-scripts.md", "generate-package-scripts.mjs", {
  title: "Package Scripts",
  content,
});

console.log(`package-scripts: ${rows.length} scripts written`);
