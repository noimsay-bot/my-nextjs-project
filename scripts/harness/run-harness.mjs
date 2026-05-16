import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./utils.mjs";

const steps = [
  "scripts/harness/generate-route-map.mjs",
  "scripts/harness/generate-env-map.mjs",
  "scripts/harness/generate-supabase-map.mjs",
  "scripts/harness/generate-package-scripts.mjs",
  "scripts/harness/check-boundaries.mjs",
  "scripts/harness/quality-score.mjs",
  "scripts/harness/check-doc-links.mjs",
  "scripts/harness/check-generated-freshness.mjs",
];

for (const step of steps) {
  console.log(`\n[harness] ${step}`);
  const result = spawnSync(process.execPath, [path.join(repoRoot, step)], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\n[harness] failed: ${step}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[harness] completed");
console.log("다음 Codex 작업 전 읽을 문서:");
console.log("- AGENTS.md");
console.log("- docs/README.md");
console.log("- docs/agent-harness/review-loop.md");
console.log("- docs/architecture/boundaries.md");
console.log("- docs/generated/route-map.md");
