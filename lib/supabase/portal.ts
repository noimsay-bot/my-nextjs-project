import {
  getSession,
  getSessionAsync,
  type SessionUser,
} from "@/lib/auth/storage";
import { createClient as createPortalBrowserClient } from "@/lib/supabase/client";

const SUPABASE_SCHEMA_GUIDE = "Supabase SQL Editor에서 최신 supabase/schema.sql을 다시 실행해 주세요.";

export async function getPortalSession(): Promise<SessionUser | null> {
  return getSession() ?? getSessionAsync();
}

export async function getPortalSupabaseClient() {
  return createPortalBrowserClient();
}

export async function requireApprovedPortalSession() {
  const session = await getPortalSession();
  if (!session || !session.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  return session;
}

function readSupabaseErrorParts(error: unknown) {
  if (!error || typeof error !== "object") {
    return {
      code: "",
      message: error instanceof Error ? error.message : String(error ?? ""),
      details: "",
      hint: "",
    };
  }

  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message : "",
    details: typeof record.details === "string" ? record.details : "",
    hint: typeof record.hint === "string" ? record.hint : "",
  };
}

export function isSupabaseSchemaMissingError(error: unknown) {
  const { code, message, details, hint } = readSupabaseErrorParts(error);
  const combined = `${message}\n${details}\n${hint}`.toLowerCase();

  return (
    code === "PGRST205" ||
    combined.includes("schema cache") ||
    (combined.includes('relation "public.') && combined.includes("does not exist")) ||
    (combined.includes("could not find the table") && combined.includes("public."))
  );
}

export function isSupabaseRequestTimeoutError(error: unknown) {
  const { code, message, details, hint } = readSupabaseErrorParts(error);
  const combined = `${code}\n${message}\n${details}\n${hint}`.toLowerCase();

  return (
    combined.includes("upstream request timeout") ||
    combined.includes("request timeout") ||
    combined.includes("statement timeout")
  );
}

export function isSupabaseRequestFailureError(error: unknown) {
  const { code, message, details, hint } = readSupabaseErrorParts(error);
  const combined = `${code}\n${message}\n${details}\n${hint}`.toLowerCase();

  return (
    combined.includes("failed to fetch") ||
    combined.includes("fetch failed") ||
    combined.includes("network error") ||
    combined.includes("load failed") ||
    combined.includes("fetch error")
  );
}

export function getSupabaseStorageErrorMessage(error: unknown, objectLabel: string) {
  if (isSupabaseSchemaMissingError(error)) {
    return `Supabase ${objectLabel} 구조가 아직 적용되지 않았습니다. ${SUPABASE_SCHEMA_GUIDE}`;
  }

  const { message } = readSupabaseErrorParts(error);
  return message || "Supabase 요청을 처리하지 못했습니다.";
}
