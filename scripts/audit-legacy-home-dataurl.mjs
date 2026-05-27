import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/s;
const BASE64_LIKE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ATTACHMENT_BASE64_KEYS = new Set(["base64", "content", "contents", "body", "payload", "file", "data"]);
const MAX_CANDIDATES_TO_PRINT = 50;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function parseArgs(argv) {
  return {
    key: readArgValue(argv, "--key"),
  };
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다. 예: NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정한 뒤 npm run audit:legacy-home-dataurl`);
  }
  return value;
}

function parseWorkspaceBody(body) {
  if (!body || typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function estimateDataUrlBytes(value) {
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return value.length;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  if (!isBase64) {
    try {
      return Buffer.byteLength(decodeURIComponent(payload), "utf8");
    } catch {
      return Buffer.byteLength(payload, "utf8");
    }
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function estimateBase64Bytes(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function isBase64LikeAttachmentField(key, value, path) {
  if (typeof value !== "string" || value.startsWith("data:") || value.length < 256) return false;
  if (!path.some((part) => part === "attachment" || part === "attachments")) return false;
  if (!ATTACHMENT_BASE64_KEYS.has(key)) return false;
  return BASE64_LIKE_PATTERN.test(value.replace(/\s+/g, ""));
}

function getByPath(root, path) {
  return path.reduce((current, part) => {
    if (!current || typeof current !== "object") return null;
    return current[part] ?? null;
  }, root);
}

function describeCandidate(workspace, path) {
  const collectionIndex = path.findIndex((part) => part === "communityPosts" || part === "notices" || part === "ddays");
  if (collectionIndex < 0) return {};
  const collection = path[collectionIndex];
  const itemIndex = Number(path[collectionIndex + 1]);
  if (!Number.isInteger(itemIndex)) return { collection };
  const item = getByPath(workspace, [collection, itemIndex]);
  if (!item || typeof item !== "object") return { collection, itemIndex };
  return {
    collection,
    itemIndex,
    id: typeof item.id === "string" ? item.id : undefined,
    title: typeof item.title === "string" ? item.title.slice(0, 80) : undefined,
    category: typeof item.category === "string" ? item.category : undefined,
  };
}

function collectFindingsFromValue(value, path, workspace, row, findings) {
  if (typeof value === "string") {
    const key = String(path.at(-1) ?? "");
    const isDataUrlField = key === "dataUrl";
    const isDataUrlString = value.startsWith("data:");
    const isAttachmentBase64 = isBase64LikeAttachmentField(key, value, path);
    if (!isDataUrlField && !isDataUrlString && !isAttachmentBase64) return;

    findings.push({
      rowKey: row.key,
      rowNoticeId: row.notice_id ?? null,
      rowTitle: row.title ?? null,
      path: path.join("."),
      dataUrlField: isDataUrlField,
      dataUrlString: isDataUrlString,
      attachmentBase64Field: isAttachmentBase64,
      estimatedBytes: isDataUrlString ? estimateDataUrlBytes(value) : estimateBase64Bytes(value.replace(/\s+/g, "")),
      ...describeCandidate(workspace, path),
    });
    return;
  }

  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFindingsFromValue(item, [...path, String(index)], workspace, row, findings));
    return;
  }

  Object.entries(value).forEach(([key, nextValue]) => {
    collectFindingsFromValue(nextValue, [...path, key], workspace, row, findings);
  });
}

function collectFindings(rows) {
  const findings = [];
  let parsedRows = 0;
  for (const row of rows) {
    const workspace = parseWorkspaceBody(row.body);
    if (!workspace) continue;
    parsedRows += 1;
    collectFindingsFromValue(workspace, [], workspace, row, findings);
  }
  return { parsedRows, findings };
}

function toMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body")
    .order("key", { ascending: true });

  if (options.key) {
    query = query.eq("key", options.key);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const { parsedRows, findings } = collectFindings(rows ?? []);
  const totalBytes = findings.reduce((sum, item) => sum + item.estimatedBytes, 0);
  const summary = {
    mode: "read-only",
    scannedRows: rows?.length ?? 0,
    parsedJsonRows: parsedRows,
    legacyDataUrlCount: findings.filter((item) => item.dataUrlString).length,
    dataUrlFieldCount: findings.filter((item) => item.dataUrlField).length,
    attachmentBase64FieldCount: findings.filter((item) => item.attachmentBase64Field).length,
    estimatedBytes: totalBytes,
    estimatedMb: toMb(totalBytes),
    printedCandidates: Math.min(findings.length, MAX_CANDIDATES_TO_PRINT),
    totalCandidates: findings.length,
  };

  console.log("[home-dataurl:audit]", JSON.stringify(summary, null, 2));
  console.log(
    "[home-dataurl:audit:candidates]",
    JSON.stringify(
      findings.slice(0, MAX_CANDIDATES_TO_PRINT).map((item) => ({
        rowKey: item.rowKey,
        rowNoticeId: item.rowNoticeId,
        rowTitle: item.rowTitle,
        path: item.path,
        collection: item.collection,
        itemIndex: item.itemIndex,
        id: item.id,
        title: item.title,
        category: item.category,
        estimatedBytes: item.estimatedBytes,
        estimatedMb: toMb(item.estimatedBytes),
        flags: {
          dataUrlField: item.dataUrlField,
          dataUrlString: item.dataUrlString,
          attachmentBase64Field: item.attachmentBase64Field,
        },
      })),
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[home-dataurl:audit:error]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
