import fs from "node:fs";
import { listFiles, rel } from "./utils.mjs";

const sqlFiles = listFiles("supabase", { extensions: [".sql"] });
const failures = [];
const warnings = [];
const publicAnonSelectTables = new Set([]);

const privilegeOrder = ["select", "insert", "update", "delete"];

function normalizeIdentifier(value) {
  return value.replace(/"/g, "").toLowerCase();
}

function expandPrivileges(value) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "all" || normalized === "all privileges") return new Set(privilegeOrder);
  return new Set(
    normalized
      .split(",")
      .map((item) => item.trim())
      .filter((item) => privilegeOrder.includes(item)),
  );
}

function roleList(value) {
  return value
    .split(",")
    .map((role) => normalizeIdentifier(role.trim()))
    .filter(Boolean);
}

function addFailure(file, message) {
  failures.push(`${rel(file)} ${message}`);
}

for (const file of sqlFiles) {
  const text = fs.readFileSync(file, "utf8");
  const createdTables = [
    ...new Set(
      [...text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?[\w]+"?)/gi)].map((match) =>
        normalizeIdentifier(match[1]),
      ),
    ),
  ];

  for (const table of createdTables) {
    const tablePattern = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rlsEnabled = new RegExp(
      `alter\\s+table\\s+public\\."?${tablePattern}"?\\s+enable\\s+row\\s+level\\s+security`,
      "i",
    ).test(text);
    if (!rlsEnabled) {
      addFailure(file, `public.${table}: RLS enable 문이 없습니다.`);
    }

    const requiredAuthenticated = new Set();
    for (const policyMatch of text.matchAll(/create\s+policy\s+"[^"]+"[\s\S]*?;/gi)) {
      const policy = policyMatch[0];
      const targetsTable = new RegExp(`\\bon\\s+public\\."?${tablePattern}"?\\b`, "i").test(policy);
      if (!targetsTable) continue;
      if (!/\bto\s+authenticated\b/i.test(policy)) continue;
      const operationMatch = policy.match(/\bfor\s+(select|insert|update|delete|all)\b/i);
      if (!operationMatch) continue;
      const operation = operationMatch[1].toLowerCase();
      if (operation === "all") {
        for (const privilege of privilegeOrder) requiredAuthenticated.add(privilege);
      } else {
        requiredAuthenticated.add(operation);
      }
    }

    const grantsByRole = new Map();
    const grantRegex = new RegExp(
      `grant\\s+(.+?)\\s+on\\s+(?:table\\s+)?public\\."?${tablePattern}"?\\s+to\\s+([^;]+);`,
      "gi",
    );
    for (const grantMatch of text.matchAll(grantRegex)) {
      const privileges = expandPrivileges(grantMatch[1]);
      for (const role of roleList(grantMatch[2])) {
        if (!grantsByRole.has(role)) grantsByRole.set(role, new Set());
        for (const privilege of privileges) grantsByRole.get(role).add(privilege);
      }
    }

    const serviceRoleGrants = grantsByRole.get("service_role") ?? new Set();
    if (serviceRoleGrants.size === 0) {
      addFailure(file, `public.${table}: service_role GRANT가 없습니다.`);
    }

    const authenticatedGrants = grantsByRole.get("authenticated") ?? new Set();
    for (const privilege of requiredAuthenticated) {
      if (!authenticatedGrants.has(privilege)) {
        addFailure(file, `public.${table}: authenticated ${privilege} GRANT가 RLS policy와 맞지 않습니다.`);
      }
    }

    if (requiredAuthenticated.size === 0 && authenticatedGrants.size > 0) {
      addFailure(file, `public.${table}: authenticated RLS policy 없이 authenticated GRANT가 있습니다.`);
    }

    const anonGrants = grantsByRole.get("anon") ?? new Set();
    if (anonGrants.size > 0) {
      const allowed = publicAnonSelectTables.has(table) && anonGrants.size === 1 && anonGrants.has("select");
      if (!allowed) {
        addFailure(file, `public.${table}: 공개 allowlist 없이 anon GRANT가 있습니다.`);
      }
    }
  }
}

if (warnings.length) {
  console.warn("Supabase table grant warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length) {
  console.error("Supabase table grant failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`supabase-table-grants: ${sqlFiles.length} sql files scanned`);
