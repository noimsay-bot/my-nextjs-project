"use client";

import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

const CUSTOMER_SUPPORT_TABLE = "customer_support_messages";
const MAX_CUSTOMER_SUPPORT_BODY_LENGTH = 2000;

interface CustomerSupportMessageRow {
  id: string;
  body: string;
  created_at: string;
}

export interface CustomerSupportMessage {
  id: string;
  body: string;
  createdAt: string;
}

export interface CustomerSupportMessageWorkspace {
  items: CustomerSupportMessage[];
  schemaMissing: boolean;
  message: string | null;
}

function formatCustomerSupportMessage(row: CustomerSupportMessageRow): CustomerSupportMessage {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function submitCustomerSupportMessage(body: string) {
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

  try {
    const supabase = await getPortalSupabaseClient();
    const { error } = await supabase.from(CUSTOMER_SUPPORT_TABLE).insert({
      body: normalizedBody,
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
      .select("id, body, created_at")
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

    return {
      items: (data ?? []).map(formatCustomerSupportMessage),
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
