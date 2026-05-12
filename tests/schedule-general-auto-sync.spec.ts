import { expect, test } from "@playwright/test";

import { defaultScheduleState, getDayDuplicateNameSet } from "@/lib/schedule/constants";
import { buildBigEventBlockedByDate, generateSchedule, removePersonFromCategory, sanitizeScheduleState, syncGeneralAssignments, updateScheduleBigEvents } from "@/lib/schedule/engine";
import { presetScheduleMonths } from "@/lib/schedule/preset-schedules.generated";
import { canRepairPublishedGeneralAssignments, normalizePublishedSchedule } from "@/lib/schedule/published";
import { syncVacationTextForChangedRoute } from "@/lib/schedule/change-requests";
import type { GeneratedSchedule, SchedulePersonRef } from "@/lib/schedule/types";

test("2026 schedule months use calendar month ranges", () => {
  const ranges = [
    { month: 5, first: "2026-04-27", last: "2026-05-31" },
    { month: 6, first: "2026-06-01", last: "2026-07-05" },
    { month: 7, first: "2026-06-29", last: "2026-08-02" },
  ];

  ranges.forEach(({ month, first, last }) => {
    const generated = generateSchedule({
      ...defaultScheduleState,
      year: 2026,
      month,
    }).state.generated;

    expect(generated?.days[0]?.dateKey).toBe(first);
    expect(generated?.days[generated.days.length - 1]?.dateKey).toBe(last);
  });
});

test("june 2026 schedule includes june 7", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated;

  expect(generated?.days.some((day) => day.dateKey === "2026-06-07")).toBe(true);
});

test("big event assignments create dynamic duty columns and remove people from general auto assignments", () => {
  const baseState = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state;
  const withBigEvents = updateScheduleBigEvents(baseState, "2026-06", [
    {
      id: "event-worldcup",
      name: "월드컵",
      assignments: [
        {
          id: "event-worldcup-kim",
          name: "김재식",
          profile_id: null,
          start_date: "2026-06-04",
          end_date: "2026-06-25",
        },
        {
          id: "event-worldcup-park",
          name: "박재현",
          profile_id: null,
          start_date: "2026-06-10",
          end_date: "2026-06-18",
        },
      ],
    },
  ]);

  const day4 = withBigEvents.generated?.days.find((day) => day.dateKey === "2026-06-04");
  const day10 = withBigEvents.generated?.days.find((day) => day.dateKey === "2026-06-10");
  const day26 = withBigEvents.generated?.days.find((day) => day.dateKey === "2026-06-26");

  expect(day4?.assignments["월드컵"]).toEqual(["김재식"]);
  expect(day10?.assignments["월드컵"]).toEqual(["김재식", "박재현"]);
  expect(day4?.assignments["일반"] ?? []).not.toContain("김재식");
  expect(day10?.assignments["일반"] ?? []).not.toContain("김재식");
  expect(day10?.assignments["일반"] ?? []).not.toContain("박재현");
  expect(day26?.assignments["월드컵"]).toBeUndefined();
});

test("big event date ranges are clamped to the schedule month", () => {
  const blockedByDate = buildBigEventBlockedByDate(
    [
      {
        id: "event-worldcup",
        name: "월드컵",
        assignments: [
          {
            id: "event-worldcup-kim",
            name: "김재식",
            profile_id: null,
            start_date: "2026-05-20",
            end_date: "2026-06-03",
          },
        ],
      },
    ],
    "2026-06",
  );

  expect(blockedByDate["2026-05-31"]).toBeUndefined();
  expect(Array.from(blockedByDate["2026-06-01"] ?? [])).toEqual(["김재식"]);
  expect(Array.from(blockedByDate["2026-06-03"] ?? [])).toEqual(["김재식"]);
  expect(blockedByDate["2026-06-04"]).toBeUndefined();
});

test("big event people keep manual special assignments and get conflict warnings only", () => {
  const baseState = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state;
  const source = JSON.parse(JSON.stringify(baseState.generated!)) as typeof baseState.generated;
  const targetDay = source!.days.find((day) => day.dateKey === "2026-06-10")!;
  targetDay.assignments["국회"] = ["김재식"];

  const state = sanitizeScheduleState({
    ...baseState,
    generated: source,
    generatedHistory: [source!],
  });
  const withBigEvents = updateScheduleBigEvents(state, "2026-06", [
    {
      id: "event-worldcup",
      name: "월드컵",
      assignments: [
        {
          id: "event-worldcup-kim",
          name: "김재식",
          profile_id: null,
          start_date: "2026-06-10",
          end_date: "2026-06-10",
        },
      ],
    },
  ]);
  const updatedDay = withBigEvents.generated?.days.find((day) => day.dateKey === "2026-06-10");

  expect(updatedDay?.assignments["국회"]).toEqual(["김재식"]);
  expect(updatedDay?.assignments["월드컵"]).toEqual(["김재식"]);
  expect(updatedDay?.assignments["일반"] ?? []).not.toContain("김재식");
  expect(updatedDay?.conflicts).toEqual(
    expect.arrayContaining([
      { category: "국회", name: "김재식" },
      { category: "월드컵", name: "김재식" },
    ]),
  );
});

test("general assignments are restored after an edit removes an eligible name", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
  }).state;
  const initialState = sanitizeScheduleState(generated);
  const targetDateKey = "2026-05-27";
  const targetDay = initialState.generated?.days.find((day) => day.dateKey === targetDateKey);

  expect(targetDay?.assignments["일반"]).toContain("정상원");
  const generalIndex = targetDay?.assignments["일반"]?.findIndex((name) => name === "정상원") ?? -1;
  expect(generalIndex).toBeGreaterThanOrEqual(0);

  const editedState = removePersonFromCategory(initialState, targetDateKey, "일반", generalIndex, "정상원");
  const editedTargetDay = editedState.generated?.days.find((day) => day.dateKey === targetDateKey);

  expect(editedTargetDay?.assignments["일반"]).toContain("정상원");
  expect(editedTargetDay?.assignments["석근"] ?? []).not.toContain("정상원");
});

test("vacation entries keep same-day fixed work assignments and mark conflicts", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state;
  const targetDateKey = "2026-06-04";
  const targetDay = generated.generated?.days.find((day) => day.dateKey === targetDateKey);
  const vacationName = targetDay?.assignments["조근"]?.[0] ?? "";

  expect(vacationName).toBeTruthy();

  const state = sanitizeScheduleState({
    ...generated,
    vacations: `${targetDateKey}: 연차:${vacationName}`,
  });
  const updatedDay = state.generated?.days.find((day) => day.dateKey === targetDateKey);
  const workAssignments = Object.entries(updatedDay?.assignments ?? {})
    .filter(([category]) => category !== "휴가")
    .flatMap(([, names]) => names);

  expect(updatedDay?.assignments["휴가"]).toContain(`연차:${vacationName}`);
  expect(workAssignments).toContain(vacationName);
  expect(updatedDay?.conflicts).toContainEqual({ category: "조근", name: vacationName });
  expect(getDayDuplicateNameSet(updatedDay!).has(vacationName)).toBe(true);
});

test("published schedule normalization removes vacation people from general assignments", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const targetDateKey = "2026-06-01";
  const source = JSON.parse(JSON.stringify(generated)) as typeof generated;
  const targetDay = source.days.find((day) => day.dateKey === targetDateKey)!;
  const vacationName = "휴가자";

  targetDay.assignments["일반"] = [vacationName, "근무자"];
  targetDay.assignments["휴가"] = [`연차:${vacationName}`];
  targetDay.vacations = [`연차:${vacationName}`];

  const normalized = normalizePublishedSchedule(source);
  const updatedDay = normalized.days.find((day) => day.dateKey === targetDateKey)!;

  expect(updatedDay.assignments["일반"]).toEqual(["근무자"]);
  expect(updatedDay.assignments["휴가"]).toContain(`연차:${vacationName}`);
  expect(getDayDuplicateNameSet(updatedDay).has(vacationName)).toBe(false);
});

test("published schedule normalization keeps vacation people in fixed work assignments", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const targetDateKey = "2026-06-01";
  const source = JSON.parse(JSON.stringify(generated)) as typeof generated;
  const targetDay = source.days.find((day) => day.dateKey === targetDateKey)!;
  const vacationName = "휴가자";

  targetDay.assignments["연장"] = [vacationName, "근무자"];
  targetDay.assignments["휴가"] = [`연차:${vacationName}`];
  targetDay.vacations = [`연차:${vacationName}`];

  const normalized = normalizePublishedSchedule(source);
  const updatedDay = normalized.days.find((day) => day.dateKey === targetDateKey)!;

  expect(updatedDay.assignments["연장"]).toEqual([vacationName, "근무자"]);
  expect(updatedDay.assignments["휴가"]).toContain(`연차:${vacationName}`);
  expect(getDayDuplicateNameSet(updatedDay).has(vacationName)).toBe(true);
});

test("schedule state normalization keeps fixed work conflicts and removes vacation people from general", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const targetDateKey = "2026-06-04";
  const source = JSON.parse(JSON.stringify(generated)) as typeof generated;
  const targetDay = source.days.find((day) => day.dateKey === targetDateKey)!;
  const vacationName = "휴가자";

  targetDay.assignments["조근"] = [vacationName, "조근자"];
  targetDay.assignments["연장"] = [vacationName, "연장자"];
  targetDay.assignments["일반"] = [vacationName, "일반자"];
  targetDay.assignments["휴가"] = [`연차:${vacationName}`];

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
    generated: source,
    generatedHistory: [source],
  });
  const updatedDay = state.generated?.days.find((day) => day.dateKey === targetDateKey)!;
  const workAssignments = Object.entries(updatedDay.assignments)
    .filter(([category]) => category !== "휴가")
    .flatMap(([, names]) => names);

  expect(updatedDay.assignments["휴가"]).toContain(`연차:${vacationName}`);
  expect(updatedDay.assignments["조근"]).toContain(vacationName);
  expect(updatedDay.assignments["연장"]).toContain(vacationName);
  expect(updatedDay.assignments["일반"] ?? []).not.toContain(vacationName);
  expect(workAssignments).toContain(vacationName);
  expect(updatedDay.conflicts).toEqual(
    expect.arrayContaining([
      { category: "조근", name: vacationName },
      { category: "연장", name: vacationName },
    ]),
  );
  expect(getDayDuplicateNameSet(updatedDay).has(vacationName)).toBe(true);
});

test("general manual additions do not re-add jcheck assignees", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const targetDateKey = "2026-06-08";
  const source = JSON.parse(JSON.stringify(generated)) as typeof generated;
  const targetDay = source.days.find((day) => day.dateKey === targetDateKey)!;
  const jcheckName = "제크자";

  targetDay.assignments["제크"] = [jcheckName];
  targetDay.assignments["일반"] = ["일반자", jcheckName];
  targetDay.generalManualAdditions = [jcheckName];

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
    generated: source,
    generatedHistory: [source],
  });
  const updatedDay = state.generated?.days.find((day) => day.dateKey === targetDateKey)!;

  expect(updatedDay.assignments["제크"]).toContain(jcheckName);
  expect(updatedDay.assignments["일반"] ?? []).not.toContain(jcheckName);
  expect(getDayDuplicateNameSet(updatedDay).has(jcheckName)).toBe(false);
});

test("general assignments exclude every same-day non-general category", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const targetDateKey = "2026-06-09";
  const source = JSON.parse(JSON.stringify(generated)) as typeof generated;
  const targetDay = source.days.find((day) => day.dateKey === targetDateKey)!;
  const blockedNamesByCategory = {
    조근: "구본준",
    연장: "김재식",
    석근: "변경태",
    야근: "유규열",
    제크: "김진광",
    국회: "이학진",
    청사: "황현우",
    청와대: "조용희",
  };
  const vacationName = "방극철";
  const blockedNames = [...Object.values(blockedNamesByCategory), vacationName];

  Object.entries(blockedNamesByCategory).forEach(([category, name]) => {
    targetDay.assignments[category] = [name];
  });
  targetDay.assignments["일반"] = [...blockedNames, "일반자"];
  targetDay.assignments["휴가"] = [`연차:${vacationName}`];
  targetDay.vacations = [`연차:${vacationName}`];
  targetDay.generalManualAdditions = [...blockedNames, "수동일반자"];

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
    generated: source,
    generatedHistory: [source],
  });
  const updatedDay = state.generated?.days.find((day) => day.dateKey === targetDateKey)!;

  blockedNames.forEach((name) => {
    expect(updatedDay.assignments["일반"] ?? []).not.toContain(name);
    expect(updatedDay.generalManualAdditions ?? []).not.toContain(name);
  });
  expect(updatedDay.assignments["일반"] ?? []).toContain("수동일반자");
  expect(updatedDay.generalManualAdditions ?? []).toEqual(["수동일반자"]);
  expect(getDayDuplicateNameSet(updatedDay).size).toBe(0);
});

test("april 21 preset recomputes general assignments with 정상원", () => {
  const aprilPreset = presetScheduleMonths.find((item) => item.monthKey === "2026-04");
  expect(aprilPreset).toBeTruthy();

  const days = JSON.parse(JSON.stringify(aprilPreset!.days));
  const state = {
    ...defaultScheduleState,
    year: 2026,
    month: 4,
  };

  syncGeneralAssignments(state, days, state.generalTeamPeople);

  const day21 = days.find((day: { dateKey: string; assignments: Record<string, string[]> }) => day.dateKey === "2026-04-21");
  expect(day21?.assignments["일반"]).toContain("정상원");
});

test("april preset keeps 정상원 in 일반 after state sanitization", () => {
  const aprilPreset = presetScheduleMonths.find((item) => item.monthKey === "2026-04");
  expect(aprilPreset).toBeTruthy();

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 4,
    generated: aprilPreset!,
    generatedHistory: [aprilPreset!],
  });

  const day21 = state.generated?.days.find((day) => day.dateKey === "2026-04-21");
  expect(day21?.assignments["일반"]).toContain("정상원");
});

test("general assignments do not drop 정상원 just because 석근 off is set", () => {
  const aprilPreset = presetScheduleMonths.find((item) => item.monthKey === "2026-04");
  expect(aprilPreset).toBeTruthy();

  const days = JSON.parse(JSON.stringify(aprilPreset!.days));
  const state = {
    ...defaultScheduleState,
    year: 2026,
    month: 4,
    offByCategory: {
      ...defaultScheduleState.offByCategory,
      evening: ["변경태", "이완근", "정상원", "정철원"],
    },
  };

  syncGeneralAssignments(state, days, state.generalTeamPeople);

  const day21 = days.find((day: { dateKey: string; assignments: Record<string, string[]> }) => day.dateKey === "2026-04-21");
  expect(day21?.assignments["일반"]).toContain("정상원");
});

test("general assignments ignore basic off names", () => {
  const aprilPreset = presetScheduleMonths.find((item) => item.monthKey === "2026-04");
  expect(aprilPreset).toBeTruthy();

  const days = JSON.parse(JSON.stringify(aprilPreset!.days));
  const state = {
    ...defaultScheduleState,
    year: 2026,
    month: 4,
    offPeople: ["변경태", "이완근", "정상원"],
  };

  syncGeneralAssignments(state, days, state.generalTeamPeople);

  const day21 = days.find((day: { dateKey: string; assignments: Record<string, string[]> }) => day.dateKey === "2026-04-21");
  expect(day21?.assignments["일반"]).toContain("변경태");
  expect(day21?.assignments["일반"]).toContain("정상원");
});

test("published repair allows general auto-sync when only vacation data changed", () => {
  const mayPreset = presetScheduleMonths.find((item) => item.monthKey === "2026-05");
  expect(mayPreset).toBeTruthy();

  const published = JSON.parse(JSON.stringify(mayPreset!));
  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
    generated: JSON.parse(JSON.stringify(mayPreset!)),
    generatedHistory: [JSON.parse(JSON.stringify(mayPreset!))],
  });
  const generated = state.generated;
  const generatedDay8 = generated?.days.find((day) => day.dateKey === "2026-05-08");

  expect(published.days.find((day: { dateKey: string; assignments: Record<string, string[]> }) => day.dateKey === "2026-05-08")?.assignments["일반"]).toBeUndefined();
  expect(generatedDay8?.assignments["일반"]).toContain("정상원");
  expect(generatedDay8?.assignments["휴가"]).toContain("근속휴가:이완근");
  expect(canRepairPublishedGeneralAssignments(published, generated!)).toBe(true);
});

test("accepted compensatory leave swaps update vacation source text before schedule normalization", () => {
  const baseDay = {
    day: 1,
    month: 6,
    year: 2026,
    dow: 1,
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    assignments: {},
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
  const swappedSchedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-06",
    days: [
      {
        ...baseDay,
        dateKey: "2026-06-10",
        day: 10,
        dow: 3,
        vacations: ["대휴:박재현"],
        assignments: { 휴가: ["대휴:박재현"] },
      },
      {
        ...baseDay,
        dateKey: "2026-06-12",
        day: 12,
        dow: 5,
        vacations: ["대휴:김재식"],
        assignments: { 휴가: ["대휴:김재식"] },
      },
    ],
  } satisfies GeneratedSchedule;
  const route = [
    {
      monthKey: "2026-06",
      dateKey: "2026-06-10",
      category: "휴가",
      index: 0,
      name: "대휴:김재식",
    },
    {
      monthKey: "2026-06",
      dateKey: "2026-06-12",
      category: "휴가",
      index: 0,
      name: "대휴:박재현",
    },
  ] satisfies SchedulePersonRef[];
  const vacations = syncVacationTextForChangedRoute(
    "2026-06-10: 대휴:김재식\n2026-06-12: 대휴:박재현",
    [swappedSchedule],
    route,
  );
  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
    vacations,
    generated: swappedSchedule,
    generatedHistory: [swappedSchedule],
  });

  expect(vacations).toContain("2026-06-10: 대휴:박재현");
  expect(vacations).toContain("2026-06-12: 대휴:김재식");
  expect(state.generated?.days.find((day) => day.dateKey === "2026-06-10")?.assignments["휴가"]).toContain(
    "대휴:박재현",
  );
  expect(state.generated?.days.find((day) => day.dateKey === "2026-06-12")?.assignments["휴가"]).toContain(
    "대휴:김재식",
  );
});
