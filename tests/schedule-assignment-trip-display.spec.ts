import { test, expect } from "@playwright/test";
import {
  applyScheduleAssignmentDutyCategoriesToSchedule,
  applyScheduleAssignmentNameTagsToSchedule,
  createAssignmentRowKey,
  createCustomAssignmentRowKey,
  createDefaultScheduleAssignmentDayRows,
  createDefaultScheduleAssignmentEntry,
  formatScheduleAssignmentDisplayName,
  getScheduleAssignmentBigEventDutyOptions,
  getScheduleAssignmentBigEvents,
  getScheduleAssignmentGeneralDisplayNames,
  getScheduleAssignmentRows,
} from "@/lib/team-lead/storage";
import { defaultPointers } from "@/lib/schedule/constants";
import type { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";
import type { ScheduleAssignmentDataStore } from "@/lib/team-lead/storage";

test("trip display survives schedule row index drift", () => {
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-05": {
        "2026-05-02::일반::0::박재현": {
          ...createDefaultScheduleAssignmentEntry(),
          travelType: "국내출장",
          tripTagId: "trip-1",
          tripTagLabel: "출장",
          tripTagPhase: "ongoing",
        },
      },
    },
    rows: {},
  };

  expect(
    formatScheduleAssignmentDisplayName(
      {
        monthKey: "2026-05",
        dateKey: "2026-05-02",
        category: "일반",
        index: 2,
        name: "박재현",
      },
      store,
      new Map(),
    ),
  ).toBe("박재현(출)");
});

test("trip display follows a published trip category even when assignment duty differs", () => {
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-05": {
        "2026-05-02::일반::0::박재현": {
          ...createDefaultScheduleAssignmentEntry(),
          travelType: "국내출장",
          tripTagId: "trip-1",
          tripTagLabel: "출장",
          tripTagPhase: "ongoing",
        },
      },
    },
    rows: {},
  };

  expect(
    formatScheduleAssignmentDisplayName(
      {
        monthKey: "2026-05",
        dateKey: "2026-05-02",
        category: "출장",
        index: 0,
        name: "박재현",
      },
      store,
      new Map(),
    ),
  ).toBe("박재현(출)");
});

test("trip display follows assignment trip category rows without travel type metadata", () => {
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-05": {
        "2026-05-02::출장::0::박재현": {
          ...createDefaultScheduleAssignmentEntry(),
          schedules: ["2026 월드컵 멕시코 현지 답사 및 사전취재(전영희)"],
        },
      },
    },
    rows: {},
  };

  expect(
    formatScheduleAssignmentDisplayName(
      {
        monthKey: "2026-05",
        dateKey: "2026-05-02",
        category: "출장",
        index: 0,
        name: "박재현",
      },
      store,
      new Map(),
    ),
  ).toBe("박재현(출)");
});

test("trip display works for custom general rows from schedule assignment", () => {
  const customRowKey = createCustomAssignmentRowKey("2026-04-20", "custom-1");
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-04": {
        [customRowKey]: {
          ...createDefaultScheduleAssignmentEntry(),
          travelType: "국내출장",
          tripTagId: "trip-2",
          tripTagLabel: "출장",
          tripTagPhase: "departure",
        },
      },
    },
    rows: {
      "2026-04": {
        "2026-04-20": {
          addedRows: [{ id: "custom-1", name: "박재현", duty: "일반" }],
          deletedRowKeys: [],
          rowOverrides: {},
        },
      },
    },
  };

  expect(
    formatScheduleAssignmentDisplayName(
      {
        monthKey: "2026-04",
        dateKey: "2026-04-20",
        category: "일반",
        index: 0,
        name: "박재현",
      },
      store,
      new Map(),
    ),
  ).toBe("박재현(출)");
});

test("general schedule display keeps original general row when assignment has a trip tag", () => {
  const day = {
    dateKey: "2026-05-02",
    day: 2,
    month: 5,
    year: 2026,
    dow: 6,
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: { 일반: ["박재현", "구본준"] },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  } as DaySchedule;
  const rowKey = createAssignmentRowKey(day.dateKey, "일반", 0, "박재현");
  const dayRows = {
    addedRows: [],
    deletedRowKeys: [],
    rowOverrides: {
      [rowKey]: { name: "박재현", duty: "기타" },
    },
  };
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-05": {
        [rowKey]: {
          ...createDefaultScheduleAssignmentEntry(),
          travelType: "국내출장",
          tripTagId: "trip-1",
          tripTagLabel: "출장",
          tripTagPhase: "ongoing",
        },
      },
    },
    rows: {
      "2026-05": {
        [day.dateKey]: dayRows,
      },
    },
  };

  expect(getScheduleAssignmentGeneralDisplayNames(day, "2026-05", dayRows, store)).toContain("박재현");
});

test("half-day assignment duty adds half-day tag to schedule display name", () => {
  const day = {
    dateKey: "2026-05-02",
    day: 2,
    month: 5,
    year: 2026,
    dow: 6,
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: { 일반: ["박재현"] },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  } as DaySchedule;
  const rowKey = createAssignmentRowKey(day.dateKey, "일반", 0, "박재현");
  const schedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    days: [day],
    nextPointers: { ...defaultPointers },
    nextStartDate: "2026-06-01",
  } as GeneratedSchedule;
  const store: ScheduleAssignmentDataStore = {
    entries: {},
    rows: {
      "2026-05": {
        [day.dateKey]: {
          addedRows: [],
          deletedRowKeys: [],
          rowOverrides: {
            [rowKey]: { name: "박재현", duty: "오전반차" },
          },
        },
      },
    },
  };

  const taggedSchedule = applyScheduleAssignmentNameTagsToSchedule(schedule, store);

  expect(taggedSchedule.days[0]?.assignmentNameTags?.["일반::박재현"]).toBe("half");
});

test("assembly assignment duty is reflected in the schedule management assembly category", () => {
  const day = {
    dateKey: "2026-06-06",
    day: 6,
    month: 6,
    year: 2026,
    dow: 6,
    isWeekend: true,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: { 일반: ["김재식", "이지수"], 국회: [] },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  } as DaySchedule;
  const rowKey = createAssignmentRowKey(day.dateKey, "일반", 0, "김재식");
  const schedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    days: [day],
    nextPointers: { ...defaultPointers },
    nextStartDate: "2026-07-01",
  } as GeneratedSchedule;
  const store: ScheduleAssignmentDataStore = {
    entries: {},
    rows: {
      "2026-06": {
        [day.dateKey]: {
          addedRows: [],
          deletedRowKeys: [],
          rowOverrides: {
            [rowKey]: { name: "김재식", duty: "국회" },
          },
        },
      },
    },
  };

  const linkedSchedule = applyScheduleAssignmentDutyCategoriesToSchedule(schedule, store);
  const linkedDay = linkedSchedule.days[0]!;

  expect(linkedDay.assignments["국회"]).toEqual(["김재식"]);
  expect(linkedDay.assignments["일반"]).toEqual(["이지수"]);
});

test("big event assignments become schedule assignment duties across month boundaries", () => {
  const maySchedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    days: [],
    nextPointers: { ...defaultPointers },
    nextStartDate: "2026-06-01",
    big_events: [
      {
        id: "world-cup",
        name: "월드컵",
        assignments: [
          {
            id: "world-cup-park",
            name: "박재현",
            profile_id: null,
            start_date: "2026-05-24",
            end_date: "2026-06-30",
          },
        ],
      },
    ],
  } as GeneratedSchedule;
  const juneDay = {
    dateKey: "2026-06-10",
    day: 10,
    month: 6,
    year: 2026,
    dow: 3,
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: { 일반: ["박재현"] },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  } as DaySchedule;
  const juneSchedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    days: [juneDay],
    nextPointers: { ...defaultPointers },
    nextStartDate: "2026-07-01",
  } as GeneratedSchedule;
  const bigEvents = getScheduleAssignmentBigEvents([maySchedule, juneSchedule]);

  expect(getScheduleAssignmentBigEventDutyOptions([maySchedule, juneSchedule])).toContain("월드컵");
  expect(getScheduleAssignmentRows(juneDay, createDefaultScheduleAssignmentDayRows(), bigEvents)[0]?.duty).toBe("월드컵");
});
