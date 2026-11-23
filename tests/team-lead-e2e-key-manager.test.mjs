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
  return { meta: null, holders: [], envelopes: new Map(), sequence: 0 };
}

// 브라우저 하나 = 세션 하나 + 그 브라우저의 IndexedDB(deviceKeys). DB는 공유한다.
function createBrowser(db, session) {
  const deviceKeys = new Map();
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
      return "2026-11-23T00:00:00.000Z";
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
