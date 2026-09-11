import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Actual storage modules; every Supabase/auth dependency is synthetic and offline.
const compiled = new Map();
const clone = (value) => JSON.parse(JSON.stringify(value));
const month = (key) => ({ year: 2026, month: Number(key.slice(5)), monthKey: key,
  days: [{ dateKey: `${key}-07`, assignments: {}, vacations: [], manualExtras: [] }], nextStartDate: `${key}-08` });
function fixture() {
  const calls = [];
  const rows = new Map(["2026-09", "2026-10"].map((key) => [key, {
    month_key: key, draft_state: month(key), published_state: month(key), published_at: "published", updated_at: "v1",
  }]));
  let revision = 1;
  let intercept = async () => null;
  const defaultState = { year: 2026, month: 9, vacations: "", generatedHistory: [], generated: null };
  let settings = clone(defaultState);
  let session = { id: "synthetic-desk", approved: true, username: "테스트", role: "desk" };
  const client = {
    from(table) {
      const call = { table, method: "read", filters: [] };
      const finish = async () => {
        calls.push(clone(call));
        const override = await intercept(call);
        if (override) return override;
        if (table === "schedule_settings") {
          if (call.payload) settings = clone(call.payload.state);
          return { data: { key: "global", state: clone(settings) }, error: null };
        }
        assert.equal(table, "schedule_months");
        const matches = (row) => call.filters.every(([type, key, value]) => type === "not" ? row[key] !== null
          : type === "in" ? value.includes(row[key]) : row[key] === value);
        let data;
        if (call.method === "insert") {
          const inserts = Array.isArray(call.payload) ? call.payload : [call.payload];
          if (inserts.some((row) => rows.has(row.month_key))) return { data: null, error: { message: "duplicate month" } };
          data = inserts.map((row) => {
            const value = { ...clone(row), updated_at: `v${++revision}` };
            rows.set(value.month_key, value);
            return value;
          });
        } else {
          data = [...rows.values()].filter(matches);
          if (call.method === "update") data = data.map((row) => {
            Object.assign(row, clone(call.payload), { updated_at: `v${++revision}` });
            return row;
          });
          if (call.method === "delete") data.forEach((row) => rows.delete(row.month_key));
        }
        return { data: clone(data), error: null };
      };
      const chain = { then: (resolve, reject) => finish().then(resolve, reject), returns: finish, maybeSingle: finish };
      for (const method of ["select", "order"]) chain[method] = (...args) => { call[method] = args; return chain; };
      for (const method of ["eq", "is", "in"]) chain[method] = (key, value) => { call.filters.push([method, key, value]); return chain; };
      chain.not = (key, _operator, value) => { call.filters.push(["not", key, value]); return chain; };
      for (const method of ["insert", "upsert", "update", "delete"]) chain[method] = (payload) => {
        call.method = method; if (payload) call.payload = payload; return chain;
      };
      return chain;
    },
  };
  const stubs = {
    "@/lib/schedule/constants": { defaultScheduleState: defaultState },
    "@/lib/schedule/desk-records": { refreshDeskRecordStore: async () => undefined },
    "@/lib/schedule/engine": { sanitizeScheduleState: clone, normalizeGeneratedSchedule: clone,
      getMonthKey: (year, month) => `${year}-${String(month).padStart(2, "0")}`, syncGeneralAssignments: () => undefined },
    "@/lib/schedule/preset-schedules.generated": { presetScheduleMonths: [] },
    "@/lib/supabase/portal": { getPortalSession: async () => session, getPortalSupabaseClient: async () => client,
      getSupabaseStorageErrorMessage: (error) => error.message, isSupabaseSchemaMissingError: () => false },
  };
  const loaded = new Map();
  function load(name) {
    if (stubs[name]) return stubs[name];
    if (loaded.has(name)) return loaded.get(name);
    assert.match(name, /^@\/lib\/schedule\/(storage|published|optimistic-lock|month-version)$/);
    if (!compiled.has(name)) compiled.set(name, ts.transpileModule(readFileSync(new URL(`../${name.slice(2)}.ts`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    const exports = {};
    loaded.set(name, exports);
    vm.runInNewContext(compiled.get(name), { exports, require: load, console, Error,
      process: { env: { NODE_ENV: "production" } }, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout });
    return exports;
  }
  const storage = load("@/lib/schedule/storage");
  const published = load("@/lib/schedule/published");
  return { storage, published, rows, calls,
    setIntercept(fn) { intercept = fn; }, setSession(next) { session = next; },
    async refresh() { await storage.refreshScheduleState(); await published.refreshPublishedSchedules(); },
    writes() { return calls.filter((call) => call.table === "schedule_months" && call.method !== "read"); },
    editDraft(key = "2026-09") {
      const state = storage.readStoredScheduleState();
      state.generatedHistory.find((item) => item.monthKey === key).days[0].assignments.취재 = ["초안 수정"];
      return storage.saveScheduleState(state);
    },
    editPublished(keys = ["2026-09"]) {
      const items = published.getPublishedSchedules();
      items.filter((item) => keys.includes(item.monthKey)).forEach((item) => { item.schedule.days[0].assignments.취재 = ["게시 수정"]; });
      return published.savePublishedSchedules(items);
    },
  };
}

test("draft then publication save carries the local version forward and only writes the changed month", async () => {
  const f = fixture(); await f.refresh();
  await f.editDraft(); await f.editPublished();
  assert.equal(f.writes().length, 2);
  assert.equal(f.writes()[1].filters.find(([, key]) => key === "updated_at")[2], "v2");
  assert.equal(f.rows.get("2026-10").updated_at, "v1");
  assert.deepEqual(f.rows.get("2026-09").published_state.days[0].assignments.취재, ["게시 수정"]);
});

test("publication then draft save also carries the matching local version forward", async () => {
  const f = fixture(); await f.refresh();
  await f.editPublished(); await f.editDraft();
  assert.equal(f.writes()[1].filters.find(([, key]) => key === "updated_at")[2], "v2");
});

test("an external edit between local saves is rejected and the DB publication is preserved", async () => {
  const f = fixture(); await f.refresh(); await f.editDraft();
  const row = f.rows.get("2026-09"); row.updated_at = "external";
  row.published_state.days[0].assignments.취재 = ["다른 편집자"];
  await assert.rejects(f.editPublished(), /다른 곳에서 변경/);
  assert.deepEqual(row.published_state.days[0].assignments.취재, ["다른 편집자"]);
  assert.equal(f.published.getPublishedSchedules()[0].schedule.days[0].assignments.취재[0], "다른 편집자");
});

test("refreshing just the draft cannot bless a stale publication version", async () => {
  const f = fixture(); await f.refresh();
  f.rows.get("2026-09").updated_at = "external";
  await f.storage.refreshScheduleState(); await f.editDraft();
  await assert.rejects(f.editPublished(), /다른 곳에서 변경/);
  assert.equal(f.writes()[1].filters.find(([, key]) => key === "updated_at")[2], "v1");
});

test("refreshing just publication cannot bless a stale draft version", async () => {
  const f = fixture(); await f.refresh();
  f.rows.get("2026-09").updated_at = "external";
  await f.published.refreshPublishedSchedules(); await f.editPublished();
  await assert.rejects(f.editDraft(), /다른 곳에서 변경/);
});

test("saving the same publication list makes no schedule-month writes", async () => {
  const f = fixture(); await f.refresh();
  await f.published.savePublishedSchedules(f.published.getPublishedSchedules());
  assert.equal(f.writes().length, 0);
});

test("first draft insertion returns a version used by subsequent edits", async () => {
  const f = fixture(); await f.refresh();
  const state = f.storage.readStoredScheduleState(); state.generatedHistory.push(month("2026-11"));
  await f.storage.saveScheduleState(state); await f.editDraft("2026-11");
  assert.equal(f.writes()[0].method, "insert");
  assert.equal(f.writes()[1].method, "update");
  assert.equal(f.writes()[1].filters.find(([, key]) => key === "updated_at")[2], "v2");
});

test("a concurrent new month cannot be overwritten by a draft insert", async () => {
  const f = fixture(); await f.refresh();
  const state = f.storage.readStoredScheduleState(); state.generatedHistory.push(month("2026-11"));
  f.rows.set("2026-11", { month_key: "2026-11", draft_state: month("2026-11"), updated_at: "external" });
  await assert.rejects(f.storage.saveScheduleState(state), /duplicate month/);
  assert.equal(f.rows.get("2026-11").updated_at, "external");
});

test("partial publication failure waits for slower writes before DB recovery", async () => {
  const f = fixture(); await f.refresh();
  let lateWriteFinished = false;
  f.setIntercept(async (call) => {
    const key = call.filters.find(([, name]) => name === "month_key")?.[2];
    if (call.method === "update" && key === "2026-09") return { data: null, error: { message: "injected failure" } };
    if (call.method === "update" && key === "2026-10") { await new Promise((resolve) => setTimeout(resolve, 20)); lateWriteFinished = true; }
    if (call.table === "schedule_months" && call.method === "read") assert.equal(lateWriteFinished, true);
    return null;
  });
  await assert.rejects(f.editPublished(["2026-09", "2026-10"]), /injected failure/);
  assert.equal(f.published.getPublishedSchedules()[1].schedule.days[0].assignments.취재[0], "게시 수정");
});

test("unapproved sessions cannot persist schedules", async () => {
  const f = fixture(); await f.refresh(); f.setSession({ approved: false });
  await assert.rejects(f.editDraft(), /승인된 로그인/);
  assert.equal(f.writes().length, 0);
});
