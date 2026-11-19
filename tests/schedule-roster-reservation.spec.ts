import { expect, test } from "@playwright/test";

import { defaultScheduleState } from "@/lib/schedule/constants";
import {
  cancelRosterReservationInMap,
  getCurrentKstDateKey,
  getUpcomingRosterReservation,
  remapBlueHouseAssignmentsForRosterChange,
  reserveRosterInMap,
  ROSTER_BASE_EFFECTIVE_DATE_KEY,
  sanitizeScheduleState,
  setCurrentRosterInMap,
  toggleBlueHouseAssignment,
} from "@/lib/schedule/engine";
import { prepareScheduleForPublish } from "@/lib/schedule/published";
import type { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextWeekday(date: Date) {
  const next = new Date(date);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

// 다음 달 평일 두 날짜: 첫째 날은 예약 전, 둘째 날(시행일)부터 예약 명단이 적용된다.
function createReservationFixture() {
  const now = new Date();
  const before = nextWeekday(new Date(now.getFullYear(), now.getMonth() + 1, 2));
  const effective = nextWeekday(new Date(now.getFullYear(), now.getMonth() + 1, 15));
  const year = effective.getFullYear();
  const month = effective.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const createDay = (date: Date): DaySchedule => ({
    dateKey: toDateKey(date),
    day: date.getDate(),
    month,
    year,
    dow: date.getDay(),
    isWeekend: false,
    isHoliday: false,
    isCustomHoliday: false,
    isWeekdayHoliday: false,
    isOverflowMonth: false,
    vacations: [],
    assignments: { 조근: ["유규열"], 야근: ["이지수"] },
    manualExtras: [],
    headerName: "홍승재",
    conflicts: [],
  });
  const generated = {
    year,
    month,
    monthKey,
    days: [createDay(before), createDay(effective)],
    nextPointers: defaultScheduleState.pointers,
    nextStartDate: toDateKey(effective),
  } as unknown as GeneratedSchedule;

  return { beforeDateKey: toDateKey(before), effectiveDateKey: toDateKey(effective), monthKey, generated };
}

test("reserved 일반조/청와대 rosters apply from the effective date only", () => {
  const { beforeDateKey, effectiveDateKey, monthKey, generated } = createReservationFixture();
  const currentGeneral = ["구본준", "김재식", "박재현"];
  const currentBlueHouse = ["김미란", "박재현"];

  const state = sanitizeScheduleState({
    ...defaultScheduleState,
    generalTeamPeople: currentGeneral,
    generalTeamRosterVersion: defaultScheduleState.generalTeamRosterVersion,
    generalTeamPeopleByDate: reserveRosterInMap({}, currentGeneral, effectiveDateKey, ["구본준", "김재식", "최민수"]),
    blueHousePeople: currentBlueHouse,
    blueHousePeopleByDate: reserveRosterInMap({}, currentBlueHouse, effectiveDateKey, ["이주원", "박재현"]),
    generated,
    generatedHistory: [generated],
  });

  // 오늘 기준 본 명단은 그대로다.
  expect(state.generalTeamPeople).toEqual(currentGeneral);
  expect(state.blueHousePeople).toEqual(currentBlueHouse);

  const before = state.generated?.days.find((day) => day.dateKey === beforeDateKey);
  const after = state.generated?.days.find((day) => day.dateKey === effectiveDateKey);
  expect(before?.assignments["청와대"]).toEqual(["김미란"]);
  expect(before?.assignments["일반"]).toEqual(["구본준", "김재식", "박재현"]);
  expect(after?.assignments["청와대"]).toEqual(["이주원"]);
  expect(after?.assignments["일반"]).toEqual(["구본준", "김재식", "최민수"]);

  // 시행일 이후의 청와대 토글은 예약 명단 안에서만 번갈아 바뀐다.
  const toggled = toggleBlueHouseAssignment(state, monthKey, effectiveDateKey);
  const toggledAfter = toggled.generated?.days.find((day) => day.dateKey === effectiveDateKey);
  expect(toggledAfter?.assignments["청와대"]).toEqual(["박재현"]);
  expect(toggledAfter?.assignments["일반"]).toEqual(["구본준", "김재식", "최민수"]);

  // 게시 근무표도 날짜별 명단으로 계산된다.
  const published = prepareScheduleForPublish(generated, [], state);
  const publishedBefore = published.days.find((day) => day.dateKey === beforeDateKey);
  const publishedAfter = published.days.find((day) => day.dateKey === effectiveDateKey);
  expect(publishedBefore?.assignments["일반"]).toEqual(["구본준", "김재식", "박재현"]);
  expect(publishedAfter?.assignments["일반"]).toEqual(["구본준", "김재식", "최민수"]);
});

test("existing blue house names after the effective date are remapped and restored on cancel", () => {
  const { beforeDateKey, effectiveDateKey, generated } = createReservationFixture();
  const filled: GeneratedSchedule = {
    ...generated,
    days: generated.days.map((day) => ({ ...day, assignments: { ...day.assignments, 청와대: ["김미란"] } })),
  };
  const previous = { blueHousePeople: ["김미란", "박재현"], blueHousePeopleByDate: {} };
  const reserved = {
    blueHousePeople: ["김미란", "박재현"],
    blueHousePeopleByDate: reserveRosterInMap({}, previous.blueHousePeople, effectiveDateKey, ["이주원", "박재현"]),
  };

  const remapped = remapBlueHouseAssignmentsForRosterChange(filled, previous, reserved);
  expect(remapped.changed).toBe(true);
  expect(remapped.schedule.days.find((day) => day.dateKey === beforeDateKey)?.assignments["청와대"]).toEqual(["김미란"]);
  expect(remapped.schedule.days.find((day) => day.dateKey === effectiveDateKey)?.assignments["청와대"]).toEqual(["이주원"]);

  const cancelled = { ...reserved, blueHousePeopleByDate: cancelRosterReservationInMap(reserved.blueHousePeopleByDate) };
  expect(cancelled.blueHousePeopleByDate).toEqual({});
  const restored = remapBlueHouseAssignmentsForRosterChange(remapped.schedule, reserved, cancelled);
  expect(restored.schedule.days.find((day) => day.dateKey === effectiveDateKey)?.assignments["청와대"]).toEqual(["김미란"]);
});

test("roster map helpers keep past entries and edit only the active period", () => {
  const today = getCurrentKstDateKey();
  const future = "2999-12-01";
  const map = reserveRosterInMap({}, ["A", "B"], future, ["A", "C"], today);

  expect(map).toEqual({ [ROSTER_BASE_EFFECTIVE_DATE_KEY]: ["A", "B"], [future]: ["A", "C"] });
  expect(getUpcomingRosterReservation(map, today)).toEqual({ effectiveDateKey: future, names: ["A", "C"] });

  // 지금 명단을 바로 수정해도 예약 명단은 그대로다.
  const edited = setCurrentRosterInMap(map, ["A", "B", "D"], today);
  expect(edited[ROSTER_BASE_EFFECTIVE_DATE_KEY]).toEqual(["A", "B", "D"]);
  expect(edited[future]).toEqual(["A", "C"]);

  // 예약을 다시 하면 이전 미래 예약은 대체된다.
  const rescheduled = reserveRosterInMap(map, ["A", "B"], "2999-11-01", ["E"], today);
  expect(Object.keys(rescheduled)).toEqual([ROSTER_BASE_EFFECTIVE_DATE_KEY, "2999-11-01"]);

  // 예약이 없을 때는 날짜별 명단을 만들지 않는다.
  expect(setCurrentRosterInMap({}, ["A"], today)).toEqual({});
});
