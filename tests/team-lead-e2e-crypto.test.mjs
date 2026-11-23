import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 같은 realm에서 실행해야 WebCrypto가 돌려주는 ArrayBuffer/Uint8Array를 모듈이 그대로 다룰 수 있다.
function loadCryptoModule() {
  const source = readFileSync(new URL("../lib/team-lead/e2e-crypto.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const commonJsModule = { exports: {} };
  new Function("exports", "module", compiled)(commonJsModule.exports, commonJsModule);
  return commonJsModule.exports;
}

const e2e = loadCryptoModule();

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "TeamLeadE2eCryptoError");
    assert.equal(error.code, code);
    return true;
  });
}

test("데이터 암호화·복호화 왕복과 envelope 형식", async () => {
  const dataKey = await e2e.generateTeamLeadDataKey();
  const value = { 2026: { 홍길동: [{ id: "n1", text: "방송사고 경위 확인 필요", score: -1.5 }] } };

  const envelope = await e2e.encryptTeamLeadState(dataKey, { stateKey: "reference_notes_v1", keyVersion: 1, value });

  assert.equal(envelope.enc, "tl-e2e-v1");
  assert.equal(envelope.keyVersion, 1);
  assert.ok(e2e.isTeamLeadE2eEnvelope(envelope));
  assert.ok(!JSON.stringify(envelope).includes("홍길동"));
  assert.ok(!JSON.stringify(envelope).includes("방송사고"));

  const decrypted = await e2e.decryptTeamLeadState(dataKey, {
    stateKey: "reference_notes_v1",
    keyVersion: 1,
    envelope,
  });
  assert.deepEqual(decrypted, value);
});

test("같은 값도 매번 다른 IV와 암호문을 만든다", async () => {
  const dataKey = await e2e.generateTeamLeadDataKey();
  const first = await e2e.encryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, value: { a: 1 } });
  const second = await e2e.encryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, value: { a: 1 } });
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ct, second.ct);
});

test("다른 key 행으로 바꿔치기한 암호문은 열리지 않는다", async () => {
  const dataKey = await e2e.generateTeamLeadDataKey();
  const envelope = await e2e.encryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, value: { a: 1 } });

  await rejectsWithCode(
    e2e.decryptTeamLeadState(dataKey, { stateKey: "contribution_manual_v1", keyVersion: 1, envelope }),
    "decrypt_failed",
  );
});

test("열쇠 세대가 다르면 거부하고, 변조된 암호문과 다른 데이터 키는 열리지 않는다", async () => {
  const dataKey = await e2e.generateTeamLeadDataKey();
  const otherKey = await e2e.generateTeamLeadDataKey();
  const envelope = await e2e.encryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 2, value: [1, 2] });

  await rejectsWithCode(
    e2e.decryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, envelope }),
    "key_version_mismatch",
  );
  await rejectsWithCode(
    e2e.decryptTeamLeadState(otherKey, { stateKey: "scoreboard_v1", keyVersion: 2, envelope }),
    "decrypt_failed",
  );

  const tamperedCt = Buffer.from(envelope.ct, "base64");
  tamperedCt[0] ^= 0xff;
  await rejectsWithCode(
    e2e.decryptTeamLeadState(dataKey, {
      stateKey: "scoreboard_v1",
      keyVersion: 2,
      envelope: { ...envelope, ct: tamperedCt.toString("base64") },
    }),
    "decrypt_failed",
  );
});

test("평문 상태는 envelope으로 인정하지 않는다", async () => {
  const dataKey = await e2e.generateTeamLeadDataKey();
  for (const value of [null, {}, [], { 2026: {} }, { enc: "tl-e2e-v1" }, { enc: "other", keyVersion: 1, iv: "", ct: "" }]) {
    assert.equal(e2e.isTeamLeadE2eEnvelope(value), false);
  }
  await rejectsWithCode(
    e2e.decryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, envelope: { 2026: {} } }),
    "invalid_envelope",
  );
});

test("보호 대상 key 목록", () => {
  for (const key of ["scoreboard_v1", "reference_notes_v1", "contribution_manual_v1", "best_report_quarters_v1"]) {
    assert.equal(e2e.isTeamLeadE2eProtectedStateKey(key), true);
  }
  for (const key of ["final_cut_v1", "review_access_v1", "best_report_current_v1", "submission_access_v1"]) {
    assert.equal(e2e.isTeamLeadE2eProtectedStateKey(key), false);
  }
});

test("기기 열쇠: 개인키는 추출 불가이고, 감싼 데이터 키는 그 기기만 연다", async () => {
  const deviceA = await e2e.generateTeamLeadDeviceKeyPair();
  const deviceB = await e2e.generateTeamLeadDeviceKeyPair();
  assert.equal(deviceA.privateKey.extractable, false);

  const dataKey = await e2e.generateTeamLeadDataKey();
  const publicA = await e2e.importTeamLeadPublicKey(await e2e.exportTeamLeadPublicKey(deviceA.publicKey));
  const wrappedForA = await e2e.wrapTeamLeadDataKey(dataKey, publicA);

  const unwrapped = await e2e.unwrapTeamLeadDataKey(wrappedForA, deviceA.privateKey);
  const envelope = await e2e.encryptTeamLeadState(unwrapped, { stateKey: "scoreboard_v1", keyVersion: 1, value: "ok" });
  assert.equal(await e2e.decryptTeamLeadState(dataKey, { stateKey: "scoreboard_v1", keyVersion: 1, envelope }), "ok");

  await rejectsWithCode(e2e.unwrapTeamLeadDataKey(wrappedForA, deviceB.privateKey), "decrypt_failed");
  await rejectsWithCode(e2e.importTeamLeadPublicKey("not-a-key"), "invalid_public_key");
});

test("인수인계: 기존 팀장 기기가 새 팀장 기기용 사본을 만들면 새 기기에서 연다", async () => {
  const oldLead = await e2e.generateTeamLeadDeviceKeyPair();
  const newLead = await e2e.generateTeamLeadDeviceKeyPair();
  const dataKey = await e2e.generateTeamLeadDataKey();
  const envelope = await e2e.encryptTeamLeadState(dataKey, {
    stateKey: "contribution_manual_v1",
    keyVersion: 1,
    value: { 2026: { 김기자: [{ label: "특보", score: 2 }] } },
  });
  const wrappedForOld = await e2e.wrapTeamLeadDataKey(dataKey, oldLead.publicKey);

  const newLeadPublicSpki = await e2e.exportTeamLeadPublicKey(newLead.publicKey);
  const oldSession = await e2e.unwrapTeamLeadDataKey(wrappedForOld, oldLead.privateKey);
  const wrappedForNew = await e2e.wrapTeamLeadDataKey(oldSession, await e2e.importTeamLeadPublicKey(newLeadPublicSpki));

  const newSession = await e2e.unwrapTeamLeadDataKey(wrappedForNew, newLead.privateKey);
  assert.deepEqual(
    await e2e.decryptTeamLeadState(newSession, { stateKey: "contribution_manual_v1", keyVersion: 1, envelope }),
    { 2026: { 김기자: [{ label: "특보", score: 2 }] } },
  );
});

test("기기 확인 코드는 6자리 숫자이고 같은 공개키면 항상 같다", async () => {
  const first = await e2e.exportTeamLeadPublicKey((await e2e.generateTeamLeadDeviceKeyPair()).publicKey);
  const second = await e2e.exportTeamLeadPublicKey((await e2e.generateTeamLeadDeviceKeyPair()).publicKey);

  const code = await e2e.computeTeamLeadKeyFingerprint(first);
  assert.match(code, /^\d{6}$/);
  assert.equal(await e2e.computeTeamLeadKeyFingerprint(first), code);
  assert.notEqual(await e2e.computeTeamLeadKeyFingerprint(second), code);
});

test("복구 코드: 발급·정규화·열기, 틀린 코드와 형식 오류 거부", async () => {
  const holder = await e2e.createTeamLeadRecoveryHolder();

  assert.match(holder.recoveryCode, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  assert.match(holder.fingerprint, /^\d{6}$/);
  assert.equal(holder.kdf.alg, "PBKDF2-SHA256");
  assert.ok(holder.kdf.iterations >= 600_000);

  const normalizedCode = holder.recoveryCode.replace(/-/g, "");
  const stored = { publicKey: holder.publicKey, wrappedPrivateKey: holder.wrappedPrivateKey, kdf: holder.kdf };
  assert.ok(!JSON.stringify(stored).includes(normalizedCode), "DB에 저장할 값에 복구 코드가 들어가면 안 된다");

  const dataKey = await e2e.generateTeamLeadDataKey();
  const wrappedForRecovery = await e2e.wrapTeamLeadDataKey(dataKey, await e2e.importTeamLeadPublicKey(holder.publicKey));

  // 소문자·공백 입력도 받아 준다.
  const typed = normalizedCode.toLowerCase().replace(/(.{4})/g, "$1 ");
  const recoveryPrivateKey = await e2e.unlockTeamLeadRecoveryPrivateKey(typed, stored);
  assert.equal(recoveryPrivateKey.extractable, false);
  const recovered = await e2e.unwrapTeamLeadDataKey(wrappedForRecovery, recoveryPrivateKey);
  const envelope = await e2e.encryptTeamLeadState(dataKey, { stateKey: "best_report_quarters_v1", keyVersion: 1, value: [] });
  assert.deepEqual(
    await e2e.decryptTeamLeadState(recovered, { stateKey: "best_report_quarters_v1", keyVersion: 1, envelope }),
    [],
  );

  const lastChar = normalizedCode.at(-1);
  const wrongCode = normalizedCode.slice(0, -1) + (lastChar === "A" ? "B" : "A");
  await rejectsWithCode(e2e.unlockTeamLeadRecoveryPrivateKey(wrongCode, stored), "wrong_recovery_code");
  await rejectsWithCode(e2e.unlockTeamLeadRecoveryPrivateKey("ABCD-EFGH", stored), "invalid_recovery_code");
  await rejectsWithCode(
    e2e.unlockTeamLeadRecoveryPrivateKey(holder.recoveryCode, { ...stored, kdf: { ...stored.kdf, iterations: 10 } }),
    "invalid_envelope",
  );
});

test("복구 코드 정규화: 모양이 비슷한 숫자를 받아 주고 길이·문자를 검사한다", () => {
  const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  assert.equal(e2e.normalizeTeamLeadRecoveryCode("abcd-efgh-ijkl-mnop-qrst-uvwx-yz23-4567"), code);
  assert.equal(e2e.normalizeTeamLeadRecoveryCode("ABCDEFGH1JKLMN0PQRSTUVWXYZ234567"), code);
  assert.throws(() => e2e.normalizeTeamLeadRecoveryCode(code.slice(1)), { code: "invalid_recovery_code" });
  assert.throws(() => e2e.normalizeTeamLeadRecoveryCode(`${code.slice(0, -1)}9`), { code: "invalid_recovery_code" });
});
