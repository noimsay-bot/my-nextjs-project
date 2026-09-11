import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { repoRoot } from "../scripts/harness/utils.mjs";

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

test("generated content is reproducible, read-only when checking, and independent of mtimes", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "portal-harness-test-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  copyDirectory(path.join(repoRoot, "scripts/harness"), path.join(fixture, "scripts/harness"));
  for (const dir of ["app", "supabase", "docs/exec-plans"]) fs.mkdirSync(path.join(fixture, dir), { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ scripts: { "harness:all": "node scripts/harness/run-harness.mjs" } }));
  fs.writeFileSync(path.join(fixture, "app/page.tsx"), "export default function Page() { return null; }");
  fs.writeFileSync(path.join(fixture, "docs/exec-plans/tech-debt-tracker.md"), "# Debt\n");
  const run = (script) => spawnSync(process.execPath, [path.join(fixture, "scripts/harness", script)], {
    cwd: fixture, encoding: "utf8", env: { ...process.env, HARNESS_CHECK_GENERATED: "" },
  });
  const generate = () => {
    for (const script of ["generate-route-map.mjs", "generate-env-map.mjs", "generate-supabase-map.mjs", "generate-package-scripts.mjs", "quality-score.mjs"]) {
      const result = run(script);
      assert.equal(result.status, 0, result.stderr);
    }
  };
  const docs = ["route-map", "env-map", "supabase-map", "package-scripts", "dependency-map"].map((name) => path.join(fixture, "docs/generated", `${name}.md`));
  docs.push(path.join(fixture, "docs/QUALITY_SCORE.md"), path.join(fixture, "docs/exec-plans/tech-debt-tracker.md"));
  generate();
  const before = docs.map((file) => fs.readFileSync(file, "utf8"));
  generate();
  assert.deepEqual(docs.map((file) => fs.readFileSync(file, "utf8")), before);
  for (const file of docs) fs.utimesSync(file, new Date(0), new Date(0));
  fs.utimesSync(path.join(fixture, "app/page.tsx"), new Date(), new Date());
  assert.equal(run("check-generated-freshness.mjs").status, 0);
  assert.deepEqual(docs.map((file) => fs.statSync(file).mtimeMs), docs.map(() => 0));
  fs.mkdirSync(path.join(fixture, "app/new-route"));
  fs.writeFileSync(path.join(fixture, "app/new-route/page.tsx"), "export default function Page() { return null; }");
  assert.notEqual(run("check-generated-freshness.mjs").status, 0, "new route must invalidate the route map");
  assert.deepEqual(docs.map((file) => fs.readFileSync(file, "utf8")), before, "check must never rewrite stale docs");
  generate();
  fs.rmSync(path.join(fixture, "app/new-route/page.tsx"));
  assert.notEqual(run("check-generated-freshness.mjs").status, 0, "deleted route must invalidate the route map");
  generate();
  fs.appendFileSync(docs[0], "\nmanual edit\n");
  assert.notEqual(run("check-generated-freshness.mjs").status, 0, "manual document edits must be detected");
  generate();
  for (const file of docs) fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
  assert.equal(run("check-generated-freshness.mjs").status, 0, "Windows CRLF checkout must be accepted");
});
