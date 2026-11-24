import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 총괄팀장 · DESK 계정과 보안 열쇠 변화 알림 로직을 가짜 저장소 · 메일로 검사한다.
function loadCore() {
  const code = ts.transpileModule(readFileSync(new URL("../lib/team-lead/security-watch-core.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const commonJsModule = { exports: {} };
  new Function("exports", "module", "require", code)(commonJsModule.exports, commonJsModule, () => {
    throw new Error("security-watch-core는 다른 모듈을 import하지 않는다.");
  });
  return commonJsModule.exports;
}

const core = loadCore();

const lead = { name: "김팀장", role: "team_lead", approved: true, email: "lead@example.test" };
const desk = { name: "박데스크", role: "desk", approved: true, email: "desk@example.test" };

function snapshot(accounts, holders = {}, takenAt = "2026-11-24T00:30:00.000Z") {
  return { version: 1, accounts, holders, takenAt };
}

function createDeps(next, previous) {
  const sent = [];
  const store = { value: previous ?? null };
  return {
    sent,
    store,
    deps: {
      takeSnapshot: async () => structuredClone(next),
      loadPrevious: async () => store.value,
      savePrevious: async (value) => {
        store.value = structuredClone(value);
      },
      sendMail: async (input) => {
        sent.push(input);
        return { sent: true };
      },
      now: () => "2026-11-25T00:30:00.000Z",
      siteUrl: "https://portal.example.test",
    },
  };
}

test("처음에는 기준만 저장하고 메일은 보내지 않는다", async () => {
  const { deps, sent, store } = createDeps(snapshot({ a: lead }));
  assert.deepEqual(await core.runSecurityWatchCheck(deps), { status: "baseline" });
  assert.equal(sent.length, 0);
  assert.equal(store.value.accounts.a.name, "김팀장");
});

test("바뀐 게 없으면 메일을 보내지 않는다(시각만 다른 것은 무시)", async () => {
  const previous = snapshot({ a: lead, b: desk }, { h1: { kind: "device", label: "PC", status: "active", profileId: "a" } });
  const next = structuredClone(previous);
  next.takenAt = "2026-11-25T00:30:00.000Z";
  const { deps, sent } = createDeps(next, previous);
  assert.deepEqual(await core.runSecurityWatchCheck(deps), { status: "unchanged" });
  assert.equal(sent.length, 0);
});

test("등급 · 이메일 · 기기 변화를 문장으로 알려 주고, 강등된 팀장에게도 보낸다", async () => {
  const previous = snapshot(
    { a: lead, b: desk, c: { ...lead, name: "이전팀장", email: "old@example.test" } },
    {
      h1: { kind: "device", label: "사무실 PC", status: "active", profileId: "a" },
      h2: { kind: "device", label: "휴대폰", status: "pending", profileId: "a" },
      r1: { kind: "recovery", label: "복구 코드", status: "active", profileId: null },
    },
  );
  const next = snapshot(
    {
      a: { ...lead, email: "attacker@evil.test" },
      b: { ...desk, role: "team_lead" },
      x: { name: "새관리자", role: "admin", approved: true, email: "x@example.test" },
    },
    {
      h1: { kind: "device", label: "사무실 PC", status: "revoked", profileId: "a" },
      h2: { kind: "device", label: "휴대폰", status: "active", profileId: "a" },
      h3: { kind: "device", label: "모르는 PC", status: "pending", profileId: "b" },
    },
  );
  const { deps, sent, store } = createDeps(next, previous);
  const result = await core.runSecurityWatchCheck(deps);
  assert.equal(result.status, "alerted");
  const text = sent[0].text;
  assert.match(text, /로그인 이메일 변경: 김팀장 \(le\*\*\*@example\.test → at\*\*\*@evil\.test\)/);
  assert.match(text, /등급 변경: 박데스크 \(DESK → 총괄팀장\)/);
  assert.match(text, /등급 해제: 이전팀장/);
  assert.match(text, /등급 부여: 새관리자 → 관리자/);
  assert.match(text, /해제 - 사무실 PC \(김팀장\)/);
  assert.match(text, /기기 승인 - 휴대폰 \(김팀장\)/);
  assert.match(text, /새 기기 승인 대기 - 모르는 PC \(박데스크\)/);
  assert.match(text, /기록 삭제 - 복구 코드/);
  // 이전 · 현재 총괄팀장 모두에게(바뀌기 전 이메일 포함) 보낸다.
  assert.deepEqual(sent[0].to, ["attacker@evil.test", "desk@example.test", "lead@example.test", "old@example.test"]);
  assert.equal(store.value.accounts.b.role, "team_lead");
});

test("2단계 인증 등록 · 초기화를 알려 주고, 예전 기록(수 없음)과는 비교하지 않는다", () => {
  const previous = snapshot({ a: { ...lead, mfaFactors: 1 }, b: { ...desk, mfaFactors: 0 }, c: { ...desk, name: "옛기록" } });
  const next = snapshot({ a: { ...lead, mfaFactors: 0 }, b: { ...desk, mfaFactors: 1 }, c: { ...desk, name: "옛기록", mfaFactors: 1 } });
  assert.deepEqual(core.diffSecurityWatchSnapshot(previous, next), [
    "2단계 인증 해제(초기화): 김팀장",
    "2단계 인증 등록: 박데스크",
  ]);
});

test("메일이 안 나가면 기준을 바꾸지 않아 다음 점검 때 다시 보낸다", async () => {
  const previous = snapshot({ a: lead });
  const next = snapshot({ a: lead, b: desk });
  const { deps, store } = createDeps(next, previous);
  deps.sendMail = async () => ({ sent: false });
  assert.deepEqual(await core.runSecurityWatchCheck(deps), { status: "mail_not_sent", events: 1 });
  assert.deepEqual(store.value, previous);
});

test("알림 API가 백업 · 코드 변경 · 계정 변화 점검을 함께 하고 Auth 이메일을 쓴다", () => {
  const route = readFileSync(new URL("../app/api/internal/team-lead/security-change-alert/route.ts", import.meta.url), "utf8");
  assert.match(route, /rpc\("backup_team_lead_protected_state"/);
  assert.match(route, /runSecurityWatchCheck/);
  assert.match(route, /auth\.admin\.getUserById/);
});
