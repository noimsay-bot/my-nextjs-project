import { test, expect } from "@playwright/test";
import { defaultScheduleState, isAutoManagedGeneralAssignment } from "@/lib/schedule/constants";
import { moveAssignmentCategory, sanitizeScheduleState, syncGeneralAssignments } from "@/lib/schedule/engine";
import type { DaySchedule, GeneratedSchedule, ScheduleState } from "@/lib/schedule/types";

function createHolidayDay(): DaySchedule {
  return {
    dateKey: "2026-05-01",
    day: 1,
    month: 5,
    year: 2026,
    dow: 5,
    isWeekend: false,
    isHoliday: true,
    isCustomHoliday: true,
    isWeekdayHoliday: true,
    isOverflowMonth: false,
    vacations: [],
    assignments: {
      조근: ["조용희"],
      일반: ["구본준"],
      석근: ["이학진"],
      야근: ["반일훈"],
    },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
}

function createState(): ScheduleState {
  const generated: GeneratedSchedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    days: [createHolidayDay()],
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-06-01",
  };

  return sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
    generated,
    generatedHistory: [generated],
  });
}

test("weekday holiday work-type card order can be moved", () => {
  const next = moveAssignmentCategory(createState(), "2026-05-01", "야근", "조근");
  const day = next.generated?.days.find((item) => item.dateKey === "2026-05-01");
  const workTypeOrder = Object.keys(day?.assignments ?? {}).filter((category) =>
    ["조근", "일반", "석근", "야근"].includes(category),
  );
  const workTypeOverrideOrder = (day?.assignmentOrderOverrides ?? []).filter((category) =>
    ["조근", "일반", "석근", "야근"].includes(category),
  );

  expect(workTypeOrder).toEqual(["야근", "조근", "일반", "석근"]);
  expect(workTypeOverrideOrder).toEqual(["야근", "조근", "일반", "석근"]);
});

test("weekday holiday general assignment is not treated as auto-managed", () => {
  const holidayDay = createHolidayDay();
  const normalWeekday = {
    ...holidayDay,
    dateKey: "2026-05-04",
    day: 4,
    dow: 1,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
  };

  expect(isAutoManagedGeneralAssignment(holidayDay, "일반")).toBe(false);
  expect(isAutoManagedGeneralAssignment(holidayDay, "주말일반근무")).toBe(false);
  expect(isAutoManagedGeneralAssignment(normalWeekday, "일반")).toBe(true);
});

test("weekday holiday general assignments survive general sync", () => {
  const state = createState();
  const day = state.generated?.days.find((item) => item.dateKey === "2026-05-01");

  expect(day?.assignments["일반"]).toEqual(["구본준"]);
  syncGeneralAssignments(state, state.generated?.days ?? [], state.generalTeamPeople);
  expect(day?.assignments["일반"]).toEqual(["구본준"]);
});
