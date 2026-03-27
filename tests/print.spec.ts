import { expect, test } from "@playwright/test";

const SESSION_KEY = "j-special-force-session-v1";
const SCHEDULE_KEY = "j-schedule-integrated-react-v1";
const PUBLISHED_SCHEDULES_KEY = "j-special-force-published-schedules-v1";
const DISABLE_AUTO_PRINT_KEY = "codex-disable-auto-print";

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

function createSampleSchedule() {
  const year = 2026;
  const month = 7;
  const assignmentMap: Record<number, Record<string, string[]>> = {
    1: { 조근: ["관리자"], 연장: ["박서준"], 석근: ["이도윤"] },
    2: { 조근: ["최민지"], 연장: ["정우성"], 석근: ["한소희"] },
    3: { 조근: ["강민석"], 일반: ["오지민"], 뉴스대기: ["배수지"] },
    4: { 조근: ["김하늘"], 뉴스대기: ["유재석"], 야근: ["송지효"] },
    7: { 석근: ["박서준"], 연장: ["김민재"] },
    14: { 연장: ["장원영"], 조근: ["차은우"] },
    20: { 야근: ["이도윤"], 일반: ["김태리"] },
    22: { 조근: ["고윤정"], 석근: ["박보검"] },
    28: { 석근: ["손예진"], 연장: ["정해인"] },
  };

  const days = Array.from({ length: 31 }, (_, index) => createDay(year, month, index + 1, assignmentMap[index + 1] ?? {}));
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

function createSampleState(schedule: ReturnType<typeof createSampleSchedule>) {
  const emptyOrder = Array.from({ length: 30 }, () => "");
  const snapshot = {
    id: "snapshot-2026-07",
    label: "2026-07 original",
    createdAt: "2026-07-01T09:00:00+09:00",
    generated: schedule,
  };
  return {
    year: schedule.year,
    month: schedule.month,
    jcheckCount: 1,
    extraHolidays: "",
    vacations: "",
    offPeople: [],
    offByCategory: {
      morning: [],
      extension: [],
      evening: [],
      nightWeekday: [],
      nightFriday: [],
      nightSaturday: [],
      nightSunday: [],
      jcheck: [],
      holidayDuty: [],
    },
    offExcludeByCategory: {
      morning: [],
      extension: [],
      evening: [],
      nightWeekday: [],
      nightFriday: [],
      nightSaturday: [],
      nightSunday: [],
      jcheck: [],
      holidayDuty: [],
    },
    orders: {
      morning: [...emptyOrder],
      extension: [...emptyOrder],
      evening: [...emptyOrder],
      nightWeekday: [...emptyOrder],
      nightFriday: [...emptyOrder],
      nightSaturday: [...emptyOrder],
      nightSunday: [...emptyOrder],
      jcheck: [...emptyOrder],
      holidayDuty: [...emptyOrder],
    },
    pointers: {
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
    monthStartPointers: {},
    monthStartNames: {},
    pendingSnapshotMonthKey: null,
    generated: schedule,
    generatedHistory: [schedule],
    snapshots: {
      [schedule.monthKey]: [snapshot],
    },
    currentUser: "관리자",
    showMyWork: false,
    editDateKey: null,
    selectedPerson: null,
  };
}

test.beforeEach(async ({ page }) => {
  const schedule = createSampleSchedule();
  const published = [
    {
      monthKey: schedule.monthKey,
      title: `${schedule.year}년 ${schedule.month}월 근무표`,
      publishedAt: "2026. 7. 1. 오전 9:00:00",
      schedule,
    },
  ];

  await page.addInitScript(
    ({ sessionKey, scheduleKey, publishedKey, disableAutoPrintKey, scheduleState, publishedItems }) => {
      window.localStorage.setItem(disableAutoPrintKey, "1");
      window.localStorage.setItem(
        sessionKey,
        JSON.stringify({
          id: "admin-seed",
          username: "관리자",
          role: "admin",
          mustChangePassword: false,
        }),
      );
      window.localStorage.setItem(scheduleKey, JSON.stringify(scheduleState));
      window.localStorage.setItem(publishedKey, JSON.stringify(publishedItems));
    },
    {
      sessionKey: SESSION_KEY,
      scheduleKey: SCHEDULE_KEY,
      publishedKey: PUBLISHED_SCHEDULES_KEY,
      disableAutoPrintKey: DISABLE_AUTO_PRINT_KEY,
      scheduleState: createSampleState(schedule),
      publishedItems: published,
    },
  );
});

test("home print popup shows schedule print sheet", async ({ page }) => {
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "출력" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  await expect(popup.getByText("7월 근무표")).toBeVisible();
  await expect(popup.locator(".schedule-print-table")).toBeVisible();
  await expect(popup.locator(".schedule-print-assignment strong", { hasText: "조근" }).first()).toBeVisible();
});

test("home print highlights my name when my-work view is enabled", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "내 근무 보기" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "출력" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  await expect(popup.locator(".schedule-print-name-highlight", { hasText: "관리자" })).toBeVisible();
});

test("desk print popup shows landscape print table", async ({ page }) => {
  await page.goto("/schedule");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "출력" }).first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  await expect(popup.getByText("7월 근무표")).toBeVisible();
  await expect(popup.locator(".schedule-print-table th")).toHaveCount(7);
  await expect(popup.locator(".schedule-print-assignment strong", { hasText: "뉴스대기" }).first()).toBeVisible();
});

test("original snapshot print popup shows original title", async ({ page }) => {
  await page.goto("/schedule");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "출력" }).nth(1).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  await expect(popup.getByText("7월 원본")).toBeVisible();
  await expect(popup.locator(".schedule-print-table")).toBeVisible();
});
