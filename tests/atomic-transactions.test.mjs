import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// A real, in-memory Postgres engine with synthetic auth/roles. Never contacts Supabase.
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const atomicSql = readFileSync(new URL("../supabase/incremental_atomic_news_and_live_status.sql", import.meta.url), "utf8");
const bootstrapSql = readFileSync(new URL("../supabase/incremental_safe_profile_bootstrap.sql", import.meta.url), "utf8");
const admin = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const draft = "00000000-0000-4000-8000-000000000101";
const official = "00000000-0000-4000-8000-000000000102";
const story = "00000000-0000-4000-8000-000000000201";
const missing = "00000000-0000-4000-8000-000000000299";
const camera = "00000000-0000-4000-8000-000000000301";
const repairCamera = "00000000-0000-4000-8000-000000000302";
const entry = (id, note = null) => ({ equipment_item_id: id, live_note: note });

test("baseline schema and incremental rollout define the same hardened functions", () => {
  const definition = (sql, name) => {
    const normalized = sql.replace(/\r\n/g, "\n");
    const start = normalized.indexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0, `missing function ${name}`);
    const end = normalized.indexOf("\n$$;", start);
    assert.ok(end > start, `missing function end ${name}`);
    return normalized.slice(start, end);
  };
  for (const name of ["save_news_issue_set_items_atomic", "publish_news_issue_set_atomic", "save_live_equipment_status_atomic"]) {
    assert.equal(definition(schema, name), definition(atomicSql, name));
  }
  assert.equal(definition(schema, "handle_new_user"), definition(bootstrapSql, "handle_new_user"));
});

test("Postgres signup hardening and atomic writes preserve permissions and roll back failures", async (t) => {
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
    grant usage on schema auth, public to anon, authenticated, service_role;
  `);
  // Use the actual schema's profile/trigger definitions, not an implementation mirror.
  await db.exec(schema.slice(0, schema.indexOf("alter table public.profiles enable row level security;")));
  await db.exec(`insert into auth.users values
    ('${admin}', 'admin@example.test', '{"login_id":"operator"}'),
    ('${member}', 'member@example.test', '{"login_id":"noimsay","role":"admin"}');`);

  await t.test("self-selected privileged-looking signup metadata always creates a member", async () => {
    const { rows } = await db.query("select role, approved from profiles where id=$1", [member]);
    assert.deepEqual(rows, [{ role: "member", approved: true }]);
  });
  await db.exec(`update profiles set role='admin' where id='${admin}';`);
  await t.test("incremental bootstrap is repeatable and preserves existing roles and approvals", async () => {
    await db.exec(`update profiles set approved=false where id='${member}';`);
    await db.exec(bootstrapSql);
    await db.exec(bootstrapSql);
    const { rows } = await db.query("select role,approved from profiles order by id");
    assert.deepEqual(rows, [{ role: "admin", approved: true }, { role: "member", approved: false }]);
    await db.exec(`update profiles set approved=true where id='${member}';`);
  });
  await t.test("repair script creates only missing members, without metadata-based elevation", async () => {
    await db.exec(`delete from profiles where id='${member}';`);
    await db.exec(readFileSync(new URL("../supabase/repair_missing_profiles.sql", import.meta.url), "utf8"));
    assert.equal((await db.query("select role from profiles where id=$1", [member])).rows[0].role, "member");
    assert.equal((await db.query("select role from profiles where id=$1", [admin])).rows[0].role, "admin");
  });

  // News issue table DDL is absent from the repo; these minimal constraints are
  // fixtures. Verify the deployment's actual columns/policies before SQL rollout.
  await db.exec(`
    create table home_news_briefings (id uuid primary key);
    create table home_news_issue_sets (
      id uuid primary key, status text not null, issue_date date, briefing_slot text,
      published_at timestamptz, updated_by uuid references profiles(id)
    );
    create table home_news_issue_set_items (
      id uuid primary key default gen_random_uuid(), issue_set_id uuid references home_news_issue_sets(id),
      briefing_id uuid references home_news_briefings(id), display_order integer,
      unique(issue_set_id, briefing_id)
    );
    alter table home_news_issue_sets enable row level security;
    alter table home_news_issue_set_items enable row level security;
    create policy managers on home_news_issue_sets to authenticated using (is_admin()) with check (is_admin());
    create policy managers on home_news_issue_set_items to authenticated using (is_admin()) with check (is_admin());
  `);
  for (const table of ["equipment_items", "equipment_loans", "equipment_loan_items", "live_equipment_status_board"]) {
    const match = schema.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(match, `missing actual DDL for ${table}`);
    await db.exec(match[0]);
  }
  await db.exec(`
    grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
    create unique index one_active_loan on equipment_loan_items(equipment_item_id) where status='borrowed';
    insert into home_news_briefings values ('${story}');
    insert into home_news_issue_sets (id,status,issue_date,briefing_slot) values
      ('${draft}','draft','2026-09-10','morning_6'), ('${official}','published','2026-09-10','morning_6');
    insert into home_news_issue_set_items (issue_set_id,briefing_id,display_order) values ('${draft}','${story}',1);
    insert into equipment_items (id,category,group_name,name,code,metadata) values
      ('${camera}','live','TVU','TVU-1','camera','{}'),
      ('${repairCamera}','live','TVU','TVU-2','repair','{"is_under_repair":true}');
  `);
  await db.exec(atomicSql);
  await db.exec(atomicSql);
  async function asRole(role, uid) {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('test.uid',$1,false)", [uid]);
  }

  await t.test("failed replacement restores the original news items", async () => {
    await asRole("authenticated", admin);
    await assert.rejects(db.query("select save_news_issue_set_items_atomic($1,$2::uuid[])", [draft, [missing]]), /foreign key/);
    assert.deepEqual((await db.query("select briefing_id from home_news_issue_set_items")).rows, [{ briefing_id: story }]);
  });
  await t.test("invalid composition and ordinary-member calls cannot mutate news", async () => {
    await assert.rejects(db.query("select save_news_issue_set_items_atomic($1,$2::uuid[])", [draft, [story, story]]), /중복/);
    await asRole("authenticated", member);
    await assert.rejects(db.query("select publish_news_issue_set_atomic($1)", [draft]), /관리자 권한/);
    await asRole("anon", member);
    await assert.rejects(db.query("select publish_news_issue_set_atomic($1)", [draft]), /permission denied/);
  });
  await t.test("publication failure restores the previous official set; success switches it once", async () => {
    await db.exec(`reset role;
      create function fail_publication() returns trigger language plpgsql as $$ begin
        if new.id='${draft}' and new.status='published' then raise exception 'injected publication failure'; end if;
        return new; end $$;
      create trigger inject_failure before update on home_news_issue_sets for each row execute function fail_publication();`);
    await asRole("authenticated", admin);
    await assert.rejects(db.query("select publish_news_issue_set_atomic($1)", [draft]), /injected publication failure/);
    assert.equal((await db.query("select status from home_news_issue_sets where id=$1", [official])).rows[0].status, "published");
    await db.exec("reset role; drop trigger inject_failure on home_news_issue_sets;");
    await asRole("authenticated", admin);
    await db.query("select publish_news_issue_set_atomic($1)", [draft]);
    assert.equal((await db.query("select count(*)::int as n from home_news_issue_sets where status='published'")).rows[0].n, 1);
    assert.equal((await db.query("select status from home_news_issue_sets where id=$1", [official])).rows[0].status, "archived");
  });
  const saveLive = (actor, entries) => db.query("select save_live_equipment_status_atomic($1,$2::jsonb)", [actor, JSON.stringify(entries)]);
  await t.test("live RPC rejects browser roles and rechecks the server actor", async () => {
    await asRole("authenticated", admin);
    await assert.rejects(saveLive(admin, [entry(camera)]), /permission denied/);
    await asRole("service_role", admin);
    await assert.rejects(saveLive(member, [entry(camera)]), /저장 권한/);
    await assert.rejects(saveLive(admin, [entry(camera), entry(camera)]), /중복/);
  });
  await t.test("live save creates a linked loan and repair-only board without borrowing it", async () => {
    await saveLive(admin, [entry(camera, "location one"), entry(repairCamera, "repair memo")]);
    assert.equal((await db.query("select count(*)::int as n from equipment_loans")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from equipment_loan_items")).rows[0].n, 1);
    assert.equal((await db.query("select live_note from live_equipment_status_board")).rows[0].live_note, "repair memo");
  });
  await t.test("a later board failure rolls back earlier parent and child returns", async () => {
    await db.exec(`reset role;
      alter table live_equipment_status_board add constraint reject_test_failure check (live_note is distinct from 'FAIL');`);
    await asRole("service_role", admin);
    await assert.rejects(saveLive(admin, [entry(camera), entry(repairCamera, "FAIL")]), /reject_test_failure/);
    assert.equal((await db.query("select status from equipment_loan_items")).rows[0].status, "borrowed");
    assert.equal((await db.query("select status from equipment_loans")).rows[0].status, "borrowed");
    assert.equal((await db.query("select live_note from live_equipment_status_board")).rows[0].live_note, "repair memo");
    await saveLive(admin, [entry(camera), entry(repairCamera)]);
    assert.equal((await db.query("select status from equipment_loan_items")).rows[0].status, "returned");
    assert.equal((await db.query("select status from equipment_loans")).rows[0].status, "returned");
    assert.equal((await db.query("select count(*)::int as n from live_equipment_status_board")).rows[0].n, 0);
  });
});
