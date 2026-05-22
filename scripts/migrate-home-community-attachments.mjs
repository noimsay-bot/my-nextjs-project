import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const HOME_COMMUNITY_ATTACHMENT_BUCKET = "home-community-attachments";
const DOWNLOAD_URL_PREFIX = "/api/home/public-workspace?attachmentPostId=";
const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/s;

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
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    key: readArgValue(argv, "--key"),
  };
}

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

function parseDataUrl(dataUrl) {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1]?.trim() || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  try {
    return {
      mimeType,
      bytes: isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8"),
    };
  } catch {
    return null;
  }
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function getSafeFileName(fileName) {
  const normalized = String(fileName || "attachment")
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\w.\-가-힣 ]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return normalized || "attachment";
}

function getStoragePath(post, attachment) {
  const ownerId = isUuidLike(post.authorId) ? post.authorId : "legacy";
  return `community/${ownerId}/${post.id}-${randomUUID()}-${getSafeFileName(attachment.fileName)}`;
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

function collectLegacyAttachments(rows) {
  const items = [];
  for (const row of rows) {
    const workspace = parseWorkspaceBody(row.body);
    if (!workspace || !Array.isArray(workspace.communityPosts)) continue;
    workspace.communityPosts.forEach((post, postIndex) => {
      const attachment = post?.attachment;
      const dataUrl = typeof attachment?.dataUrl === "string" ? attachment.dataUrl : "";
      if (!post?.id || !attachment || !dataUrl.startsWith("data:") || attachment.storagePath) return;
      const parsed = parseDataUrl(dataUrl);
      items.push({
        row,
        workspace,
        post,
        postIndex,
        attachment,
        parsed,
      });
    });
  }
  return items;
}

async function ensureBucket(supabase) {
  const { error } = await supabase.storage.createBucket(HOME_COMMUNITY_ATTACHMENT_BUCKET, {
    public: false,
    fileSizeLimit: 6 * 1024 * 1024,
  });
  if (error && !/already exists|duplicate|exists/i.test(error.message)) {
    throw error;
  }
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
    .select("key, body")
    .order("key", { ascending: true });

  if (options.key) {
    query = query.eq("key", options.key);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const targets = collectLegacyAttachments(rows ?? []);
  const invalidCount = targets.filter((target) => !target.parsed).length;
  const validTargets = targets.filter((target) => target.parsed);
  const totalBytes = validTargets.reduce((sum, target) => sum + target.parsed.bytes.byteLength, 0);

  console.log("[home-community-attachments:migrate]", {
    mode: options.apply ? "apply" : "dry-run",
    scannedRows: rows?.length ?? 0,
    legacyAttachments: targets.length,
    migratableAttachments: validTargets.length,
    invalidAttachments: invalidCount,
    approximateBytes: totalBytes,
  });

  if (!options.apply || validTargets.length === 0) {
    if (!options.apply) {
      console.log("dry-run only: 실제 이전은 --apply를 붙여 실행하세요.");
    }
    return;
  }

  await ensureBucket(supabase);

  const changedRows = new Map();
  const uploadedPaths = [];
  try {
    for (const target of validTargets) {
      const storagePath = getStoragePath(target.post, target.attachment);
      const { error: uploadError } = await supabase.storage
        .from(HOME_COMMUNITY_ATTACHMENT_BUCKET)
        .upload(storagePath, target.parsed.bytes, {
          contentType: target.parsed.mimeType,
          upsert: false,
        });

      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);

      const nextAttachment = {
        fileName: target.attachment.fileName,
        mimeType: target.parsed.mimeType,
        sizeBytes: target.attachment.sizeBytes ?? target.parsed.bytes.byteLength,
        storagePath,
        downloadUrl: `${DOWNLOAD_URL_PREFIX}${encodeURIComponent(target.post.id)}`,
        createdAt: target.attachment.createdAt ?? new Date().toISOString(),
      };

      target.workspace.communityPosts[target.postIndex] = {
        ...target.post,
        attachment: nextAttachment,
      };
      changedRows.set(target.row.key, target.workspace);
    }

    for (const [key, workspace] of changedRows.entries()) {
      const { error: updateError } = await supabase
        .from("home_popup_notice_state")
        .update({ body: JSON.stringify(workspace) })
        .eq("key", key);
      if (updateError) throw updateError;
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(HOME_COMMUNITY_ATTACHMENT_BUCKET).remove(uploadedPaths);
    }
    throw error;
  }

  console.log("[home-community-attachments:migrate:done]", {
    updatedRows: changedRows.size,
    migratedAttachments: validTargets.length,
    migratedBytes: totalBytes,
  });
}

main().catch((error) => {
  console.error("[home-community-attachments:migrate:error]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
