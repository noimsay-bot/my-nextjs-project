import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/home-popup/storage.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const post = { id: "post", category: "notice", title: "Cached post", body: "Keep this full body", authorId: "a", authorName: "A", attachment: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };

function setup({ quota = false } = {}) {
  let session = { id: "a", role: "member", approved: true };
  const entries = new Map([["jtbc-home-workspace-cache-v2:a", JSON.stringify({ version: 3, cachedAt: Date.now(), notices: [], ddays: [], communityPosts: [post], communityComments: [] })]]);
  const calls = [];
  const exports = {};
  const browser = new EventTarget();
  Object.assign(browser, { setTimeout, clearTimeout, localStorage: {
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => { if (quota) throw new Error("QuotaExceededError"); entries.set(key, value); },
  } });
  vm.runInNewContext(compiled, {
    exports, window: browser, Event, CustomEvent, AbortController, URLSearchParams, console,
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ notices: [], ddays: [], communityPosts: [], communityComments: [], applications: [] }) };
    },
    require(name) {
      if (name === "@/lib/auth/storage") return { getSession: () => session, isReadOnlyPortalRole: () => false };
      if (name === "@/lib/supabase/portal") return {
        getPortalSession: async () => session,
        getPortalSupabaseClient: () => assert.fail("Summary must not download the full Supabase workspace"),
      };
      if (name === "@/lib/portal/traffic-debug") return { logPortalTrafficDebug() {} };
      throw new Error(name);
    },
  });
  return { api: exports, calls, entries, session: (next) => { session = next; } };
}

test("home summary uses the API without community payload and preserves the full cached community", async () => {
  const { api, calls, entries } = setup();
  assert.equal(api.hydrateHomePopupWorkspaceFromLocal(), true);
  const result = await api.refreshHomePopupNoticeWorkspace({ includeTrips: false, includeCommunity: false });
  assert.equal(calls[0], "/api/home/public-workspace?includeTrips=0&includeCommunity=0");
  assert.equal(result.communityPosts[0].body, post.body);
  assert.equal(JSON.parse(entries.get("jtbc-home-workspace-cache-v2:a")).communityPosts[0].body, post.body);
  await api.refreshHomePopupNoticeWorkspace({ includeTrips: false, includeCommunity: false });
  assert.equal(calls.length, 1);
});

test("cold summary does not overwrite a full local cache with empty community arrays", async () => {
  const { api, entries } = setup();
  const original = entries.get("jtbc-home-workspace-cache-v2:a");
  await api.refreshHomePopupNoticeWorkspace({ includeTrips: false, includeCommunity: false });
  assert.equal(entries.get("jtbc-home-workspace-cache-v2:a"), original);
});

test("optional localStorage write failure does not fail hydration or successful refresh", async () => {
  const { api } = setup({ quota: true });
  assert.equal(api.hydrateHomePopupWorkspaceFromLocal(), true);
  assert.equal((await api.refreshHomePopupNoticeWorkspace({ includeTrips: false, includeCommunity: false })).communityPosts.length, 1);
});

test("switching accounts or signing out never carries community data into another session", async () => {
  const state = setup();
  state.api.hydrateHomePopupWorkspaceFromLocal();
  state.session({ id: "b", role: "member", approved: true });
  assert.equal((await state.api.refreshHomePopupNoticeWorkspace({ includeTrips: false, includeCommunity: false })).communityPosts.length, 0);
  assert.equal(state.entries.has("jtbc-home-workspace-cache-v2:b"), false);
  state.session(null);
  assert.equal((await state.api.refreshHomePopupNoticeWorkspace()).communityPosts.length, 0);
  assert.equal(state.calls.length, 1);
});
