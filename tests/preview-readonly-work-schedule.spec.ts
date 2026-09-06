import { expect, test } from "@playwright/test";

const previewDemoEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "codex/mobile-schedule-pan-zoom" &&
  process.env.PREVIEW_SCHEDULE_DEMO === "1";

test.describe("read-only work schedule preview", () => {
  test("returns 404 when the preview server guard is disabled", async ({ page }) => {
    test.skip(previewDemoEnabled, "Preview 전용 서버 가드가 활성화된 실행에서는 제외합니다.");

    const response = await page.goto("/preview/work-schedule");
    expect(response?.status()).toBe(404);
  });

  test("renders synthetic pan/zoom schedule without auth, Supabase, or mutations", async ({ page, context }) => {
    test.skip(!previewDemoEnabled, "Preview 전용 서버 가드 환경에서만 실행합니다.");

    const forbiddenRequests: string[] = [];

    page.on("request", (request) => {
      const url = new URL(request.url());
      const method = request.method();
      const isSupabase = url.hostname.endsWith(".supabase.co");
      const isAppApi = url.origin === "http://127.0.0.1:3101" && url.pathname.startsWith("/api/");
      const isMutation = !["GET", "HEAD"].includes(method);

      if (isSupabase || isAppApi || isMutation) {
        forbiddenRequests.push(`${method} ${url.origin}${url.pathname}`);
      }
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto("/preview/work-schedule");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("status")).toContainText("정철원 (프리뷰)");
    await expect(page.getByRole("status")).toContainText("합성 데이터");
    await expect(page.locator("[data-read-only-preview='true']")).toBeVisible();
    const panZoomSurface = page.locator("[data-testid='schedule-pan-zoom-surface']");
    const zoomInButton = page.getByRole("button", { name: "확대" });
    const resetButton = page.getByRole("button", { name: "전체 맞춤" });
    const showMineButton = page.getByRole("button", { name: "내 근무 보기" });

    await expect(panZoomSurface).toHaveAttribute("data-layout-mode", "mobile");
    await expect.poll(async () => Number(await panZoomSurface.getAttribute("data-scale"))).toBeGreaterThan(0);
    const initialScale = Number(await panZoomSurface.getAttribute("data-scale"));

    await expect(zoomInButton).toBeVisible();
    await expect(page.getByRole("button", { name: "축소" })).toBeVisible();
    await expect(resetButton).toBeVisible();
    await expect(showMineButton).toBeVisible();

    await zoomInButton.click();
    await expect.poll(async () => Number(await panZoomSurface.getAttribute("data-scale"))).toBeGreaterThan(initialScale);
    await resetButton.click();
    await expect.poll(async () => Number(await panZoomSurface.getAttribute("data-scale"))).toBeCloseTo(initialScale, 3);
    await showMineButton.click();
    await expect(page.getByRole("button", { name: "전체 보기" })).toBeVisible();

    await expect(page.getByRole("button", { name: "근무 수정" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "근무표 숨김" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "교환 요청" })).toHaveCount(0);

    const authState = await page.evaluate(() => ({
      authCache: window.localStorage.getItem("j-special-force-auth-cache-v4"),
      supabaseTokenKeys: Object.keys(window.localStorage).filter(
        (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
      ),
    }));
    const authCookies = (await context.cookies()).filter(
      (cookie) => cookie.name.startsWith("sb-") && cookie.name.endsWith("-auth-token"),
    );

    expect(authState.authCache).toBeNull();
    expect(authState.supabaseTokenKeys).toEqual([]);
    expect(authCookies).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  });
});
