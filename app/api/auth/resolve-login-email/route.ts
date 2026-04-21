import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

function normalizeLoginId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("email")
      .eq("login_id", loginId)
      .maybeSingle<{ email: string }>();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message,
        },
        { status: 500 },
      );
    }

    if (!data?.email) {
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
      email: data.email,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "아이디 조회에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
