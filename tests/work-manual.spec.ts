import { expect, test, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const MOCK_WEBHARDS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    title: "샘플 관리자 로그인",
    login_id: "sample-admin",
    password: "sample-pass-1",
    note: "맨 앞 s 소문자",
    url: "",
    sort_order: 1,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    title: "샘플 게스트 로그인",
    login_id: "sample-guest",
    password: "Sample-pass-2",
    note: "",
    url: "",
    sort_order: 2,
  },
];

async function seedManualPage(page: Page, role: string) {
  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);
  await page.addInitScript(
    ({ authCacheKey, supabaseAuthTokenKey, supabaseSession, supabaseCookieValue, role }) => {
      document.cookie = `${supabaseAuthTokenKey}=${supabaseCookieValue}; path=/; max-age=3600; SameSite=Lax`;
      window.localStorage.setItem(
        authCacheKey,
        JSON.stringify({
          id: "admin-seed",
          email: "admin@example.com",
          loginId: "admin",
          username: "관리자",
          role,
          approved: true,
          mustChangePassword: false,
          canReview: false,
        }),
      );
      window.localStorage.setItem(supabaseAuthTokenKey, JSON.stringify(supabaseSession));
    },
    { authCacheKey: AUTH_CACHE_KEY, supabaseAuthTokenKey, supabaseSession, supabaseCookieValue, role },
  );

  await page.route("**/rest/v1/work_manual_webhards*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_WEBHARDS) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
  });
}

test("work manual sections switch from the table of contents", async ({ page }) => {
  await seedManualPage(page, "admin");
  await page.goto("/tips");

  const toc = page.getByRole("navigation", { name: "Tips 목차" });
  await expect(page.getByRole("heading", { name: "결재선 즐겨찾기" })).toBeVisible();

  await toc.getByRole("button", { name: "실물증빙 입력방법" }).click();
  await expect(page.getByRole("heading", { name: "실물증빙 입력방법" })).toBeVisible();
  await expect(page.getByAltText("전표 상세 입력 화면")).toBeVisible();
  await expect(page).toHaveURL(/#receipt$/);

  await toc.getByRole("button", { name: "계정과목 및 부가세" }).click();
  await expect(page.getByText("CL 일당 30,000원 / EL 50,000원", { exact: false })).toBeVisible();

  await toc.getByRole("button", { name: "웹하드" }).click();
  await expect(page.getByText("1. 샘플 관리자 로그인")).toBeVisible();
  await expect(page.getByText("sample-pass-1")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 웹하드 추가" })).toBeVisible();
});

test("desk sees webhards with manage buttons", async ({ page }) => {
  await seedManualPage(page, "desk");
  await page.goto("/tips#webhard");

  await expect(page.getByText("2. 샘플 게스트 로그인")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 웹하드 추가" })).toBeVisible();
});

test("member cannot open the work manual", async ({ page }) => {
  await seedManualPage(page, "member");
  await page.goto("/tips#webhard");

  await expect(page).not.toHaveURL(/\/tips/);
  await expect(page.getByText("샘플 관리자 로그인")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tips" })).toHaveCount(0);
});
