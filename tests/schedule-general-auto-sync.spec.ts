import { expect, test } from "@playwright/test";

import { defaultScheduleState } from "@/lib/schedule/constants";
import { generateSchedule, removePersonFromCategory, sanitizeScheduleState, syncGeneralAssignments } from "@/lib/schedule/engine";
import { presetScheduleMonths } from "@/lib/schedule/preset-schedules.generated";

test("2026 schedule months use the newsroom week-based ranges", () => {
  const ranges = [
    { month: 5, first: "2026-05-04", last: "2026-06-06" },
    { month: 6, first: "2026-06-08", last: "2026-07-04" },
    { month: 7, first: "2026-07-05", last: "2026-08-01" },
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

test("general assignments are restored after an edit removes an eligible name", () => {
  const generated = generateSchedule({
    ...defaultScheduleState,
    year: 2026,
    month: 5,
  }).state;
  const initialState = sanitizeScheduleState(generated);
  const day21 = initialState.generated?.days.find((day) => day.dateKey === "2026-05-21");

  expect(day21?.assignments["일반"]).toContain("정상원");
  const generalIndex = day21?.assignments["일반"]?.findIndex((name) => name === "정상원") ?? -1;
  expect(generalIndex).toBeGreaterThanOrEqual(0);

  const editedState = removePersonFromCategory(initialState, "2026-05-21", "일반", generalIndex, "정상원");
  const editedDay21 = editedState.generated?.days.find((day) => day.dateKey === "2026-05-21");

  expect(editedDay21?.assignments["일반"]).toContain("정상원");
  expect(editedDay21?.assignments["석근"] ?? []).not.toContain("정상원");
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

test("general assignments exclude globally off names while keeping evening-only off names eligible", () => {
  const aprilPreset = presetScheduleMonths.find((item) => item.monthKey === "2026-04");
  expect(aprilPreset).toBeTruthy();

  const days = JSON.parse(JSON.stringify(aprilPreset!.days));
  const state = {
    ...defaultScheduleState,
    year: 2026,
    month: 4,
    offPeople: ["변경태", "이완근"],
    offByCategory: {
      ...defaultScheduleState.offByCategory,
      evening: ["정상원"],
    },
  };

  syncGeneralAssignments(state, days, state.generalTeamPeople);

  const day21 = days.find((day: { dateKey: string; assignments: Record<string, string[]> }) => day.dateKey === "2026-04-21");
  expect(day21?.assignments["일반"]).not.toContain("변경태");
  expect(day21?.assignments["일반"]).not.toContain("이완근");
  expect(day21?.assignments["일반"]).toContain("정상원");
});
