import "server-only";

import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient, hasSupabaseAuthCookie } from "@/lib/supabase/server";

interface WeatherAuthProfile {
  id: string;
  role: string;
  approved: boolean;
}

export async function requireWeatherAdmin() {
  try {
    if (!(await hasSupabaseAuthCookie())) {
      return {
        response: NextResponse.json({ message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 }),
        profile: null,
      };
    }

    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        response: NextResponse.json({ message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 }),
        profile: null,
      };
    }

    const profileQuery = hasSupabaseAdminEnv()
      ? createAdminClient().from("profiles").select("id, role, approved").eq("id", user.id)
      : supabase.from("profiles").select("id, role, approved").eq("id", user.id);
    const { data: profile, error: profileError } = await profileQuery.maybeSingle<WeatherAuthProfile>();

    if (profileError || !profile || !profile.approved || profile.role !== "admin") {
      return {
        response: NextResponse.json({ message: "날씨 페이지 관리자 권한이 없습니다." }, { status: 403 }),
        profile: null,
      };
    }

    return {
      response: null,
      profile,
    };
  } catch {
    return {
      response: NextResponse.json({ message: "날씨 API 권한 확인 설정을 확인해 주세요." }, { status: 500 }),
      profile: null,
    };
  }
}
