import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { defaultScheduleState } from "@/lib/schedule/constants";
import type { DaySchedule, GeneratedSchedule, ScheduleState } from "@/lib/schedule/types";
import {
  applyExtraUnitToScheduleSnapshot,
  buildExtraLotteryResultsForUnit,
  hasExtraLotteryResults,
  normalizeExtraVacationDateKeys,
  type VacationExtraRequest,
  type VacationExtraUnit,
} from "@/lib/vacation/extra-storage";

function createDay(dateKey: string, vacations: string[] = []): DaySchedule {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return {
    dateKey,
    day,
    month,
    year,
    dow: date.getDay(),
    isWeekend: date.getDay() === 0 || date.getDay() === 6,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations,
    assignments: vacations.length > 0 ? { "휴가": [...vacations] } : {},
    manualExtras: [],
    headerName: "",
    conflicts: [],
  };
}

function createSchedule(days: DaySchedule[]): GeneratedSchedule {
  return {
    year: 2026,
    month: 7,
    monthKey: "2026-07",
    days,
    nextPointers: { ...defaultScheduleState.pointers },
    nextStartDate: "2026-07-09",
  };
}

function createScheduleState(schedule: GeneratedSchedule): ScheduleState {
  return {
    ...defaultScheduleState,
    year: 2026,
    month: 7,
    vacations: "2026-07-06: 연차:1차연차",
    generated: schedule,
    generatedHistory: [schedule],
  };
}

function createUnit(overrides: Partial<VacationExtraUnit> = {}): VacationExtraUnit {
  return {
    id: "extra-unit-1",
    label: "7월 추가 신청",
    targetYear: 2026,
    targetMonth: 7,
    dateKeys: ["2026-07-06", "2026-07-07", "2026-07-08"],
    limits: {},
    annualWinners: {},
    compensatoryWinners: {},
    isOpen: false,
    appliedAt: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function createRequest(
  requesterName: string,
  type: "연차" | "대휴",
  dates: string[],
): VacationExtraRequest {
  return {
    id: `${requesterName}-${type}`,
    unitId: "extra-unit-1",
    requesterId: `${requesterName}-id`,
    requesterName,
    type,
    dates,
    rawDates: "",
    createdAt: "",
  };
}

test("R1: extra migration keeps primary vacation tables untouched", () => {
  const sql = readFileSync("supabase/incremental_vacation_extra.sql", "utf8");

  expect(sql).toContain("create table if not exists public.vacation_extra_units");
  expect(sql).toContain("create table if not exists public.vacation_extra_requests");
  expect(sql).not.toMatch(/\b(alter table|update|delete from|insert into|drop table)\s+public\.vacation_requests\b/i);
  expect(sql).not.toMatch(/\b(alter table|update|delete from|insert into|drop table)\s+public\.vacation_months\b/i);
});

test("A1/A3: extra lottery is independent and honors each date capacity", () => {
  const primaryLotteryDone = { annualWinners: { "2026-07-06": ["1차당첨"] } };
  const unit = createUnit({
    limits: {
      "2026-07-06": 1,
      "2026-07-07": 2,
    },
  });
  const requests = [
    createRequest("김연차", "연차", ["2026-07-06"]),
    createRequest("이연차", "연차", ["2026-07-06", "2026-07-07"]),
    createRequest("박대휴", "대휴", ["2026-07-07"]),
  ];

  expect(primaryLotteryDone.annualWinners["2026-07-06"]).toEqual(["1차당첨"]);
  expect(hasExtraLotteryResults(unit)).toBe(false);

  const result = buildExtraLotteryResultsForUnit(unit, requests);

  expect(result.annualWinners["2026-07-06"]).toHaveLength(1);
  expect([
    ...(result.annualWinners["2026-07-07"] ?? []),
    ...(result.compensatoryWinners["2026-07-07"] ?? []),
  ]).toHaveLength(2);
});

test("A4/A5/A6: extra apply appends typed winners to draft and published schedules and skips missing dates", () => {
  const draftSchedule = createSchedule([
    createDay("2026-07-06", ["연차:1차연차"]),
    createDay("2026-07-07"),
  ]);
  const publishedSchedule = createSchedule([
    createDay("2026-07-06", ["연차:1차연차"]),
    createDay("2026-07-07"),
  ]);
  const primaryRequestRow = {
    id: "primary-request-1",
    monthKey: "2026-07",
    requesterName: "1차연차",
    dates: ["2026-07-06"],
  };
  const unit = createUnit({
    annualWinners: {
      "2026-07-06": ["추가연차"],
      "2026-07-08": ["없는날연차"],
    },
    compensatoryWinners: {
      "2026-07-06": ["추가대휴"],
      "2026-07-07": ["둘째날대휴"],
    },
  });

  const result = applyExtraUnitToScheduleSnapshot(
    createScheduleState(draftSchedule),
    [{ monthKey: "2026-07", title: "7월", publishedAt: "", schedule: publishedSchedule }],
    unit,
  );

  const draftDay6 = result.scheduleState.generated?.days.find((day) => day.dateKey === "2026-07-06");
  const draftDay7 = result.scheduleState.generated?.days.find((day) => day.dateKey === "2026-07-07");
  const publishedDay6 = result.publishedItems[0]?.schedule.days.find((day) => day.dateKey === "2026-07-06");

  expect(primaryRequestRow).toEqual({
    id: "primary-request-1",
    monthKey: "2026-07",
    requesterName: "1차연차",
    dates: ["2026-07-06"],
  });
  expect(draftDay6?.vacations).toEqual(["연차:1차연차", "연차:추가연차", "대휴:추가대휴"]);
  expect(draftDay6?.assignments["휴가"]).toEqual(["연차:1차연차", "연차:추가연차", "대휴:추가대휴"]);
  expect(publishedDay6?.vacations).toEqual(["연차:1차연차", "연차:추가연차", "대휴:추가대휴"]);
  expect(publishedDay6?.assignments["휴가"]).toEqual(["연차:1차연차", "연차:추가연차", "대휴:추가대휴"]);
  expect(draftDay7?.vacations).toEqual(["대휴:둘째날대휴"]);
  expect(result.scheduleState.vacations).not.toContain("2026-07-08");
  expect(result.extraApprovedMap["2026-07-08"]).toBeUndefined();
});

test("V-B: extra date normalization excludes weekends and required schedule holidays", () => {
  expect(
    normalizeExtraVacationDateKeys(
      ["2026-05-01", "2026-05-02", "2026-05-04"],
      2026,
      5,
    ),
  ).toEqual(["2026-05-04"]);
});
