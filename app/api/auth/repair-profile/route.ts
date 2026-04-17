import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

function buildProfileInsertPayload(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const metadata = user.user_metadata ?? {};
  const loginId = typeof metadata.login_id === "string" ? metadata.login_id.trim().toLowerCase() : "";
  const displayName = typeof metadata.name === "string" ? metadata.name.trim() : "";

  return {
    id: user.id,
    email: user.email ?? "",
    login_id: loginId || null,
    name: displayName || user.email || "User",
    role: "member" as const,
    approved: true,
  };
}

type ProfileInsertPayload = ReturnType<typeof buildProfileInsertPayload>;

export async function POST() {
  try {
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

    const payload = buildProfileInsertPayload(user);

    if (hasSupabaseAdminEnv()) {
      const admin = createAdminClient();
      const adminPayload = payload as unknown as never;
      const { error } = await admin
        .from("profiles")
        .upsert(adminPayload, {
          onConflict: "id",
          ignoreDuplicates: true,
        });

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const serverPayload = payload as ProfileInsertPayload;
      const { error } = await supabase.from("profiles").insert(serverPayload);
      if (error && error.code !== "23505") {
        throw new Error(error.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "프로필 복구에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
