import { expect, test, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, E2E_BASE_URL, seedSupabaseAuthCookie } from "../e2e-auth";

const E2E_PUBLISHED_SEED_KEY = "codex-e2e-published-schedules";
const TEST_YEAR = 2099;
const TEST_MONTH = 7;

type ViewportCase = {
  width: number;
  height: number;
  expectedMode: "mobile" | "tablet";
};

const viewportCases: ViewportCase[] = [
  { width: 320, height: 568, expectedMode: "mobile" },
  { width: 360, height: 740, expectedMode: "mobile" },
  { width: 375, height: 812, expectedMode: "mobile" },
  { width: 390, height: 844, expectedMode: "mobile" },
  { width: 393, height: 852, expectedMode: "mobile" },
  { width: 412, height: 915, expectedMode: "mobile" },
  { width: 430, height: 932, expectedMode: "mobile" },
  { width: 768, height: 1024, expectedMode: "tablet" },
  { width: 820, height: 1180, expectedMode: "tablet" },
];

function createDay(day: number) {
  const date = new Date(TEST_YEAR, TEST_MONTH - 1, day);
  return {
    dateKey: `${TEST_YEAR}-${String(TEST_MONTH).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day,
    month: TEST_MONTH,
    year: TEST_YEAR,
    dow: date.getDay(),
    isWeekend: date.getDay() === 0 || date.getDay() === 6,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: {
      조근: ["관리자", "반일훈"],
      일반: ["김진광", "유연경"],
      석근: ["정상원", "정재우", "조용희"],
      뉴스대기: ["박재현", "최무룡"],
      청와대: ["장후원", "신동환"],
      국회: ["이학진", "정상원"],
      청사: ["이주원", "이동현"],
      야근: ["유규열", "박대권"],
    },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
}

function createPublishedSchedule() {
  const monthKey = `${TEST_YEAR}-${String(TEST_MONTH).padStart(2, "0")}`;
  const days = Array.from({ length: 31 }, (_, index) => createDay(index + 1));
  return [
    {
      monthKey,
      title: `${TEST_YEAR}년 ${TEST_MONTH}월 근무표`,
      publishedAt: `${TEST_YEAR}-07-01T09:00:00+09:00`,
      schedule: {
        year: TEST_YEAR,
        month: TEST_MONTH,
        monthKey,
        days,
        nextPointers: {
          morning: 1,
          extension: 1,
          evening: 1,
          nightWeekday: 1,
          nightFriday: 1,
          nightSaturday: 1,
          nightSunday: 1,
          jcheck: 1,
          holidayDuty: 1,
        },
        nextStartDate: days[0].dateKey,
      },
    },
  ];
}

async function seedWorkSchedule(page: Page) {
  const publishedItems = createPublishedSchedule();
  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);
  await page.addInitScript(
    ({ authCacheKey, authTokenKey, authSession, authCookieValue, publishedSeedKey, scheduleItems }) => {
      document.cookie = `${authTokenKey}=${authCookieValue}; path=/; max-age=3600; SameSite=Lax`;
      window.localStorage.setItem(
        authCacheKey,
        JSON.stringify({
          id: "admin-seed",
          email: "admin@example.com",
          loginId: "admin",
          username: "관리자",
          role: "admin",
          approved: true,
          mustChangePassword: false,
          canReview: true,
        }),
      );
      window.localStorage.setItem(authTokenKey, JSON.stringify(authSession));
      window.localStorage.setItem(publishedSeedKey, JSON.stringify(scheduleItems));
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      authTokenKey: supabaseAuthTokenKey,
      authSession: supabaseSession,
      authCookieValue: supabaseCookieValue,
      publishedSeedKey: E2E_PUBLISHED_SEED_KEY,
      scheduleItems: publishedItems,
    },
  );
}

async function readPanZoomMetrics(page: Page) {
  return page.locator("[data-testid='schedule-pan-zoom-surface']").evaluate((surfaceElement) => {
    const surface = surfaceElement as HTMLElement;
    const canvas = surface.querySelector<HTMLElement>("[data-testid='schedule-pan-zoom-content']");
    if (!canvas) throw new Error("pan/zoom canvas not found");
    const surfaceRect = surface.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const numberFromData = (name: string) => Number(surface.dataset[name] ?? Number.NaN);
    return {
      scale: numberFromData("scale"),
      fitScale: numberFromData("fitScale"),
      panX: numberFromData("panX"),
      panY: numberFromData("panY"),
      contentWidth: numberFromData("contentWidth"),
      contentHeight: numberFromData("contentHeight"),
      viewportWidth: surface.clientWidth,
      viewportHeight: surface.clientHeight,
      surface: {
        left: surfaceRect.left,
        top: surfaceRect.top,
        right: surfaceRect.right,
        bottom: surfaceRect.bottom,
      },
      canvas: {
        left: canvasRect.left,
        top: canvasRect.top,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
      },
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

function expectPanWithinBounds(metrics: Awaited<ReturnType<typeof readPanZoomMetrics>>) {
  const scaledWidth = metrics.contentWidth * metrics.scale;
  const scaledHeight = metrics.contentHeight * metrics.scale;
  const minX = Math.min(0, metrics.viewportWidth - scaledWidth);
  const minY = Math.min(0, metrics.viewportHeight - scaledHeight);
  expect(metrics.panX).toBeGreaterThanOrEqual(minX - 1);
  expect(metrics.panX).toBeLessThanOrEqual(Math.max(0, (metrics.viewportWidth - scaledWidth) / 2) + 1);
  expect(metrics.panY).toBeGreaterThanOrEqual(minY - 1);
  expect(metrics.panY).toBeLessThanOrEqual(Math.max(0, (metrics.viewportHeight - scaledHeight) / 2) + 1);
  expect(Math.min(metrics.surface.right, metrics.canvas.right) - Math.max(metrics.surface.left, metrics.canvas.left)).toBeGreaterThan(1);
  expect(Math.min(metrics.surface.bottom, metrics.canvas.bottom) - Math.max(metrics.surface.top, metrics.canvas.top)).toBeGreaterThan(1);
}

async function dragPanZoomSurface(page: Page, direction: "negative" | "positive") {
  const surface = page.locator("[data-testid='schedule-pan-zoom-surface']");
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("pan/zoom surface has no visible bounding box");

  const left = Math.max(8, box.x + 8);
  const right = Math.min(viewport.width - 8, box.x + box.width - 8);
  const top = Math.max(8, box.y + 8);
  const bottom = Math.min(viewport.height - 8, box.y + box.height - 8);
  const startRatio = direction === "negative" ? 0.75 : 0.25;
  const endRatio = direction === "negative" ? 0.25 : 0.75;
  const startX = left + (right - left) * startRatio;
  const startY = top + (bottom - top) * startRatio;
  const endX = left + (right - left) * endRatio;
  const endY = top + (bottom - top) * endRatio;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 4 });
  await page.mouse.up();
}

async function dragFromNameChip(page: Page, chip: Locator) {
  const surface = page.locator("[data-testid='schedule-pan-zoom-surface']");
  await surface.scrollIntoViewIfNeeded();
  const surfaceBox = await surface.boundingBox();
  const chipBox = await chip.boundingBox();
  if (!surfaceBox || !chipBox) throw new Error("name chip is not visible inside the pan/zoom surface");

  const startX = chipBox.x + chipBox.width / 2;
  const startY = chipBox.y + chipBox.height / 2;
  const canMoveRight = startX + 48 < surfaceBox.x + surfaceBox.width - 8;
  const endX = startX + (canMoveRight ? 48 : -48);
  const endY = Math.min(surfaceBox.y + surfaceBox.height - 8, startY + 24);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 4 });
  await page.mouse.up();
}

for (const viewportCase of viewportCases) {
  test(`monthly pan/zoom preserves fit, bounds, reset, and name tap at ${viewportCase.width}px`, async ({ browser }) => {
    const contextOptions: BrowserContextOptions = {
      baseURL: E2E_BASE_URL,
      viewport: { width: viewportCase.width, height: viewportCase.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    };
    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage();
      let changeRequestPostCount = 0;
      await page.route("**/rest/v1/schedule_change_requests**", async (route) => {
        if (route.request().method() === "POST") changeRequestPostCount += 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      });
      await page.route("**/rest/v1/portal_user_settings**", async (route) => {
        await route.fulfill({
          status: 406,
          contentType: "application/json",
          body: JSON.stringify({ code: "PGRST116", details: "No rows", hint: null, message: "No rows" }),
        });
      });
      await seedWorkSchedule(page);
      await page.goto("/work-schedule");

    const surface = page.locator("[data-testid='schedule-pan-zoom-surface']");
    await expect(surface).toHaveAttribute("data-layout-mode", viewportCase.expectedMode);
    await expect.poll(async () => Number(await surface.getAttribute("data-fit-scale"))).toBeGreaterThan(0);

    const initial = await readPanZoomMetrics(page);
    expect(initial.scale).toBeCloseTo(initial.fitScale, 5);
    expect(initial.canvas.left).toBeGreaterThanOrEqual(initial.surface.left - 1);
    expect(initial.canvas.right).toBeLessThanOrEqual(initial.surface.right + 1);
    expect(initial.canvas.top).toBeGreaterThanOrEqual(initial.surface.top - 1);
    expect(initial.canvas.bottom).toBeLessThanOrEqual(initial.surface.bottom + 1);
    expect(initial.documentOverflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "근무 수정" }).click();
    const ownNameChip = page.locator("[data-schedule-change-name-chip='true']").filter({ hasText: "관리자" }).first();
    await dragFromNameChip(page, ownNameChip);
    await expect(page.getByText("선택된 인원 1명")).toHaveCount(0);
    expect(changeRequestPostCount).toBe(0);

    const zoomIn = page.getByRole("button", { name: "근무표 확대" });
    await zoomIn.click();
    await zoomIn.click();
    const zoomed = await readPanZoomMetrics(page);
    expect(zoomed.scale).toBeGreaterThan(initial.scale);
    expect(zoomed.scale).toBeLessThanOrEqual(3);

    for (let index = 0; index < 4; index += 1) await dragPanZoomSurface(page, "negative");
    const negativePan = await readPanZoomMetrics(page);
    expectPanWithinBounds(negativePan);
    expect(Math.abs(negativePan.panX - zoomed.panX) + Math.abs(negativePan.panY - zoomed.panY)).toBeGreaterThan(1);
    for (let index = 0; index < 6; index += 1) await dragPanZoomSurface(page, "positive");
    const positivePan = await readPanZoomMetrics(page);
    expectPanWithinBounds(positivePan);
    expect(Math.abs(positivePan.panX - negativePan.panX) + Math.abs(positivePan.panY - negativePan.panY)).toBeGreaterThan(1);

    await page.getByRole("button", { name: "전체 맞춤" }).click();
    const reset = await readPanZoomMetrics(page);
    expect(reset.scale).toBeCloseTo(initial.fitScale, 5);
    expect(reset.panX).toBeCloseTo(initial.panX, 3);
    expect(reset.panY).toBeCloseTo(initial.panY, 3);

    await ownNameChip.tap();
    await expect(page.getByText("선택된 인원 1명")).toBeVisible();
    expect(changeRequestPostCount).toBe(0);
    } finally {
      await context.close();
    }
  });
}
