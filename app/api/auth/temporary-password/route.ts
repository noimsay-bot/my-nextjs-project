import { NextResponse } from "next/server";
import type { AdminUserAttributes, User } from "@supabase/supabase-js";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { hasTemporaryPasswordMailEnv, sendTemporaryPasswordMail } from "@/lib/server/mail";

const PROFILE_COLUMNS = "id, email, login_id, name";
const AUTH_USER_LOOKUP_PAGE_SIZE = 1000;
const AUTH_USER_LOOKUP_MAX_PAGES = 10;

interface ProfileRow {
  id: string;
  email: string;
  login_id: string | null;
  name: string;
}

function normalizeIdentifier(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function findProfileByIdentifier(admin: ReturnType<typeof createAdminClient>, identifier: string) {
  const query = admin
    .from("profiles")
    .select(PROFILE_COLUMNS);

  if (identifier.includes("@")) {
    return query.eq("email", identifier).maybeSingle<ProfileRow>();
  }

  return query.eq("login_id", identifier).maybeSingle<ProfileRow>();
}

function getAuthUserLoginId(user: User) {
  const loginId = user.user_metadata?.login_id;
  return typeof loginId === "string" ? loginId.trim().toLowerCase() : "";
}

async function findAuthUserByIdentifier(admin: ReturnType<typeof createAdminClient>, identifier: string) {
  for (let page = 1; page <= AUTH_USER_LOOKUP_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_LOOKUP_PAGE_SIZE,
    });

    if (error) {
      return { user: null, error };
    }

    const user = data.users.find((item) => {
      const email = item.email?.trim().toLowerCase() ?? "";
      return email === identifier || getAuthUserLoginId(item) === identifier;
    });

    if (user) {
      return { user, error: null };
    }

    if (data.users.length < AUTH_USER_LOOKUP_PAGE_SIZE) {
      break;
    }
  }

  return { user: null, error: null };
}

async function repairProfileLookupFields(input: {
  admin: ReturnType<typeof createAdminClient>;
  authUser: User;
  profile: ProfileRow | null;
  email: string;
  loginId: string;
  username: string;
}) {
  const { admin, authUser, profile, email, loginId, username } = input;
  const profileLoginId = loginId.includes("@") ? getAuthUserLoginId(authUser) : loginId;

  if (profile) {
    const updates: Partial<Pick<ProfileRow, "email" | "login_id" | "name">> = {};
    if (!profile.email && email) updates.email = email;
    if (!profile.login_id && profileLoginId) updates.login_id = profileLoginId;
    if (!profile.name && username) updates.name = username;

    if (Object.keys(updates).length > 0) {
      const { error } = await admin.from("profiles").update(updates as unknown as never).eq("id", authUser.id);
      if (error) {
        throw new Error(error.message);
      }
    }
    return;
  }

  const profilePayload = {
    id: authUser.id,
    email,
    login_id: profileLoginId || null,
    name: username,
  } as const;
  const { error } = await admin.from("profiles").upsert(profilePayload as unknown as never, { onConflict: "id" });
  if (error) {
    throw new Error(error.message);
  }
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
    const identifier = normalizeIdentifier(body?.loginId);
    if (!identifier) {
      return NextResponse.json(
        {
          ok: false,
          message: "아이디 또는 이메일을 입력해 주세요.",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await findProfileByIdentifier(admin, identifier);

    if (profileError) {
      return NextResponse.json(
        {
          ok: false,
          message: profileError.message,
        },
        { status: 500 },
      );
    }

    const authUserResult = profile?.id
      ? await admin.auth.admin.getUserById(profile.id)
      : await findAuthUserByIdentifier(admin, identifier);
    const authUser = "user" in authUserResult ? authUserResult.user : authUserResult.data.user;
    const authUserError = authUserResult.error;

    if (authUserError) {
      return NextResponse.json(
        {
          ok: false,
          message: authUserError.message,
        },
        { status: 500 },
      );
    }

    if (!authUser) {
      return NextResponse.json(
        {
          ok: false,
          message: "일치하는 아이디 또는 이메일을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const email = profile?.email || authUser.email;
    if (!email) {
      return NextResponse.json(
        {
          ok: false,
          message: "회원 이메일을 찾지 못했습니다. 관리자에게 문의해 주세요.",
        },
        { status: 404 },
      );
    }

    const temporaryPassword = createTemporaryPassword();
    const loginId = profile?.login_id || getAuthUserLoginId(authUser) || identifier;
    const username =
      profile?.name ||
      (typeof authUser.user_metadata?.name === "string" ? authUser.user_metadata.name : "") ||
      email;
    await repairProfileLookupFields({
      admin,
      authUser,
      profile,
      email,
      loginId,
      username,
    });

    const nextUserMetadata = {
      ...(authUser.user_metadata ?? {}),
      login_id: loginId,
      name: username,
      must_change_password: true,
      mustChangePassword: true,
    } satisfies NonNullable<AdminUserAttributes["user_metadata"]>;

    const { error: updateError } = await admin.auth.admin.updateUserById(authUser.id, {
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
      email,
      loginId,
      username,
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
