import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule(relativePath, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require(name) {
      assert.equal(name, "server-only");
      return {};
    },
    AbortController,
    ...globals,
  });
  return exports;
}

test("log-only mail never records the email, login ID, or password and never sends", async () => {
  const { deliverTemporaryPasswordMail } = loadModule("../lib/server/mail-core.ts");
  const warnings = [];
  const input = { email: "review-user@example.test", loginId: "review-login", username: "Test", temporaryPassword: "dummy-secret-not-real" };
  const result = await deliverTemporaryPasswordMail(input, { mailLogOnly: true }, {
    warn: (message) => warnings.push(message),
    sendMail: () => assert.fail("Log-only mode must not send mail"),
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "log_only");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /re\*\*\*@example\.test/);
  for (const value of [input.email, input.loginId, input.temporaryPassword]) {
    assert.equal(warnings[0].includes(value), false);
  }
});

function timeoutModule(fetch) {
  let deadline;
  let cleared = 0;
  const loaded = loadModule("../lib/server/fetch-text-with-timeout.ts", {
    fetch,
    setTimeout(callback, duration) { deadline = callback; assert.equal(duration, 8_000); return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared += 1; },
  });
  return { ...loaded, expire: () => deadline(), cleared: () => cleared };
}

test("weather fetch preserves options and clears its deadline after the body", async () => {
  const helper = timeoutModule(async (url, init) => {
    assert.equal(url, "https://example.test/weather");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.Accept, "application/json");
    return { ok: true, status: 200, text: async () => '{"weather":"ok"}' };
  });
  const result = await helper.fetchTextWithTimeout("https://example.test/weather", { cache: "no-store", headers: { Accept: "application/json" } });
  assert.equal(result.text, '{"weather":"ok"}');
  assert.equal(helper.cleared(), 1);
});

test("weather deadline aborts a stalled body even after headers have arrived", async () => {
  let reading;
  const started = new Promise((resolve) => { reading = resolve; });
  const helper = timeoutModule(async (_url, { signal }) => ({
    ok: true,
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      reading();
    }),
  }));
  const request = helper.fetchTextWithTimeout("https://example.test/weather");
  await started;
  helper.expire();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(helper.cleared(), 1);
});

test("weather fetch propagates caller cancellation and clears timers on network failure", async () => {
  const caller = new AbortController();
  caller.abort(new Error("caller cancelled"));
  const helper = timeoutModule(async (_url, { signal }) => {
    assert.equal(signal.aborted, true);
    throw signal.reason;
  });
  await assert.rejects(helper.fetchTextWithTimeout("https://example.test/weather", { signal: caller.signal }), /caller cancelled/);
  assert.equal(helper.cleared(), 1);
});
