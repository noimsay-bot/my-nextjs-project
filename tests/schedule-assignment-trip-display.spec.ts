import { test, expect } from "@playwright/test";
import {
  createCustomAssignmentRowKey,
  createDefaultScheduleAssignmentEntry,
  formatScheduleAssignmentDisplayName,
} from "@/lib/team-lead/storage";
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
