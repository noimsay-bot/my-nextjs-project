import "server-only";

import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { AssemblyLeavePushAction } from "@/lib/schedule/assembly-leave-push-core";

type AssemblyLeavePushInput = {
  action: AssemblyLeavePushAction;
  date: string;
  memberName: string;
  requestId: string;
};

type AssemblyLeavePushLogPayload = {
  action: AssemblyLeavePushAction;
  date: string;
  member_name: string;
  request_id: string;
  success: boolean;
  error_message: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function insertAssemblyLeavePushLog(payload: AssemblyLeavePushLogPayload) {
  if (!hasSupabaseAdminEnv()) {
    console.warn("[assembly-leave-push] DB 로그를 남기려면 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.", {
      action: payload.action,
      date: payload.date,
      memberName: payload.member_name,
      requestId: payload.request_id,
      success: payload.success,
      errorMessage: payload.error_message,
    });
    return;
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("schedule_assembly_leave_push_logs").insert(payload as never);
    if (error) {
      console.warn("[assembly-leave-push] DB 로그 저장에 실패했습니다.", {
        action: payload.action,
        date: payload.date,
        memberName: payload.member_name,
        requestId: payload.request_id,
        message: error.message,
      });
    }
  } catch (error) {
    console.warn("[assembly-leave-push] DB 로그 저장 중 예외가 발생했습니다.", {
      action: payload.action,
      date: payload.date,
      memberName: payload.member_name,
      requestId: payload.request_id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function readAssemblyLeaveApplyConfig() {
  const apiUrl = process.env.ASSEMBLY_LEAVE_APPLY_URL?.trim();
  const token = process.env.HUB_TO_ASSEMBLY_TOKEN?.trim();

  if (!apiUrl || !token) {
    return {
      ok: false as const,
      message: !apiUrl
        ? "ASSEMBLY_LEAVE_APPLY_URL 서버 환경변수가 설정되지 않았습니다."
        : "HUB_TO_ASSEMBLY_TOKEN 서버 환경변수가 설정되지 않았습니다.",
    };
  }

  return { ok: true as const, apiUrl, token };
}

export async function pushAssemblyCompensatoryLeaveToAssembly(input: AssemblyLeavePushInput) {
  const date = input.date.trim();
  const memberName = input.memberName.trim();
  const requestId = input.requestId.trim();

  if (!DATE_PATTERN.test(date) || !memberName || !requestId) {
    const message = "국회 대휴 반영 요청의 date, memberName, requestId가 올바르지 않습니다.";
    await insertAssemblyLeavePushLog({
      action: input.action,
      date,
      member_name: memberName,
      request_id: requestId,
      success: false,
      error_message: message,
    });
    return { ok: false as const, message };
  }

  const config = readAssemblyLeaveApplyConfig();
  if (!config.ok) {
    await insertAssemblyLeavePushLog({
      action: input.action,
      date,
      member_name: memberName,
      request_id: requestId,
      success: false,
      error_message: config.message,
    });
    console.warn("[assembly-leave-push] 국회 대휴 반영 설정이 없어 호출을 건너뜁니다.", {
      action: input.action,
      date,
      memberName,
      requestId,
      message: config.message,
    });
    return { ok: true as const, skipped: true as const, message: config.message };
  }

  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: input.action,
        date,
        leaveType: "대휴",
        memberName,
        source: "hub_change_request",
        requestId,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const responsePayload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      const message =
        responsePayload?.message ??
        responsePayload?.error ??
        `국회 대휴 반영 API가 ${response.status} 응답을 반환했습니다.`;
      await insertAssemblyLeavePushLog({
        action: input.action,
        date,
        member_name: memberName,
        request_id: requestId,
        success: false,
        error_message: message,
      });
      return { ok: false as const, status: response.status, message };
    }

    await insertAssemblyLeavePushLog({
      action: input.action,
      date,
      member_name: memberName,
      request_id: requestId,
      success: true,
      error_message: null,
    });
    return { ok: true as const, skipped: false as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await insertAssemblyLeavePushLog({
      action: input.action,
      date,
      member_name: memberName,
      request_id: requestId,
      success: false,
      error_message: message,
    });
    return { ok: false as const, message };
  }
}
