import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties,
  getAssemblyCompensatoryLeavePushOperations,
  type AssemblyLeavePushAction,
} from "@/lib/schedule/assembly-leave-push-core";
import { pushAssemblyCompensatoryLeaveToAssembly } from "@/lib/schedule/assembly-leave-push";
import type { GeneratedSchedule, SchedulePersonRef, ScheduleChangeRequest } from "@/lib/schedule/types";

export const runtime = "nodejs";

const PUSH_ROLES = new Set(["desk", "admin", "team_lead"]);

type ChangeRequestPushRow = {
  id: string;
  route: SchedulePersonRef[] | null;
  status: ScheduleChangeRequest["status"];
};

type ScheduleMonthAssemblyDutyRow = {
  month_key: string;
  draft_state: GeneratedSchedule | null;
  published_state: GeneratedSchedule | null;
};

function normalizeAction(value: unknown): AssemblyLeavePushAction | null {
  return value === "upsert" || value === "delete" ? value : null;
}

function expectedStatusForAction(action: AssemblyLeavePushAction): ScheduleChangeRequest["status"] {
  return action === "upsert" ? "accepted" : "rolledBack";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    requestId?: unknown;
    action?: unknown;
  } | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const action = normalizeAction(body?.action);

  if (!requestId || !action) {
    return NextResponse.json(
      {
        ok: false,
        message: "requestId와 action(upsert/delete)이 필요합니다.",
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

  if (profileError || !profile?.approved || !PUSH_ROLES.has(profile.role)) {
    return NextResponse.json(
      {
        ok: false,
        message: "근무 변경 요청 처리 권한이 필요합니다.",
      },
      { status: 403 },
    );
  }

  const { data: changeRequest, error: requestError } = await supabase
    .from("schedule_change_requests")
    .select("id, route, status")
    .eq("id", requestId)
    .maybeSingle<ChangeRequestPushRow>();

  if (requestError) {
    return NextResponse.json(
      {
        ok: false,
        message: requestError.message,
      },
      { status: 500 },
    );
  }

  if (!changeRequest) {
    return NextResponse.json(
      {
        ok: false,
        message: "근무 변경 요청을 찾지 못했습니다.",
      },
      { status: 404 },
    );
  }

  const expectedStatus = expectedStatusForAction(action);
  if (changeRequest.status !== expectedStatus) {
    return NextResponse.json(
      {
        ok: false,
        message: `근무 변경 요청 상태가 ${expectedStatus}일 때만 국회 대휴 반영을 실행합니다.`,
      },
      { status: 409 },
    );
  }

  const operations = getAssemblyCompensatoryLeavePushOperations(changeRequest.route ?? [], action);
  if (operations.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "대휴 변경요청이 아닙니다.",
    });
  }

  const operationMonthKeys = Array.from(
    new Set(operations.map((operation) => operation.date.slice(0, 7)).filter(Boolean)),
  );
  const { data: scheduleMonths, error: scheduleMonthsError } = await supabase
    .from("schedule_months")
    .select("month_key, draft_state, published_state")
    .in("month_key", operationMonthKeys)
    .returns<ScheduleMonthAssemblyDutyRow[]>();

  if (scheduleMonthsError) {
    return NextResponse.json(
      {
        ok: false,
        message: scheduleMonthsError.message,
      },
      { status: 500 },
    );
  }

  const eligibleOperations = filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties(
    operations,
    (scheduleMonths ?? []).flatMap((row) => [row.draft_state, row.published_state]),
  );
  if (eligibleOperations.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "국회근무표에 있는 대휴 대상자가 아닙니다.",
    });
  }

  const results = [];
  for (const operation of eligibleOperations) {
    results.push(
      await pushAssemblyCompensatoryLeaveToAssembly({
        action: operation.action,
        date: operation.date,
        memberName: operation.memberName,
        requestId,
      }),
    );
  }
  const failed = results.filter((result) => !result.ok);

  if (failed.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        pushedCount: results.length - failed.length,
        failedCount: failed.length,
        message: failed[0]?.message ?? "국회 대휴 반영에 실패했습니다.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    skipped: results.every((result) => result.ok && result.skipped === true),
    pushedCount: results.filter((result) => result.ok && result.skipped !== true).length,
  });
}
