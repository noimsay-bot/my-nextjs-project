import { NextResponse } from "next/server";
import { buildDeskLeaveNamesByDate } from "@/lib/schedule/desk-record-leave";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type ProfileRow = {
  approved: boolean;
};

type DeskRecordSettingsRow = {
  state: unknown;
};

function json(payload: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(payload, { ...init, headers });
}

export async function GET() {
  try {
    if (!hasSupabaseAdminEnv()) {
      return json({ message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("approved")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (profileError || !profile?.approved) {
      return json({ message: "승인된 계정이 필요합니다." }, { status: 403 });
    }

    const { data, error } = await admin
      .from("schedule_settings")
      .select("state")
      .eq("key", "desk_records_v1")
      .maybeSingle<DeskRecordSettingsRow>();

    if (error) {
      throw new Error("휴직 정보를 불러오지 못했습니다.");
    }

    return json({ namesByDate: buildDeskLeaveNamesByDate(data?.state) });
  } catch {
    return json({ message: "휴직 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}
