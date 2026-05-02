import { test, expect } from "@playwright/test";
import { defaultScheduleState } from "@/lib/schedule/constants";
import { moveAssignmentCategory, sanitizeScheduleState } from "@/lib/schedule/engine";
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
