import { NextResponse } from "next/server";
import { sendPortalNoticeMail } from "@/lib/server/mail";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import {
  parseTeamLeadSecurityManifest,
  runTeamLeadSecurityAlertCheck,
  TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY,
} from "@/lib/team-lead/security-alert-core";
import {
  runSecurityWatchCheck,
  SECURITY_WATCH_ROLES,
  SECURITY_WATCH_SNAPSHOT_STATE_KEY,
  type SecurityWatchSnapshot,
} from "@/lib/team-lead/security-watch-core";

// 총괄팀장 보안 매일 점검(Vercel Cron). 세 가지를 서로 독립적으로 한다(하나가 실패해도 나머지는 한다).
//   1. 총괄팀장 암호문 백업(DB 함수 backup_team_lead_protected_state). 설명: supabase/incremental_team_lead_e2e_delete_guard.sql
//   2. 보안 관련 코드 변경 알림. 설명: lib/team-lead/security-alert-core.ts
//   3. 총괄팀장 · DESK 계정과 보안 열쇠 변화 알림. 설명: lib/team-lead/security-watch-core.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminClient>;

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const matched = /^Bearer\s+(.+)$/i.exec(header);
  return matched?.[1]?.trim() ?? "";
}

async function loadState(admin: AdminClient, key: string) {
  const { data, error } = await admin.from("team_lead_state").select("state").eq("key", key).maybeSingle<{ state: unknown }>();
  if (error) throw new Error(error.message);
  return data?.state ?? null;
}

async function saveState(admin: AdminClient, key: string, state: unknown) {
  const { error } = await admin.from("team_lead_state").upsert({ key, state, updated_by: null } as unknown as never);
  if (error) throw new Error(error.message);
}

/**
 * 총괄팀장 · DESK · admin 계정 목록. 이메일은 profiles.email이 아니라 Supabase Auth의 로그인 이메일을 쓴다
 * (profiles.email은 관리자 화면에서 바꿀 수 있어 알림을 다른 곳으로 돌릴 수 있기 때문).
 */
async function loadPrivilegedAccounts(admin: AdminClient) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, name, role, approved, email")
    .in("role", [...SECURITY_WATCH_ROLES])
    .returns<{ id: string; name: string | null; role: string; approved: boolean; email: string | null }[]>();
  if (error) throw new Error(error.message);
  const accounts: SecurityWatchSnapshot["accounts"] = {};
  for (const row of data ?? []) {
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(row.id);
    if (authError) throw new Error(authError.message);
    const { data: factorData, error: factorError } = await admin.auth.admin.mfa.listFactors({ userId: row.id });
    if (factorError) throw new Error(factorError.message);
    accounts[row.id] = {
      name: row.name?.trim() || "이름 없음",
      role: row.role,
      approved: row.approved === true,
      email: (authData.user?.email ?? row.email ?? "").trim().toLowerCase(),
      mfaFactors: (factorData?.factors ?? []).filter((factor) => factor.status === "verified").length,
    };
  }
  return accounts;
}

async function settle<T>(job: () => Promise<T>) {
  try {
    return { ok: true as const, value: await job() };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: Request) {
  const expectedToken = process.env.CRON_SECRET?.trim();
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET 서버 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }
  if (getBearerToken(request) !== expectedToken) {
    return NextResponse.json({ ok: false, message: "인증이 필요합니다." }, { status: 401 });
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const now = () => new Date().toISOString();
  let accountsCache: Promise<SecurityWatchSnapshot["accounts"]> | null = null;
  const accounts = () => (accountsCache ??= loadPrivilegedAccounts(admin));

  const backup = await settle(async () => {
    const { data, error } = await admin.rpc("backup_team_lead_protected_state" as never);
    if (error) throw new Error(error.message);
    return data as unknown as number;
  });

  const codeAlert = await settle(() =>
    runTeamLeadSecurityAlertCheck({
      manifest: parseTeamLeadSecurityManifest(process.env.TEAM_LEAD_SECURITY_MANIFEST ?? null),
      loadPrevious: () => loadState(admin, TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY),
      savePrevious: (manifest) => saveState(admin, TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY, manifest),
      async listRecipients() {
        const list = Object.values(await accounts())
          .filter((account) => account.role === "team_lead" && account.approved && account.email.includes("@"))
          .map((account) => account.email);
        return [...new Set(list)];
      },
      sendMail: sendPortalNoticeMail,
      now,
      siteUrl,
    }),
  );

  const watch = await settle(() =>
    runSecurityWatchCheck({
      async takeSnapshot() {
        const { data, error } = await admin
          .from("team_lead_key_holders")
          .select("id, kind, label, status, profile_id")
          .returns<{ id: string; kind: string; label: string | null; status: string; profile_id: string | null }[]>();
        if (error) throw new Error(error.message);
        const holders: SecurityWatchSnapshot["holders"] = {};
        for (const row of data ?? []) {
          holders[row.id] = { kind: row.kind, label: row.label ?? "", status: row.status, profileId: row.profile_id };
        }
        return { version: 1, accounts: await accounts(), holders, takenAt: now() };
      },
      loadPrevious: () => loadState(admin, SECURITY_WATCH_SNAPSHOT_STATE_KEY),
      savePrevious: (snapshot) => saveState(admin, SECURITY_WATCH_SNAPSHOT_STATE_KEY, snapshot),
      sendMail: sendPortalNoticeMail,
      now,
      siteUrl,
    }),
  );

  for (const [name, result] of [["backup", backup], ["code-alert", codeAlert], ["watch", watch]] as const) {
    if (!result.ok) console.error(`[security-change-alert] ${name}:`, result.message);
  }

  // 받는 사람 주소, 이름, 파일 내용은 응답에 넣지 않는다.
  const codeValue = codeAlert.ok ? codeAlert.value : null;
  const ok = backup.ok && codeAlert.ok && watch.ok;
  return NextResponse.json(
    {
      ok,
      backup: backup.ok ? "saved" : "failed",
      status: codeValue?.status ?? "failed",
      ...(codeValue && "recipients" in codeValue ? { recipients: codeValue.recipients } : {}),
      ...(codeValue && "diff" in codeValue
        ? {
            changed: codeValue.diff.changed.length,
            added: codeValue.diff.added.length,
            removed: codeValue.diff.removed.length,
          }
        : {}),
      watch: watch.ok ? watch.value.status : "failed",
      ...(watch.ok && "events" in watch.value ? { watchEvents: watch.value.events } : {}),
    },
    { status: ok ? 200 : 500 },
  );
}
