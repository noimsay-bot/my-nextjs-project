import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// A real, in-memory Postgres engine with synthetic auth/roles. Never contacts Supabase.
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const livesSql = readFileSync(new URL("../supabase/incremental_youtube_lives.sql", import.meta.url), "utf8");
const desk = "00000000-0000-4000-8000-000000000001";
const teamLead = "00000000-0000-4000-8000-000000000002";
const member = "00000000-0000-4000-8000-000000000003";
const admin = "00000000-0000-4000-8000-000000000004";
const pendingDesk = "00000000-0000-4000-8000-000000000005";

test("baseline schema contains the same youtube lives block as the incremental SQL", () => {
  const normalize = (sql) => sql.replace(/\r\n/g, "\n");
  const block = (sql) => {
    const text = normalize(sql);
    const start = text.indexOf("create table if not exists public.youtube_lives");
    const end = text.indexOf("grant select, insert, update, delete on table public.live_participation to service_role;");
    assert.ok(start >= 0 && end > start, "youtube lives block not found");
    return text.slice(start, end);
  };
  assert.equal(block(schema), block(livesSql));
});

test("live participation is readable by approved users and writable only by desk", async (t) => {
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
  await db.exec(schema.slice(0, schema.indexOf("alter table public.profiles enable row level security;")));
  await db.exec(`insert into auth.users values
    ('${desk}', 'desk@example.test', '{"login_id":"desk"}'),
    ('${teamLead}', 'lead@example.test', '{"login_id":"lead"}'),
    ('${member}', 'member@example.test', '{"login_id":"member"}'),
    ('${admin}', 'admin@example.test', '{"login_id":"admin"}'),
    ('${pendingDesk}', 'pending@example.test', '{"login_id":"pending"}');
    update profiles set role='desk', approved=true where id='${desk}';
    update profiles set role='team_lead', approved=true where id='${teamLead}';
    update profiles set role='member', approved=true where id='${member}';
    update profiles set role='admin', approved=true where id='${admin}';
    update profiles set role='desk', approved=false where id='${pendingDesk}';`);
  await db.exec(livesSql);
  // The incremental SQL must be safe to run twice.
  await db.exec(livesSql);
  await db.exec(`insert into youtube_lives (video_id, title, started_at) values
    ('vid-a', 'A', '2026-11-10T01:00:00Z'),
    ('vid-b', 'B', '2026-11-10T02:00:00Z');`);

  const as = async (role, uid) => {
    await db.exec(`reset role; set role ${role};`);
    await db.query("select set_config('test.uid',$1,false)", [uid ?? ""]);
  };
  const check = (videoId, uid) =>
    db.query("insert into live_participation (video_id, checked_by) values ($1, $2)", [videoId, uid]);
  const countChecks = async () => {
    await db.exec("reset role;");
    return Number((await db.query("select count(*)::int as n from live_participation")).rows[0].n);
  };

  await t.test("non-desk accounts cannot check", async () => {
    for (const uid of [member, admin, pendingDesk]) {
      await as("authenticated", uid);
      await assert.rejects(check("vid-a", uid), /row-level security/);
    }
    await as("anon", null);
    await assert.rejects(check("vid-a", member), /permission denied/);
    assert.equal(await countChecks(), 0);
  });

  await t.test("desk and team lead can check, but only as themselves", async () => {
    await as("authenticated", desk);
    await assert.rejects(check("vid-a", member), /row-level security/);
    await check("vid-a", desk);
    await as("authenticated", teamLead);
    await check("vid-b", teamLead);
    assert.equal(await countChecks(), 2);
  });

  await t.test("approved users can read, unapproved and anon cannot", async () => {
    await as("authenticated", member);
    assert.equal((await db.query("select video_id from youtube_lives")).rows.length, 2);
    assert.equal((await db.query("select video_id from live_participation")).rows.length, 2);
    await as("authenticated", pendingDesk);
    assert.equal((await db.query("select video_id from youtube_lives")).rows.length, 0);
    assert.equal((await db.query("select video_id from live_participation")).rows.length, 0);
    await as("anon", null);
    await assert.rejects(db.query("select video_id from youtube_lives"), /permission denied/);
  });

  await t.test("non-desk accounts cannot uncheck or edit collected lives", async () => {
    await as("authenticated", member);
    await db.query("delete from live_participation where video_id='vid-a'");
    await assert.rejects(db.query("update live_participation set checked_at=now()"), /permission denied/);
    await assert.rejects(db.query("update youtube_lives set title='x'"), /permission denied/);
    await assert.rejects(db.query("delete from youtube_lives"), /permission denied/);
    assert.equal(await countChecks(), 2);
  });

  await t.test("re-collecting a live keeps its check", async () => {
    await as("service_role", null);
    await db.query(`insert into youtube_lives (video_id, title, started_at) values
      ('vid-a', 'A (제목 수정)', '2026-11-10T01:00:00Z')
      on conflict (video_id) do update
      set title = excluded.title, started_at = excluded.started_at, collected_at = now()`);
    await db.exec("reset role;");
    const { rows } = await db.query(
      "select l.title, p.checked_by from youtube_lives l join live_participation p using (video_id) where l.video_id='vid-a'",
    );
    assert.deepEqual(rows, [{ title: "A (제목 수정)", checked_by: desk }]);
  });

  await t.test("desk can uncheck", async () => {
    await as("authenticated", desk);
    await db.query("delete from live_participation where video_id='vid-b'");
    assert.equal(await countChecks(), 1);
  });
});
