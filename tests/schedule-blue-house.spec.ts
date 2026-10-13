import { expect, test, type Page } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";
import {
  applyScheduleAssignmentDutyCategoriesToSchedule,
  createDefaultScheduleAssignmentDayRows,
  getScheduleAssignmentRows,
  type ScheduleAssignmentDataStore,
} from "@/lib/team-lead/storage";

const SCHEDULE_SEED_KEY = "codex-e2e-schedule-state";

// 청와대 기본 이름은 이번 달 이후 근무표에만 채워지므로 다음 달 평일로 시드한다.
function getNextMonthWeekday() {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function createBlueHouseSeed() {
  const date = getNextMonthWeekday();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
  const generated = {
    year,
    month,
    monthKey,
    days: [
      {
        dateKey,
        day,
        month,
        year,
        dow: date.getDay(),
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: {
          조근: ["유규열"],
          석근: ["장후원"],
          야근: ["이지수"],
        },
        manualExtras: [],
        headerName: "홍승재",
        conflicts: [],
      },
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
    nextStartDate: dateKey,
  };

  return {
    dateKey,
    state: {
      year,
      month,
      generalTeamPeople: ["구본준", "김재식", "박재현"],
      generalTeamRosterVersion: 2,
      blueHousePeople: ["박재현", "김재식"],
      generated,
      generatedHistory: [generated],
      currentUser: "관리자",
      showMyWork: false,
      editDateKey: null,
      editingMonthKey: null,
      selectedPerson: null,
    },
  };
}

async function seedScheduleWritePage(page: Page, seedState: unknown) {
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
      if (!window.sessionStorage.getItem("blue-house-seeded")) {
        window.localStorage.setItem(scheduleSeedKey, JSON.stringify(seedState));
        window.sessionStorage.setItem("blue-house-seeded", "1");
      }
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

test("weekday blue house row defaults to the first name, toggles, and counts as duty for 일반", async ({ page }) => {
  const { dateKey, state } = createBlueHouseSeed();
  await seedScheduleWritePage(page, state);
  await page.goto("/schedule/write");

  const dayCard = page.locator(`[data-date-key="${dateKey}"]`).first();
  const blueHouseToggle = dayCard.locator('[data-blue-house-toggle="true"]');
  const generalRow = dayCard.locator('[data-category="일반"]');

  await expect(blueHouseToggle).toHaveText("박재현");
  await expect(generalRow).toContainText("김재식");
  await expect(generalRow).not.toContainText("박재현");

  // 청와대 칸은 날짜 칸의 맨 아래에 있어야 한다.
  await expect(dayCard.locator("[data-category]").last()).toHaveAttribute("data-category", "청와대");

  await blueHouseToggle.click();
  await expect(blueHouseToggle).toHaveText("김재식");
  await expect(generalRow).toContainText("박재현");
  await expect(generalRow).not.toContainText("김재식");

  await blueHouseToggle.click();
  await expect(blueHouseToggle).toHaveText("박재현");
});

test("weekday blue house names stay out of 일정배정 rows and survive linked duty sync", () => {
  const { dateKey, state } = createBlueHouseSeed();
  const day = {
    ...state.generated.days[0],
    assignments: { ...state.generated.days[0].assignments, 청와대: ["박재현"], 국회: ["구본준"] },
  };
  const schedule = { ...state.generated, days: [day] };
  const emptyStore: ScheduleAssignmentDataStore = { entries: {}, rows: {} };

  const rows = getScheduleAssignmentRows(day, createDefaultScheduleAssignmentDayRows());
  expect(rows.some((row) => row.name === "박재현")).toBe(false);
  expect(rows.some((row) => row.name === "구본준" && row.duty === "국회")).toBe(true);

  const synced = applyScheduleAssignmentDutyCategoriesToSchedule(schedule, emptyStore, []);
  const syncedDay = synced.days.find((item) => item.dateKey === dateKey);
  expect(syncedDay?.assignments["청와대"]).toEqual(["박재현"]);
});
