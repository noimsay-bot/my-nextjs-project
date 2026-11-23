import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 메모리 안의 실제 Postgres 엔진으로 총괄팀장 보호 데이터 삭제 방지 트리거와 백업 함수를 검사한다.
const read = (name) => readFileSync(new URL(`../supabase/${name}`, import.meta.url), "utf8");
const schema = read("schema.sql").replace(/\r\n/g, "\n");
const plaintextGuardSql = read("incremental_team_lead_e2e_plaintext_guard.sql");
const versionGuardSql = read("incremental_team_lead_e2e_key_version_guard.sql");
const deleteGuardSql = read("incremental_team_lead_e2e_delete_guard.sql").replace(/\r\n/g, "\n");

const WRAPPED = "w".repeat(120);
const PUBLIC_KEY = "p".repeat(120);
const envelopeState = (keyVersion) => JSON.stringify({ enc: "tl-e2e-v1", keyVersion, iv: "aXY=", ct: "Y3Q=" });
const PROTECTED_KEYS = ["scoreboard_v1", "reference_notes_v1", "contribution_manual_v1", "best_report_quarters_v1"];

test("schema.sql에 삭제 방지 SQL 본문이 그대로 들어 있다", () => {
  const body = deleteGuardSql.slice(deleteGuardSql.indexOf("-- 1) 암호화가"));
  assert.ok(body.length > 1000);
  assert.ok(schema.includes(body.trimEnd()), "schema.sql을 incremental 파일과 맞춰 주세요.");
});

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.team_lead_state (
      key text primary key,
      state jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table public.team_lead_key_holders (
      id text primary key,
      kind text not null,
      profile_id text,
      label text not null default '',
      public_key text not null,
      fingerprint text not null,
      wrapped_private_key text,
      kdf jsonb,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      approved_at timestamptz,
      revoked_at timestamptz
    );
    create table public.team_lead_key_envelopes (
      holder_id text not null references public.team_lead_key_holders (id) on delete cascade,
      key_version integer not null,
      wrapped_dek text not null,
      primary key (holder_id, key_version)
    );
  `);
  await db.exec(plaintextGuardSql);
  await db.exec(versionGuardSql);
  await db.exec(deleteGuardSql);
  await db.exec(deleteGuardSql); // 여러 번 실행해도 안전해야 한다.

  const q = (sql, params) => db.query(sql, params);
  const putState = (key, state) =>
    q(`insert into team_lead_state (key, state) values ($1, $2::jsonb)
       on conflict (key) do update set state = excluded.state`, [key, state]);
  const addHolder = (id, kind, status = "active") =>
    q(`insert into team_lead_key_holders (id, kind, profile_id, public_key, fingerprint, wrapped_private_key, kdf, status)
       values ($1, $2, $3, $4, '123456', $5, $6::jsonb, $7)`, [
      id,
      kind,
      kind === "device" ? "lead" : null,
      PUBLIC_KEY,
      kind === "recovery" ? WRAPPED : null,
      kind === "recovery" ? "{}" : null,
      status,
    ]);
  const addEnvelope = (holderId, keyVersion) =>
    q(`insert into team_lead_key_envelopes (holder_id, key_version, wrapped_dek) values ($1, $2, $3)
       on conflict (holder_id, key_version) do update set wrapped_dek = excluded.wrapped_dek`, [holderId, keyVersion, WRAPPED]);
  const rejects = (promise, pattern) =>
    assert.rejects(promise, (error) => {
      assert.match(error.message, pattern);
      return true;
    });
  return { db, q, putState, addHolder, addEnvelope, rejects };
}

// 운영과 같은 상태: 기기 1대 + 복구 코드 1개, 세대 1, 잠그기 완료.
async function lockedState(h) {
  await h.addHolder("device-a", "device");
  await h.addHolder("recovery-1", "recovery");
  await h.addEnvelope("device-a", 1);
  await h.addEnvelope("recovery-1", 1);
  await h.putState("crypto_meta_v1", JSON.stringify({ enabled: false, currentKeyVersion: 1 }));
  await h.putState("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 1 }));
  for (const key of PROTECTED_KEYS) await h.putState(key, envelopeState(1));
}

test("설정 도중 실패한 복구 코드 되돌리기는 막지 않는다(암호화 설정 전)", async (t) => {
  const h = await setup(t);
  await h.addHolder("device-a", "device");
  await h.addHolder("recovery-1", "recovery");
  await h.addEnvelope("recovery-1", 1);
  await h.q("delete from team_lead_key_holders where id = 'recovery-1'");
  const { rows } = await h.q("select count(*)::int as n from team_lead_key_envelopes");
  assert.equal(rows[0].n, 0);
});

test("잠근 뒤: 보호 데이터 행은 지울 수 없고, 다른 key는 지울 수 있다", async (t) => {
  const h = await setup(t);
  await lockedState(h);
  for (const key of PROTECTED_KEYS) {
    await h.rejects(h.q("delete from team_lead_state where key = $1", [key]), /지울 수 없습니다/);
  }
  await h.putState("final_cut_v1", "{}");
  await h.q("delete from team_lead_state where key = 'final_cut_v1'");
});

test("마지막 복구 코드와 그 사본은 지우거나 해제하거나 바꿔치기할 수 없다", async (t) => {
  const h = await setup(t);
  await lockedState(h);
  await h.rejects(h.q("delete from team_lead_key_holders where id = 'recovery-1'"), /마지막 복구 코드/);
  await h.rejects(
    h.q("update team_lead_key_holders set status = 'revoked', revoked_at = now() where id = 'recovery-1'"),
    /마지막 복구 코드/,
  );
  await h.rejects(h.q("delete from team_lead_key_envelopes where holder_id = 'recovery-1'"), /마지막 복구 코드 사본/);
  await h.rejects(
    h.q("update team_lead_key_envelopes set wrapped_dek = $1 where holder_id = 'recovery-1'", ["x".repeat(130)]),
    /바꿀 수 없습니다/,
  );
  await h.rejects(
    h.q("update team_lead_key_holders set wrapped_private_key = $1 where id = 'recovery-1'", ["x".repeat(130)]),
    /열쇠 자체는 바꿀 수 없습니다/,
  );
  await h.rejects(
    h.q("update team_lead_key_holders set public_key = $1 where id = 'device-a'", ["x".repeat(130)]),
    /열쇠 자체는 바꿀 수 없습니다/,
  );
});

test("정상 흐름은 그대로 된다: 기기 해제, 복구 코드 다시 발급, 열쇠 새로 고치기", async (t) => {
  const h = await setup(t);
  await lockedState(h);

  // 기기 해제(화면 순서: 사본 삭제 → 해제). 해제한 열쇠는 되살릴 수 없다.
  await h.addHolder("device-b", "device");
  await h.addEnvelope("device-b", 1);
  await h.q("delete from team_lead_key_envelopes where holder_id = 'device-b'");
  await h.q("update team_lead_key_holders set status = 'revoked', revoked_at = now() where id = 'device-b'");
  await h.rejects(
    h.q("update team_lead_key_holders set status = 'active', revoked_at = null where id = 'device-b'"),
    /다시 쓸 수 없습니다/,
  );

  // 복구 코드 다시 발급(새 코드 + 사본 → 예전 사본 삭제 → 예전 코드 해제).
  await h.addHolder("recovery-2", "recovery");
  await h.addEnvelope("recovery-2", 1);
  await h.q("delete from team_lead_key_envelopes where holder_id = 'recovery-1'");
  await h.q("update team_lead_key_holders set status = 'revoked', revoked_at = now() where id = 'recovery-1'");

  // 열쇠 새로 고치기: 새 세대 사본 → 세대 올리기 → 데이터 다시 잠그기 → 이전 세대 사본 삭제.
  // 중간에 실패해 다시 하면 새 세대 사본을 덮어쓴다(아직 현재 세대가 아니므로 허용).
  await h.addEnvelope("device-a", 2);
  await h.addEnvelope("recovery-2", 2);
  await h.addEnvelope("recovery-2", 2);
  await h.putState("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 2 }));
  for (const key of PROTECTED_KEYS) await h.putState(key, envelopeState(2));
  await h.q("delete from team_lead_key_envelopes where key_version < 2");
  const { rows } = await h.q("select holder_id, key_version from team_lead_key_envelopes order by holder_id");
  assert.deepEqual(rows, [
    { holder_id: "device-a", key_version: 2 },
    { holder_id: "recovery-2", key_version: 2 },
  ]);

  // 팀장 강등 트리거처럼 기기 사본을 지우고 기기를 해제하는 것은 된다.
  await h.q("delete from team_lead_key_envelopes where holder_id = 'device-a'");
  await h.q("update team_lead_key_holders set status = 'revoked', revoked_at = now() where id = 'device-a'");
});

test("복구 코드 사본이 없는 세대로는 올릴 수 없다", async (t) => {
  const h = await setup(t);
  await lockedState(h);
  await h.rejects(
    h.putState("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 99 })),
    /복구 코드 사본이 없는/,
  );
  await h.addEnvelope("device-a", 2);
  await h.rejects(
    h.putState("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 2 })),
    /복구 코드 사본이 없는/,
    "기기 사본만 있고 복구 코드 사본이 없으면 거부",
  );
  // 같은 세대로 다른 값만 바꾸는 것은 된다.
  await h.putState("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 1, rotatedAt: "x" }));
});

test("백업 함수는 암호문 · 설정 · 활성 복구 사본만 담고, 오래된 백업은 지운다", async (t) => {
  const h = await setup(t);
  await lockedState(h);
  await h.putState("final_cut_v1", JSON.stringify({ plain: true }));
  const { rows: first } = await h.q("select public.backup_team_lead_protected_state() as n");
  assert.equal(first[0].n, 1);
  const { rows } = await h.q("select payload from team_lead_protected_backups");
  const payload = rows[0].payload;
  assert.deepEqual(payload.state_rows.map((row) => row.key), ["best_report_quarters_v1", "contribution_manual_v1", "crypto_meta_v1", "reference_notes_v1", "scoreboard_v1"]);
  assert.ok(payload.state_rows.filter((row) => row.key !== "crypto_meta_v1").every((row) => row.state.enc === "tl-e2e-v1"));
  assert.deepEqual(payload.recovery_holders.map((row) => row.id), ["recovery-1"]);
  assert.deepEqual(payload.recovery_envelopes.map((row) => row.holder_id), ["recovery-1"]);
  assert.ok(!JSON.stringify(payload).includes("device-a"), "기기 사본은 백업하지 않는다");

  await h.q("update team_lead_protected_backups set backed_up_at = now() - interval '40 days'");
  await h.q("select public.backup_team_lead_protected_state()");
  const { rows: count } = await h.q("select count(*)::int as n from team_lead_protected_backups");
  assert.equal(count[0].n, 1, "35일 지난 백업은 지운다");
});
