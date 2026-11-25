import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// 총괄팀장 · DESK · admin 2단계 인증: 화면 판단 규칙과 DB 강제 SQL을 검사한다. Supabase에 접속하지 않는다.
function loadCore() {
  const code = ts.transpileModule(readFileSync(new URL("../lib/auth/mfa-core.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const commonJsModule = { exports: {} };
  new Function("exports", "module", "require", code)(commonJsModule.exports, commonJsModule, () => {
    throw new Error("mfa-core는 다른 모듈을 import하지 않는다.");
  });
  return commonJsModule.exports;
}

const core = loadCore();
const BEFORE = new Date("2026-11-30T14:59:59Z"); // 한국 시간 11/30 23:59:59
const AFTER = new Date("2026-11-30T15:00:00Z"); // 한국 시간 12/1 0시

test("대상 등급만 확인하고, 유예 전에는 권유 · 후에는 필수, 등록했으면 6자리 확인", () => {
  const decide = (role, currentLevel, nextLevel, now = BEFORE) => core.decideMfaGate({ role, currentLevel, nextLevel, now });
  for (const role of ["member", "observer", "outlet", "partner", "reviewer", null]) {
    assert.equal(decide(role, "aal1", "aal1", AFTER), "ok", String(role));
  }
  for (const role of ["team_lead", "desk", "admin"]) {
    assert.equal(decide(role, "aal2", "aal2"), "ok");
    assert.equal(decide(role, "aal1", "aal2"), "challenge");
    assert.equal(decide(role, "aal1", "aal1", BEFORE), "enroll-suggested");
    assert.equal(decide(role, "aal1", "aal1", AFTER), "enroll-required");
    assert.equal(decide(role, null, null, AFTER), "enroll-required");
  }
});

test("돌아갈 주소는 포털 안의 경로만, 6자리는 숫자만", () => {
  assert.equal(core.sanitizeMfaNextPath("/team-lead/security"), "/team-lead/security");
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "", null, "/mfa?next=/x", "/login"]) {
    assert.equal(core.sanitizeMfaNextPath(bad), "/", String(bad));
  }
  assert.equal(core.normalizeMfaCode(" 123-456 7"), "123456");
  assert.equal(core.formatMfaRequiredDate(), "12월 1일");
});

test("AuthGate가 대상 등급을 /mfa로 보내고, /mfa는 로그인 보호 경로 밖에 있다", () => {
  const gate = readFileSync(new URL("../components/auth/auth-gate.tsx", import.meta.url), "utf8");
  assert.match(gate, /router\.replace\(`\/mfa\?next=\$\{encodeURIComponent\(pathname\)\}`\)/);
  assert.match(gate, /mfaBlocks \|\|\r?\n\s+!hasAccess\(/);
  const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.ok(!middleware.includes('"/mfa'), "middleware가 /mfa를 막으면 안 된다");
});

test("DB 강제: aal2가 아닌 로그인은 총괄팀장 · DESK · admin이어도 멤버 권한만 갖는다", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
    create type public.app_role as enum ('member', 'observer', 'desk', 'team_lead', 'admin');
    create table public.profiles (id uuid primary key, role public.app_role not null, approved boolean not null);
    insert into public.profiles values
      ('00000000-0000-0000-0000-00000000000a', 'team_lead', true),
      ('00000000-0000-0000-0000-00000000000b', 'desk', true),
      ('00000000-0000-0000-0000-00000000000c', 'admin', true),
      ('00000000-0000-0000-0000-00000000000d', 'member', true);
  `);
  const sql = readFileSync(new URL("../supabase/incremental_privileged_roles_require_mfa.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);

  const check = async (uid, aal) => {
    await db.exec(`select set_config('test.uid', '${uid}', false), set_config('test.jwt', '${JSON.stringify(aal ? { aal } : {})}', false)`);
    const { rows } = await db.query("select public.current_profile_role()::text as role, public.is_admin() as admin");
    return rows[0];
  };
  const lead = "00000000-0000-0000-0000-00000000000a";
  const desk = "00000000-0000-0000-0000-00000000000b";
  const admin = "00000000-0000-0000-0000-00000000000c";
  const member = "00000000-0000-0000-0000-00000000000d";

  assert.deepEqual(await check(lead, "aal2"), { role: "team_lead", admin: true });
  assert.deepEqual(await check(lead, "aal1"), { role: "member", admin: false });
  assert.deepEqual(await check(lead, null), { role: "member", admin: false });
  assert.deepEqual(await check(desk, "aal2"), { role: "desk", admin: false });
  assert.deepEqual(await check(desk, "aal1"), { role: "member", admin: false });
  assert.deepEqual(await check(admin, "aal2"), { role: "admin", admin: true });
  assert.deepEqual(await check(admin, "aal1"), { role: "member", admin: false });
  assert.deepEqual(await check(member, "aal1"), { role: "member", admin: false });
});
