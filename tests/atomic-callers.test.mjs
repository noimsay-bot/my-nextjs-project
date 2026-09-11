import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies) {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, require: (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  } });
  return exports;
}

function news({ role = "admin", status = "draft", error = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, "home_news_issue_sets");
      const query = { select: () => query, eq: () => query, single: async () => ({ data: { id: "set", status, items: [] }, error: null }) };
      // Deliberately no insert/update/delete methods: a multiwrite fallback must fail.
      return query;
    },
    rpc: async (name, args) => { calls.push({ name, args }); return { error }; },
  };
  const api = load("../lib/home-news/issue-set-actions.ts", {
    "@/lib/auth/storage": { hasAdminAccess: (value) => value === "admin" || value === "team_lead" },
    "@/lib/home-news/admin-types": {},
    "@/lib/home-news/issue-set-queries": { getNewsIssueSetWorkspace: async () => ({ sets: [] }) },
    "@/lib/home-news/issue-set-types": {},
    "@/lib/supabase/portal": {
      getPortalSession: async () => ({ id: "actor", role, approved: true }),
      getPortalSupabaseClient: async () => client,
      getSupabaseStorageErrorMessage: (problem) => problem.message,
    },
  });
  return { api, calls };
}

test("news composition and publication each use a single transactional RPC", async () => {
  const { api, calls } = news();
  assert.equal((await api.saveNewsIssueSetItems({ issueSetId: "set", briefingIds: ["story"] })).ok, true);
  assert.equal((await api.publishNewsIssueSet("set")).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "save_news_issue_set_items_atomic", args: { p_issue_set_id: "set", p_briefing_ids: ["story"] } },
    { name: "publish_news_issue_set_atomic", args: { p_issue_set_id: "set" } },
  ]);
});

test("missing news RPC fails explicitly without destructive fallback; role/status guards remain", async () => {
  const state = news({ error: { code: "PGRST202", message: "missing function" } });
  assert.match((await state.api.saveNewsIssueSetItems({ issueSetId: "set", briefingIds: [] })).message, /incremental_atomic_news_and_live_status/);
  assert.match((await state.api.publishNewsIssueSet("set")).message, /incremental_atomic_news_and_live_status/);
  for (const options of [{ role: "member" }, { status: "locked" }, { status: "archived" }]) {
    const guarded = news(options);
    assert.equal((await guarded.api.publishNewsIssueSet("set")).ok, false);
    assert.equal(guarded.calls.length, 0);
  }
});

const actor = "00000000-0000-4000-8000-000000000001";
const camera = "00000000-0000-4000-8000-000000000002";
function live({ role = "desk", approved = true, authenticated = true, error = null } = {}) {
  const calls = [];
  const admin = {
    from(table) {
      assert.equal(table, "profiles");
      const query = { select: () => query, eq: (_key, id) => { assert.equal(id, actor); return query; }, maybeSingle: async () => ({ data: { id: actor, role, approved }, error: null }) };
      return query;
    },
    rpc: async (name, args) => { calls.push({ name, args }); return { error }; },
  };
  const api = load("../app/api/equipment/live-status/route.ts", {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ status: options.status ?? 200, body }) } },
    "@/lib/supabase/admin": { hasSupabaseAdminEnv: () => true, createAdminClient: () => admin },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: actor } : null }, error: null }) } }) },
  });
  return { calls, post: (body) => api.POST({ json: async () => body }) };
}

test("equipment caller derives actor from verified auth, normalizes input, and delegates once", async () => {
  const state = live();
  assert.equal((await state.post({ actorId: "spoofed", entries: [{ equipmentItemId: camera, cameraReporter: " Reporter ", note: "x".repeat(300) }] })).status, 200);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "save_live_equipment_status_atomic");
  assert.equal(state.calls[0].args.p_actor_id, actor);
  assert.equal(state.calls[0].args.p_entries[0].live_camera_reporter, "Reporter");
  assert.equal(state.calls[0].args.p_entries[0].live_note.length, 240);
});

test("equipment auth, approval, duplicate and migration errors never perform partial table writes", async () => {
  for (const [options, expected] of [[{ authenticated: false }, 401], [{ role: "member" }, 403], [{ approved: false }, 403]]) {
    const state = live(options);
    assert.equal((await state.post({ entries: [{ equipmentItemId: camera }] })).status, expected);
    assert.equal(state.calls.length, 0);
  }
  const invalid = live();
  for (const entries of [[], [{}], [{ equipmentItemId: "bad" }], [{ equipmentItemId: camera }, { equipmentItemId: camera }]]) {
    assert.equal((await invalid.post({ entries })).status, 400);
  }
  assert.equal(invalid.calls.length, 0);
  const missing = live({ error: { code: "42883", message: "missing" } });
  const result = await missing.post({ entries: [{ equipmentItemId: camera }] });
  assert.equal(result.status, 500);
  assert.match(result.body.message, /incremental_atomic_news_and_live_status/);
  assert.equal(missing.calls.length, 1);
});
