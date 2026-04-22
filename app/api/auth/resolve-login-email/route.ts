import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

const LOGIN_EMAIL_LOOKUP_TIMEOUT_MS = 8000;
const LOGIN_EMAIL_LOOKUP_TIMEOUT_MESSAGE = "로그인 아이디 조회 시간이 초과되었습니다.";

function normalizeLoginId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeMessage(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "{}" ||
    trimmed === "[]" ||
    trimmed === "[object Object]" ||
    trimmed === "null" ||
    trimmed === "undefined"
  ) {
    return fallback;
  }

  return trimmed;
}

function logResolveLoginEmail(
  stage: string,
  details: {
    elapsedMs?: number;
    reason?: "missing_env" | "invalid_input" | "timeout" | "query_error" | "not_found" | "ok" | "unexpected_error";
    status?: number;
    message?: string;
  },
) {
  const method = stage === "failed" ? console.warn : console.info;
  method("[auth] resolve-login-email", details);
}

async function queryLoginEmail(loginId: string) {
  const supabase = createAdminClient();
  const lookupPromise = supabase
    .from("profiles")
    .select("email")
    .eq("login_id", loginId)
    .maybeSingle<{ email: string }>();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(LOGIN_EMAIL_LOOKUP_TIMEOUT_MESSAGE));
      }, LOGIN_EMAIL_LOOKUP_TIMEOUT_MS);
    });

    return (await Promise.race([lookupPromise, timeoutPromise])) as {
      data: { email: string } | null;
      error: { message: string } | null;
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseAdminEnv()) {
      logResolveLoginEmail("failed", {
        reason: "missing_env",
        status: 500,
      });
      return NextResponse.json(
        {
          ok: false,
          message: "로그인 아이디 조회에는 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
        },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => null)) as { loginId?: unknown } | null;
    const loginId = normalizeLoginId(body?.loginId);

    if (!loginId) {
      logResolveLoginEmail("failed", {
        reason: "invalid_input",
        status: 400,
      });
      return NextResponse.json(
        {
          ok: false,
          message: "아이디를 입력해 주세요.",
        },
        { status: 400 },
      );
    }

    const startedAt = Date.now();
    const { data, error } = await queryLoginEmail(loginId);
    const elapsedMs = Date.now() - startedAt;

    if (error) {
      logResolveLoginEmail("failed", {
        reason: "query_error",
        status: 500,
        elapsedMs,
        message: normalizeMessage(error.message, "아이디 조회에 실패했습니다."),
      });
      return NextResponse.json(
        {
          ok: false,
          message: normalizeMessage(error.message, "아이디 조회에 실패했습니다."),
        },
        { status: 500 },
      );
    }

    const email = data?.email?.trim().toLowerCase() ?? null;
    if (!email) {
      logResolveLoginEmail("complete", {
        reason: "not_found",
        status: 404,
        elapsedMs,
      });
      return NextResponse.json(
        {
          ok: false,
          message: "일치하는 아이디를 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    logResolveLoginEmail("complete", {
      reason: "ok",
      status: 200,
      elapsedMs,
    });
    return NextResponse.json({
      ok: true,
      email,
    });
  } catch (error) {
    const message = normalizeMessage(error instanceof Error ? error.message : error, "아이디 조회에 실패했습니다.");
    logResolveLoginEmail("failed", {
      reason: message === LOGIN_EMAIL_LOOKUP_TIMEOUT_MESSAGE ? "timeout" : "unexpected_error",
      status: 500,
      message,
    });
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
