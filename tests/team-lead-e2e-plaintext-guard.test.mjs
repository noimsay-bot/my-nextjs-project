import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 메모리 안의 실제 Postgres 엔진으로 평문 덮어쓰기 방지 트리거를 검사한다. Supabase에 접속하지 않는다.
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const guardSql = readFileSync(new URL("../supabase/incremental_team_lead_e2e_plaintext_guard.sql", import.meta.url), "utf8");

const ENVELOPE = JSON.stringify({ enc: "tl-e2e-v1", keyVersion: 1, iv: "aXY=", ct: "Y3Q=" });

test("schema.sql과 incremental SQL의 평문 방지 블록이 같다", () => {
  const block = (sql) => {
    const text = sql.replace(/\r\n/g, "\n");
    const start = text.indexOf("create or replace function public.guard_team_lead_protected_state()");
    const endMarker = "execute function public.guard_team_lead_protected_state();";
    const end = text.indexOf(endMarker);
    assert.ok(start >= 0 && end > start, "평문 방지 블록을 찾지 못했습니다.");
    return text.slice(start, end + endMarker.length);
  };
  assert.equal(block(schema), block(guardSql));
});

test("암호화를 켜면 보호 대상 4개 key는 암호문만 저장되고, 켠 설정은 끄거나 지울 수 없다", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table public.team_lead_state (
      key text primary key,
      state jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(guardSql);
  // 여러 번 실행해도 안전해야 한다.
  await db.exec(guardSql);

  const put = (key, state) =>
    db.query(
      `insert into team_lead_state (key, state) values ($1, $2::jsonb)
       on conflict (key) do update set state = excluded.state`,
      [key, state],
    );
  const rejects = (promise, pattern) =>
    assert.rejects(promise, (error) => {
      assert.match(error.message, pattern);
      return true;
    });

  await t.test("켜기 전에는 평문도 저장된다(전환 전 호환)", async () => {
    await put("crypto_meta_v1", JSON.stringify({ enabled: false, currentKeyVersion: 1 }));
    await put("scoreboard_v1", JSON.stringify({ a: 1 }));
    await put("reference_notes_v1", JSON.stringify({ notes: {} }));
  });

  await t.test("켠 뒤에는 보호 대상 key에 평문·빈 값·가짜 형식을 쓸 수 없다", async () => {
    await put("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 1 }));
    for (const key of ["scoreboard_v1", "reference_notes_v1", "contribution_manual_v1", "best_report_quarters_v1"]) {
      await rejects(put(key, JSON.stringify({ a: 1 })), /암호문으로만/);
      await rejects(put(key, "{}"), /암호문으로만/);
      await rejects(put(key, "[]"), /암호문으로만/);
      await rejects(put(key, JSON.stringify({ enc: "tl-e2e-v1", keyVersion: "1", iv: "a", ct: "b" })), /암호문으로만/);
      await put(key, ENVELOPE);
    }
    const { rows } = await db.query("select state from team_lead_state where key = 'scoreboard_v1'");
    assert.equal(rows[0].state.enc, "tl-e2e-v1");
  });

  await t.test("보호 대상이 아닌 key는 계속 평문으로 저장된다", async () => {
    await put("final_cut_v1", JSON.stringify({ item: "circle" }));
    await put("review_access_v1", JSON.stringify({ profileIds: [] }));
  });

  await t.test("켠 암호화 설정은 끄거나 지울 수 없지만, 켠 상태의 다른 값은 바꿀 수 있다", async () => {
    await rejects(put("crypto_meta_v1", JSON.stringify({ enabled: false, currentKeyVersion: 1 })), /끌 수 없습니다/);
    await rejects(put("crypto_meta_v1", "{}"), /끌 수 없습니다/);
    await rejects(db.query("delete from team_lead_state where key = 'crypto_meta_v1'"), /지울 수 없습니다/);
    await put("crypto_meta_v1", JSON.stringify({ enabled: true, currentKeyVersion: 2 }));
  });

  await t.test("보호 대상 행 삭제는 막지 않는다(평문이 생기지 않음)", async () => {
    await db.query("delete from team_lead_state where key = 'contribution_manual_v1'");
  });
});
