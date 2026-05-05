import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const E2E_PUBLISHED_SEED_KEY = "codex-e2e-published-schedules";

type DeviceCase = {
  name: string;
  context: BrowserContextOptions;
  expectedMode: "mobile" | "tablet";
};

function createDay(year: number, month: number, day: number, assignments: Record<string, string[]> = {}) {
  const date = new Date(year, month - 1, day);
  return {
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day,
    month,
    year,
    dow: date.getDay(),
    isWeekend: date.getDay() === 0 || date.getDay() === 6,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments,
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
}

function createDensePublishedSchedule() {
  const year = 2026;
  const month = 7;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const denseAssignments: Record<string, string[]> = {
    조근: ["정철원", "반일훈"],
    일반: ["김진광", "유연경"],
    석근: ["정상원", "정재우", "조용희"],
    뉴스대기: ["박재현", "최무룡"],
    청와대: ["장후원", "신동환"],
    국회: ["이학진", "정상원"],
    청사: ["이주원", "이동현"],
    야근: ["유규열", "박대권"],
  };

  const days = Array.from({ length: 31 }, (_, index) =>
    createDay(year, month, index + 1, {
      ...denseAssignments,
      ...(index % 3 === 0 ? { 휴가: ["조용희(연차)", "김재식(대휴)"] } : {}),
    }),
  );

  return [
    {
      monthKey,
      title: `${year}년 ${month}월 근무표`,
      publishedAt: "2026-07-01T09:00:00+09:00",
      schedule: {
        year,
        month,
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

async function seedHomePage(page: Page) {
  const publishedItems = createDensePublishedSchedule();
  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);
  await page.addInitScript(
    ({ authCacheKey, supabaseAuthTokenKey, supabaseSession, supabaseCookieValue, publishedSeedKey, publishedItems }) => {
      document.cookie = `${supabaseAuthTokenKey}=${supabaseCookieValue}; path=/; max-age=3600; SameSite=Lax`;
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
      window.localStorage.setItem(
        supabaseAuthTokenKey,
        JSON.stringify(supabaseSession),
      );
      window.localStorage.setItem(publishedSeedKey, JSON.stringify(publishedItems));
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      supabaseAuthTokenKey,
      supabaseSession,
      supabaseCookieValue,
      publishedSeedKey: E2E_PUBLISHED_SEED_KEY,
      publishedItems,
    },
  );
}

const deviceCases: DeviceCase[] = [
  {
    name: "iPhone SE",
    context: {
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
    expectedMode: "mobile",
  },
  {
    name: "iPhone 14 Pro Max",
    context: {
      viewport: { width: 430, height: 932 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
    expectedMode: "mobile",
  },
  {
    name: "Galaxy S23 Ultra",
    context: {
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3.5,
    },
    expectedMode: "mobile",
  },
  {
    name: "Surface Duo",
    context: {
      viewport: { width: 540, height: 720 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2.5,
    },
    expectedMode: "tablet",
  },
  {
    name: "Galaxy Fold Open",
    context: {
      viewport: { width: 673, height: 841 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2.5,
    },
    expectedMode: "tablet",
  },
  {
    name: "iPad Mini",
    context: {
      viewport: { width: 768, height: 1024 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
    expectedMode: "tablet",
  },
];

for (const deviceCase of deviceCases) {
  test(`home published schedule layout stays separated on ${deviceCase.name}`, async ({ browser }) => {
    const context = await browser.newContext(deviceCase.context);
    const page = await context.newPage();
    await seedHomePage(page);
    await page.goto("/");
    await page.waitForSelector(".schedule-calendar-grid--daily");

    const panel = page.locator(`.schedule-published-panel--${deviceCase.expectedMode}`);
    await expect(panel).toBeVisible();

    await expect(page.locator(".schedule-calendar-grid--home-mobile-three-day")).toBeVisible();
    await expect(page.locator(".schedule-calendar-grid--home-mobile-three-day .schedule-day-card")).toHaveCount(6);

    const homeRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".schedule-calendar-grid--home-mobile-three-day > div > div"))
        .map((row) => row.querySelectorAll(".schedule-day-card").length),
    );
    expect(homeRows).toEqual([3, 3]);

    const threePersonGrid = await page.evaluate(() => {
      const grid = Array.from(document.querySelectorAll<HTMLElement>(".schedule-published-panel--home-three-day .schedule-name-grid"))
        .find((candidate) => candidate.querySelectorAll(".schedule-name-chip").length === 3);
      const columns = grid
        ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
        : 0;
      return {
        chipCount: grid?.querySelectorAll(".schedule-name-chip").length ?? 0,
        columns,
      };
    });
    expect(threePersonGrid).toEqual({ chipCount: 3, columns: 2 });

    const diagnostics = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll<HTMLElement>(".schedule-day-card .schedule-name-chip"));
      const overlaps: Array<{ a: string; b: string; left: number; top: number }> = [];
      const overflows: Array<{ name: string; side: string; amount: number }> = [];

      for (const chip of chips) {
        const chipRect = chip.getBoundingClientRect();
        const card = chip.closest<HTMLElement>(".schedule-day-card");
        if (!card) continue;
        const cardRect = card.getBoundingClientRect();
        const label = chip.textContent?.trim() || "(blank)";

        if (chipRect.right - cardRect.right > 0.5) {
          overflows.push({ name: label, side: "right", amount: chipRect.right - cardRect.right });
        }
        if (chipRect.left - cardRect.left < -0.5) {
          overflows.push({ name: label, side: "left", amount: cardRect.left - chipRect.left });
        }

        const siblings = Array.from(chip.parentElement?.querySelectorAll<HTMLElement>(".schedule-name-chip") ?? []);
        for (const sibling of siblings) {
          if (sibling === chip) continue;
          const siblingRect = sibling.getBoundingClientRect();
          const horizontal = chipRect.left < siblingRect.right - 0.5 && chipRect.right > siblingRect.left + 0.5;
          const vertical = chipRect.top < siblingRect.bottom - 0.5 && chipRect.bottom > siblingRect.top + 0.5;
          if (horizontal && vertical) {
            const a = label;
            const b = sibling.textContent?.trim() || "(blank)";
            if (!overlaps.some((item) => (item.a === a && item.b === b) || (item.a === b && item.b === a))) {
              overlaps.push({ a, b, left: Math.round(chipRect.left), top: Math.round(chipRect.top) });
            }
          }
        }
      }

      const panel = document.querySelector<HTMLElement>("[class*='schedule-published-panel--']");
      return {
        className: panel?.className ?? "",
        chipCount: chips.length,
        overlaps,
        overflows,
      };
    });

    expect(diagnostics.chipCount).toBeGreaterThan(20);
    expect.soft(diagnostics.overlaps, `${deviceCase.name} overlap diagnostics: ${JSON.stringify(diagnostics)}`).toEqual([]);
    expect.soft(diagnostics.overflows, `${deviceCase.name} overflow diagnostics: ${JSON.stringify(diagnostics)}`).toEqual([]);

    await context.close();
  });
}

test("desktop home published schedule shows the current Monday-Sunday week", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await seedHomePage(page);

  await page.goto("/");
  await page.waitForSelector(".schedule-calendar-grid--daily");

  await expect(page.locator(".schedule-published-panel--desktop")).toBeVisible();
  await expect(page.locator(".schedule-published-panel--home-three-day")).toHaveCount(0);
  await expect(page.locator(".schedule-calendar-grid--home-mobile-three-day")).toHaveCount(0);
  await expect(page.locator(".schedule-calendar-grid--daily .schedule-day-card")).toHaveCount(7);

  const metrics = await page.evaluate(() => {
    const dayLabels = Array.from(document.querySelectorAll<HTMLElement>(".schedule-calendar-grid--daily > .schedule-day-card .schedule-day-date span"))
      .map((node) => node.textContent?.trim() ?? "");
    const weekdayLabels = Array.from(document.querySelectorAll<HTMLElement>(".schedule-calendar-grid--daily > .schedule-weekday"))
      .map((node) => node.textContent?.trim() ?? "");
    const grid = document.querySelector<HTMLElement>(".schedule-calendar-grid--daily");
    return {
      dayLabels,
      weekdayLabels,
      gridColumns: grid ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0,
    };
  });

  expect(metrics.weekdayLabels).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
  expect(metrics.dayLabels).toEqual(["6/29", "6/30", "7/1", "7/2", "7/3", "7/4", "7/5"]);
  expect(metrics.gridColumns).toBe(7);

  await context.close();
});

test("mobile work schedule defaults to full fit and toggles to three-day rows", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await seedHomePage(page);

  await page.goto("/work-schedule");
  await page.waitForSelector(".schedule-calendar-grid--daily");

  await expect(page.locator(".schedule-published-panel--mobile-full-fit")).toBeVisible();
  await expect(page.locator(".schedule-published-zoom-controls")).toBeVisible();
  await expect(page.locator(".schedule-calendar-grid--home-mobile-three-day")).toHaveCount(0);
  await expect(page.locator(".schedule-calendar-grid--daily .schedule-day-card")).toHaveCount(33);

  await page.waitForFunction(() => {
    const zoom = document.querySelector<HTMLElement>(".schedule-published-panel--mobile-full-fit .schedule-calendar-zoom--daily");
    return Boolean(zoom?.style.transform?.startsWith("scale("));
  });

  await page.getByRole("button", { name: "보기 변경" }).click();

  await expect(page.locator(".schedule-published-panel--three-day")).toBeVisible();
  await expect(page.locator(".schedule-published-zoom-controls")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "전체 보기" })).toBeVisible();

  const threeDayMetrics = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>(".schedule-published-panel--three-day .schedule-calendar-scroll--daily");
    const row = document.querySelector<HTMLElement>(".schedule-calendar-grid--home-mobile-three-day > div > div");
    const firstNameGrid = document.querySelector<HTMLElement>(".schedule-published-panel--page-three-day .schedule-name-grid");
    const scrollRect = scroll?.getBoundingClientRect();
    const firstRowCardRects = Array.from(row?.querySelectorAll<HTMLElement>(".schedule-day-card") ?? []).map((card) =>
      card.getBoundingClientRect(),
    );
    const allCardRects = Array.from(document.querySelectorAll<HTMLElement>(".schedule-published-panel--page-three-day .schedule-day-card")).map((card) =>
      card.getBoundingClientRect(),
    );
    const maxCardRight = Math.max(...firstRowCardRects.map((rect) => rect.right));
    const maxCardHeight = Math.max(...allCardRects.map((rect) => rect.height));
    const nameGridColumns = firstNameGrid
      ? window.getComputedStyle(firstNameGrid).gridTemplateColumns.split(" ").filter(Boolean).length
      : 0;
    return {
      totalCardCount: allCardRects.length,
      rowCardCount: firstRowCardRects.length,
      rightOverflow: scrollRect ? maxCardRight - scrollRect.right : 0,
      maxCardHeight,
      nameGridColumns,
    };
  });

  expect(threeDayMetrics.totalCardCount).toBe(33);
  expect(threeDayMetrics.rowCardCount).toBe(3);
  expect(threeDayMetrics.rightOverflow).toBeLessThanOrEqual(1);
  expect(threeDayMetrics.nameGridColumns).toBe(2);
  expect(threeDayMetrics.maxCardHeight).toBeLessThanOrEqual(360);

  await context.close();
});
