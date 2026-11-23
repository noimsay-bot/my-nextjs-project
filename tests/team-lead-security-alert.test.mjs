import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 총괄팀장 보안 코드 변경 알림의 판단 로직을 가짜 저장소·메일로 검사한다. 실제 메일·DB는 쓰지 않는다.
function loadCore() {
  const code = ts.transpileModule(readFileSync(new URL("../lib/team-lead/security-alert-core.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const commonJsModule = { exports: {} };
  new Function("exports", "module", "require", code)(commonJsModule.exports, commonJsModule, () => {
    throw new Error("security-alert-core는 다른 모듈을 import하지 않아야 한다(next.config.ts에서 바로 쓴다).");
  });
  return commonJsModule.exports;
}

const core = loadCore();

function manifest(files, commit = { sha: "abcdef1234567", message: "보안 열쇠 수정\n\n자세한 설명", author: "dev", ref: "main" }) {
  return { version: 1, files, commit, builtAt: "2026-11-23T00:00:00.000Z" };
}

function createDeps(overrides = {}) {
  const sent = [];
  const store = { value: null };
  const deps = {
    manifest: manifest({ "lib/team-lead/e2e-crypto.ts": "h1", "lib/team-lead/storage.ts": "h2" }),
    async loadPrevious() {
      return store.value;
    },
    async savePrevious(value) {
      store.value = structuredClone(value);
    },
    async listRecipients() {
      return ["lead@example.test"];
    },
    async sendMail(input) {
      sent.push(input);
      return { sent: true };
    },
    now: () => "2026-11-24T00:30:00.000Z",
    siteUrl: "https://portal.example.test",
    ...overrides,
  };
  return { deps, sent, store };
}

test("감시 대상은 보안 관련 파일만이다(일반 화면 수정으로 메일이 가지 않게)", () => {
  const watched = [
    "lib/team-lead/e2e-crypto.ts",
    "lib/team-lead/e2e-state.ts",
    "lib/team-lead/storage.ts",
    "lib/team-lead/scoreboard.ts",
    "lib/team-lead/security-alert-core.ts",
    "lib/supabase/portal.ts",
    "components/team-lead/security-keys-page.tsx",
    "app/(portal)/team-lead/security/page.tsx",
    "app/api/internal/team-lead/security-change-alert/route.ts",
    "supabase/incremental_team_lead_e2e_keys.sql",
    "supabase/incremental_team_lead_e2e_key_version_guard.sql",
    "next.config.ts",
    "vercel.json",
    "package.json",
  ];
  for (const path of watched) assert.equal(core.isTeamLeadSecurityWatchedPath(path), true, path);
  assert.equal(core.isTeamLeadSecurityWatchedPath("lib\\team-lead\\e2e-crypto.ts"), true, "윈도우 경로도 같게 본다");

  const ignored = [
    "lib/team-lead/contribution.ts",
    "components/team-lead/contribution-page.tsx",
    "components/schedule/schedule-app.tsx",
    "supabase/schema.sql",
    "supabase/incremental_restrict_admin_privilege_escalation.sql",
    "package-lock.json",
  ];
  for (const path of ignored) assert.equal(core.isTeamLeadSecurityWatchedPath(path), false, path);
});

test("next.config.ts가 감시 목록으로 지문을 만들어 서버에 넣는다", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /from "\.\/lib\/team-lead\/security-alert-core"/);
  assert.match(config, /TEAM_LEAD_SECURITY_MANIFEST: JSON\.stringify\(buildTeamLeadSecurityManifest\(\)\)/);
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/internal/team-lead/security-change-alert"));
});

test("처음 점검: 알림 시작 메일을 보내고 기준을 저장한다", async () => {
  const { deps, sent, store } = createDeps();
  const result = await core.runTeamLeadSecurityAlertCheck(deps);
  assert.deepEqual(result, { status: "started", recipients: 1 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /알림이 시작/);
  assert.match(sent[0].text, /감시 중인 파일: 2개/);
  assert.deepEqual(store.value.files, deps.manifest.files);
});

test("바뀌지 않았으면 메일을 보내지 않는다", async () => {
  const { deps, sent, store } = createDeps();
  store.value = structuredClone(deps.manifest);
  store.value.builtAt = "2026-11-01T00:00:00.000Z";
  assert.deepEqual(await core.runTeamLeadSecurityAlertCheck(deps), { status: "unchanged" });
  assert.equal(sent.length, 0);
});

test("바뀌었으면 바뀐·새·없어진 파일과 커밋 설명을 메일로 보내고 기준을 바꾼다", async () => {
  const { deps, sent, store } = createDeps();
  store.value = manifest({ "lib/team-lead/e2e-crypto.ts": "old", "lib/team-lead/e2e-old.ts": "x" });
  const result = await core.runTeamLeadSecurityAlertCheck(deps);
  assert.equal(result.status, "alerted");
  assert.deepEqual(result.diff, {
    added: ["lib/team-lead/storage.ts"],
    removed: ["lib/team-lead/e2e-old.ts"],
    changed: ["lib/team-lead/e2e-crypto.ts"],
  });
  const text = sent[0].text;
  assert.match(sent[0].subject, /보안 관련 코드가 바뀌었습니다/);
  assert.match(text, /바뀐 파일 1개\n {2}- lib\/team-lead\/e2e-crypto\.ts/);
  assert.match(text, /새로 생긴 파일 1개/);
  assert.match(text, /없어진 파일 1개/);
  assert.match(text, /개발자가 남긴 설명: 보안 열쇠 수정\n/, "설명은 첫 줄만 넣는다");
  assert.match(text, /커밋: abcdef1 \(작성: dev\) · 브랜치: main/);
  assert.match(text, /2026\. 11\. 24\./, "확인 시각은 한국 시간으로 쓴다");
  assert.deepEqual(store.value.files, deps.manifest.files);
});

test("Git 커밋 정보 없이 배포되면 메일에 강하게 경고한다", async () => {
  const { deps, sent, store } = createDeps({
    manifest: manifest({ "lib/team-lead/e2e-crypto.ts": "new" }, { sha: null, message: null, author: null, ref: null }),
  });
  store.value = manifest({ "lib/team-lead/e2e-crypto.ts": "old" });
  await core.runTeamLeadSecurityAlertCheck(deps);
  assert.match(sent[0].text, /GitHub 커밋 기록이 없습니다/);
  assert.match(sent[0].text, /반드시 개발자에게/);
});

test("메일이 나가지 않으면 기준을 바꾸지 않아 다음 점검 때 다시 보낸다", async () => {
  const previous = manifest({ "lib/team-lead/e2e-crypto.ts": "old" });
  const { deps, store } = createDeps({ sendMail: async () => ({ sent: false }) });
  store.value = structuredClone(previous);
  assert.deepEqual(await core.runTeamLeadSecurityAlertCheck(deps), { status: "mail_not_sent", kind: "change" });
  assert.deepEqual(store.value, previous);

  const failing = createDeps({
    sendMail: async () => {
      throw new Error("smtp down");
    },
  });
  failing.store.value = structuredClone(previous);
  await assert.rejects(core.runTeamLeadSecurityAlertCheck(failing.deps), /smtp down/);
  assert.deepEqual(failing.store.value, previous);
});

test("받을 총괄팀장이 없거나 지문 목록이 없으면 아무것도 바꾸지 않는다", async () => {
  const noRecipients = createDeps({ listRecipients: async () => [] });
  assert.deepEqual(await core.runTeamLeadSecurityAlertCheck(noRecipients.deps), { status: "no_recipients" });
  assert.equal(noRecipients.store.value, null);

  const noManifest = createDeps({ manifest: null });
  assert.deepEqual(await core.runTeamLeadSecurityAlertCheck(noManifest.deps), { status: "no_manifest" });
  assert.equal(core.parseTeamLeadSecurityManifest("not json"), null);
  assert.equal(core.parseTeamLeadSecurityManifest({ version: 2, files: {} }), null);
});
