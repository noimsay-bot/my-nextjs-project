import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { ElectionCellColors, ElectionEvent, ElectionPoint, ElectionStatus } from "@/lib/election/types";

export const dynamic = "force-dynamic";

interface ElectionEventRow {
  id: string;
  title: string;
  election_date: string;
  status: ElectionStatus;
  published_at: string | null;
  published_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ElectionPointRow {
  id: string;
  event_id: string;
  sort_order: number | null;
  region: string | null;
  place: string | null;
  pool_video: string | null;
  equipment_name: string | null;
  equipment_type: string | null;
  trs: string | null;
  camera_staff_name: string | null;
  camera_staff_user_id: string | null;
  camera_staff_name_pm: string | null;
  camera_staff_user_id_pm: string | null;
  audio_staff_name: string | null;
  audio_staff_user_id: string | null;
  audio_staff_name_pm: string | null;
  reporter_name: string | null;
  reporter_user_id: string | null;
  reporter_name_pm: string | null;
  live_time: string | null;
  live_time_pm: string | null;
  address: string | null;
  note: string | null;
  live_position: string | null;
  lan: string | null;
  lighting: string | null;
  region_color: string | null;
  cell_colors: Record<string, unknown> | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

function normalizeCellColors(value: unknown): ElectionCellColors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, color]) => typeof color === "string" && color.trim()),
  ) as ElectionCellColors;
}

function rowToPoint(row: ElectionPointRow): ElectionPoint {
  return {
    id: row.id,
    eventId: row.event_id,
    sortOrder: row.sort_order ?? 0,
    region: row.region ?? "",
    place: row.place ?? "",
    poolVideo: row.pool_video ?? "",
    equipmentName: row.equipment_name ?? "",
    equipmentType: row.equipment_type ?? "",
    trs: row.trs ?? "",
    cameraStaffName: row.camera_staff_name ?? "",
    cameraStaffUserId: row.camera_staff_user_id,
    cameraStaffNamePm: row.camera_staff_name_pm ?? "",
    cameraStaffUserIdPm: row.camera_staff_user_id_pm,
    audioStaffName: row.audio_staff_name ?? "",
    audioStaffUserId: row.audio_staff_user_id,
    audioStaffNamePm: row.audio_staff_name_pm ?? "",
    reporterName: row.reporter_name ?? "",
    reporterUserId: row.reporter_user_id,
    reporterNamePm: row.reporter_name_pm ?? "",
    liveTime: row.live_time ?? "",
    liveTimePm: row.live_time_pm ?? "",
    address: row.address ?? "",
    note: row.note ?? "",
    livePosition: row.live_position ?? "",
    lan: row.lan ?? "",
    lighting: row.lighting ?? "",
    regionColor: row.region_color ?? "",
    cellColors: normalizeCellColors(row.cell_colors),
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: ElectionEventRow, points: ElectionPoint[]): ElectionEvent {
  return {
    id: row.id,
    title: row.title,
    electionDate: row.election_date,
    status: row.status,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    points,
  };
}

export async function GET() {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ event: null, error: "public_election_unavailable" }, { status: 503 });
  }

  const supabase = createAdminClient();
  const { data: eventRow, error: eventError } = await supabase
    .from("election_events")
    .select("id, title, election_date, status, published_at, published_by, closed_at, closed_by, created_by, created_at, updated_at")
    .eq("status", "published")
    .order("election_date", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<ElectionEventRow>();

  if (eventError) {
    return NextResponse.json({ event: null, error: "public_election_fetch_failed" }, { status: 500 });
  }

  if (!eventRow) {
    return NextResponse.json({ event: null });
  }

  const { data: pointRows, error: pointError } = await supabase
    .from("election_points")
    .select("*")
    .eq("event_id", eventRow.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<ElectionPointRow[]>();

  if (pointError) {
    return NextResponse.json({ event: null, error: "public_election_points_fetch_failed" }, { status: 500 });
  }

  return NextResponse.json({
    event: rowToEvent(eventRow, (pointRows ?? []).map(rowToPoint)),
  });
}
