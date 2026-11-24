import { expect, test, type Page, type Route } from "@playwright/test";
import { AUTH_CACHE_KEY, createE2eSupabaseSession, encodeSupabaseCookie, getSupabaseAuthTokenKey } from "../e2e-auth";

// 총괄팀장 2단계 인증 화면: 유예 중 등록 권유 → 나중에 하기 / 등록 → 6자리 확인 → 원래 화면으로.
// Supabase Auth의 MFA API는 가짜 응답으로 대신한다(실제 계정에 인증 앱을 만들지 않는다).

const USER_ID = "admin-seed";

// 처음 여는 /mfa 화면은 개발 서버가 컴파일하느라 느릴 수 있다.
test.setTimeout(90_000);
const FIRST_LOAD = { timeout: 30_000 };

function fakeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.c2ln`;
}

function accessToken(aal: "aal1" | "aal2") {
  const now = Math.floor(Date.now() / 1000);
  return fakeJwt({
    sub: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    aal,
    amr: [{ method: aal === "aal2" ? "totp" : "password", timestamp: now }],
    session_id: "e2e-session",
    iat: now,
    exp: now + 3600,
  });
}

async function openAsTeamLead(page: Page, path: string) {
  const verifiedFactors: { id: string; factor_type: string; status: string; friendly_name: string }[] = [];
  const user = () => ({
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "admin@example.com",
    user_metadata: { login_id: "admin", name: "총괄팀장" },
    app_metadata: {},
    factors: verifiedFactors,
    created_at: "2026-01-01T00:00:00Z",
  });
  const reply = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/rest/v1/**", (route) => reply(route, []));
  await page.route("**/auth/v1/user**", (route) => reply(route, user()));
  await page.route("**/auth/v1/factors**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/factors") && route.request().method() === "POST") {
      await reply(route, {
        id: "factor-1",
        type: "totp",
        friendly_name: "카메라 허브",
        totp: {
          // 실제 서버처럼 SVG 원문을 준다(supabase-js가 앞에 "data:image/svg+xml;utf-8,"를 붙인다).
          qr_code:
            "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='#000'/></svg>",
          secret: "E2ESECRETBASE32",
          uri: "otpauth://totp/e2e",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/challenge")) {
      await reply(route, { id: "challenge-1", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
      return;
    }
    if (url.pathname.endsWith("/verify")) {
      const body = JSON.parse(route.request().postData() ?? "{}") as { code?: string };
      if (body.code !== "123456") {
        await reply(route, { code: "mfa_verification_failed", msg: "Invalid TOTP code entered" }, 422);
        return;
      }
      verifiedFactors.push({ id: "factor-1", factor_type: "totp", status: "verified", friendly_name: "카메라 허브" });
      await reply(route, {
        access_token: accessToken("aal2"),
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "e2e-refresh-2",
        user: user(),
      });
      return;
    }
    await reply(route, {});
  });

  const tokenKey = getSupabaseAuthTokenKey();
  const session = { ...createE2eSupabaseSession(), access_token: accessToken("aal1") };
  const cookieValue = encodeSupabaseCookie(session);
  await page.addInitScript(
    ({ authCacheKey, tokenKey, session, cookieValue }) => {
      if (!window.sessionStorage.getItem("e2e-seeded")) {
        window.sessionStorage.setItem("e2e-seeded", "1");
        document.cookie = `${tokenKey}=${cookieValue}; path=/; max-age=3600; SameSite=Lax`;
        window.localStorage.setItem(tokenKey, JSON.stringify(session));
      }
      window.localStorage.setItem(
        authCacheKey,
        JSON.stringify({
          id: "admin-seed",
          email: "admin@example.com",
          loginId: "admin",
          username: "총괄팀장",
          role: "team_lead",
          actualRole: "team_lead",
          experienceRole: null,
          approved: true,
          mustChangePassword: false,
          canReview: true,
          actualCanReview: true,
        }),
      );
    },
    { authCacheKey: AUTH_CACHE_KEY, tokenKey, session, cookieValue },
  );
  await page.goto(path);
}

test("유예 중: 총괄팀장을 2단계 인증 화면으로 보내고, 나중에 하기를 누르면 원래 화면으로 간다", async ({ page }) => {
  await openAsTeamLead(page, "/team-lead/security");
  await expect(page).toHaveURL(/\/mfa\?next=%2Fteam-lead%2Fsecurity/, FIRST_LOAD);
  await expect(page.getByText("12월 1일부터는 등록해야 포털을 쓸 수 있습니다")).toBeVisible();
  await page.getByRole("button", { name: "나중에 하기" }).click();
  await expect(page).toHaveURL(/\/team-lead\/security$/);
  await expect(page.getByText("2단계 인증", { exact: true })).toHaveCount(0);
});

test("등록: QR이 나오고, 틀린 6자리는 거부하고, 맞는 6자리면 원래 화면으로 간다", async ({ page }) => {
  await openAsTeamLead(page, "/team-lead/security");
  await expect(page).toHaveURL(/\/mfa/, FIRST_LOAD);
  await page.getByRole("button", { name: "등록 시작" }).click();
  const qr = page.getByAltText("인증 앱 등록용 QR 코드");
  await expect(qr).toBeVisible();
  await expect
    .poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth), { message: "QR 그림이 실제로 그려져야 한다" })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: /설정 키 보기/ }).click();
  await expect(page.getByText("E2ESECRETBASE32")).toBeVisible();

  const input = page.getByPlaceholder("6자리 숫자");
  await input.fill("111111");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByText("6자리가 맞지 않습니다")).toBeVisible();

  await input.fill("123 456");
  await expect(input).toHaveValue("123456");
  await page.screenshot({ path: "test-results/mfa-enroll-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page).toHaveURL(/\/team-lead\/security$/);

  const offenders = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(offenders).toBeLessThanOrEqual(2);
});
