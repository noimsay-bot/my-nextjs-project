import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run with: node --test tests/celebration-storage.test.mjs
// Imports are stubbed: no browser, environment files, auth service, or DB access.
const source = readFileSync(new URL("../lib/celebrations/storage.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const missingColumn = {
  code: "42703",
  message: "column portal_celebration_events.recurrence does not exist",
};
const missingCacheColumn = {
  code: "PGRST204",
  message: "Could not find the 'recurrence' column of 'portal_celebration_events' in the schema cache",
};
const legacyRow = {
  id: "event-1", title: "테스트", message: null, button_label: "확인",
  effect: "confetti", intensity: "normal", is_active: true,
  starts_at: null, ends_at: null, created_by: "admin-1",
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const draft = {
  title: " 테스트 ", message: "", button_label: "확인", intensity: "normal",
  starts_at: "", ends_at: "", recurrence: "none", is_active: true,
};
const success = (data) => ({ data, error: null });
const failure = (error) => ({ data: null, error });

function loadStorage(responses, session = { id: "admin-1", approved: true, actualRole: "admin" }) {
  const calls = [];
  const pending = [...responses];
  const warnings = [];
  const client = {
    from(table) {
      const call = { table, operations: [] };
      calls.push(call);
      const finish = () => {
        assert.ok(pending.length, "Unexpected additional Supabase request");
        return Promise.resolve(pending.shift());
      };
      const chain = {
        then(resolve, reject) { return finish().then(resolve, reject); },
        returns: finish,
        single: finish,
      };
      for (const method of ["select", "eq", "neq", "order", "limit", "insert", "update"]) {
        chain[method] = (...args) => {
          call.operations.push({ method, args });
          return chain;
        };
      }
      return chain;
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console: { warn: (...args) => warnings.push(args) },
    require(name) {
      if (name === "@/lib/auth/storage") {
        return { getSession: () => session, hasAdminAccess: (role) => role === "admin" };
      }
      if (name === "@/lib/supabase/client") {
        return { createClient: () => client, hasSupabaseEnv: () => true };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { storage: exports, calls, warnings, pending };
}

const argsFor = (call, method) => call.operations.find((operation) => operation.method === method)?.args;
const hasRecurrence = (call) => argsFor(call, "select")[0].split(", ").includes("recurrence");

test("modern reads keep recurrence and original query limits with no retry", async () => {
  for (const [method, limit] of [["getRecentCelebrationEvents", 20], ["getActiveCelebrationEvent", 100]]) {
    const { storage, calls } = loadStorage([success([{ ...legacyRow, recurrence: "none" }])]);
    const result = await storage[method]();
    assert.equal((Array.isArray(result) ? result[0] : result).recurrence, "none");
    assert.equal(calls.length, 1);
    assert.ok(hasRecurrence(calls[0]));
    assert.equal(argsFor(calls[0], "limit")[0], limit);
  }
  const { storage } = loadStorage([success([{ ...legacyRow, recurrence: "yearly" }])]);
  assert.equal((await storage.getRecentCelebrationEvents())[0].recurrence, "yearly");
});

for (const error of [missingColumn, missingCacheColumn]) {
  test(`legacy list and active reads retry only recurrence projection (${error.code})`, async () => {
    for (const [method, limit] of [["getRecentCelebrationEvents", 20], ["getActiveCelebrationEvent", 100]]) {
      const { storage, calls } = loadStorage([failure(error), success([legacyRow])]);
      const result = await storage[method]();
      assert.equal((Array.isArray(result) ? result[0] : result).recurrence, "none");
      assert.equal(calls.length, 2);
      assert.ok(hasRecurrence(calls[0]));
      assert.equal(hasRecurrence(calls[1]), false);
      for (const call of calls) {
        assert.equal(call.table, "portal_celebration_events");
        assert.equal(argsFor(call, "limit")[0], limit);
        assert.equal(argsFor(call, "order")[0], "created_at");
        assert.equal(argsFor(call, "order")[1].ascending, false);
        if (method === "getActiveCelebrationEvent") {
          assert.equal(argsFor(call, "eq")[0], "is_active");
          assert.equal(argsFor(call, "eq")[1], true);
        }
      }
    }
  });

  test(`one-off insert retries without recurrence and deactivates only after success (${error.code})`, async () => {
    const { storage, calls } = loadStorage([failure(error), success(legacyRow), success(null)]);
    const result = await storage.createCelebrationEvent(draft, { deactivateExisting: true });
    assert.equal(result.recurrence, "none");
    assert.equal(calls.length, 3);
    assert.equal(argsFor(calls[0], "insert")[0].recurrence, "none");
    assert.ok(hasRecurrence(calls[0]));
    const payload = argsFor(calls[1], "insert")[0];
    assert.equal(Object.hasOwn(payload, "recurrence"), false);
    assert.equal(payload.title, "테스트");
    assert.equal(payload.created_by, "admin-1");
    assert.equal(hasRecurrence(calls[1]), false);
    assert.equal(argsFor(calls[2], "update")[0].is_active, false);
    assert.equal(argsFor(calls[2], "neq")[1], legacyRow.id);
  });

  test(`yearly insert fails with migration guidance and never downgrades or deactivates (${error.code})`, async () => {
    const { storage, calls } = loadStorage([failure(error)]);
    await assert.rejects(
      storage.createCelebrationEvent({ ...draft, recurrence: "yearly" }, { deactivateExisting: true }),
      /supabase\/incremental_portal_celebration_events_recurrence\.sql/,
    );
    assert.equal(calls.length, 1);
    assert.equal(argsFor(calls[0], "insert")[0].recurrence, "yearly");
  });
}

test("active legacy reads still exclude future and expired events", async () => {
  const { storage } = loadStorage([failure(missingColumn), success([
    { ...legacyRow, id: "future", starts_at: "2999-01-01T00:00:00Z" },
    { ...legacyRow, id: "expired", ends_at: "2000-01-01T00:00:00Z" },
    legacyRow,
  ])]);
  assert.equal((await storage.getActiveCelebrationEvent()).id, legacyRow.id);
});

test("next read tries modern columns again after legacy fallback", async () => {
  const { storage, calls } = loadStorage([
    failure(missingColumn), success([legacyRow]), success([{ ...legacyRow, recurrence: "yearly" }]),
  ]);
  await storage.getRecentCelebrationEvents();
  assert.equal((await storage.getRecentCelebrationEvents())[0].recurrence, "yearly");
  assert.equal(calls.length, 3);
  assert.ok(hasRecurrence(calls[2]));
});

test("modern yearly insert preserves recurrence with a single request", async () => {
  const { storage, calls } = loadStorage([success({ ...legacyRow, recurrence: "yearly" })]);
  const result = await storage.createCelebrationEvent({ ...draft, recurrence: "yearly" }, { deactivateExisting: false });
  assert.equal(result.recurrence, "yearly");
  assert.equal(calls.length, 1);
});

test("unrelated columns, relations, permissions, and network errors never retry", async () => {
  const errors = [
    { code: "42703", message: "column portal_celebration_events.starts_at does not exist" },
    { code: "42703", message: "column other_table.recurrence does not exist" },
    { code: "PGRST204", message: "Could not find the 'starts_at' column of 'portal_celebration_events' in the schema cache" },
    { code: "PGRST204", message: "Could not find the 'recurrence' column of 'other_table' in the schema cache" },
    { code: "42501", message: "permission denied for table portal_celebration_events" },
    { code: "", message: "Failed to fetch" },
  ];
  for (const error of errors) {
    for (const method of ["getRecentCelebrationEvents", "createCelebrationEvent", "getActiveCelebrationEvent"]) {
      const { storage, calls, warnings } = loadStorage([failure(error)]);
      const request = method === "createCelebrationEvent"
        ? storage[method](draft, { deactivateExisting: true })
        : storage[method]();
      if (method === "getActiveCelebrationEvent") {
        assert.equal(await request, null);
        assert.equal(warnings.length, 1);
      } else {
        await assert.rejects(request, (failure) => failure.message === error.message);
      }
      assert.equal(calls.length, 1);
    }
  }
});

test("fallback failure propagates and cannot deactivate existing events", async () => {
  const error = { code: "42501", message: "permission denied" };
  const { storage, calls } = loadStorage([failure(missingColumn), failure(error)]);
  await assert.rejects(storage.createCelebrationEvent(draft, { deactivateExisting: true }), /permission denied/);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((call) => argsFor(call, "update")), false);
});

test("an insert without a returned row cannot deactivate existing events", async () => {
  const { storage, calls } = loadStorage([success(null)]);
  await assert.rejects(storage.createCelebrationEvent(draft, { deactivateExisting: true }), /게시에 실패/);
  assert.equal(calls.length, 1);
});

test("unapproved or non-admin sessions cannot list or create even on legacy schema", async () => {
  for (const session of [null, { approved: false, actualRole: "admin" }, { approved: true, actualRole: "member" }]) {
    const { storage, calls } = loadStorage([], session);
    await assert.rejects(storage.getRecentCelebrationEvents(), /관리자 권한/);
    await assert.rejects(storage.createCelebrationEvent(draft, { deactivateExisting: true }), /관리자 권한/);
    assert.equal(calls.length, 0);
  }
});
