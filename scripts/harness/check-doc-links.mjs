import fs from "node:fs";
import path from "node:path";
import { listFiles, rel, repoRoot } from "./utils.mjs";

const markdownFiles = [
  path.join(repoRoot, "AGENTS.md"),
  ...listFiles("docs", { extensions: [".md"] }),
].filter((file) => fs.existsSync(file));

const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
const failures = [];

function normalizeTarget(rawTarget) {
  return rawTarget.trim().replace(/^<|>$/g, "").split("#")[0].trim();
}

for (const file of markdownFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(linkRegex)) {
    const target = normalizeTarget(match[1]);
    if (!target) continue;
    if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;
    if (target.startsWith("/")) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      failures.push(`${rel(file)} -> ${target}`);
    }
  }
}

if (failures.length) {
  console.error("Broken documentation links:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`doc-links: ${markdownFiles.length} markdown files checked`);
