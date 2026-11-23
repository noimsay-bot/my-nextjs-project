import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import type { NextConfig } from "next";
import {
  isTeamLeadSecurityWatchedPath,
  TEAM_LEAD_SECURITY_WATCH_FILES,
  TEAM_LEAD_SECURITY_WATCH_ROOTS,
  type TeamLeadSecurityManifest,
} from "./lib/team-lead/security-alert-core";

const isDevelopment = process.env.NODE_ENV === "development";

// 총괄팀장 보안 관련 파일의 지문 목록. 서버 API가 매일 지난 배포와 비교해 바뀌면 총괄팀장에게 메일을 보낸다.
// 자세한 설명: lib/team-lead/security-alert-core.ts
function buildTeamLeadSecurityManifest(): TeamLeadSecurityManifest {
  const root = path.resolve(__dirname);
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) return;
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute)) visit(path.posix.join(relative.replace(/\\/g, "/"), name));
      return;
    }
    const normalized = relative.replace(/\\/g, "/");
    if (!isTeamLeadSecurityWatchedPath(normalized)) return;
    const content = readFileSync(absolute, "utf8").replace(/\r\n/g, "\n");
    files[normalized] = createHash("sha256").update(content).digest("hex");
  };
  for (const relative of [...TEAM_LEAD_SECURITY_WATCH_ROOTS, ...TEAM_LEAD_SECURITY_WATCH_FILES]) visit(relative);

  const sorted = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
  return {
    version: 1,
    files: sorted,
    commit: {
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
      author: process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || null,
      ref: process.env.VERCEL_GIT_COMMIT_REF || null,
    },
    builtAt: new Date().toISOString(),
  };
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: isDevelopment ? ".next-dev" : ".next",
  outputFileTracingRoot: path.resolve(__dirname),
  env: {
    TEAM_LEAD_SECURITY_MANIFEST: JSON.stringify(buildTeamLeadSecurityManifest()),
  },
};

export default nextConfig;
