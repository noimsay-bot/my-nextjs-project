import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKUP_RETENTION_LIMIT = 10;

interface ScheduleAssignmentRow {
  month_key: string;
  entries: unknown;
  rows: unknown;
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const matched = /^Bearer\s+(.+)$/i.exec(header);
  return matched?.[1]?.trim() ?? "";
}

function getSeoulDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, offset: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMeaningfulEntry(value: unknown) {
  const entry = asRecord(value);
  const schedules = Array.isArray(entry.schedules) ? entry.schedules : [];
  const exclusiveVideo = Array.isArray(entry.exclusiveVideo) ? entry.exclusiveVideo : [];
  return (
    hasText(entry.clockIn) ||
    hasText(entry.clockOut) ||
    hasText(entry.travelType) ||
    hasText(entry.tripTagId) ||
    hasText(entry.tripTagLabel) ||
    hasText(entry.tripTagPhase) ||
    schedules.some(hasText) ||
    exclusiveVideo.some(Boolean) ||
    Number(entry.coverageScore ?? 0) > 0 ||
    hasText(entry.coverageNote)
  );
}

function getEntryCount(entries: unknown) {
  return Object.values(asRecord(entries)).filter(hasMeaningfulEntry).length;
}

function getRowChangeCount(rows: unknown) {
  return Object.values(asRecord(rows)).reduce<number>((count, value) => {
    const dayRows = asRecord(value);
    const addedRows = Array.isArray(dayRows.addedRows) ? dayRows.addedRows.length : 0;
    const deletedRows = Array.isArray(dayRows.deletedRowKeys) ? dayRows.deletedRowKeys.length : 0;
    const rowOverrides = Object.keys(asRecord(dayRows.rowOverrides)).length;
    return count + addedRows + deletedRows + rowOverrides;
  }, 0);
}

async function pruneDailyBackups(
  admin: ReturnType<typeof createAdminClient>,
  monthKey: string,
  backupDateKey: string,
) {
  const cutoffDateKey = addDaysToDateKey(backupDateKey, -(BACKUP_RETENTION_LIMIT - 1));

  const oldRowsDelete = await admin
    .from("team_lead_schedule_assignment_backups")
    .delete()
    .eq("kind", "daily")
    .eq("month_key", monthKey)
    .lt("backup_date", cutoffDateKey);

  if (oldRowsDelete.error) {
    throw new Error(oldRowsDelete.error.message);
  }

  const { data, error } = await admin
    .from("team_lead_schedule_assignment_backups")
    .select("id")
    .eq("kind", "daily")
    .eq("month_key", monthKey)
    .order("backup_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(BACKUP_RETENTION_LIMIT, 999)
    .returns<Array<{ id: string }>>();

  if (error) {
    throw new Error(error.message);
  }

  const deleteIds = (data ?? []).map((row) => row.id).filter(Boolean);
  if (deleteIds.length === 0) return;

  const { error: deleteError } = await admin
    .from("team_lead_schedule_assignment_backups")
    .delete()
    .in("id", deleteIds);

  if (deleteError) {
    throw new Error(deleteError.message);
  }
}

async function createDailyScheduleAssignmentBackups() {
  const admin = createAdminClient();
  const backupDateKey = getSeoulDateKey();
  const { data, error } = await admin
    .from("team_lead_schedule_assignments")
    .select("month_key, entries, rows")
    .returns<ScheduleAssignmentRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  let savedCount = 0;
  let skippedCount = 0;

  for (const row of data ?? []) {
    const monthKey = row.month_key.trim();
    if (!monthKey) {
      skippedCount += 1;
      continue;
    }

    const entryCount = getEntryCount(row.entries);
    const rowChangeCount = getRowChangeCount(row.rows);
    if (entryCount + rowChangeCount === 0) {
      skippedCount += 1;
      continue;
    }

    const backupPayload = {
      kind: "daily",
      month_key: monthKey,
      backup_date: backupDateKey,
      label: `${monthKey} 일일 백업 ${backupDateKey}`,
      entries: asRecord(row.entries),
      rows: asRecord(row.rows),
      entry_count: entryCount,
      row_change_count: rowChangeCount,
    } as unknown as never;
    const { error: upsertError } = await admin
      .from("team_lead_schedule_assignment_backups")
      .upsert(backupPayload, { onConflict: "kind,month_key,backup_date" });

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    await pruneDailyBackups(admin, monthKey, backupDateKey);
    savedCount += 1;
  }

  return {
    backupDateKey,
    savedCount,
    skippedCount,
    scannedCount: data?.length ?? 0,
  };
}

export async function GET(request: Request) {
  const expectedToken = process.env.CRON_SECRET?.trim();
  if (!expectedToken) {
    return NextResponse.json(
      {
        ok: false,
        message: "CRON_SECRET 서버 환경변수가 설정되지 않았습니다.",
      },
      { status: 500 },
    );
  }

  if (getBearerToken(request) !== expectedToken) {
    return NextResponse.json(
      {
        ok: false,
        message: "인증이 필요합니다.",
      },
      { status: 401 },
    );
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      {
        ok: false,
        message: "Supabase admin 환경변수가 설정되지 않았습니다.",
      },
      { status: 500 },
    );
  }

  try {
    const result = await createDailyScheduleAssignmentBackups();
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "일정배정 일일 백업에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
