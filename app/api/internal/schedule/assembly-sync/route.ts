import { NextResponse } from "next/server";
import { syncAssemblyDutiesToHub } from "@/lib/schedule/assembly-sync";

export const runtime = "nodejs";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const matched = /^Bearer\s+(.+)$/i.exec(header);
  return matched?.[1]?.trim() ?? "";
}

export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        message: "인증이 필요합니다.",
      },
      { status: 401 },
    );
  }

  const expectedToken = process.env.HUB_ASSEMBLY_SYNC_TOKEN?.trim();
  if (!expectedToken) {
    console.warn("[assembly-sync] HUB_ASSEMBLY_SYNC_TOKEN 서버 환경변수가 설정되지 않았습니다.");
    return NextResponse.json(
      {
        ok: false,
        message: "국회 동기화 인증 설정이 없습니다.",
      },
      { status: 500 },
    );
  }

  if (token !== expectedToken) {
    return NextResponse.json(
      {
        ok: false,
        message: "인증이 필요합니다.",
      },
      { status: 401 },
    );
  }

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

  try {
    const result = await syncAssemblyDutiesToHub(month, "assembly_webhook");
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
