import { expect, test } from "@playwright/test";

import { defaultScheduleState, getDayDuplicateNameSet } from "@/lib/schedule/constants";
import { generateSchedule, removePersonFromCategory, sanitizeScheduleState, syncGeneralAssignments } from "@/lib/schedule/engine";
import { presetScheduleMonths } from "@/lib/schedule/preset-schedules.generated";
import { canRepairPublishedGeneralAssignments, normalizePublishedSchedule } from "@/lib/schedule/published";

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

test("vacation entries remove the same person from work assignments", () => {
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
  expect(workAssignments).not.toContain(vacationName);
  expect(getDayDuplicateNameSet(updatedDay!).has(vacationName)).toBe(false);
});

test("published schedule normalization removes vacation people from work assignments", () => {
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

test("schedule state normalization removes vacation people already stored on the day", () => {
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
  expect(workAssignments).not.toContain(vacationName);
  expect(getDayDuplicateNameSet(updatedDay).has(vacationName)).toBe(false);
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
