import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 실제 WebCrypto + 메모리 가짜 저장소로 보안 열쇠 관리 흐름을 검사한다. Supabase/IndexedDB는 쓰지 않는다.
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
const managerModule = loadCommonJs(transpile("../lib/team-lead/e2e-key-manager.ts"), {
  "@/lib/team-lead/e2e-crypto": crypto,
});

const LEAD_A = { id: "lead-a", name: "김팀장", role: "team_lead", approved: true };
const LEAD_B = { id: "lead-b", name: "이팀장", role: "team_lead", approved: true };
const ADMIN = { id: "admin-1", name: "개발자", role: "admin", approved: true };

function createSharedDb() {
  return { meta: null, holders: [], envelopes: new Map(), sequence: 0, stateRows: new Map(), clock: 0, beforeReplace: null };
}

// 브라우저 하나 = 세션 하나 + 그 브라우저의 IndexedDB(deviceKeys). DB는 공유한다.
function createBrowser(db, session, deviceKeys = new Map()) {
  const state = { session };
  const names = new Map([LEAD_A, LEAD_B, ADMIN].map((user) => [user.id, user.name]));
  const backend = {
    async getSession() {
      return state.session;
    },
    async loadCryptoMeta() {
      return db.meta ? { ...db.meta } : null;
    },
    async saveCryptoMeta(meta) {
      db.meta = { ...meta };
    },
    async listHolders() {
      return db.holders.map((row) => ({ ...row, owner_name: row.profile_id ? names.get(row.profile_id) ?? null : null }));
    },
    async insertHolder(input) {
      db.sequence += 1;
      const row = {
        id: `holder-${db.sequence}`,
        created_at: new Date(Date.UTC(2026, 10, 23, 0, db.sequence)).toISOString(),
        approved_by: null,
        approved_at: null,
        revoked_at: null,
        ...input,
      };
      db.holders.push(row);
      return { ...row };
    },
    async updateHolder(id, patch) {
      const row = db.holders.find((item) => item.id === id);
      if (!row) throw new Error("holder not found");
      Object.assign(row, patch);
    },
    async deleteHolder(id) {
      db.holders = db.holders.filter((item) => item.id !== id);
      for (const key of [...db.envelopes.keys()]) if (key.startsWith(`${id}|`)) db.envelopes.delete(key);
    },
    async getEnvelope(holderId, keyVersion) {
      return db.envelopes.get(`${holderId}|${keyVersion}`) ?? null;
    },
    async upsertEnvelope(input) {
      db.envelopes.set(`${input.holder_id}|${input.key_version}`, { ...input });
    },
    async deleteEnvelopesForHolder(holderId) {
      for (const key of [...db.envelopes.keys()]) if (key.startsWith(`${holderId}|`)) db.envelopes.delete(key);
    },
    async deleteEnvelopesBelowVersion(keyVersion) {
      for (const [key, row] of [...db.envelopes.entries()]) if (row.key_version < keyVersion) db.envelopes.delete(key);
    },
    async loadProtectedStateRows(keys) {
      return keys.filter((key) => db.stateRows.has(key)).map((key) => ({ key, ...structuredClone(db.stateRows.get(key)) }));
    },
    async replaceProtectedState(key, expectedUpdatedAt, value) {
      if (db.beforeReplace) await db.beforeReplace(key);
      const row = db.stateRows.get(key);
      if (!row || row.updated_at !== expectedUpdatedAt) return false;
      db.clock += 1;
      db.stateRows.set(key, { state: structuredClone(value), updated_at: `t${db.clock}` });
      return true;
    },
    async getDeviceKey(profileId) {
      return deviceKeys.get(profileId) ?? null;
    },
    async saveDeviceKey(record) {
      deviceKeys.set(record.profileId, record);
    },
    async deleteDeviceKey(profileId) {
      deviceKeys.delete(profileId);
    },
    now() {
      return db.nowValue ?? "2026-11-23T00:00:00.000Z";
    },
  };
  return { manager: managerModule.createTeamLeadE2eKeyManager(backend), state, deviceKeys };
}

async function rejectsWithMessage(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

async function sameDataKey(left, right) {
  const envelope = await crypto.encryptTeamLeadState(left, { stateKey: "scoreboard_v1", keyVersion: 1, value: { ok: 1 } });
  return crypto.decryptTeamLeadState(right, { stateKey: "scoreboard_v1", keyVersion: 1, envelope });
}

test("총괄팀장이 아니면 보안 열쇠를 다룰 수 없다", async () => {
  const db = createSharedDb();
  const adminBrowser = createBrowser(db, ADMIN);
  await rejectsWithMessage(adminBrowser.manager.getStatus(), /총괄팀장 계정/);
  await rejectsWithMessage(adminBrowser.manager.registerThisDevice("PC"), /총괄팀장 계정/);

  const pendingLead = createBrowser(db, { ...LEAD_A, approved: false });
  await rejectsWithMessage(pendingLead.manager.setupKeys(), /총괄팀장 계정/);
});

test("최초 설정 → 인수인계 승인 → 복구 코드 → 해제까지 전체 흐름", async (t) => {
  const db = createSharedDb();
  const browserA = createBrowser(db, LEAD_A);
  const browserB = createBrowser(db, LEAD_B);
  let recoveryCode = "";

  await t.test("기기 등록 전에는 최초 설정을 할 수 없다", async () => {
    await rejectsWithMessage(browserA.manager.setupKeys(), /먼저 이 기기를 등록/);
  });

  await t.test("기기 등록과 최초 설정", async () => {
    const holder = await browserA.manager.registerThisDevice("  사무실 PC · Chrome  ");
    assert.equal(holder.status, "pending");
    assert.equal(holder.label, "사무실 PC · Chrome");
    assert.equal(browserA.deviceKeys.get(LEAD_A.id).holderId, holder.id);
    assert.equal(browserA.deviceKeys.get(LEAD_A.id).privateKey.extractable, false);

    const again = await browserA.manager.registerThisDevice("다른 이름");
    assert.equal(again.id, holder.id, "이미 등록된 기기는 새로 만들지 않는다");

    const result = await browserA.manager.setupKeys();
    recoveryCode = result.recoveryCode;
    assert.match(recoveryCode, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);

    const status = await browserA.manager.getStatus();
    assert.equal(status.meta.currentKeyVersion, 1);
    assert.equal(status.meta.enabled, false);
    assert.equal(status.thisDevice.state, "active");
    assert.equal(status.unlocked, true);
    assert.equal(status.activeDeviceCount, 1);
    assert.equal(status.activeRecoveryCount, 1);
    assert.ok(browserA.manager.getUnlockedDataKey(LEAD_A.id));
    assert.equal(browserA.manager.getUnlockedDataKey(LEAD_B.id), null);

    const stored = JSON.stringify({ meta: db.meta, holders: db.holders, envelopes: [...db.envelopes.values()] });
    assert.ok(!stored.includes(recoveryCode.replace(/-/g, "")), "복구 코드는 DB에 저장되지 않는다");

    await rejectsWithMessage(browserA.manager.setupKeys(), /이미 보안 열쇠가 설정/);
  });

  await t.test("새 팀장 기기는 6자리 확인 코드가 맞아야 승인된다", async () => {
    await browserB.manager.registerThisDevice("새 팀장 PC");
    const statusB = await browserB.manager.getStatus();
    assert.equal(statusB.thisDevice.state, "pending");
    assert.equal(statusB.unlocked, false);
    assert.equal(await browserB.manager.unlock(), false);
    const code = statusB.thisDevice.fingerprint;
    const holderId = statusB.thisDevice.holder.id;

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    await rejectsWithMessage(browserA.manager.approveDevice(holderId, wrong), /확인 코드가 맞지 않습니다/);
    await rejectsWithMessage(browserA.manager.approveDevice(holderId, ""), /확인 코드가 맞지 않습니다/);
    await rejectsWithMessage(browserB.manager.approveDevice(holderId, code), /잠겨 있습니다/);

    await browserA.manager.approveDevice(holderId, `${code.slice(0, 3)} ${code.slice(3)}`);
    assert.equal(await browserB.manager.unlock(), true);
    const keyA = browserA.manager.getUnlockedDataKey(LEAD_A.id).dataKey;
    const keyB = browserB.manager.getUnlockedDataKey(LEAD_B.id).dataKey;
    assert.deepEqual(await sameDataKey(keyA, keyB), { ok: 1 });
  });

  await t.test("DB의 확인 코드 칸을 바꿔치기한 기기는 승인되지 않는다", async () => {
    const forged = await crypto.generateTeamLeadDeviceKeyPair();
    const publicKey = await crypto.exportTeamLeadPublicKey(forged.publicKey);
    const realCode = await crypto.computeTeamLeadKeyFingerprint(publicKey);
    db.sequence += 1;
    db.holders.push({
      id: "forged",
      kind: "device",
      profile_id: LEAD_B.id,
      label: "이팀장 새 휴대폰",
      public_key: publicKey,
      fingerprint: realCode === "000000" ? "111111" : "000000",
      wrapped_private_key: null,
      kdf: null,
      status: "pending",
      created_at: "2026-11-23T00:00:00.000Z",
      approved_by: null,
      approved_at: null,
      revoked_at: null,
    });
    await rejectsWithMessage(browserA.manager.approveDevice("forged", realCode), /확인 코드가 맞지 않습니다/);
    await browserA.manager.revokeHolder("forged");
    assert.equal(db.holders.find((row) => row.id === "forged").status, "revoked");
  });

  await t.test("복구 코드로 새 브라우저를 열고, 다시 발급하면 이전 코드는 쓸 수 없다", async () => {
    const browserB2 = createBrowser(db, LEAD_B);
    const firstChar = recoveryCode[0];
    const wrongCode = `${firstChar === "A" ? "B" : "A"}${recoveryCode.slice(1)}`;
    await rejectsWithMessage(browserB2.manager.recoverWithCode(wrongCode, "집 PC"), /복구 코드가 맞지 않습니다/);

    const recovered = await browserB2.manager.recoverWithCode(recoveryCode.toLowerCase(), "집 PC");
    assert.equal(recovered.mustReissueRecoveryCode, true);
    const status = await browserB2.manager.getStatus();
    assert.equal(status.thisDevice.state, "active");
    assert.equal(status.unlocked, true);

    const reissued = await browserB2.manager.reissueRecoveryCode();
    assert.notEqual(reissued.recoveryCode, recoveryCode);
    const after = await browserB2.manager.getStatus();
    assert.equal(after.activeRecoveryCount, 1);

    const browserB3 = createBrowser(db, LEAD_B);
    await rejectsWithMessage(browserB3.manager.recoverWithCode(recoveryCode, "노트북"), /복구 코드가 맞지 않습니다/);
    await browserB3.manager.recoverWithCode(reissued.recoveryCode, "노트북");
    assert.equal((await browserB3.manager.getStatus()).unlocked, true);
  });

  await t.test("마지막 열쇠와 마지막 복구 코드는 해제할 수 없다", async () => {
    const activeRecovery = db.holders.find((row) => row.kind === "recovery" && row.status === "active");
    await rejectsWithMessage(browserA.manager.revokeHolder(activeRecovery.id), /복구 코드 다시 발급/);

    const activeDevices = db.holders.filter((row) => row.kind === "device" && row.status === "active");
    for (const device of activeDevices) {
      await browserB.manager.revokeHolder(device.id);
    }
    await rejectsWithMessage(browserB.manager.revokeHolder(activeRecovery.id), /복구 코드 다시 발급|마지막 남은 열쇠/);
    assert.equal(db.envelopes.has(`${activeRecovery.id}|1`), true);
  });

  await t.test("해제된 기기는 다시 열리지 않고, 다시 등록하면 새 기기로 승인 대기가 된다", async () => {
    browserA.manager.lock();
    assert.equal(await browserA.manager.unlock(), false);
    const status = await browserA.manager.getStatus();
    assert.equal(status.thisDevice.state, "revoked");

    const fresh = await browserA.manager.registerThisDevice("사무실 PC 재등록");
    assert.equal(fresh.status, "pending");
    assert.notEqual(fresh.id, status.thisDevice.holder.id);
  });
});

function putStateRow(db, key, value) {
  db.clock += 1;
  db.stateRows.set(key, { state: structuredClone(value), updated_at: `t${db.clock}` });
}

test("데이터 잠그기: 켜고, 평문 4개를 암호문으로 바꾸고, 다시 눌러도 안전하다", async () => {
  const db = createSharedDb();
  const browserA = createBrowser(db, LEAD_A);
  await browserA.manager.registerThisDevice("사무실 PC");
  await browserA.manager.setupKeys();

  const originals = {
    scoreboard_v1: { broadcastAccident: { 홍길동: [{ score: -2, memo: "자막 오류" }] } },
    reference_notes_v1: { notes: { "user-1": "야간 선호" } },
    contribution_manual_v1: { "2026-Q4": { "user-2": 3 } },
    final_cut_v1: { item: "circle" },
  };
  for (const [key, value] of Object.entries(originals)) putStateRow(db, key, value);

  let status = await browserA.manager.getStatus();
  assert.deepEqual(status.protectedData, { encrypted: 0, plaintext: 3, outdated: 0 }, "보호 대상 key만 센다");

  // 잠긴 브라우저(열쇠 없음)는 전환할 수 없다.
  const lockedBrowser = createBrowser(db, LEAD_A);
  await rejectsWithMessage(lockedBrowser.manager.encryptProtectedData(), /잠겨 있습니다/);
  assert.equal(db.meta.enabled, false);

  // 전환 도중 다른 화면이 같은 행을 한 번 저장해도 최신 값을 다시 읽어 암호화한다.
  let raced = false;
  db.beforeReplace = async (key) => {
    if (key === "reference_notes_v1" && !raced) {
      raced = true;
      putStateRow(db, key, { notes: { "user-1": "주간 선호(수정)" } });
    }
  };
  const result = await browserA.manager.encryptProtectedData();
  db.beforeReplace = null;
  assert.equal(result.converted, 3);
  assert.equal(db.meta.enabled, true);
  assert.equal(db.meta.enabledAt, "2026-11-23T00:00:00.000Z");
  assert.deepEqual(db.stateRows.get("final_cut_v1").state, originals.final_cut_v1, "보호 대상이 아닌 key는 그대로 둔다");

  const { dataKey, keyVersion } = browserA.manager.getUnlockedDataKey(LEAD_A.id);
  const expected = { ...originals, reference_notes_v1: { notes: { "user-1": "주간 선호(수정)" } } };
  for (const key of ["scoreboard_v1", "reference_notes_v1", "contribution_manual_v1"]) {
    const stored = db.stateRows.get(key).state;
    assert.ok(crypto.isTeamLeadE2eEnvelope(stored), `${key}는 암호문이어야 한다`);
    assert.ok(!JSON.stringify(stored).includes("선호") && !JSON.stringify(stored).includes("자막"), "평문이 남지 않는다");
    assert.deepEqual(await crypto.decryptTeamLeadState(dataKey, { stateKey: key, keyVersion, envelope: stored }), expected[key]);
  }

  status = await browserA.manager.getStatus();
  assert.deepEqual(status.protectedData, { encrypted: 3, plaintext: 0, outdated: 0 });

  // 다시 눌러도 이미 암호문인 행은 건드리지 않는다.
  const before = JSON.stringify([...db.stateRows.entries()]);
  assert.equal((await browserA.manager.encryptProtectedData()).converted, 0);
  assert.equal(JSON.stringify([...db.stateRows.entries()]), before);
});

test("데이터 잠그기: 계속 다른 화면이 저장하면 덮어쓰지 않고 멈춘다", async () => {
  const db = createSharedDb();
  const browserA = createBrowser(db, LEAD_A);
  await browserA.manager.registerThisDevice("사무실 PC");
  await browserA.manager.setupKeys();
  putStateRow(db, "scoreboard_v1", { a: 1 });
  db.beforeReplace = async (key) => putStateRow(db, key, { a: 2 });
  await rejectsWithMessage(browserA.manager.encryptProtectedData(), /다른 화면에서/);
  db.beforeReplace = null;
  assert.deepEqual(db.stateRows.get("scoreboard_v1").state, { a: 2 }, "마지막으로 저장된 값이 남는다");
  assert.equal(db.meta.enabled, true, "암호화는 먼저 켜져 이후 저장은 암호문이 된다");
});

async function decryptRow(db, dataKey, key) {
  const stored = db.stateRows.get(key).state;
  return crypto.decryptTeamLeadState(dataKey, { stateKey: key, keyVersion: stored.keyVersion, envelope: stored });
}

test("열쇠 새로 고치기: 해제된 기기의 예전 열쇠로는 열 수 없고, 남은 기기·복구 코드는 그대로 연다", async () => {
  const db = createSharedDb();
  const browserA = createBrowser(db, LEAD_A);
  const browserB = createBrowser(db, LEAD_B);
  await browserA.manager.registerThisDevice("사무실 PC");
  const { recoveryCode } = await browserA.manager.setupKeys();
  putStateRow(db, "scoreboard_v1", { a: 1 });
  putStateRow(db, "reference_notes_v1", { notes: { u1: "메모" } });
  await browserA.manager.encryptProtectedData();

  // 이전 팀장(B) 기기 승인 후 해제(등급 강등 트리거와 같은 결과)
  db.nowValue = "2026-11-24T00:00:00.000Z";
  const deviceB = await browserB.manager.registerThisDevice("B 노트북");
  await browserA.manager.approveDevice(deviceB.id, deviceB.fingerprint);
  assert.equal(await browserB.manager.unlock(), true);
  const oldKeyOfB = browserB.manager.getUnlockedDataKey(LEAD_B.id).dataKey;
  assert.equal((await browserA.manager.getStatus()).rotationRecommended, false, "해제 전에는 권하지 않는다");
  db.nowValue = "2026-11-25T00:00:00.000Z";
  await browserA.manager.revokeHolder(deviceB.id);
  assert.equal((await browserA.manager.getStatus()).rotationRecommended, true, "승인됐던 기기가 해제되면 권한다");

  db.nowValue = "2026-11-26T00:00:00.000Z";
  const result = await browserA.manager.rotateDataKey();
  assert.equal(result.keyVersion, 2);
  assert.equal(result.converted, 2);
  assert.equal(db.meta.currentKeyVersion, 2);
  assert.equal(db.meta.rotatedAt, "2026-11-26T00:00:00.000Z");
  assert.ok([...db.envelopes.values()].every((row) => row.key_version === 2), "예전 세대 사본은 지운다");

  const status = await browserA.manager.getStatus();
  assert.deepEqual(status.protectedData, { encrypted: 2, plaintext: 0, outdated: 0 });
  assert.equal(status.rotationRecommended, false);

  // 해제된 B가 갖고 있던 예전 데이터 키로는 새 데이터를 열 수 없다.
  await assert.rejects(decryptRow(db, oldKeyOfB, "scoreboard_v1"));

  // 같은 기기의 다른 탭(같은 IndexedDB)은 새 세대로 자동으로 연다.
  const otherTab = createBrowser(db, LEAD_A, browserA.deviceKeys);
  assert.equal(await otherTab.manager.unlock(), true);
  assert.deepEqual(await decryptRow(db, otherTab.manager.getUnlockedDataKey(LEAD_A.id).dataKey, "scoreboard_v1"), { a: 1 });

  // 복구 코드는 다시 입력하지 않아도 새 세대를 연다.
  const freshBrowser = createBrowser(db, LEAD_A);
  await freshBrowser.manager.recoverWithCode(recoveryCode, "새 PC");
  const recovered = freshBrowser.manager.getUnlockedDataKey(LEAD_A.id);
  assert.equal(recovered.keyVersion, 2);
  assert.deepEqual(await decryptRow(db, recovered.dataKey, "reference_notes_v1"), { notes: { u1: "메모" } });
});

test("열쇠 새로 고치기가 중간에 멈춰도 데이터를 읽을 수 있고, 이어서 암호화로 마친다", async () => {
  const db = createSharedDb();
  const browserA = createBrowser(db, LEAD_A);
  await browserA.manager.registerThisDevice("사무실 PC");
  await browserA.manager.setupKeys();
  putStateRow(db, "scoreboard_v1", { a: 1 });
  putStateRow(db, "contribution_manual_v1", { c: 3 });
  await browserA.manager.encryptProtectedData();

  db.beforeReplace = async (key) => {
    if (key === "scoreboard_v1") throw new Error("network down");
  };
  await rejectsWithMessage(browserA.manager.rotateDataKey(), /network down/);
  db.beforeReplace = null;
  assert.equal(db.meta.currentKeyVersion, 2);
  assert.equal(db.stateRows.get("scoreboard_v1").state.keyVersion, 1, "멈춘 행은 예전 세대로 남는다");
  assert.ok([...db.envelopes.values()].some((row) => row.key_version === 1), "다 바뀌기 전에는 예전 사본을 지우지 않는다");

  // 다른 탭(같은 기기)은 예전 세대 행도 그 세대 사본으로 읽는다.
  const otherTab = createBrowser(db, LEAD_A, browserA.deviceKeys);
  await otherTab.manager.unlock();
  const v1Key = await otherTab.manager.getDataKeyForVersion(LEAD_A.id, 1);
  assert.deepEqual(await decryptRow(db, v1Key, "scoreboard_v1"), { a: 1 });
  assert.equal(await otherTab.manager.getDataKeyForVersion(LEAD_B.id, 1), null, "다른 사람 몫은 열지 않는다");

  const status = await otherTab.manager.getStatus();
  // scoreboard_v1에서 멈춰 그 뒤 행도 아직 예전 세대다.
  assert.deepEqual(status.protectedData, { encrypted: 0, plaintext: 0, outdated: 2 });

  await otherTab.manager.encryptProtectedData();
  assert.equal(db.stateRows.get("scoreboard_v1").state.keyVersion, 2);
  assert.ok([...db.envelopes.values()].every((row) => row.key_version === 2));
  const v2Key = otherTab.manager.getUnlockedDataKey(LEAD_A.id).dataKey;
  assert.deepEqual(await decryptRow(db, v2Key, "scoreboard_v1"), { a: 1 });
  assert.deepEqual(await decryptRow(db, v2Key, "contribution_manual_v1"), { c: 3 });
});

test("열쇠 새로 고치기는 데이터 잠그기 전이나 복구 코드가 없으면 하지 않는다", async () => {
  const db = createSharedDb();
  const browserA = createBrowser(db, LEAD_A);
  await browserA.manager.registerThisDevice("사무실 PC");
  await browserA.manager.setupKeys();
  await rejectsWithMessage(browserA.manager.rotateDataKey(), /데이터 잠그기를 먼저/);
  await browserA.manager.encryptProtectedData();
  for (const row of db.holders) if (row.kind === "recovery") row.status = "revoked";
  await rejectsWithMessage(browserA.manager.rotateDataKey(), /복구 코드가 없습니다/);
  assert.equal(db.meta.currentKeyVersion, 1);
});
