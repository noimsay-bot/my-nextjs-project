import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_CACHE_KEY = "j-special-force-auth-cache-v3";
const E2E_PUBLISHED_SEED_KEY = "codex-e2e-published-schedules";

function getSupabaseAuthTokenKey() {
  for (const envFile of [".env.local", ".env"]) {
    const fullPath = path.join(process.cwd(), envFile);
    if (!fs.existsSync(fullPath)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    const match = text.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)/);
    if (!match) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, "");
    const host = new URL(value).hostname.split(".")[0];
    return `sb-${host}-auth-token`;
  }
  return "sb-local-auth-token";
}

const SUPABASE_AUTH_TOKEN_KEY = getSupabaseAuthTokenKey();

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
  await page.addInitScript(
    ({ authCacheKey, supabaseAuthTokenKey, publishedSeedKey, publishedItems }) => {
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
        JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: "admin-seed",
            email: "admin@example.com",
            user_metadata: {
              role: "admin",
              login_id: "admin",
              name: "관리자",
            },
          },
        }),
      );
      window.localStorage.setItem(publishedSeedKey, JSON.stringify(publishedItems));
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      supabaseAuthTokenKey: SUPABASE_AUTH_TOKEN_KEY,
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
