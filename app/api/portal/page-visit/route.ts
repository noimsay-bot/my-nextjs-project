import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

const PAGE_VISIT_TABLE = "page_visit_events";
const PUBLIC_PAGE_VISIT_KEYS = new Set(["election_external"]);

function normalizePath(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return "";
  return trimmed.slice(0, 240);
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({ message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const pageKey = typeof payload?.pageKey === "string" ? payload.pageKey.trim() : "";
    if (!PUBLIC_PAGE_VISIT_KEYS.has(pageKey)) {
      return NextResponse.json({ message: "지원하지 않는 방문 기록입니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin.from(PAGE_VISIT_TABLE).insert({
      profile_id: null,
      page_key: pageKey,
      path: normalizePath(payload?.path) || "/election-public",
    } as never);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "방문 기록을 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
