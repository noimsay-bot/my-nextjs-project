import { expect, test } from "@playwright/test";

import { defaultScheduleState, getDayDuplicateNameSet } from "@/lib/schedule/constants";
import { buildBigEventBlockedByDate, generateEmptySchedule, generateSchedule, removePersonFromCategory, removeVacationPersonFromDay, sanitizeScheduleState, syncGeneralAssignments, updateScheduleBigEvents } from "@/lib/schedule/engine";
import { getDeskPriorityVacationMap } from "@/lib/schedule/desk-records";
import { presetScheduleMonths } from "@/lib/schedule/preset-schedules.generated";
import { canRepairPublishedGeneralAssignments, normalizePublishedSchedule, prepareScheduleForPublish } from "@/lib/schedule/published";
import { syncVacationTextForChangedRoute } from "@/lib/schedule/change-requests";
import {
  applyAssemblyDutiesToSchedule,
  applyAssemblyLeavesToSchedule,
  createAssemblyLeaveMatchErrorKey,
  parseAssemblyExportPayload,
  safeUpdateAssignments,
  type HubAssemblyLeaveAssignment,
} from "@/lib/schedule/assembly-sync-core";
import {
  filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties,
  getAssemblyCompensatoryLeavePushItems,
  getAssemblyCompensatoryLeavePushOperations,
} from "@/lib/schedule/assembly-leave-push-core";
import type { GeneratedSchedule, SchedulePersonRef } from "@/lib/schedule/types";

test("2026 schedule months use configured coverage ranges", () => {
  const ranges = [
    { month: 5, first: "2026-04-27", last: "2026-05-31" },
    { month: 6, first: "2026-06-01", last: "2026-07-05" },
    { month: 7, first: "2026-07-06", last: "2026-08-02" },
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

test("empty schedule template stays blank until actual assignments are added", () => {
  const generated = generateEmptySchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 7,
  }).state.generated;

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 7,
    generated: generated!,
    generatedHistory: [generated!],
  });
  const day = state.generated?.days.find((item) => item.dateKey === "2026-07-06");

  expect(day?.assignments["일반"] ?? []).toEqual([]);
});

test("blank template with actual assignments recomputes general assignments", () => {
  const generated = JSON.parse(JSON.stringify(generateEmptySchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 7,
  }).state.generated)) as GeneratedSchedule;
  const day = generated.days.find((item) => item.dateKey === "2026-07-06");
  expect(day).toBeTruthy();
  day!.assignments["야근"] = ["구본준"];

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 7,
    generated,
    generatedHistory: [generated],
  });
  const syncedDay = state.generated?.days.find((item) => item.dateKey === "2026-07-06");
  const untouchedDay = state.generated?.days.find((item) => item.dateKey === "2026-07-07");

  expect(syncedDay?.assignments["일반"]?.length).toBeGreaterThan(0);
  expect(syncedDay?.assignments["일반"] ?? []).not.toContain("구본준");
  expect(untouchedDay?.assignments["일반"] ?? []).toEqual([]);
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
  const targetName = targetDay?.assignments["일반"]?.[0] ?? "";

  expect(targetName).toBeTruthy();
  const generalIndex = targetDay?.assignments["일반"]?.findIndex((name) => name === targetName) ?? -1;
  expect(generalIndex).toBeGreaterThanOrEqual(0);

  const editedState = removePersonFromCategory(initialState, targetDateKey, "일반", generalIndex, targetName);
  const editedTargetDay = editedState.generated?.days.find((day) => day.dateKey === targetDateKey);

  expect(editedTargetDay?.assignments["일반"]).toContain(targetName);
  expect(editedTargetDay?.assignments["석근"] ?? []).not.toContain(targetName);
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

test("published schedule preparation starts after the previous published schedule coverage", () => {
  const juneState = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state;
  const june = juneState.generated!;
  const julyState = generateSchedule({
    ...juneState,
    year: 2026,
    month: 7,
  }).state;
  const july = julyState.generated!;

  expect(june.nextStartDate).toBe("2026-07-06");
  expect(july.days[0].dateKey).toBe("2026-07-06");

  const prepared = prepareScheduleForPublish(
    july,
    [
      {
        monthKey: june.monthKey,
        title: "2026년 6월 근무표",
        publishedAt: "2026-06-01T00:00:00.000Z",
        schedule: june,
      },
    ],
    julyState,
  );

  expect(prepared.days[0].dateKey).toBe("2026-07-06");
  expect(prepared.days.some((day) => day.dateKey === "2026-07-05")).toBe(false);
});

test("published schedule preparation recomputes general after fixed duty changes", () => {
  const state = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 7,
  }).state;
  const source = JSON.parse(JSON.stringify(state.generated!)) as GeneratedSchedule;
  const targetDay = source.days.find((day) => day.dateKey === "2026-07-06")!;
  const assemblyName = targetDay.assignments["일반"]?.[0] ?? "";

  expect(assemblyName).toBeTruthy();
  targetDay.assignments["국회"] = [assemblyName];

  const prepared = prepareScheduleForPublish(source, [], state);
  const preparedDay = prepared.days.find((day) => day.dateKey === "2026-07-06")!;

  expect(preparedDay.assignments["국회"]).toContain(assemblyName);
  expect(preparedDay.assignments["일반"] ?? []).not.toContain(assemblyName);
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

test("childcare leave desk note is not imported as long-service vacation", () => {
  const deskVacationMap = getDeskPriorityVacationMap();
  const allEntries = Object.values(deskVacationMap).flat();

  expect(allEntries).not.toContain("근속휴가:이완근");
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
  expect(generatedDay8?.assignments["휴가"] ?? []).not.toContain("근속휴가:이완근");
  expect(canRepairPublishedGeneralAssignments(published, generated!)).toBe(true);
});

test("vacation deletion removes Jung even when vacation fields are out of sync", () => {
  const schedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    days: [
      {
        dateKey: "2026-06-29",
        day: 29,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["대휴:정철원"],
        assignments: { 휴가: [] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;
  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
    generated: schedule,
    generatedHistory: [schedule],
  });
  const day = state.generated!.days[0];
  day.assignments["휴가"] = [];
  day.vacations = ["대휴:정철원"];

  const next = removeVacationPersonFromDay(state, "2026-06-29", "대휴:정철원");
  const nextDay = next.generated?.days.find((item) => item.dateKey === "2026-06-29");

  expect(nextDay?.assignments["휴가"]).toBeUndefined();
  expect(nextDay?.vacations).toEqual([]);
  expect(next.vacations).not.toContain("2026-06-29");
  expect(next.vacations).not.toContain("정철원");
});

test("vacation deletion removes Jung even after the entry type changed to other", () => {
  const schedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    days: [
      {
        dateKey: "2026-06-29",
        day: 29,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["기타:정철원"],
        assignments: { 휴가: ["기타:정철원"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;
  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
    generated: schedule,
    generatedHistory: [schedule],
  });

  const next = removeVacationPersonFromDay(state, "2026-06-29", "기타:정철원");
  const nextDay = next.generated?.days.find((item) => item.dateKey === "2026-06-29");

  expect(nextDay?.assignments["휴가"]).toBeUndefined();
  expect(nextDay?.vacations).toEqual([]);
  expect(next.vacations).not.toContain("정철원");
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

test("assembly export parser supports optional leaves without breaking duty items", () => {
  const legacy = parseAssemblyExportPayload(
    {
      items: [
        { date: "2026-05-08", dutyType: "공휴일", memberName: "신승규" },
        { date: "2026-05-08", dutyType: "공휴일", memberName: "신승규" },
      ],
    },
    "2026-05",
  );

  expect(legacy.hasItemsField).toBe(true);
  expect(legacy.hasLeavesField).toBe(false);
  expect(legacy.duties).toHaveLength(1);
  expect(legacy.leaves).toHaveLength(0);

  const next = parseAssemblyExportPayload(
    {
      items: [{ date: "2026-05-10", dutyType: "주말근무", memberName: "김상현" }],
      leaves: [
        { date: "2026-05-08", leaveType: "연차", memberName: "신승규" },
        { date: "2026-05-08", leaveType: "연차", leaveVariant: "normal", memberName: "신승규" },
        { date: "2026-05-09", leaveType: "연차", leaveVariant: "blue", memberName: "김상현" },
        { date: "2026-05-10", leaveType: "대휴", memberName: "삭제금지" },
      ],
    },
    "2026-05",
  );

  expect(next.hasItemsField).toBe(true);
  expect(next.hasLeavesField).toBe(true);
  expect(next.duties).toHaveLength(1);
  expect(next.leaves).toEqual([
    { date: "2026-05-08", leaveType: "연차", leaveVariant: "normal", memberName: "신승규" },
    { date: "2026-05-09", leaveType: "연차", leaveVariant: "blue", memberName: "김상현" },
    { date: "2026-05-10", leaveType: "대휴", memberName: "삭제금지" },
  ]);
});

test("assembly export parser does not treat missing items as an empty source of truth", () => {
  const parsed = parseAssemblyExportPayload(
    {
      leaves: [{ date: "2026-05-08", leaveType: "연차", memberName: "신승규" }],
    },
    "2026-05",
  );

  expect(parsed.hasItemsField).toBe(false);
  expect(parsed.hasLeavesField).toBe(true);
  expect(parsed.duties).toEqual([]);
  expect(parsed.leaves).toEqual([{ date: "2026-05-08", leaveType: "연차", leaveVariant: "normal", memberName: "신승규" }]);
  expect(parsed.errors.some((item) => item.message.includes("items 필드가 없어"))).toBe(true);
});

test("assembly export parser rejects dates outside the requested month without timezone shifting", () => {
  const parsed = parseAssemblyExportPayload(
    {
      items: [
        { date: "2026-04-30", dutyType: "공휴일", memberName: "이전월" },
        { date: "2026-05-01", dutyType: "공휴일", memberName: "해당월" },
        { date: "2026-06-01", dutyType: "공휴일", memberName: "다음월" },
      ],
      leaves: [
        { date: "2026-06-01", leaveType: "연차", memberName: "다음월휴가" },
      ],
    },
    "2026-05",
  );

  expect(parsed.duties).toEqual([{ date: "2026-05-01", dutyType: "공휴일", memberName: "해당월", sourceId: undefined, sourceUpdatedAt: undefined }]);
  expect(parsed.leaves).toEqual([]);
  expect(parsed.errors).toHaveLength(3);
});

test("safe assignment updates reject protected category changes", () => {
  expect(() =>
    safeUpdateAssignments(
      {
        조근: ["A"],
        국회: ["B"],
      },
      ["국회"],
      {
        조근: [],
      },
    ),
  ).toThrow("허용되지 않은 근무유형");
});

test("assembly duty sync only changes assembly assignments", () => {
  const schedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-06-01",
    days: [
      {
        dateKey: "2026-05-08",
        day: 8,
        month: 5,
        year: 2026,
        dow: 5,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["연차:E", "대휴:H", "기타:G"],
        assignments: {
          조근: ["A"],
          일반: ["B"],
          야근: ["C"],
          국회: ["D"],
          휴가: ["연차:E", "대휴:H", "기타:G"],
          제크: ["F"],
          대휴: ["H"],
        },
        manualExtras: ["국회"],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;

  const result = applyAssemblyDutiesToSchedule(schedule, new Set(["2026-05-08"]), new Map([["2026-05-08", ["N"]]]), new Set());
  const assignments = result.schedule.days[0].assignments;

  expect(assignments["국회"]).toEqual(["D", "N"]);
  expect(result.schedule.assembly_duty_sync_state).toEqual({ "2026-05-08": ["N"] });
  expect(assignments["조근"]).toEqual(["A"]);
  expect(assignments["일반"]).toEqual(["B"]);
  expect(assignments["야근"]).toEqual(["C"]);
  expect(assignments["휴가"]).toEqual(["연차:E", "대휴:H", "기타:G"]);
  expect(assignments["제크"]).toEqual(["F"]);
  expect(assignments["대휴"]).toEqual(["H"]);
});

test("assembly duty sync preserves current assembly names on match errors", () => {
  const schedule = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
  }).state.generated!;
  const day = schedule.days.find((item) => item.dateKey === "2026-05-08")!;
  day.assignments["국회"] = ["기존국회"];

  const result = applyAssemblyDutiesToSchedule(schedule, new Set(["2026-05-08"]), new Map(), new Set(["2026-05-08"]));

  expect(result.schedule.days.find((item) => item.dateKey === "2026-05-08")?.assignments["국회"]).toEqual(["기존국회"]);
});

test("assembly duty sync removes only names previously owned by assembly sync", () => {
  const schedule = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
  }).state.generated!;
  schedule.assembly_duty_sync_state = { "2026-05-08": ["동기화국회"] };
  const day = schedule.days.find((item) => item.dateKey === "2026-05-08")!;
  day.assignments["국회"] = ["수동국회", "동기화국회"];

  const result = applyAssemblyDutiesToSchedule(schedule, new Set(["2026-05-08"]), new Map(), new Set());

  expect(result.schedule.days.find((item) => item.dateKey === "2026-05-08")?.assignments["국회"]).toEqual(["수동국회"]);
  expect(result.schedule.assembly_duty_sync_state).toBeUndefined();
});

test("P1.5-A: stale W1 read does not revive Jung compensatory leave after hub deletion before write", () => {
  const staleSchedule = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const latestSchedule = JSON.parse(JSON.stringify(staleSchedule)) as GeneratedSchedule;
  const staleDay = staleSchedule.days.find((item) => item.dateKey === "2026-06-29")!;
  const latestDay = latestSchedule.days.find((item) => item.dateKey === "2026-06-29")!;
  staleDay.assignments["휴가"] = ["대휴:정철원"];
  staleDay.vacations = ["대휴:정철원"];
  latestDay.assignments = {};
  latestDay.vacations = [];

  const staleResult = applyAssemblyDutiesToSchedule(
    staleSchedule,
    new Set(["2026-06-29"]),
    new Map([["2026-06-29", ["황현우"]]]),
    new Set(),
  );
  const result = applyAssemblyDutiesToSchedule(
    latestSchedule,
    new Set(["2026-06-29"]),
    new Map([["2026-06-29", ["황현우"]]]),
    new Set(),
  );

  expect(staleResult.schedule.days.find((item) => item.dateKey === "2026-06-29")?.assignments["휴가"]).toEqual([
    "대휴:정철원",
  ]);
  expect(result.schedule.days.find((item) => item.dateKey === "2026-06-29")?.assignments["휴가"]).toBeUndefined();
  expect(result.schedule.days.find((item) => item.dateKey === "2026-06-29")?.vacations).toEqual([]);
  expect(result.schedule.days.find((item) => item.dateKey === "2026-06-29")?.assignments["국회"]).toEqual(["황현우"]);
});

test("P1.5-B: hub deletion before W1 read remains deleted after assembly duty sync", () => {
  const latestSchedule = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 6,
  }).state.generated!;
  const latestDay = latestSchedule.days.find((item) => item.dateKey === "2026-06-29")!;
  latestDay.assignments = {};
  latestDay.vacations = [];

  const result = applyAssemblyDutiesToSchedule(
    latestSchedule,
    new Set(["2026-06-29"]),
    new Map([["2026-06-29", ["황현우"]]]),
    new Set(),
  );

  expect(result.schedule.days.find((item) => item.dateKey === "2026-06-29")?.assignments["휴가"]).toBeUndefined();
  expect(result.schedule.days.find((item) => item.dateKey === "2026-06-29")?.vacations).toEqual([]);
  expect(result.schedule.days.find((item) => item.dateKey === "2026-06-29")?.assignments["국회"]).toEqual(["황현우"]);
});

test("P2-B: assembly duty sync removes export-missing sync name while preserving manual names", () => {
  const schedule = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
  }).state.generated!;
  schedule.assembly_duty_sync_state = { "2026-05-08": ["빠진국회"] };
  const day = schedule.days.find((item) => item.dateKey === "2026-05-08")!;
  day.assignments["국회"] = ["수동국회", "빠진국회"];

  const result = applyAssemblyDutiesToSchedule(
    schedule,
    new Set(["2026-05-08"]),
    new Map([["2026-05-08", ["새국회"]]]),
    new Set(),
  );

  expect(result.schedule.days.find((item) => item.dateKey === "2026-05-08")?.assignments["국회"]).toEqual([
    "수동국회",
    "새국회",
  ]);
  expect(result.schedule.assembly_duty_sync_state).toEqual({ "2026-05-08": ["새국회"] });
});

test("assembly leaves sync maps annual, blue annual, and other leave while preserving compensatory leave and existing jcheck", () => {
  const baseDay = {
    day: 8,
    month: 5,
    year: 2026,
    dow: 5,
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: ["연차:기존연차", "대휴:보존대휴", "기타:기존기타"],
    assignments: {
      휴가: ["연차:기존연차", "대휴:보존대휴", "기타:기존기타"],
      제크: ["기존제크"],
      야근: ["보존야근"],
    },
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
  const schedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-06-01",
    days: [{ ...baseDay, dateKey: "2026-05-08" }],
  } satisfies GeneratedSchedule;
  const desired = new Map<string, Map<HubAssemblyLeaveAssignment, string[]>>([
    [
      "2026-05-08",
      new Map<HubAssemblyLeaveAssignment, string[]>([
        ["연차", ["신승규"]],
        ["제크", ["김상현"]],
        ["기타", ["검진자", "경조자"]],
      ]),
    ],
  ]);

  const result = applyAssemblyLeavesToSchedule(schedule, new Set(["2026-05-08"]), desired, new Set());
  const day = result.schedule.days[0];

  expect(day.assignments["휴가"]).toEqual(["연차:기존연차", "연차:신승규", "대휴:보존대휴", "기타:기존기타", "기타:검진자", "기타:경조자"]);
  expect(day.vacations).toEqual(["연차:기존연차", "연차:신승규", "대휴:보존대휴", "기타:기존기타", "기타:검진자", "기타:경조자"]);
  expect(day.assignments["제크"]).toEqual(["기존제크", "김상현"]);
  expect(result.schedule.assembly_leave_sync_state).toEqual({
    "2026-05-08": {
      연차: ["신승규"],
      제크: ["김상현"],
      기타: ["검진자", "경조자"],
    },
  });
  expect(day.assignments["야근"]).toEqual(["보존야근"]);
  expect(result.changed).toBe(true);
});

test("assembly leaves sync empty export clears only previously synced leave targets", () => {
  const schedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-06-01",
    assembly_leave_sync_state: {
      "2026-05-08": {
        연차: ["신승규"],
        제크: ["김상현"],
        기타: ["검진자"],
      },
    },
    days: [
      {
        dateKey: "2026-05-08",
        day: 8,
        month: 5,
        year: 2026,
        dow: 5,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["연차:신승규", "대휴:보존대휴", "기타:검진자"],
        assignments: {
          조근: ["보존조근"],
          휴가: ["연차:신승규", "대휴:보존대휴", "기타:검진자"],
          제크: ["김상현"],
          대휴: ["별도대휴"],
        },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;

  const result = applyAssemblyLeavesToSchedule(
    schedule,
    new Set(["2026-05-08"]),
    new Map([["2026-05-08", new Map<HubAssemblyLeaveAssignment, string[]>()]]),
    new Set(),
  );
  const day = result.schedule.days[0];

  expect(day.assignments["휴가"]).toEqual(["대휴:보존대휴"]);
  expect(day.vacations).toEqual(["대휴:보존대휴"]);
  expect(day.assignments["제크"]).toBeUndefined();
  expect(day.assignments["조근"]).toEqual(["보존조근"]);
  expect(day.assignments["대휴"]).toEqual(["별도대휴"]);
  expect(result.schedule.assembly_leave_sync_state).toBeUndefined();
});

test("assembly leaves sync removes previously synced annual leave from the old date when Assembly moves it", () => {
  const schedule: GeneratedSchedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    assembly_leave_sync_state: {
      "2026-06-15": { 연차: ["김상현"] },
    },
    days: [
      {
        day: 15,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["연차:김상현", "연차:수동연차", "대휴:보존대휴"],
        assignments: { 휴가: ["연차:김상현", "연차:수동연차", "대휴:보존대휴"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-06-15",
      },
      {
        day: 16,
        month: 6,
        year: 2026,
        dow: 2,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 조근: ["보존조근"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-06-16",
      },
    ],
  };
  const desired = new Map<string, Map<HubAssemblyLeaveAssignment, string[]>>([
    ["2026-06-16", new Map<HubAssemblyLeaveAssignment, string[]>([["연차", ["김상현"]]])],
  ]);

  const result = applyAssemblyLeavesToSchedule(
    schedule,
    new Set(["2026-06-15", "2026-06-16"]),
    desired,
    new Set(),
  );

  expect(result.schedule.days[0].assignments["휴가"]).toEqual(["연차:수동연차", "대휴:보존대휴"]);
  expect(result.schedule.days[0].vacations).toEqual(["연차:수동연차", "대휴:보존대휴"]);
  expect(result.schedule.days[1].assignments["휴가"]).toEqual(["연차:김상현"]);
  expect(result.schedule.days[1].assignments["조근"]).toEqual(["보존조근"]);
  expect(result.schedule.assembly_leave_sync_state).toEqual({
    "2026-06-16": { 연차: ["김상현"] },
  });
  expect(result.deletedCount).toBe(1);
});

test("assembly leaves sync removes old-date leave on first tracked run when the same Assembly person appears on another date", () => {
  const schedule: GeneratedSchedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    days: [
      {
        day: 15,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["연차:김대호", "연차:수동연차"],
        assignments: { 휴가: ["연차:김대호", "연차:수동연차"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-06-15",
      },
      {
        day: 16,
        month: 6,
        year: 2026,
        dow: 2,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: {},
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-06-16",
      },
    ],
  };
  const desired = new Map<string, Map<HubAssemblyLeaveAssignment, string[]>>([
    ["2026-06-16", new Map<HubAssemblyLeaveAssignment, string[]>([["연차", ["김대호"]]])],
  ]);

  const result = applyAssemblyLeavesToSchedule(
    schedule,
    new Set(["2026-06-15", "2026-06-16"]),
    desired,
    new Set(),
  );

  expect(result.schedule.days[0].assignments["휴가"]).toEqual(["연차:수동연차"]);
  expect(result.schedule.days[1].assignments["휴가"]).toEqual(["연차:김대호"]);
  expect(result.schedule.assembly_leave_sync_state).toEqual({
    "2026-06-16": { 연차: ["김대호"] },
  });
});

test("assembly leaves sync removes only synced jcheck names from old dates", () => {
  const schedule: GeneratedSchedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    assembly_leave_sync_state: {
      "2026-06-15": { 제크: ["김상현"] },
    },
    days: [
      {
        day: 15,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 제크: ["정규제크", "김상현"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-06-15",
      },
      {
        day: 16,
        month: 6,
        year: 2026,
        dow: 2,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 제크: ["기존제크"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-06-16",
      },
    ],
  };
  const desired = new Map<string, Map<HubAssemblyLeaveAssignment, string[]>>([
    ["2026-06-16", new Map<HubAssemblyLeaveAssignment, string[]>([["제크", ["김상현"]]])],
  ]);

  const result = applyAssemblyLeavesToSchedule(
    schedule,
    new Set(["2026-06-15", "2026-06-16"]),
    desired,
    new Set(),
  );

  expect(result.schedule.days[0].assignments["제크"]).toEqual(["정규제크"]);
  expect(result.schedule.days[1].assignments["제크"]).toEqual(["기존제크", "김상현"]);
  expect(result.schedule.assembly_leave_sync_state).toEqual({
    "2026-06-16": { 제크: ["김상현"] },
  });
});

test("assembly empty leaves preserve existing vacation targets and jcheck", () => {
  const schedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-06-01",
    days: [
      {
        day: 8,
        month: 5,
        year: 2026,
        dow: 5,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["연차:삭제연차", "대휴:보존대휴", "기타:삭제기타"],
        assignments: {
          휴가: ["연차:삭제연차", "대휴:보존대휴", "기타:삭제기타"],
          제크: ["삭제제크"],
          조근: ["보존조근"],
        },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-05-08",
      },
    ],
  } satisfies GeneratedSchedule;

  const result = applyAssemblyLeavesToSchedule(schedule, new Set(["2026-05-08"]), new Map(), new Set());
  const day = result.schedule.days[0];

  expect(day.assignments["휴가"]).toEqual(["연차:삭제연차", "대휴:보존대휴", "기타:삭제기타"]);
  expect(day.vacations).toEqual(["연차:삭제연차", "대휴:보존대휴", "기타:삭제기타"]);
  expect(day.assignments["제크"]).toEqual(["삭제제크"]);
  expect(day.assignments["조근"]).toEqual(["보존조근"]);
});

test("assembly leave sync preserves existing vacation entries when export has no matching names", () => {
  const schedule = {
    year: 2026,
    month: 5,
    monthKey: "2026-05",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-06-01",
    days: [
      {
        day: 8,
        month: 5,
        year: 2026,
        dow: 5,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["연차:보류연차", "기타:삭제기타"],
        assignments: { 휴가: ["연차:보류연차", "기타:삭제기타"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
        dateKey: "2026-05-08",
      },
    ],
  } satisfies GeneratedSchedule;
  const result = applyAssemblyLeavesToSchedule(
    schedule,
    new Set(["2026-05-08"]),
    new Map(),
    new Set([createAssemblyLeaveMatchErrorKey("2026-05-08", "연차")]),
  );

  expect(result.schedule.days[0].assignments["휴가"]).toEqual(["연차:보류연차", "기타:삭제기타"]);
});

test("assembly compensatory leave push items use accepted route final names", () => {
  const route = [
    { monthKey: "2026-06", dateKey: "2026-06-10", category: "휴가", index: 0, name: "대휴:김재식" },
    { monthKey: "2026-06", dateKey: "2026-06-12", category: "휴가", index: 0, name: "대휴:박재현" },
  ] satisfies SchedulePersonRef[];

  expect(getAssemblyCompensatoryLeavePushItems(route)).toEqual([
    { date: "2026-06-10", memberName: "박재현" },
    { date: "2026-06-12", memberName: "김재식" },
  ]);
  expect(getAssemblyCompensatoryLeavePushItems([{ ...route[0], name: "연차:김재식" }, route[1]])).toEqual([]);
});

test("assembly compensatory leave push deletes original swapped leaves before inserting final leaves", () => {
  const route = [
    { monthKey: "2026-06", dateKey: "2026-06-22", category: "휴가", index: 0, name: "대휴:황현우" },
    { monthKey: "2026-06", dateKey: "2026-06-29", category: "휴가", index: 0, name: "대휴:정철원" },
  ] satisfies SchedulePersonRef[];

  expect(getAssemblyCompensatoryLeavePushOperations(route, "upsert")).toEqual([
    { action: "delete", date: "2026-06-22", memberName: "황현우" },
    { action: "delete", date: "2026-06-29", memberName: "정철원" },
    { action: "upsert", date: "2026-06-22", memberName: "정철원" },
    { action: "upsert", date: "2026-06-29", memberName: "황현우" },
  ]);

  expect(getAssemblyCompensatoryLeavePushOperations(route, "delete")).toEqual([
    { action: "delete", date: "2026-06-22", memberName: "정철원" },
    { action: "delete", date: "2026-06-29", memberName: "황현우" },
    { action: "upsert", date: "2026-06-22", memberName: "황현우" },
    { action: "upsert", date: "2026-06-29", memberName: "정철원" },
  ]);
});

test("assembly compensatory leave push ignores names that are not on assembly duties", () => {
  const route = [
    { monthKey: "2026-06", dateKey: "2026-06-22", category: "휴가", index: 0, name: "대휴:황현우" },
    { monthKey: "2026-06", dateKey: "2026-06-29", category: "휴가", index: 0, name: "대휴:정철원" },
  ] satisfies SchedulePersonRef[];
  const operations = getAssemblyCompensatoryLeavePushOperations(route, "upsert");
  const schedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    days: [
      {
        dateKey: "2026-06-22",
        day: 22,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 국회: ["황현우"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
      {
        dateKey: "2026-06-29",
        day: 29,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 국회: ["황현우"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;

  expect(filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties(operations, [schedule])).toEqual([
    { action: "delete", date: "2026-06-22", memberName: "황현우" },
    { action: "upsert", date: "2026-06-29", memberName: "황현우" },
  ]);
});

test("assembly compensatory leave push allows swapped targets for members listed on assembly duties", () => {
  const route = [
    { monthKey: "2026-06", dateKey: "2026-06-22", category: "휴가", index: 0, name: "대휴:황현우" },
    { monthKey: "2026-06", dateKey: "2026-06-29", category: "휴가", index: 0, name: "대휴:정철원" },
  ] satisfies SchedulePersonRef[];
  const operations = getAssemblyCompensatoryLeavePushOperations(route, "upsert");
  const schedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    days: [
      {
        dateKey: "2026-06-22",
        day: 22,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 국회: ["황현우"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
      {
        dateKey: "2026-06-29",
        day: 29,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: [],
        assignments: { 국회: ["정철원"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;

  expect(filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties(operations, [schedule])).toEqual([
    { action: "delete", date: "2026-06-22", memberName: "황현우" },
    { action: "delete", date: "2026-06-29", memberName: "정철원" },
    { action: "upsert", date: "2026-06-22", memberName: "정철원" },
    { action: "upsert", date: "2026-06-29", memberName: "황현우" },
  ]);
});

test("T1: actual Hwang-Jung assembly compensatory swap clears Jung from June 29", () => {
  const route = [
    { monthKey: "2026-06", dateKey: "2026-06-22", category: "휴가", index: 0, name: "대휴:황현우" },
    { monthKey: "2026-06", dateKey: "2026-06-29", category: "휴가", index: 0, name: "대휴:정철원" },
  ] satisfies SchedulePersonRef[];
  const operations = getAssemblyCompensatoryLeavePushOperations(route, "upsert");
  const schedule = {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-01",
    days: [
      {
        dateKey: "2026-06-22",
        day: 22,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["대휴:정철원"],
        assignments: { 국회: ["황현우"], 휴가: ["대휴:정철원"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
      {
        dateKey: "2026-06-29",
        day: 29,
        month: 6,
        year: 2026,
        dow: 1,
        isWeekend: false,
        isHoliday: false,
        isCustomHoliday: false,
        isWeekdayHoliday: false,
        isOverflowMonth: false,
        vacations: ["대휴:황현우"],
        assignments: { 국회: ["정철원"], 휴가: ["대휴:황현우"] },
        manualExtras: [],
        headerName: "",
        conflicts: [],
      },
    ],
  } satisfies GeneratedSchedule;

  const eligibleOperations = filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties(operations, [schedule]);
  const vacations = syncVacationTextForChangedRoute(
    "2026-06-22: 대휴:황현우\n2026-06-29: 대휴:정철원",
    [schedule],
    route,
  );

  expect(eligibleOperations).toEqual([
    { action: "delete", date: "2026-06-22", memberName: "황현우" },
    { action: "delete", date: "2026-06-29", memberName: "정철원" },
    { action: "upsert", date: "2026-06-22", memberName: "정철원" },
    { action: "upsert", date: "2026-06-29", memberName: "황현우" },
  ]);
  expect(vacations).toContain("2026-06-22: 대휴:정철원");
  expect(vacations).toContain("2026-06-29: 대휴:황현우");
  expect(vacations).not.toContain("2026-06-29: 대휴:정철원");
});
