import { expect, test as base } from "@playwright/test";

// Install before creating a page, including requests made during initial hydration.
const test = base.extend({
  context: async ({ context, baseURL }, runWithContext) => {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseURL && !url.pathname.startsWith("/api/") && ["GET", "HEAD"].includes(route.request().method())) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await runWithContext(context);
  },
});

test("login loads and unauthenticated schedule access remains protected", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("input[type='password']")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인", exact: true }).last()).toBeVisible();
  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("synthetic schedule keeps zoom and read-only controls on desktop and mobile", async ({ page }) => {
  const response = await page.goto("/preview/work-schedule");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("합성 데이터");
  await expect(page.locator("[data-read-only-preview='true']")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 720) {
    const surface = page.getByTestId("schedule-pan-zoom-surface");
    await expect.poll(async () => Number(await surface.getAttribute("data-scale"))).toBeGreaterThan(0);
    const initialScale = Number(await surface.getAttribute("data-scale"));
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const cdp = await page.context().newCDPSession(page);
    const x = box!.x + box!.width / 2;
    const y = box!.y + Math.min(box!.height / 2, 180);
    const points = (distance: number) => [{ x: x - distance, y, id: 1 }, { x: x + distance, y, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(30) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(80) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => Number(await surface.getAttribute("data-scale"))).toBeGreaterThan(initialScale);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(80) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(10) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => Number(await surface.getAttribute("data-scale"))).toBeCloseTo(initialScale, 3);
    await cdp.detach();
  }
  await expect(page.getByRole("button", { name: "근무 수정", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "교환 요청", exact: true })).toHaveCount(0);
});

test("CSS shine and extracted read-only equipment panel preserve desktop/mobile behavior", async ({ page }) => {
  const id = "00000000-0000-0000-0000-000000000001";
  await page.addInitScript(() => {
    localStorage.setItem("j-special-force-auth-cache-v4", JSON.stringify({
      id: "00000000-0000-0000-0000-000000000002", email: "offline@example.test", username: "Offline", loginId: "offline",
      role: "member", actualRole: "member", displayRole: "member", experienceRole: null, approved: true,
      mustChangePassword: false, canReview: false, actualCanReview: false,
    }));
  });
  const tables: string[] = [];
  await page.route("http://127.0.0.1:9/rest/v1/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const table = new URL(route.request().url()).pathname.split("/").pop()!;
    tables.push(table);
    const data: Record<string, unknown> = {
      equipment_items: [{ id, category: "live", group_name: "TVU", name: "TVU1", code: "live-tvu-1", sort_order: 1, is_active: true, metadata: {}, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }],
      equipment_loan_items: [],
      live_equipment_status_board: [{ equipment_item_id: id, live_trs: "TRS-1", live_camera_reporter: "테스트 기자", live_audio_man: "", live_location: "테스트 장소", live_note: "", updated_at: "2026-09-01T00:00:00Z" }],
      election_events: null,
    };
    expect(Object.hasOwn(data, table)).toBe(true);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data[table]) });
  });
  await page.goto("/offline-component-lab");
  await expect(page.getByRole("cell", { name: "TVU-1", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "테스트 기자", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "사용중", exact: true })).toBeVisible();
  await expect(page.locator("input, textarea, select")).toHaveCount(0);
  expect(tables.sort()).toEqual(["election_events", "equipment_items", "equipment_loan_items", "live_equipment_status_board"]);
  const moving = page.getByTestId("shine-moving").locator("span");
  const paused = page.getByTestId("shine-paused").locator("span");
  await expect(moving).toHaveCSS("animation-duration", "1.2s");
  await expect(moving).toHaveCSS("animation-play-state", "running");
  const initial = await moving.evaluate((node) => getComputedStyle(node).backgroundPositionX);
  await expect.poll(() => moving.evaluate((node) => getComputedStyle(node).backgroundPositionX)).not.toBe(initial);
  await expect(paused).toHaveCSS("animation-play-state", "paused");
  if (!test.info().project.name.includes("mobile")) {
    await moving.hover();
    await expect(moving).toHaveCSS("animation-play-state", "paused");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(moving).toHaveCSS("animation-name", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
