import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { syncAssemblyDutiesToHub } from "@/lib/schedule/assembly-sync";

export const runtime = "nodejs";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const PUBLISH_SYNC_ROLES = new Set(["desk", "admin", "team_lead"]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { month?: unknown } | null;
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  if (!MONTH_PATTERN.test(month)) {
    return NextResponse.json(
      {
        ok: false,
        message: "month는 YYYY-MM 형식이어야 합니다.",
      },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        message: "로그인 세션을 확인하지 못했습니다.",
      },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("id", user.id)
    .maybeSingle<{ role: string; approved: boolean }>();

  if (profileError || !profile?.approved || !PUBLISH_SYNC_ROLES.has(profile.role)) {
    return NextResponse.json(
      {
        ok: false,
        message: "근무표 게시 권한이 필요합니다.",
      },
      { status: 403 },
    );
  }

  try {
    const result = await syncAssemblyDutiesToHub(month, "hub_publish");
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "국회 근무 동기화에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
