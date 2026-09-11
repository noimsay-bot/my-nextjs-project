import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./utils.mjs";

// Compare real output without writing. Checkout times and unrelated edits do not
// invalidate a document, but changed/deleted inputs and manual document edits do.
const generators = [
  "generate-route-map.mjs",
  "generate-env-map.mjs",
  "generate-supabase-map.mjs",
  "generate-package-scripts.mjs",
  "quality-score.mjs",
];

for (const generator of generators) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts/harness", generator)], {
    cwd: repoRoot,
    env: { ...process.env, HARNESS_CHECK_GENERATED: "1" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.error?.message || `${generator} failed.`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log("generated-freshness: 6 generated files and managed quality notes checked by content");
