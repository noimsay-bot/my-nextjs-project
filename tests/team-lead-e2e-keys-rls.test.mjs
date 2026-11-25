import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 메모리 안의 실제 Postgres 엔진과 가짜 auth/역할로 검사한다. Supabase에 접속하지 않는다.
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const keysSql = readFileSync(new URL("../supabase/incremental_team_lead_e2e_keys.sql", import.meta.url), "utf8");

const teamLead = "00000000-0000-4000-8000-000000000011";
const nextTeamLead = "00000000-0000-4000-8000-000000000012";
const admin = "00000000-0000-4000-8000-000000000013";
const desk = "00000000-0000-4000-8000-000000000014";
const member = "00000000-0000-4000-8000-000000000015";
const pendingTeamLead = "00000000-0000-4000-8000-000000000016";

const PUBLIC_KEY = "A".repeat(560);
const WRAPPED_DEK = "B".repeat(512);
const WRAPPED_PRIVATE_KEY = "C".repeat(2400);

test("schema.sql과 incremental SQL의 열쇠 보관 블록이 같다", () => {
  const normalize = (sql) => sql.replace(/\r\n/g, "\n");
  const block = (sql) => {
    const text = normalize(sql);
    const start = text.indexOf("create table if not exists public.team_lead_key_holders");
    const endMarker = "execute function public.revoke_team_lead_key_holders_on_demotion();";
    const end = text.indexOf(endMarker);
    assert.ok(start >= 0 && end > start, "열쇠 보관 블록을 찾지 못했습니다.");
    return text.slice(start, end + endMarker.length);
  };
  assert.equal(block(schema), block(keysSql));
});

test("열쇠 보관 테이블은 승인된 총괄팀장만 쓰고, 등급이 내려가면 기기 열쇠가 해제된다", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    -- 기본은 2단계 인증을 마친 로그인(aal2). aal1 동작은 mfa.test.mjs가 따로 검사한다.
    create function auth.jwt() returns jsonb language sql as $$
      select coalesce(nullif(current_setting('test.jwt', true), ''), '{"aal":"aal2"}')::jsonb
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
  `);
  await db.exec(schema.slice(0, schema.indexOf("alter table public.profiles enable row level security;")));
  await db.exec(`insert into auth.users values
    ('${teamLead}', 'lead@example.test', '{"login_id":"lead"}'),
    ('${nextTeamLead}', 'next@example.test', '{"login_id":"next"}'),
    ('${admin}', 'admin@example.test', '{"login_id":"admin"}'),
    ('${desk}', 'desk@example.test', '{"login_id":"desk"}'),
    ('${member}', 'member@example.test', '{"login_id":"member"}'),
    ('${pendingTeamLead}', 'pending@example.test', '{"login_id":"pending"}');
    update profiles set role='team_lead', approved=true where id in ('${teamLead}', '${nextTeamLead}');
    update profiles set role='admin', approved=true where id='${admin}';
    update profiles set role='desk', approved=true where id='${desk}';
    update profiles set role='member', approved=true where id='${member}';
    update profiles set role='team_lead', approved=false where id='${pendingTeamLead}';`);
  await db.exec(keysSql);
  // 같은 SQL을 두 번 실행해도 안전해야 한다.
  await db.exec(keysSql);

  const as = async (role, uid) => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('test.uid',$1,false)", [uid ?? ""]);
  };
  const asOwner = async (uid) => {
    await db.exec("reset role;");
    await db.query("select set_config('test.uid',$1,false)", [uid ?? ""]);
  };
  const insertDevice = (profileId, status = "pending", fingerprint = "123456") =>
    db.query(
      `insert into team_lead_key_holders (kind, profile_id, label, public_key, fingerprint, status)
       values ('device', $1, '사무실 PC', $2, $3, $4) returning id`,
      [profileId, PUBLIC_KEY, fingerprint, status],
    );
  const insertRecovery = () =>
    db.query(
      `insert into team_lead_key_holders (kind, label, public_key, fingerprint, wrapped_private_key, kdf, status)
       values ('recovery', '복구 코드', $1, '654321', $2, '{"alg":"PBKDF2-SHA256"}', 'active') returning id`,
      [PUBLIC_KEY, WRAPPED_PRIVATE_KEY],
    );
  const insertEnvelope = (holderId, keyVersion = 1) =>
    db.query("insert into team_lead_key_envelopes (holder_id, key_version, wrapped_dek) values ($1, $2, $3)", [
      holderId,
      keyVersion,
      WRAPPED_DEK,
    ]);

  let leadDeviceId;
  let nextLeadDeviceId;
  let recoveryId;

  await t.test("총괄팀장이 아니면 등록할 수 없다", async () => {
    for (const uid of [admin, desk, member, pendingTeamLead]) {
      await as("authenticated", uid);
      await assert.rejects(insertDevice(uid), /row-level security/);
      await assert.rejects(insertRecovery(), /row-level security/);
    }
    await as("anon", null);
    await assert.rejects(insertDevice(teamLead), /permission denied/);
  });

  await t.test("총괄팀장은 본인 기기만 pending으로 등록하고, 복구 코드는 active로 만든다", async () => {
    await as("authenticated", teamLead);
    await assert.rejects(insertDevice(nextTeamLead), /row-level security/);
    await assert.rejects(insertDevice(teamLead, "active"), /row-level security/);
    await assert.rejects(insertDevice(teamLead, "pending", "12ab56"), /check constraint/);
    await assert.rejects(
      db.query(
        `insert into team_lead_key_holders (kind, profile_id, public_key, fingerprint, wrapped_private_key, kdf)
         values ('device', $1, $2, '123456', $3, '{}')`,
        [teamLead, PUBLIC_KEY, WRAPPED_PRIVATE_KEY],
      ),
      /check constraint/,
    );

    leadDeviceId = (await insertDevice(teamLead)).rows[0].id;
    recoveryId = (await insertRecovery()).rows[0].id;

    await db.query(
      "update team_lead_key_holders set status='active', approved_by=$1, approved_at=now() where id=$2",
      [teamLead, leadDeviceId],
    );
    await insertEnvelope(leadDeviceId);
    await insertEnvelope(recoveryId);

    await as("authenticated", nextTeamLead);
    nextLeadDeviceId = (await insertDevice(nextTeamLead, "pending", "111111")).rows[0].id;
    await db.query("update team_lead_key_holders set status='active' where id=$1", [nextLeadDeviceId]);
    await insertEnvelope(nextLeadDeviceId);
  });

  await t.test("관리자·DESK·팀원은 보관자와 감싼 데이터 키를 볼 수 없다", async () => {
    for (const uid of [admin, desk, member, pendingTeamLead]) {
      await as("authenticated", uid);
      assert.equal((await db.query("select * from team_lead_key_holders")).rows.length, 0);
      assert.equal((await db.query("select * from team_lead_key_envelopes")).rows.length, 0);
      const updated = await db.query("update team_lead_key_holders set status='active' where id=$1", [recoveryId]);
      assert.equal(updated.affectedRows ?? 0, 0);
    }
    await as("authenticated", teamLead);
    assert.equal((await db.query("select * from team_lead_key_holders")).rows.length, 3);
    assert.equal((await db.query("select * from team_lead_key_envelopes")).rows.length, 3);
  });

  await t.test("revoked 상태와 revoked_at은 함께 움직여야 한다", async () => {
    await as("authenticated", teamLead);
    await assert.rejects(
      db.query("update team_lead_key_holders set status='revoked' where id=$1", [nextLeadDeviceId]),
      /check constraint/,
    );
  });

  await t.test("등급이 내려간 총괄팀장의 기기 열쇠만 해제되고 복구 코드·다른 팀장 기기는 유지된다", async () => {
    await asOwner(nextTeamLead);
    await db.query("update profiles set role='member' where id=$1", [teamLead]);

    const holders = (await db.query("select id, status, revoked_at from team_lead_key_holders order by created_at")).rows;
    const byId = new Map(holders.map((row) => [row.id, row]));
    assert.equal(byId.get(leadDeviceId).status, "revoked");
    assert.ok(byId.get(leadDeviceId).revoked_at);
    assert.equal(byId.get(nextLeadDeviceId).status, "active");
    assert.equal(byId.get(recoveryId).status, "active");

    const envelopeHolders = (await db.query("select holder_id from team_lead_key_envelopes")).rows.map((row) => row.holder_id);
    assert.deepEqual(new Set(envelopeHolders), new Set([nextLeadDeviceId, recoveryId]));

    await as("authenticated", teamLead);
    assert.equal((await db.query("select * from team_lead_key_holders")).rows.length, 0);
  });

  await t.test("이름 등 등급 외 변경은 열쇠에 영향을 주지 않는다", async () => {
    await asOwner(nextTeamLead);
    await db.query("update profiles set name='새 팀장' where id=$1", [nextTeamLead]);
    const row = (await db.query("select status from team_lead_key_holders where id=$1", [nextLeadDeviceId])).rows[0];
    assert.equal(row.status, "active");
  });

  await t.test("관리자는 자기 등급을 총괄팀장으로 올릴 수 없다(권한 상승 방지 트리거)", async () => {
    await asOwner(admin);
    await assert.rejects(
      db.query("update profiles set role='team_lead' where id=$1", [admin]),
      /권한 등급은 총괄팀장만 변경할 수 있습니다/,
    );
  });
});
