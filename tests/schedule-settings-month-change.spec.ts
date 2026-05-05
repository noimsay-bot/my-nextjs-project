import { expect, test, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const SCHEDULE_SEED_KEY = "codex-e2e-schedule-state";

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

function createGeneratedMonth(year: number, month: number, nextStartDate: string) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  return {
    year,
    month,
    monthKey,
    days: Array.from({ length: daysInMonth }, (_, index) =>
      createDay(year, month, index + 1, {
        조근: ["유규열"],
        일반: ["김진광", "유연경"],
        석근: ["장후원"],
        야근: ["박대권"],
      }),
    ),
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
    nextStartDate,
  };
}

function createScheduleSeed() {
  const april = createGeneratedMonth(2026, 4, "2026-05-04");
  const may = createGeneratedMonth(2026, 5, "2026-06-01");
  return {
    year: 2026,
    month: 4,
    generated: april,
    generatedHistory: [april, may],
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

test("changing the schedule month clears weekday holidays and updates the visible month", async ({ page }) => {
  await seedScheduleWritePage(page);

  await page.goto("/schedule/write");
  await page.waitForSelector(".schedule-day-card");

  const monthSelect = page.locator(".field-select").nth(1);
  const holidayField = page.locator(".field-textarea");
  const currentTitle = page.locator(".schedule-current-title").first();

  await expect(currentTitle).toHaveText("2026년 4월");
  await holidayField.fill("1, 2");
  await expect(holidayField).toHaveValue("1, 2");

  await monthSelect.selectOption("5");

  await expect(holidayField).toHaveValue("");
  await expect(currentTitle).toHaveText("2026년 5월");
  await expect(page.locator(".schedule-day-card").first()).toHaveAttribute("data-date-key", "2026-05-04");
});
