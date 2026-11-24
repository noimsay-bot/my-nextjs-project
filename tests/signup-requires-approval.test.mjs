import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 회원가입 승인제 SQL을 메모리 안의 실제 Postgres 엔진으로 검사한다. Supabase에 접속하지 않는다.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const schema = read("../supabase/schema.sql");
const approvalSql = read("../supabase/incremental_signup_requires_approval.sql");

test("schema.sql도 새 가입자를 승인 대기로 만든다", () => {
  assert.match(schema, /approved boolean not null default false,/);
  const handleNewUser = schema.slice(schema.indexOf("create or replace function public.handle_new_user()"));
  assert.match(handleNewUser.slice(0, 1500), /'member'::public\.app_role,\n\s+-- 새 가입자는 관리자가 승인해야 쓸 수 있다\.\n\s+false\n/);
  const insertPolicy = schema.slice(schema.indexOf('create policy "profiles_insert_own"'));
  assert.match(insertPolicy.slice(0, 200), /and approved = false\n\);/);
  for (const path of ["../app/api/auth/repair-profile/route.ts", "../lib/auth/storage.ts"]) {
    const source = read(path);
    const payload = source.slice(source.indexOf("function buildProfileInsertPayload"));
    assert.match(payload.slice(0, 800), /approved: false,/, `${path}의 새 프로필도 승인 대기여야 한다`);
  }
});

test("새 가입자는 승인 대기, 기존 계정은 그대로, 다시 가입 트리거가 돌아도 승인이 풀리지 않는다", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create type public.app_role as enum ('member', 'desk', 'team_lead', 'admin');
    create table public.profiles (
      id uuid primary key,
      email text not null,
      login_id text,
      name text not null,
      role public.app_role not null default 'member',
      approved boolean not null default true,
      updated_at timestamptz not null default now()
    );
    alter table public.profiles enable row level security;
    insert into public.profiles (id, email, name, role, approved)
      values ('00000000-0000-0000-0000-000000000001', 'old@example.test', '기존', 'desk', true);
  `);
  await db.exec(approvalSql);
  await db.exec(approvalSql);
  await db.exec(`
    create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();
  `);

  await db.exec(`insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000002', 'new@example.test', '{"name":"신규","login_id":"newbie"}')`);
  const { rows: created } = await db.query("select role, approved, login_id from profiles where email = 'new@example.test'");
  assert.deepEqual(created, [{ role: "member", approved: false, login_id: "newbie" }]);

  const { rows: old } = await db.query("select role, approved from profiles where email = 'old@example.test'");
  assert.deepEqual(old, [{ role: "desk", approved: true }]);

  // 기본값도 승인 대기다(서버 보정 코드가 approved 없이 넣는 경우).
  await db.exec(`insert into profiles (id, email, name) values ('00000000-0000-0000-0000-000000000003', 'x@example.test', 'x')`);
  const { rows: byDefault } = await db.query("select approved from profiles where email = 'x@example.test'");
  assert.equal(byDefault[0].approved, false);

  // 승인된 계정의 auth 행이 다시 들어와도(on conflict) 승인 상태는 바뀌지 않는다.
  await db.exec("update profiles set approved = true where email = 'new@example.test'");
  await db.exec("delete from auth.users where email = 'new@example.test'");
  await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002', 'new@example.test')`);
  const { rows: still } = await db.query("select approved from profiles where email = 'new@example.test'");
  assert.equal(still[0].approved, true);

  const { rows: policy } = await db.query(
    "select pg_get_expr(polwithcheck, polrelid) as check from pg_policy where polname = 'profiles_insert_own'",
  );
  assert.match(policy[0].check, /approved = false/);
});
