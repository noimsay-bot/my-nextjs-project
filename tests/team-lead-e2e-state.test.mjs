import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 보호 데이터 읽기·쓰기 규칙(P4)을 실제 WebCrypto와 가짜 세션/열쇠로 검사한다.
function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadCommonJs(code, requireMap = {}) {
  const commonJsModule = { exports: {} };
  const localRequire = (specifier) => {
    if (!(specifier in requireMap)) throw new Error(`unexpected import: ${specifier}`);
    return requireMap[specifier];
  };
  new Function("exports", "module", "require", code)(commonJsModule.exports, commonJsModule, localRequire);
  return commonJsModule.exports;
}

const crypto = loadCommonJs(transpile("../lib/team-lead/e2e-crypto.ts"));
const core = loadCommonJs(transpile("../lib/team-lead/e2e-state-core.ts"), { "@/lib/team-lead/e2e-crypto": crypto });

const TEAM_LEAD = { id: "lead", role: "team_lead", approved: true };
const DESK = { id: "desk", role: "desk", approved: true };

async function setup({ session = TEAM_LEAD, meta = null, unlocked = true, unlockSucceeds = false, keyVersion = 1 } = {}) {
  const dataKey = await crypto.generateTeamLeadDataKey();
  const state = { session, meta, unlocked: unlocked ? { keyVersion, dataKey } : null, lockedNotices: [], unlockCalls: 0 };
  const protectedState = core.createTeamLeadProtectedState({
    async getSession() {
      return state.session;
    },
    async loadCryptoMeta() {
      return state.meta;
    },
    getUnlockedDataKey(profileId) {
      return state.unlocked && profileId === state.session?.id ? state.unlocked : null;
    },
    async unlock() {
      state.unlockCalls += 1;
      if (unlockSucceeds) state.unlocked = { keyVersion, dataKey };
      return unlockSucceeds;
    },
    onLocked(stateKey) {
      state.lockedNotices.push(stateKey);
    },
  });
  return { protectedState, state, dataKey };
}

test("storage.ts의 동적 로딩 판별값이 암호 모듈의 보호 key·형식과 같다", () => {
  const storageSource = readFileSync(new URL("../lib/team-lead/storage.ts", import.meta.url), "utf8");
  const setBlock = storageSource.match(/const TEAM_LEAD_PROTECTED_STATE_KEYS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(setBlock, "storage.ts에서 보호 key 목록을 찾지 못했습니다.");
  const keys = [...setBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(keys, [...crypto.TEAM_LEAD_E2E_PROTECTED_STATE_KEYS].sort());
  assert.ok(storageSource.includes(`=== "${crypto.TEAM_LEAD_E2E_ENVELOPE_FORMAT}"`));
});

test("암호화 전(평문)에는 지금과 똑같이 읽고 쓴다", async () => {
  const { protectedState, state } = await setup({ meta: null, unlocked: false });
  const plain = { 2026: { 홍길동: [{ label: "특보", score: 1 }] } };

  assert.deepEqual(await protectedState.read("contribution_manual_v1", plain), { locked: false, encrypted: false, state: plain });
  assert.deepEqual(await protectedState.read("contribution_manual_v1", null), { locked: false, encrypted: false, state: null });
  assert.equal(await protectedState.prepareForWrite("contribution_manual_v1", plain), plain);
  assert.equal(state.unlockCalls, 0);
});

test("보호 대상이 아닌 key는 암호화가 켜져 있어도 손대지 않는다", async () => {
  const { protectedState } = await setup({ meta: { enabled: true, currentKeyVersion: 1 } });
  const value = { profileIds: ["a"] };
  assert.equal(await protectedState.prepareForWrite("review_access_v1", value), value);
  assert.equal(await protectedState.prepareForWrite("final_cut_v1", value), value);
});

test("암호화가 켜져 있으면 암호문으로 저장하고, 다시 읽으면 원래 값이 나온다", async () => {
  const { protectedState } = await setup({ meta: { enabled: true, currentKeyVersion: 1 } });
  const value = { broadcastAccident: { 김기자: [{ id: "x", label: "장비 사고", score: -2 }] } };

  const stored = await protectedState.prepareForWrite("scoreboard_v1", value);
  assert.ok(crypto.isTeamLeadE2eEnvelope(stored));
  assert.ok(!JSON.stringify(stored).includes("김기자"));

  assert.deepEqual(await protectedState.read("scoreboard_v1", stored), { locked: false, encrypted: true, state: value });
});

test("잠긴 총괄팀장 기기: 자동으로 열기를 시도하고, 실패하면 빈 값과 안내, 저장 거부", async () => {
  const writer = await setup({ meta: { enabled: true, currentKeyVersion: 1 } });
  const envelope = await writer.protectedState.prepareForWrite("reference_notes_v1", { 2026: { a: [{ id: "1", text: "메모" }] } });

  const locked = await setup({ meta: { enabled: true, currentKeyVersion: 1 }, unlocked: false, unlockSucceeds: false });
  const result = await locked.protectedState.read("reference_notes_v1", envelope);
  assert.equal(result.locked, true);
  assert.equal(result.state, null);
  assert.equal(result.reason, "no_key");
  assert.equal(locked.state.unlockCalls, 1);
  assert.deepEqual(locked.state.lockedNotices, ["reference_notes_v1"]);

  await assert.rejects(locked.protectedState.prepareForWrite("reference_notes_v1", {}), {
    name: "TeamLeadProtectedStateLockedError",
  });
});

test("잠긴 기기가 자동으로 열리면 정상적으로 읽는다", async () => {
  const lead = await setup({ meta: { enabled: true, currentKeyVersion: 1 }, unlocked: false, unlockSucceeds: true });
  const envelope = await crypto.encryptTeamLeadState(lead.dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, value: [1] });
  const result = await lead.protectedState.read("scoreboard_v1", envelope);
  assert.deepEqual(result, { locked: false, encrypted: true, state: [1] });
  assert.equal(lead.state.unlockCalls, 1);
});

test("DESK 등 총괄팀장이 아니면 암호문을 열려고 하지 않고 안내도 띄우지 않는다", async () => {
  const lead = await setup();
  const envelope = await crypto.encryptTeamLeadState(lead.dataKey, { stateKey: "contribution_manual_v1", keyVersion: 1, value: {} });

  const desk = await setup({ session: DESK, meta: { enabled: true, currentKeyVersion: 1 }, unlocked: false, unlockSucceeds: true });
  const result = await desk.protectedState.read("contribution_manual_v1", envelope);
  assert.equal(result.locked, true);
  assert.equal(result.reason, "not_team_lead");
  assert.equal(desk.state.unlockCalls, 0);
  assert.deepEqual(desk.state.lockedNotices, []);
  await assert.rejects(desk.protectedState.prepareForWrite("contribution_manual_v1", {}), {
    name: "TeamLeadProtectedStateLockedError",
  });

  const pendingLead = await setup({ session: { ...TEAM_LEAD, approved: false }, unlocked: true });
  assert.equal((await pendingLead.protectedState.read("contribution_manual_v1", envelope)).reason, "not_team_lead");
});

test("암호화 플래그가 아직 꺼져 있어도 이 탭에서 암호문을 본 적이 있으면 평문 저장을 거부한다", async () => {
  const lead = await setup();
  const envelope = await crypto.encryptTeamLeadState(lead.dataKey, { stateKey: "best_report_quarters_v1", keyVersion: 1, value: [] });

  const locked = await setup({ meta: null, unlocked: false });
  const plainValue = [];
  assert.equal(await locked.protectedState.prepareForWrite("best_report_quarters_v1", plainValue), plainValue);
  await locked.protectedState.read("best_report_quarters_v1", envelope);
  await assert.rejects(locked.protectedState.prepareForWrite("best_report_quarters_v1", []), {
    name: "TeamLeadProtectedStateLockedError",
  });
});

test("열쇠 세대가 다르거나 다른 열쇠로 잠긴 암호문은 잠김으로 처리한다", async () => {
  const lead = await setup({ meta: { enabled: true, currentKeyVersion: 2 }, keyVersion: 1 });
  const otherKey = await crypto.generateTeamLeadDataKey();
  const v2 = await crypto.encryptTeamLeadState(otherKey, { stateKey: "scoreboard_v1", keyVersion: 2, value: 1 });
  assert.equal((await lead.protectedState.read("scoreboard_v1", v2)).reason, "key_version");
  await assert.rejects(lead.protectedState.prepareForWrite("scoreboard_v1", 1), { name: "TeamLeadProtectedStateLockedError" });

  const sameVersion = await setup({ meta: { enabled: true, currentKeyVersion: 1 } });
  const foreign = await crypto.encryptTeamLeadState(otherKey, { stateKey: "scoreboard_v1", keyVersion: 1, value: 1 });
  assert.equal((await sameVersion.protectedState.read("scoreboard_v1", foreign)).reason, "decrypt_failed");
});

test("열쇠 새로 고치기 전후: 다른 세대 암호문은 그 세대 사본으로 읽고, 저장은 새 세대로 한다", async () => {
  const oldKey = await crypto.generateTeamLeadDataKey();
  const newKey = await crypto.generateTeamLeadDataKey();
  const state = { meta: { enabled: true, currentKeyVersion: 2 }, unlocked: { keyVersion: 1, dataKey: oldKey }, unlockCalls: 0 };
  const protectedState = core.createTeamLeadProtectedState({
    async getSession() {
      return TEAM_LEAD;
    },
    async loadCryptoMeta() {
      return state.meta;
    },
    getUnlockedDataKey() {
      return state.unlocked;
    },
    async getDataKeyForVersion(profileId, keyVersion) {
      assert.equal(profileId, TEAM_LEAD.id);
      return keyVersion === 1 ? oldKey : keyVersion === 2 ? newKey : null;
    },
    async unlock() {
      // 다른 탭이 세대를 올렸으므로 다시 열면 새 세대가 열린다.
      state.unlockCalls += 1;
      state.unlocked = { keyVersion: 2, dataKey: newKey };
      return true;
    },
  });

  const v2Envelope = await crypto.encryptTeamLeadState(newKey, { stateKey: "scoreboard_v1", keyVersion: 2, value: { a: 2 } });
  const v1Envelope = await crypto.encryptTeamLeadState(oldKey, { stateKey: "reference_notes_v1", keyVersion: 1, value: { a: 1 } });
  assert.deepEqual((await protectedState.read("scoreboard_v1", v2Envelope)).state, { a: 2 }, "새 세대 행도 읽는다");

  const written = await protectedState.prepareForWrite("scoreboard_v1", { a: 3 });
  assert.equal(written.keyVersion, 2, "저장은 새 세대 열쇠로 한다");
  assert.equal(state.unlockCalls, 1);
  assert.deepEqual((await protectedState.read("reference_notes_v1", v1Envelope)).state, { a: 1 }, "예전 세대 행도 읽는다");

  const v9Envelope = { ...v1Envelope, keyVersion: 9 };
  const locked = await protectedState.read("reference_notes_v1", v9Envelope);
  assert.equal(locked.locked, true);
  assert.equal(locked.reason, "key_version");
});
