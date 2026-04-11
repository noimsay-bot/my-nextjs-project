import { NextResponse } from "next/server";
import type { AdminUserAttributes } from "@supabase/supabase-js";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { hasTemporaryPasswordMailEnv, sendTemporaryPasswordMail } from "@/lib/server/mail";

const PROFILE_COLUMNS = "id, email, login_id, name";

function normalizeLoginId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function createTemporaryPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "임시 비밀번호 기능을 쓰려면 Vercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY를 추가해 주세요.",
        },
        { status: 500 },
      );
    }

    if (!hasTemporaryPasswordMailEnv()) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "임시 비밀번호 메일 발송을 쓰려면 SMTP_HOST, SMTP_PORT, SMTP_SECURE, EMAIL_FROM 환경변수를 설정해 주세요.",
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

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("login_id", loginId)
      .maybeSingle<{ id: string; email: string; login_id: string | null; name: string }>();

    if (profileError) {
      return NextResponse.json(
        {
          ok: false,
          message: profileError.message,
        },
        { status: 500 },
      );
    }

    if (!profile?.id || !profile.email) {
      return NextResponse.json(
        {
          ok: false,
          message: "일치하는 아이디를 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const { data: authUserData, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
    if (authUserError || !authUserData.user) {
      return NextResponse.json(
        {
          ok: false,
          message: "회원 정보를 찾지 못했습니다. 관리자에게 문의해 주세요.",
        },
        { status: 404 },
      );
    }

    const temporaryPassword = createTemporaryPassword();
    const nextUserMetadata = {
      ...(authUserData.user.user_metadata ?? {}),
      login_id: profile.login_id ?? authUserData.user.user_metadata?.login_id ?? loginId,
      name: profile.name || authUserData.user.user_metadata?.name || profile.email,
      must_change_password: true,
    } satisfies NonNullable<AdminUserAttributes["user_metadata"]>;

    const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, {
      password: temporaryPassword,
      user_metadata: nextUserMetadata,
    });

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          message: updateError.message,
        },
        { status: 500 },
      );
    }

    await sendTemporaryPasswordMail({
      email: profile.email,
      loginId,
      username: profile.name || profile.email,
      temporaryPassword,
    });

    return NextResponse.json({
      ok: true,
      message: "가입된 이메일로 임시 비밀번호를 보냈습니다.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "임시 비밀번호 발급에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
