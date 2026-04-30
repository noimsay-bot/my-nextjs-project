import { expect, test, type Page } from "@playwright/test";

const AUTH_CACHE_KEY = "j-special-force-auth-cache-v3";

async function seedScheduleWritePage(page: Page) {
  await page.addInitScript(
    ({ authCacheKey }) => {
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
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
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
