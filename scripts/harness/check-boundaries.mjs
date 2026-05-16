import fs from "node:fs";
import path from "node:path";
import { codeFiles, isClientComponentSource, lineNumberForIndex, rel, repoRoot } from "./utils.mjs";

const failures = [];
const warnings = [];
const allowedClientEnv = new Set(["NODE_ENV"]);
const envRegex = /process\.env\.([A-Z0-9_]+)/g;
const bracketEnvRegex = /process\.env\[['"]([A-Z0-9_]+)['"]\]/g;

function add(list, message, file, line = 1) {
  list.push(`${rel(file)}:${line} ${message}`);
}

function scanImports(text) {
  const imports = [];
  const regex = /import\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of text.matchAll(regex)) imports.push({ specifier: match[1], index: match.index ?? 0 });
  return imports;
}

function isComponentsImport(specifier, fromFile) {
  if (specifier.startsWith("@/components")) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const relative = rel(resolved);
  return relative === "components" || relative.startsWith("components/");
}

for (const file of codeFiles()) {
  const relative = rel(file);
  const text = fs.readFileSync(file, "utf8");
  const client = isClientComponentSource(text);
  const componentPath = relative.startsWith("components/");
  const imports = scanImports(text);

  if ((componentPath || client) && text.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    add(failures, "components/client component에서 SUPABASE_SERVICE_ROLE_KEY 문자열 사용 금지", file);
  }

  if (client) {
    for (const match of text.matchAll(envRegex)) {
      const key = match[1];
      if (!key.startsWith("NEXT_PUBLIC_") && !allowedClientEnv.has(key)) {
        add(failures, `client component에서 server-only env 직접 접근 금지: ${key}`, file, lineNumberForIndex(text, match.index ?? 0));
      }
    }
    for (const match of text.matchAll(bracketEnvRegex)) {
      const key = match[1];
      if (!key.startsWith("NEXT_PUBLIC_") && !allowedClientEnv.has(key)) {
        add(failures, `client component에서 server-only env bracket 접근 금지: ${key}`, file, lineNumberForIndex(text, match.index ?? 0));
      }
    }
  }

  if (relative.startsWith("app/(public)/")) {
    for (const item of imports) {
      if (item.specifier.includes("portal-shell") || item.specifier.includes("auth-gate")) {
        add(failures, "app/(public)는 PortalShell/AuthGate를 직접 import하지 않아야 함", file, lineNumberForIndex(text, item.index));
      }
    }
  }

  if (relative.startsWith("app/api/") || relative.includes("/route.ts")) {
    for (const item of imports) {
      if (isComponentsImport(item.specifier, file)) {
        add(failures, "app/api route에서 UI component import 금지", file, lineNumberForIndex(text, item.index));
      }
    }
  }

  if (componentPath || client) {
    for (const item of imports) {
      if (
        item.specifier.includes("/lib/supabase/admin") ||
        item.specifier.includes("@/lib/server") ||
        item.specifier.includes("/lib/server")
      ) {
        add(failures, "server-only/admin 모듈이 브라우저 경로로 import될 수 있음", file, lineNumberForIndex(text, item.index));
      }
    }
  }

  if (!relative.startsWith("app/api/") && !relative.startsWith("lib/") && !relative.startsWith("scripts/")) {
    for (const item of imports) {
      if (item.specifier.includes("/lib/supabase/admin")) {
        add(warnings, "admin client import는 서버 전용 경로인지 재확인 필요", file, lineNumberForIndex(text, item.index));
      }
    }
  }
}

if (warnings.length) {
  console.warn("Boundary warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length) {
  console.error("Boundary failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`boundaries: passed with ${warnings.length} warning(s)`);
