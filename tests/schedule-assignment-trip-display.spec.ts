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
  getScheduleAssignmentTripTooltip,
  getScheduleAssignmentVisibleTripTagMap,
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

test("trip return phase from display entries marks published work schedule names", () => {
  const rowKey = createAssignmentRowKey("2026-07-01", "뉴스대기", 0, "박재현");
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-07": {
        [rowKey]: {
          ...createDefaultScheduleAssignmentEntry(),
          travelType: "국내출장",
          tripTagId: "trip-return-1",
          tripTagLabel: "월드컵",
          tripTagPhase: "return",
        },
      },
    },
    rows: {},
  };

  expect(
    formatScheduleAssignmentDisplayName(
      {
        monthKey: "2026-07",
        dateKey: "2026-07-01",
        category: "뉴스대기",
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

test("trip tooltip only appears for names displayed with trip marker", () => {
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-05": {
        "2026-05-02::일반::0::박재현": {
          ...createDefaultScheduleAssignmentEntry(),
          schedules: ["국회 현장 일정"],
        },
      },
    },
    rows: {},
  };

  const input = {
    monthKey: "2026-05",
    dateKey: "2026-05-02",
    category: "일반",
    index: 0,
    name: "박재현",
  };

  expect(formatScheduleAssignmentDisplayName(input, store, new Map())).toBe("박재현");
  expect(getScheduleAssignmentTripTooltip(input, store, new Map())).toBeNull();
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

test("legal assignment duty adds law tag without forcing the office category", () => {
  const day = {
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
    assignments: { 일반: ["이동현", "이지수"], 청사: [] },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  } as DaySchedule;
  const rowKey = createAssignmentRowKey(day.dateKey, "일반", 0, "이동현");
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
            [rowKey]: { name: "이동현", duty: "법조" },
          },
        },
      },
    },
  };

  const taggedSchedule = applyScheduleAssignmentNameTagsToSchedule(schedule, store);
  const linkedSchedule = applyScheduleAssignmentDutyCategoriesToSchedule(schedule, store);

  expect(taggedSchedule.days[0]?.assignmentNameTags?.["일반::이동현"]).toBe("law");
  expect(linkedSchedule.days[0]?.assignments["일반"]).toEqual(["이동현", "이지수"]);
  expect(linkedSchedule.days[0]?.assignments["청사"]).toBeUndefined();
});

test("assembly support duty adds government tag for main schedule display", () => {
  const day = {
    dateKey: "2026-06-11",
    day: 11,
    month: 6,
    year: 2026,
    dow: 4,
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: { 일반: ["김재식"] },
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
            [rowKey]: { name: "김재식", duty: "국회지원" },
          },
        },
      },
    },
  };

  const taggedSchedule = applyScheduleAssignmentNameTagsToSchedule(schedule, store);

  expect(taggedSchedule.days[0]?.assignmentNameTags?.["일반::김재식"]).toBe("gov");
});

test("added support assignments tag existing general schedule names across months", () => {
  const cases = [
    {
      dateKey: "2026-07-01",
      day: 1,
      sheetMonth: 6,
      month: 7,
      name: "조용희",
      duty: "법조지원",
      expectedTag: "law",
      nextStartDate: "2026-08-01",
    },
    {
      dateKey: "2026-08-04",
      day: 4,
      sheetMonth: 8,
      month: 8,
      name: "김재식",
      duty: "국회지원",
      expectedTag: "gov",
      nextStartDate: "2026-09-01",
    },
  ] as const;

  cases.forEach(({ dateKey, day: dayNumber, sheetMonth, month, name, duty, expectedTag, nextStartDate }) => {
    const day = {
      dateKey,
      day: dayNumber,
      month,
      year: 2026,
      dow: 2,
      isWeekend: false,
      isHoliday: false,
      isCustomHoliday: false,
      isWeekdayHoliday: false,
      isOverflowMonth: false,
      vacations: [],
      assignments: { 일반: [name] },
      manualExtras: [],
      headerName: "",
      conflicts: [],
    } as DaySchedule;
    const monthKey = `2026-${String(month).padStart(2, "0")}`;
    const sheetMonthKey = `2026-${String(sheetMonth).padStart(2, "0")}`;
    const schedule = {
      year: 2026,
      month: sheetMonth,
      monthKey: sheetMonthKey,
      days: [day],
      nextPointers: { ...defaultPointers },
      nextStartDate,
    } as GeneratedSchedule;
    const store: ScheduleAssignmentDataStore = {
      entries: {},
      rows: {
        [monthKey]: {
          [day.dateKey]: {
            addedRows: [{ id: `${duty}-${name}`, name, duty }],
            deletedRowKeys: [],
            rowOverrides: {},
          },
        },
      },
    };

    const decoratedSchedule = applyScheduleAssignmentNameTagsToSchedule(
      applyScheduleAssignmentDutyCategoriesToSchedule(schedule, store),
      store,
    );

    expect(decoratedSchedule.days[0]?.assignments["일반"]).toEqual([name]);
    expect(decoratedSchedule.days[0]?.assignmentNameTags?.[`일반::${name}`]).toBe(expectedTag);
  });
});

test("trip tag continues across month boundary when previous sheet owns next-month days", () => {
  const createDay = (dateKey: string, names: string[]) => {
    const [year, month, dayNumber] = dateKey.split("-").map(Number);
    return {
      dateKey,
      day: dayNumber,
      month,
      year,
      dow: new Date(year, month - 1, dayNumber).getDay(),
      isWeekend: false,
      isHoliday: false,
      isCustomHoliday: false,
      isWeekdayHoliday: false,
      isOverflowMonth: false,
      vacations: [],
      assignments: { 일반: names },
      manualExtras: [],
      headerName: "",
      conflicts: [],
    } as DaySchedule;
  };
  // 9월 시트가 10/1~10/2까지 담당하고, 일정배정은 10월 날짜를 2026-10에 저장한 상황
  const septemberSchedule = {
    year: 2026,
    month: 9,
    monthKey: "2026-09",
    days: [createDay("2026-09-30", ["구본준"]), createDay("2026-10-01", ["구본준"]), createDay("2026-10-02", ["구본준"])],
    nextPointers: { ...defaultPointers },
    nextStartDate: "2026-10-03",
  } as GeneratedSchedule;
  const departureKey = createAssignmentRowKey("2026-09-30", "일반", 0, "구본준");
  const octoberKey = createAssignmentRowKey("2026-10-01", "일반", 0, "구본준");
  const returnKey = createAssignmentRowKey("2026-10-02", "일반", 0, "구본준");
  const tripEntry = {
    ...createDefaultScheduleAssignmentEntry(),
    travelType: "국내출장" as const,
    tripTagId: "trip-cross-month",
    tripTagLabel: "출장",
  };
  const store: ScheduleAssignmentDataStore = {
    entries: {
      "2026-09": { [departureKey]: { ...tripEntry, tripTagPhase: "departure" } },
      "2026-10": {
        [octoberKey]: { ...createDefaultScheduleAssignmentEntry(), schedules: ["10월 현지 취재"] },
        [returnKey]: { ...tripEntry, tripTagPhase: "return" },
      },
    },
    rows: {},
  };
  const visibleTripTagMap = getScheduleAssignmentVisibleTripTagMap([septemberSchedule], store);
  const octoberInput = { monthKey: "2026-09", dateKey: "2026-10-01", category: "일반", index: 0, name: "구본준" };

  expect(formatScheduleAssignmentDisplayName(octoberInput, store, visibleTripTagMap)).toBe("구본준(출)");
  expect(getScheduleAssignmentTripTooltip(octoberInput, store, visibleTripTagMap)?.schedules).toEqual(["10월 현지 취재"]);
  expect(
    formatScheduleAssignmentDisplayName({ ...octoberInput, dateKey: "2026-10-02" }, store, visibleTripTagMap),
  ).toBe("구본준(출)");
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
