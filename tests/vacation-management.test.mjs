import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual page's loading/listener hooks with deterministic hook and store doubles.
// No duplicate implementation of the event handlers and no production database access.
const source = readFileSync(new URL("../app/(portal)/schedule/vacations/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("  const syncMonthFromCache =");
const end = source.indexOf("  useEffect(() => {\n    const onExtraChange", start);
assert.ok(start > 0 && end > start, "The hook region must be updated when the page structure changes");
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const window = new EventTarget();
  const effects = [];
  const calls = [];
  const messages = [];
  let syncs = 0;
  let fail = false;
  const globals = {
    window, Error, year: 2026, month: 9, selectionLoaded: true,
    VACATION_EVENT: "vacation", VACATION_STATUS_EVENT: "status", PUBLISHED_SCHEDULES_EVENT: "published", SCHEDULE_STATE_EVENT: "schedule",
    useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
    getVacationApplicantsOverview: () => {
      syncs += 1;
      return { monthState: { dailyCapacity: 0 }, managedDateKeys: [], displayDateKeys: [], annualApplicants: [], compensatoryApplicants: [], requests: [] };
    },
    getUsers: () => [], isVacationRequestOpen: () => true, loadExtraUnits: async () => {},
    setMessage: (message) => messages.push(message),
  };
  for (const name of ["MonthState", "ManagedDateKeys", "DisplayDateKeys", "HasGeneratedSchedule", "AnnualApplicants", "CompensatoryApplicants", "MonthRequests", "Users", "VacationRequestOpenState"]) globals[`set${name}`] = () => {};
  for (const [name, event] of [["refreshScheduleState", "schedule"], ["refreshPublishedSchedules", "published"], ["refreshVacationStore", "vacation"], ["refreshUsers", "users"]]) {
    globals[name] = async () => {
      calls.push(name);
      if (fail) throw new Error("offline test failure");
      await Promise.resolve();
      window.dispatchEvent(new Event(event));
    };
  }
  vm.runInNewContext(compiled, globals);
  const cleanups = effects.map((effect) => effect());
  return { window, calls, messages, syncs: () => syncs, fail: () => { fail = true; }, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("vacation refresh events update caches without recursively fetching; focus performs one refresh", async () => {
  const state = setup();
  await settle();
  assert.equal(state.calls.length, 4);
  const before = state.syncs();
  for (const event of ["vacation", "published", "schedule"]) state.window.dispatchEvent(new Event(event));
  await settle();
  assert.equal(state.syncs(), before + 3);
  assert.equal(state.calls.length, 4);
  state.window.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(state.calls.length, 8);
  state.unmount();
  const after = state.syncs();
  state.window.dispatchEvent(new Event("focus"));
  state.window.dispatchEvent(new Event("vacation"));
  await settle();
  assert.equal(state.calls.length, 8);
  assert.equal(state.syncs(), after);
});

test("vacation refresh failures surface a warning without unhandled rejection or retries", async () => {
  const state = setup();
  await settle();
  state.fail();
  state.window.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(state.calls.length, 8);
  assert.equal(state.messages[0].tone, "warn");
  assert.match(state.messages[0].text, /offline test failure/);
  state.unmount();
});
