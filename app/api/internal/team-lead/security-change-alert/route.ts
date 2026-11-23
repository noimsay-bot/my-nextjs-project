import { NextResponse } from "next/server";
import { sendPortalNoticeMail } from "@/lib/server/mail";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import {
  parseTeamLeadSecurityManifest,
  runTeamLeadSecurityAlertCheck,
  TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY,
} from "@/lib/team-lead/security-alert-core";

// 총괄팀장 보안 관련 코드 변경 알림(매일 Vercel Cron). 설명: lib/team-lead/security-alert-core.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const matched = /^Bearer\s+(.+)$/i.exec(header);
  return matched?.[1]?.trim() ?? "";
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
  try {
    const result = await runTeamLeadSecurityAlertCheck({
      manifest: parseTeamLeadSecurityManifest(process.env.TEAM_LEAD_SECURITY_MANIFEST ?? null),
      async loadPrevious() {
        const { data, error } = await admin
          .from("team_lead_state")
          .select("state")
          .eq("key", TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY)
          .maybeSingle<{ state: unknown }>();
        if (error) throw new Error(error.message);
        return data?.state ?? null;
      },
      async savePrevious(manifest) {
        const { error } = await admin
          .from("team_lead_state")
          .upsert({ key: TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY, state: manifest, updated_by: null });
        if (error) throw new Error(error.message);
      },
      async listRecipients() {
        const { data, error } = await admin
          .from("profiles")
          .select("email")
          .eq("role", "team_lead")
          .eq("approved", true)
          .returns<{ email: string | null }[]>();
        if (error) throw new Error(error.message);
        return [...new Set((data ?? []).map((row) => row.email?.trim() ?? "").filter((email) => email.includes("@")))];
      },
      sendMail: sendPortalNoticeMail,
      now: () => new Date().toISOString(),
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
    });

    // 받는 사람 주소와 파일 내용은 응답에 넣지 않는다.
    return NextResponse.json({
      ok: true,
      status: result.status,
      ...("recipients" in result ? { recipients: result.recipients } : {}),
      ...("diff" in result
        ? {
            changed: result.diff.changed.length,
            added: result.diff.added.length,
            removed: result.diff.removed.length,
          }
        : {}),
    });
  } catch (error) {
    console.error("[security-change-alert]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, message: "보안 코드 변경 점검에 실패했습니다." }, { status: 500 });
  }
}
