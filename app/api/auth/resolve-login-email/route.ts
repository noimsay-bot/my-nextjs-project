import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

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

async function queryLoginEmail(loginId: string) {
  const supabase = createAdminClient();
  const lookupPromise = supabase
    .from("profiles")
    .select("email")
    .ilike("login_id", loginId)
    .maybeSingle<{ email: string }>();

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      reject(new Error("로그인 아이디 조회 시간이 초과되었습니다."));
    }, 8000);
  });

  return Promise.race([lookupPromise, timeoutPromise]) as Promise<{
    data: { email: string } | null;
    error: { message: string } | null;
  }>;
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseAdminEnv()) {
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
      return NextResponse.json(
        {
          ok: false,
          message: "아이디를 입력해 주세요.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await queryLoginEmail(loginId);

    if (error) {
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
      return NextResponse.json(
        {
          ok: false,
          message: "일치하는 아이디를 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      email,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: normalizeMessage(error instanceof Error ? error.message : error, "아이디 조회에 실패했습니다."),
      },
      { status: 500 },
    );
  }
}
