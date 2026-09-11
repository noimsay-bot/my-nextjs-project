import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/portal/member-level.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(overrides = {}) {
  const rows = {
    restaurants: [{ id: "r1", author_id: "a" }, { id: "r2", author_id: "b" }],
    restaurant_comments: [{ id: "c1", author_id: "a" }],
    profiles: [{ id: "a", role: "member" }, { id: "b", role: "member" }, { id: "admin", role: "admin" }],
    page_visit_events: [{ profile_id: "b" }, { profile_id: "a" }, { profile_id: "b" }, ...Array.from({ length: 5 }, () => ({ profile_id: "admin" }))],
    ...overrides,
  };
  const calls = [];
  const listeners = [];
  let session = { id: "a", role: "member", actualRole: "member", approved: true };
  let now = Date.parse("2026-09-10T00:00:00Z");
  let failTable = null;
  let wait = null;
  const client = { from(table) {
    const call = { table, ops: [] };
    calls.push(call);
    const query = {
      async then(resolve, reject) {
        try {
          if (wait) await wait;
          if (table === failTable) return resolve({ error: { message: "offline" }, data: null });
          let data = [...rows[table]];
          for (const { method, args } of call.ops) {
            if (method === "eq") data = data.filter((row) => row[args[0]] === args[1]);
            if (method === "in") data = data.filter((row) => args[1].includes(row[args[0]]));
            if (method === "range") data = data.slice(args[0], args[1] + 1);
          }
          const options = call.ops.find((op) => op.method === "select")?.args[1];
          return resolve({ data: options?.head ? null : data, count: data.length, error: null });
        } catch (error) { return reject(error); }
      },
    };
    for (const method of ["select", "eq", "in", "gte", "order", "range", "returns"]) query[method] = (...args) => {
      call.ops.push({ method, args });
      return query;
    };
    return query;
  } };
  const exports = {};
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  vm.runInNewContext(compiled, {
    exports, window: {}, Date: Clock,
    require(name) {
      if (name === "@/lib/supabase/client") return { createClient: () => client };
      if (name === "@/lib/auth/storage") return {
        getSession: () => session,
        subscribeToAuth: (listener) => listeners.push(listener),
      };
      throw new Error(name);
    },
  });
  return {
    api: exports, calls, rows,
    advance: (ms) => { now += ms; },
    fail: (table) => { failTable = table; },
    hold: (promise) => { wait = promise; },
    session: (next) => { session = next; listeners.forEach((listener) => listener(next)); },
  };
}

test("single member uses two filtered HEAD counts; rank excludes managers and keeps tie ordering", async () => {
  const { api, calls } = setup();
  const result = await api.getMemberLevelSnapshot(" a ");
  assert.equal(result.restaurantPoints, 10);
  assert.equal(result.commentPoints, 3);
  assert.equal(result.monthlyVisitRankPoints, 9);
  assert.equal(result.totalPoints, 22);
  for (const call of calls.filter((call) => call.table.startsWith("restaurant"))) {
    assert.equal(call.ops.find((op) => op.method === "select").args[1].head, true);
    assert.equal(call.ops.find((op) => op.method === "eq").args[1], "a");
  }
  assert.equal(calls.find((call) => call.table === "page_visit_events").ops[0].args[0], "profile_id");
});

test("concurrent identical requests share queries and return isolated snapshots; navigation reuses rank only", async () => {
  const { api, calls, rows } = setup();
  const [one, two] = await Promise.all([api.getMemberLevelMap(["a"]), api.getMemberLevelMap(["a"])]);
  assert.equal(calls.length, 4);
  one.get("a").totalPoints = -10;
  assert.equal(two.get("a").totalPoints, 22);
  rows.restaurants.push({ id: "r3", author_id: "a" });
  assert.equal((await api.getMemberLevelSnapshot("a")).restaurantPoints, 20);
  assert.equal(calls.length, 6);
});

test("bulk member queries filter authors and ranks include rows after the first page", async () => {
  const { api, calls } = setup({
    page_visit_events: [...Array.from({ length: 1000 }, () => ({ profile_id: "a" })), ...Array.from({ length: 1001 }, () => ({ profile_id: "b" }))],
  });
  const result = await api.getMemberLevelMap(["a", "b"]);
  assert.equal(result.get("b").monthlyVisitRankPoints, 10);
  assert.equal(result.get("a").monthlyVisitRankPoints, 9);
  assert.equal(result.size, 2);
  assert.equal(calls.filter((call) => call.table === "page_visit_events").length, 3);
  assert.ok(calls.filter((call) => call.table.startsWith("restaurant")).every((call) => call.ops.some((op) => op.method === "in")));
});

test("failed rank queries are not cached and retry recovers", async () => {
  const state = setup();
  state.fail("page_visit_events");
  assert.equal((await state.api.getMemberLevelSnapshot("a")).totalPoints, 0);
  state.fail(null);
  assert.equal((await state.api.getMemberLevelSnapshot("a")).totalPoints, 22);
  assert.equal(state.calls.filter((call) => call.table === "page_visit_events").length, 2);
});

test("rank expires and account/role changes clear its cache", async () => {
  const state = setup();
  await state.api.getMemberLevelSnapshot("a");
  state.advance(60_001);
  await state.api.getMemberLevelSnapshot("a");
  state.session({ id: "b", role: "member", actualRole: "member", approved: true });
  await state.api.getMemberLevelSnapshot("b");
  assert.equal(state.calls.filter((call) => call.table === "page_visit_events").length, 3);
  state.session(null);
  const count = state.calls.length;
  assert.equal((await state.api.getMemberLevelMap(["a"])).size, 0);
  assert.equal(state.calls.length, count);
});

test("in-flight work from a signed-out session cannot populate the new session cache", async () => {
  const state = setup();
  let release;
  state.hold(new Promise((resolve) => { release = resolve; }));
  const pending = state.api.getMemberLevelMap(["a"]);
  state.session(null);
  state.session({ id: "a", role: "member", actualRole: "member", approved: true });
  release();
  assert.equal((await pending).size, 0);
  state.hold(null);
  assert.equal((await state.api.getMemberLevelSnapshot("a")).totalPoints, 22);
  assert.equal(state.calls.filter((call) => call.table === "profiles").length, 2);
});
