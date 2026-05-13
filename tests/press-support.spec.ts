import { expect, test } from "@playwright/test";
import { getPressSupportCountsForAssignment } from "@/lib/schedule/press-support";

test("press support counts assignment duty labels", () => {
  expect(getPressSupportCountsForAssignment("국회 지원", [""])).toEqual({
    assembly: 1,
    law: 0,
  });

  expect(getPressSupportCountsForAssignment("법조지원", [""])).toEqual({
    assembly: 0,
    law: 1,
  });
});

test("press support keeps legacy schedule text counting without duty double count", () => {
  expect(getPressSupportCountsForAssignment("일반", ["오전 국회 지원", "오후 법조 지원"])).toEqual({
    assembly: 1,
    law: 1,
  });

  expect(getPressSupportCountsForAssignment("법조 지원", ["법조 지원"])).toEqual({
    assembly: 0,
    law: 1,
  });

  expect(getPressSupportCountsForAssignment("일반", ["검찰 지원"])).toEqual({
    assembly: 0,
    law: 1,
  });
});
