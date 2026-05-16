"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

const CUSTOMER_SUPPORT_TABLE = "customer_support_messages";
const CUSTOMER_SUPPORT_ATTACHMENT_BUCKET = "customer-support-attachments";
const MAX_CUSTOMER_SUPPORT_BODY_LENGTH = 2000;
const MAX_CUSTOMER_SUPPORT_ATTACHMENT_COUNT = 3;
const MAX_CUSTOMER_SUPPORT_ATTACHMENT_SIZE = 5 * 1024 * 1024;

interface CustomerSupportMessageRow {
  id: string;
  body: string;
  attachments: unknown;
  status: string | null;
  processed_at: string | null;
  processed_by: string | null;
  created_at: string;
}

interface ProfileNameRow {
  id: string;
  name: string;
}

export interface CustomerSupportAttachment {
  path: string;
  name: string;
  type: string;
  size: number;
  url: string | null;
}

export interface CustomerSupportMessage {
  id: string;
  body: string;
  attachments: CustomerSupportAttachment[];
  status: "open" | "processed";
  processedAt: string | null;
  processedBy: string | null;
  processedByName: string | null;
  createdAt: string;
}

export interface CustomerSupportMessageWorkspace {
  items: CustomerSupportMessage[];
  schemaMissing: boolean;
  message: string | null;
}

function isSupportedCustomerSupportImage(file: File) {
  return file.type.startsWith("image/");
}

function normalizeCustomerSupportAttachment(value: unknown): CustomerSupportAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : "";
  const name = typeof record.name === "string" ? record.name : "첨부 사진";
  const type = typeof record.type === "string" ? record.type : "image/*";
  const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0;
  const url = typeof record.url === "string" ? record.url : null;
  if (!path) return null;
  return { path, name, type, size, url };
}

function normalizeCustomerSupportAttachments(value: unknown): CustomerSupportAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeCustomerSupportAttachment)
    .filter((item): item is CustomerSupportAttachment => Boolean(item));
}

function formatCustomerSupportMessage(
  row: CustomerSupportMessageRow,
  processedByNameMap: Map<string, string>,
  signedUrlMap: Map<string, string>,
): CustomerSupportMessage {
  const attachments = normalizeCustomerSupportAttachments(row.attachments).map((attachment) => ({
    ...attachment,
    url: signedUrlMap.get(attachment.path) ?? null,
  }));
  return {
    id: row.id,
    body: row.body,
    attachments,
    status: row.status === "processed" ? "processed" : "open",
    processedAt: row.processed_at,
    processedBy: row.processed_by,
    processedByName: row.processed_by ? processedByNameMap.get(row.processed_by) ?? null : null,
    createdAt: row.created_at,
  };
}

function getCustomerSupportAttachmentPath(userId: string, file: File) {
  const extension = file.name.split(".").pop()?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${userId}/${id}.${extension}`;
}

async function createCustomerSupportAttachmentUrls(paths: string[]) {
  if (paths.length === 0) return new Map<string, string>();
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase.storage
    .from(CUSTOMER_SUPPORT_ATTACHMENT_BUCKET)
    .createSignedUrls(paths, 60 * 60);

  if (error) return new Map<string, string>();

  return new Map(
    (data ?? [])
      .map((item, index) => [paths[index], item.signedUrl] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  );
}

async function getProfileNameMap(profileIds: string[]) {
  const uniqueIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, string>();

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", uniqueIds)
    .returns<ProfileNameRow[]>();

  if (error) return new Map<string, string>();
  return new Map((data ?? []).map((row) => [row.id, row.name] as const));
}

export async function submitCustomerSupportMessage(body: string, files: File[] = []) {
  const session = await getPortalSession();
  if (!session?.approved) {
    return { ok: false as const, message: "승인된 로그인 세션이 필요합니다." };
  }

  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return { ok: false as const, message: "전달할 내용을 작성해 주세요." };
  }
  if (normalizedBody.length > MAX_CUSTOMER_SUPPORT_BODY_LENGTH) {
    return {
      ok: false as const,
      message: `고객센터 내용은 ${MAX_CUSTOMER_SUPPORT_BODY_LENGTH.toLocaleString("ko-KR")}자 이내로 작성해 주세요.`,
    };
  }
  if (files.length > MAX_CUSTOMER_SUPPORT_ATTACHMENT_COUNT) {
    return {
      ok: false as const,
      message: `사진은 최대 ${MAX_CUSTOMER_SUPPORT_ATTACHMENT_COUNT}장까지 첨부할 수 있습니다.`,
    };
  }
  const invalidFile = files.find((file) => !isSupportedCustomerSupportImage(file) || file.size > MAX_CUSTOMER_SUPPORT_ATTACHMENT_SIZE);
  if (invalidFile) {
    return {
      ok: false as const,
      message: "사진 첨부는 이미지 파일만 가능하며, 파일당 5MB 이하여야 합니다.",
    };
  }

  const uploadedAttachments: CustomerSupportAttachment[] = [];
  try {
    const supabase = await getPortalSupabaseClient();
    for (const file of files) {
      const path = getCustomerSupportAttachmentPath(session.id, file);
      const { error: uploadError } = await supabase.storage
        .from(CUSTOMER_SUPPORT_ATTACHMENT_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        if (uploadedAttachments.length > 0) {
          await supabase.storage
            .from(CUSTOMER_SUPPORT_ATTACHMENT_BUCKET)
            .remove(uploadedAttachments.map((attachment) => attachment.path));
        }
        return {
          ok: false as const,
          message: getSupabaseStorageErrorMessage(uploadError, CUSTOMER_SUPPORT_ATTACHMENT_BUCKET),
        };
      }

      uploadedAttachments.push({
        path,
        name: file.name || "첨부 사진",
        type: file.type,
        size: file.size,
        url: null,
      });
    }

    const { error } = await supabase.from(CUSTOMER_SUPPORT_TABLE).insert({
      body: normalizedBody,
      attachments: uploadedAttachments.map(({ path, name, type, size }) => ({ path, name, type, size })),
    });

    if (error) {
      if (uploadedAttachments.length > 0) {
        await supabase.storage
          .from(CUSTOMER_SUPPORT_ATTACHMENT_BUCKET)
          .remove(uploadedAttachments.map((attachment) => attachment.path));
      }
      return {
        ok: false as const,
        message: getSupabaseStorageErrorMessage(error, CUSTOMER_SUPPORT_TABLE),
      };
    }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "고객센터 내용을 전송하지 못했습니다.",
    };
  }

  return { ok: true as const, message: "고객센터 내용이 전송되었습니다." };
}

export async function getAdminCustomerSupportMessages(): Promise<CustomerSupportMessageWorkspace> {
  const session = await getPortalSession();
  if (!session?.approved || (session.role !== "admin" && session.role !== "team_lead")) {
    return {
      items: [],
      schemaMissing: false,
      message: "고객센터 접수 내용 조회 권한이 없습니다.",
    };
  }

  try {
    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from(CUSTOMER_SUPPORT_TABLE)
      .select("id, body, attachments, status, processed_at, processed_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<CustomerSupportMessageRow[]>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        return {
          items: [],
          schemaMissing: true,
          message: getSupabaseStorageErrorMessage(error, CUSTOMER_SUPPORT_TABLE),
        };
      }
      throw new Error(error.message);
    }

    const rows = data ?? [];
    const attachmentPaths = rows.flatMap((row) => normalizeCustomerSupportAttachments(row.attachments).map((attachment) => attachment.path));
    const signedUrlMap = await createCustomerSupportAttachmentUrls(attachmentPaths);
    const processedByNameMap = await getProfileNameMap(rows.map((row) => row.processed_by ?? ""));

    return {
      items: rows.map((row) => formatCustomerSupportMessage(row, processedByNameMap, signedUrlMap)),
      schemaMissing: false,
      message: null,
    };
  } catch (error) {
    return {
      items: [],
      schemaMissing: false,
      message: error instanceof Error ? error.message : "고객센터 접수 내용을 불러오지 못했습니다.",
    };
  }
}

export async function markCustomerSupportMessageProcessed(messageId: string) {
  const session = await getPortalSession();
  if (!session?.approved || (session.role !== "admin" && session.role !== "team_lead")) {
    return {
      ok: false as const,
      message: "고객센터 접수 내용 처리 권한이 없습니다.",
    };
  }

  try {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.rpc("mark_customer_support_message_processed", {
      p_message_id: messageId,
    });

    if (error) {
      return {
        ok: false as const,
        message: getSupabaseStorageErrorMessage(error, CUSTOMER_SUPPORT_TABLE),
      };
    }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "고객센터 접수 내용을 처리완료로 변경하지 못했습니다.",
    };
  }

  return { ok: true as const, message: "처리완료로 변경했습니다." };
}

export async function deleteCustomerSupportMessage(messageId: string) {
  const session = await getPortalSession();
  if (!session?.approved || (session.role !== "admin" && session.role !== "team_lead")) {
    return {
      ok: false as const,
      message: "고객센터 접수 내용 삭제 권한이 없습니다.",
    };
  }

  try {
    const supabase = await getPortalSupabaseClient();
    const { data, error: selectError } = await supabase
      .from(CUSTOMER_SUPPORT_TABLE)
      .select("attachments")
      .eq("id", messageId)
      .maybeSingle<{ attachments: unknown }>();

    if (selectError) {
      return {
        ok: false as const,
        message: getSupabaseStorageErrorMessage(selectError, CUSTOMER_SUPPORT_TABLE),
      };
    }

    const attachmentPaths = normalizeCustomerSupportAttachments(data?.attachments).map((attachment) => attachment.path);
    if (attachmentPaths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(CUSTOMER_SUPPORT_ATTACHMENT_BUCKET)
        .remove(attachmentPaths);
      if (removeError) {
        return {
          ok: false as const,
          message: getSupabaseStorageErrorMessage(removeError, CUSTOMER_SUPPORT_ATTACHMENT_BUCKET),
        };
      }
    }

    const { error: deleteError } = await supabase
      .from(CUSTOMER_SUPPORT_TABLE)
      .delete()
      .eq("id", messageId);

    if (deleteError) {
      return {
        ok: false as const,
        message: getSupabaseStorageErrorMessage(deleteError, CUSTOMER_SUPPORT_TABLE),
      };
    }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "고객센터 접수 내용을 삭제하지 못했습니다.",
    };
  }

  return { ok: true as const, message: "고객센터 접수 내용을 삭제했습니다." };
}
