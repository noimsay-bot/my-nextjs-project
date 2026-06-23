import { expect, test, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const SCHEDULE_SEED_KEY = "codex-e2e-schedule-state";

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
    vacations: assignments["휴가"] ?? [],
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
    nextStartDate: `${year}-${String(month).padStart(2, "0")}-06`,
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

async function seedScheduleWritePage(page: Page, seedState = createScheduleSeed()) {
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
      seedState,
    },
  );
}

test("dragging one name chip onto another swaps them 1:1", async ({ page }) => {
  await seedScheduleWritePage(page);

  await page.goto("/schedule/write");
  await page.waitForSelector(".schedule-day-card");
  await page.getByRole("button", { name: "수정 모드" }).click();

  const dayCard = page.locator('.schedule-day-card[data-date-key="2026-05-05"]').first();
  await expect(dayCard).toBeVisible();

  const generalChip = dayCard
    .locator('article[data-category="일반"] .schedule-name-chip')
    .filter({ hasText: "김진광" })
    .first();
  const eveningChip = dayCard
    .locator('article[data-category="석근"] .schedule-name-chip')
    .filter({ hasText: "장후원" })
    .first();

  await expect(generalChip).toBeVisible();
  await expect(eveningChip).toBeVisible();

  await generalChip.dragTo(eveningChip);

  await expect(
    dayCard.locator('article[data-category="일반"] .schedule-name-chip').filter({ hasText: "장후원" }).first(),
  ).toBeVisible();
  await expect(
    dayCard.locator('article[data-category="석근"] .schedule-name-chip').filter({ hasText: "김진광" }).first(),
  ).toBeVisible();
});

test("vacation deletion is preserved without running assembly sync while editing", async ({ page }) => {
  const year = 2026;
  const month = 6;
  const monthKey = "2026-06";
  const targetDay = createDay(year, month, 24, {
    일반: ["정상원"],
    휴가: ["연차:김영묵"],
    국회: ["김재식", "이지수"],
  });
  const generated = {
    ...createScheduleSeed().generated,
    year,
    month,
    monthKey,
    days: [targetDay],
    nextStartDate: "2026-06-25",
  };
  const seedState = {
    ...createScheduleSeed(),
    year,
    month,
    generated,
    generatedHistory: [generated],
  };
  await page.route("**/api/schedule/assembly-sync-on-publish", async (route) => {
    await route.abort("blockedbyclient");
  });
  await seedScheduleWritePage(page, seedState);

  await page.goto("/schedule/write");
  await page.waitForSelector(".schedule-day-card");
  await page.getByRole("button", { name: "수정 모드" }).click();

  const dayCard = page.locator('.schedule-day-card[data-date-key="2026-06-24"]').first();
  const vacationLayer = dayCard
    .locator('article[data-category="휴가"] .schedule-trip-tooltip-layer')
    .filter({ hasText: "김영묵" })
    .first();
  await expect(vacationLayer).toBeVisible();

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await vacationLayer.locator("button").click();

  await expect(
    dayCard.locator('article[data-category="휴가"] .schedule-name-chip').filter({ hasText: "김영묵" }),
  ).toHaveCount(0);
  await expect(
    dayCard.locator('article[data-category="국회"] .schedule-name-chip').filter({ hasText: "김재식" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "수정 완료" }).click();

  const storedState = await page.evaluate((scheduleSeedKey) => {
    const raw = window.localStorage.getItem(scheduleSeedKey);
    return raw ? JSON.parse(raw) : null;
  }, SCHEDULE_SEED_KEY);
  const storedDay = storedState.generatedHistory[0].days.find(
    (day: { dateKey: string }) => day.dateKey === "2026-06-24",
  );

  expect(storedDay.assignments["휴가"]).not.toContain("연차:김영묵");
  expect(storedDay.vacations).not.toContain("연차:김영묵");
  expect(storedDay.assignments["국회"]).toEqual(["김재식", "이지수"]);
});
