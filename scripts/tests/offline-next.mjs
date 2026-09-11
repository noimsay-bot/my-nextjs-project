import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Explicit source allowlist: Next.js must never load this checkout's .env files.
const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "portal-offline-next-"));
// copyFileSync avoids a Windows Node 24 cpSync crash on Unicode workspace paths.
function copySource(source, target) {
  if (path.basename(source).startsWith(".env")) return;
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copySource(path.join(source, name), path.join(target, name));
  } else {
    fs.copyFileSync(source, target);
  }
}
for (const entry of ["app", "components", "lib", "public", "package.json", "tsconfig.json", "next.config.ts", "next-env.d.ts", "middleware.ts"]) {
  const source = path.join(root, entry);
  if (fs.existsSync(source)) copySource(source, path.join(snapshot, entry));
}
// This component lab exists only in the isolated snapshot, never in a deployment.
const lab = path.join(snapshot, "app/(public)/offline-component-lab");
fs.mkdirSync(lab, { recursive: true });
fs.copyFileSync(path.join(root, "tests/offline/fixture-page.tsx"), path.join(lab, "page.tsx"));
fs.symlinkSync(path.join(root, "node_modules"), path.join(snapshot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|HOME|USERPROFILE|TMP|TEMP|TMPDIR|WINDIR|SYSTEMROOT|COMSPEC|PATHEXT|LOCALAPPDATA|APPDATA)$/i.test(key),
));
Object.assign(env, {
  NODE_ENV: "development",
  NODE_OPTIONS: `--require="${path.join(root, "scripts/tests/offline-network.cjs").replace(/\\/g, "/")}"`,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-test-publishable-key",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3107",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/mobile-schedule-pan-zoom",
  PREVIEW_SCHEDULE_DEMO: "1",
});
const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3107"], {
  cwd: snapshot, env, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  // Only this exact newly-created temporary snapshot is eligible for cleanup.
  if (path.dirname(snapshot) === path.resolve(os.tmpdir()) && path.basename(snapshot).startsWith("portal-offline-next-")) {
    fs.rmSync(snapshot, { recursive: true, force: true, maxRetries: 3 });
  }
  process.exitCode = code ?? 0;
});
