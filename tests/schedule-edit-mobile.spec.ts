import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const SCHEDULE_SEED_KEY = "codex-e2e-schedule-state";

type DeviceCase = {
  name: string;
  context: BrowserContextOptions;
};

function createDay(year: number, month: number, day: number, assignments: Record<string, string[]>) {
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
    headerName: "홍승재",
    conflicts: [],
  };
}

function createScheduleSeed() {
  const year = 2026;
  const month = 5;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const generated = {
    year,
    month,
    monthKey,
    days: [
      createDay(year, month, 5, {
        조근: ["유규열"],
        일반: ["김진광", "유연경"],
        석근: ["장후원"],
        야근: ["이지수"],
      }),
      createDay(year, month, 6, {
        조근: ["반일훈"],
        일반: ["정상원", "황현우"],
        석근: ["신동환"],
        야근: ["박대권"],
      }),
    ],
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
    nextStartDate: `${year}-${String(month).padStart(2, "0")}-07`,
  };

  return {
    year,
    month,
    generated,
    generatedHistory: [generated],
    currentUser: "관리자",
    showMyWork: false,
    editDateKey: null,
    editingMonthKey: null,
    selectedPerson: null,
  };
}

async function seedScheduleWritePage(page: Page) {
  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);
  await page.addInitScript(
    ({ authCacheKey, supabaseAuthTokenKey, supabaseSession, supabaseCookieValue, scheduleSeedKey, seedState }) => {
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
      window.localStorage.setItem(supabaseAuthTokenKey, JSON.stringify(supabaseSession));
      window.localStorage.setItem(scheduleSeedKey, JSON.stringify(seedState));
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      supabaseAuthTokenKey,
      supabaseSession,
      supabaseCookieValue,
      scheduleSeedKey: SCHEDULE_SEED_KEY,
      seedState: createScheduleSeed(),
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
  },
  {
    name: "iPad Mini",
    context: {
      viewport: { width: 768, height: 1024 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    },
  },
];

for (const deviceCase of deviceCases) {
  test(`schedule edit swap stays usable on ${deviceCase.name}`, async ({ browser }) => {
    const context = await browser.newContext(deviceCase.context);
    const page = await context.newPage();
    await seedScheduleWritePage(page);

    await page.goto("/schedule/write");
    await page.waitForSelector(".schedule-day-card");
    await page.getByRole("button", { name: "수정 모드" }).click({ force: true });

    const dayCard = page.locator('.schedule-day-card[data-date-key="2026-05-05"]').first();
    await expect(dayCard).toBeVisible();
    await expect(dayCard.locator("button.schedule-name-chip--empty").first()).toBeVisible();

    await expect(dayCard.locator('article[data-category="일반"] button.schedule-name-chip--empty').first()).toBeVisible();
    await expect(dayCard.locator('article[data-category="석근"] button.schedule-name-chip--empty').first()).toBeVisible();

    const diagnostics = await dayCard.evaluate((card) => {
      const chips = Array.from(card.querySelectorAll<HTMLElement>(".schedule-name-chip"));
      const overlaps: string[] = [];

      for (let index = 0; index < chips.length; index += 1) {
        const chip = chips[index];
        const rect = chip.getBoundingClientRect();
        const label = chip.textContent?.trim() || "(blank)";

        for (let compareIndex = index + 1; compareIndex < chips.length; compareIndex += 1) {
          const other = chips[compareIndex];
          const otherRect = other.getBoundingClientRect();
          const intersects =
            rect.left < otherRect.right &&
            rect.right > otherRect.left &&
            rect.top < otherRect.bottom &&
            rect.bottom > otherRect.top;
          if (intersects) {
            overlaps.push(`${label}<->${other.textContent?.trim() || "(blank)"}`);
          }
        }
      }

      return { overlaps };
    });

    expect(diagnostics.overlaps).toEqual([]);

    await page.getByRole("button", { name: "수정 완료" }).dispatchEvent("click");
    await expect(page.getByRole("button", { name: "수정 모드" })).toBeVisible();
    await expect(dayCard.locator(".schedule-name-chip--empty")).toHaveCount(0);

    await context.close();
  });
}
