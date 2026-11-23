import { NextResponse } from "next/server";
import type { AdminUserAttributes, User } from "@supabase/supabase-js";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { hasTemporaryPasswordMailEnv, sendTemporaryPasswordMail } from "@/lib/server/mail";
import { maskEmail, type TemporaryPasswordMailResult } from "@/lib/server/mail-core";
import { consumeRateLimit, getClientIp } from "@/lib/server/rate-limit";

// 로그인 없이 호출되는 API라, 아이디만 아는 제3자가 반복 호출해 남의 비밀번호를
// 계속 바꿔 버릴 수 있다. IP별 호출 횟수와 계정별 재발급 간격을 함께 제한한다.
const TEMPORARY_PASSWORD_IP_RATE_LIMIT = 10;
const TEMPORARY_PASSWORD_IP_RATE_WINDOW_MS = 10 * 60 * 1000;
const TEMPORARY_PASSWORD_ACCOUNT_COOLDOWN_MS = 10 * 60 * 1000;
// 계정별 마지막 발급 시각. 사용자가 직접 바꿀 수 없는 app_metadata에 둔다.
const TEMPORARY_PASSWORD_ISSUED_AT_KEY = "temporary_password_issued_at";

function getTemporaryPasswordCooldownRemainingMs(user: User, now = Date.now()) {
  const issuedAt = user.app_metadata?.[TEMPORARY_PASSWORD_ISSUED_AT_KEY];
  const issuedAtMs = typeof issuedAt === "string" ? Date.parse(issuedAt) : Number.NaN;
  if (!Number.isFinite(issuedAtMs)) return 0;
  return Math.max(0, issuedAtMs + TEMPORARY_PASSWORD_ACCOUNT_COOLDOWN_MS - now);
}

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
            "임시 비밀번호 메일 발송을 쓰려면 SMTP_HOST, SMTP_PORT, EMAIL_FROM 환경변수를 설정해 주세요.",
        },
        { status: 500 },
      );
    }

    const rateLimit = consumeRateLimit({
      key: `temporary-password:${getClientIp(request)}`,
      limit: TEMPORARY_PASSWORD_IP_RATE_LIMIT,
      windowMs: TEMPORARY_PASSWORD_IP_RATE_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
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

    const cooldownRemainingMs = getTemporaryPasswordCooldownRemainingMs(authUser);
    if (cooldownRemainingMs > 0) {
      const retryAfterSeconds = Math.ceil(cooldownRemainingMs / 1000);
      return NextResponse.json(
        {
          ok: false,
          message: `조금 전에 임시 비밀번호를 보냈습니다. 메일함을 확인하시고, 받지 못했다면 ${Math.ceil(retryAfterSeconds / 60)}분 후 다시 시도해 주세요.`,
        },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }

    // 수신처는 반드시 Supabase Auth에 등록된 이메일을 우선한다.
    // profiles.email은 다른 사람이 수정할 수 있는 값이라, 이를 우선하면 이메일을 바꿔 치기한 뒤
    // 임시 비밀번호를 가로채 남의 계정(예: 총괄팀장)에 로그인할 수 있다.
    const email = authUser.email || profile?.email;
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

    // 메일 발송이 확인된 뒤에만 비밀번호를 변경한다.
    // 발송 실패/스킵 시 기존 비밀번호가 그대로 유지되어야 사용자가 잠기지 않는다.
    const maskedEmail = maskEmail(email);
    let mailResult: TemporaryPasswordMailResult;
    try {
      mailResult = await sendTemporaryPasswordMail({
        email,
        loginId,
        username,
        temporaryPassword,
      });
    } catch (mailError) {
      console.error(`[temporary-password] 메일 발송 실패 to=${maskedEmail}`, mailError);
      return NextResponse.json(
        {
          ok: false,
          message: "임시 비밀번호 메일 발송에 실패했습니다. 관리자에게 문의해 주세요.",
        },
        { status: 500 },
      );
    }

    if (!mailResult.sent) {
      console.warn(
        `[temporary-password] 메일 미발송(reason=${mailResult.reason}) to=${maskedEmail} — 비밀번호를 변경하지 않았습니다.`,
      );
      return NextResponse.json(
        {
          ok: false,
          message:
            "메일 발송이 로그 전용 모드(MAIL_LOG_ONLY)로 설정되어 있어 임시 비밀번호를 발급하지 못했습니다. 관리자에게 문의해 주세요.",
        },
        { status: 500 },
      );
    }

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
      app_metadata: {
        ...(authUser.app_metadata ?? {}),
        [TEMPORARY_PASSWORD_ISSUED_AT_KEY]: new Date().toISOString(),
      },
    });

    if (updateError) {
      console.error(
        `[temporary-password] 메일 발송 후 비밀번호 적용 실패 to=${maskedEmail}: ${updateError.message}`,
      );
      return NextResponse.json(
        {
          ok: false,
          message:
            "임시 비밀번호 메일은 발송되었지만 적용에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 500 },
      );
    }

    console.log(`[temporary-password] 임시 비밀번호 메일 발송 완료 to=${maskedEmail}`);

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
