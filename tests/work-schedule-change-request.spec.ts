import { expect, test, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const SCHEDULE_SEED_KEY = "codex-e2e-schedule-state";
const PUBLISHED_SCHEDULES_SEED_KEY = "codex-e2e-published-schedules";

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

function createPublishedSchedule() {
  const year = 2026;
  const month = 7;
  const days = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return createDay(
      year,
      month,
      day,
      day === 4
        ? {
            주말조근: ["박서준"],
            주말일반근무: ["이도윤", "한소희"],
            뉴스대기: ["김진광"],
            야근: ["관리자"],
          }
        : {},
    );
  });

  return {
    year,
    month,
    monthKey: `${year}-${String(month).padStart(2, "0")}`,
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
  };
}

function createScheduleState(schedule: ReturnType<typeof createPublishedSchedule>) {
  return {
    year: schedule.year,
    month: schedule.month,
    generated: schedule,
    generatedHistory: [schedule],
    currentUser: "관리자",
    showMyWork: false,
    editDateKey: null,
    editingMonthKey: null,
    selectedPerson: null,
  };
}

async function seedWorkSchedulePage(page: Page) {
  const schedule = createPublishedSchedule();
  const publishedItems = [
    {
      monthKey: schedule.monthKey,
      title: `${schedule.year}년 ${schedule.month}월 근무표`,
      publishedAt: "2026-07-01T09:00:00+09:00",
      schedule,
    },
  ];
  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);

  await page.addInitScript(
    ({
      authCacheKey,
      supabaseAuthTokenKey,
      supabaseSession,
      supabaseCookieValue,
      scheduleSeedKey,
      publishedSeedKey,
      scheduleState,
      publishedItems,
    }) => {
      document.cookie = `${supabaseAuthTokenKey}=${supabaseCookieValue}; path=/; max-age=3600; SameSite=Lax`;
      window.localStorage.setItem(
        authCacheKey,
        JSON.stringify({
          id: "admin-seed",
          email: "admin@example.com",
          loginId: "admin",
          username: "관리자",
          role: "admin",
          actualRole: "admin",
          experienceRole: null,
          approved: true,
          mustChangePassword: false,
          canReview: true,
          actualCanReview: true,
        }),
      );
      window.localStorage.setItem(supabaseAuthTokenKey, JSON.stringify(supabaseSession));
      window.localStorage.setItem(scheduleSeedKey, JSON.stringify(scheduleState));
      window.localStorage.setItem(publishedSeedKey, JSON.stringify(publishedItems));
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      supabaseAuthTokenKey,
      supabaseSession,
      supabaseCookieValue,
      scheduleSeedKey: SCHEDULE_SEED_KEY,
      publishedSeedKey: PUBLISHED_SCHEDULES_SEED_KEY,
      scheduleState: createScheduleState(schedule),
      publishedItems,
    },
  );
}

test("same-day weekend night shift can request a news standby change", async ({ page }) => {
  let capturedInsert: Record<string, unknown> | null = null;

  await page.route("**/rest/v1/schedule_change_requests**", async (route) => {
    if (route.request().method() === "POST") {
      capturedInsert = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      await route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/portal_user_settings**", async (route) => {
    await route.fulfill({
      status: 406,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PGRST116",
        details: "The result contains 0 rows",
        hint: null,
        message: "JSON object requested, multiple (or no) rows returned",
      }),
    });
  });
  await seedWorkSchedulePage(page);

  await page.goto("/work-schedule");
  await page.getByRole("button", { name: "근무 수정" }).click();

  const weekendCard = page.locator(".schedule-day-card").filter({ hasText: "7/4" }).first();
  await expect(weekendCard).toBeVisible();

  await weekendCard.getByRole("button", { name: /관리자/ }).click();
  await expect(page.getByText("선택된 인원 1명")).toBeVisible();

  await weekendCard.getByRole("button", { name: /김진광/ }).click();
  await expect(page.getByText("선택된 인원 2명")).toBeVisible();

  await page.getByRole("button", { name: "교환 요청" }).click();
  await expect(page.getByText("근무 변경 요청을 등록했습니다.")).toBeVisible();

  await expect.poll(() => capturedInsert).not.toBeNull();
  expect((capturedInsert?.source_ref as { category?: string; name?: string })?.category).toBe("야근");
  expect((capturedInsert?.source_ref as { category?: string; name?: string })?.name).toBe("관리자");
  expect((capturedInsert?.target_ref as { category?: string; name?: string })?.category).toBe("뉴스대기");
  expect((capturedInsert?.target_ref as { category?: string; name?: string })?.name).toBe("김진광");
});
