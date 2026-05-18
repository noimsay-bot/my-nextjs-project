import { getSession, type SessionUser } from "@/lib/auth/storage";
import { getKstDateKey, getMonthRangeFromMonthKey } from "@/lib/election/dates";
import type {
  ElectionEvent,
  ElectionPoint,
  ElectionPointInput,
  ElectionProfileOption,
  ElectionSaveInput,
  ElectionScheduleOverlay,
  ElectionStatus,
  ElectionTvuOverlay,
  ElectionWorkspace,
} from "@/lib/election/types";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
} from "@/lib/supabase/portal";

const ELECTION_SCHEMA_GUIDE = "Supabase SQL Editor에서 supabase/incremental_election_events.sql을 실행해 주세요.";

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
  lighting: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

interface ElectionProfileRow {
  id: string;
  name: string;
  role: string;
}

export function canManageElection(session: SessionUser | null | undefined) {
  return Boolean(
    session?.approved &&
    (session.actualRole === "desk" || session.actualRole === "team_lead" || session.actualRole === "admin"),
  );
}

function electionStorageError(error: unknown, objectLabel: string) {
  const message = getSupabaseStorageErrorMessage(error, objectLabel);
  if (message.includes("구조가 아직 적용되지 않았습니다")) {
    return `Supabase ${objectLabel} 구조가 아직 적용되지 않았습니다. ${ELECTION_SCHEMA_GUIDE}`;
  }
  return message;
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
    lighting: row.lighting ?? "",
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

function pointHasContent(point: ElectionPointInput) {
  return [
    point.region,
    point.place,
    point.poolVideo,
    isDefaultEquipmentNameOnly(point.equipmentName) ? "" : point.equipmentName,
    point.trs,
    point.cameraStaffName,
    point.cameraStaffNamePm,
    point.audioStaffName,
    point.audioStaffNamePm,
    point.reporterName,
    point.reporterNamePm,
    point.liveTime,
    point.liveTimePm,
    point.address,
    point.note,
    point.livePosition,
    point.lighting,
  ].some((value) => value.trim());
}

function normalizeNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function isDefaultEquipmentNameOnly(value: string) {
  return value.trim().toUpperCase() === "TVU-";
}

function normalizeEquipmentNameText(value: string) {
  return isDefaultEquipmentNameOnly(value) ? null : normalizeNullableText(value);
}

function normalizeNullableId(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function pointInputToRow(eventId: string, point: ElectionPointInput, index: number) {
  return {
    event_id: eventId,
    sort_order: index,
    region: normalizeNullableText(point.region),
    place: normalizeNullableText(point.place),
    pool_video: normalizeNullableText(point.poolVideo),
    equipment_name: normalizeEquipmentNameText(point.equipmentName),
    equipment_type: normalizeNullableText(point.equipmentType),
    trs: normalizeNullableText(point.trs),
    camera_staff_name: normalizeNullableText(point.cameraStaffName),
    camera_staff_user_id: normalizeNullableId(point.cameraStaffUserId),
    camera_staff_name_pm: normalizeNullableText(point.cameraStaffNamePm),
    camera_staff_user_id_pm: normalizeNullableId(point.cameraStaffUserIdPm),
    audio_staff_name: normalizeNullableText(point.audioStaffName),
    audio_staff_user_id: null,
    audio_staff_name_pm: normalizeNullableText(point.audioStaffNamePm),
    reporter_name: normalizeNullableText(point.reporterName),
    reporter_user_id: null,
    reporter_name_pm: normalizeNullableText(point.reporterNamePm),
    live_time: normalizeNullableText(point.liveTime),
    live_time_pm: normalizeNullableText(point.liveTimePm),
    address: normalizeNullableText(point.address),
    note: normalizeNullableText(point.note),
    live_position: normalizeNullableText(point.livePosition),
    lighting: normalizeNullableText(point.lighting),
    is_active: point.isActive !== false,
  };
}

async function fetchProfiles(): Promise<ElectionProfileOption[]> {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("approved", true)
    .in("role", ["member", "outlet", "admin", "desk"])
    .order("name", { ascending: true })
    .returns<ElectionProfileRow[]>();

  if (error) {
    throw new Error(electionStorageError(error, "profiles"));
  }

  return (data ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
  }));
}

async function fetchPoints(eventId: string) {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("election_points")
    .select(
      "id, event_id, sort_order, region, place, pool_video, equipment_name, equipment_type, trs, camera_staff_name, camera_staff_user_id, camera_staff_name_pm, camera_staff_user_id_pm, audio_staff_name, audio_staff_user_id, audio_staff_name_pm, reporter_name, reporter_user_id, reporter_name_pm, live_time, live_time_pm, address, note, live_position, lighting, is_active, created_at, updated_at",
    )
    .eq("event_id", eventId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<ElectionPointRow[]>();

  if (error) {
    throw new Error(electionStorageError(error, "election_points"));
  }

  return (data ?? []).map(rowToPoint);
}

async function fetchEventWithPoints(row: ElectionEventRow | null) {
  if (!row) return null;
  const points = await fetchPoints(row.id);
  return rowToEvent(row, points);
}

export async function fetchElectionWorkspace(): Promise<ElectionWorkspace> {
  const session = await getPortalSession();
  if (!session?.approved) {
    return { event: null, profiles: [], canManage: false };
  }

  const canManage = canManageElection(session);
  const supabase = await getPortalSupabaseClient();
  let query = supabase
    .from("election_events")
    .select("id, title, election_date, status, published_at, published_by, closed_at, closed_by, created_by, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  query = canManage ? query.in("status", ["draft", "published"]) : query.eq("status", "published");

  const { data, error } = await query.maybeSingle<ElectionEventRow>();
  if (error) {
    throw new Error(electionStorageError(error, "election_events"));
  }

  const [event, profiles] = await Promise.all([
    fetchEventWithPoints(data ?? null),
    canManage ? fetchProfiles() : Promise.resolve([]),
  ]);

  return { event, profiles, canManage };
}

export async function saveElectionWorkspace(input: ElectionSaveInput) {
  const session = await getPortalSession();
  if (!canManageElection(session)) {
    throw new Error("선거 중계표 저장 권한이 없습니다.");
  }

  const title = input.title.trim();
  const electionDate = input.electionDate.trim();
  if (!title) {
    throw new Error("선거명을 입력해 주세요.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(electionDate)) {
    throw new Error("선거일을 선택해 주세요.");
  }

  const supabase = await getPortalSupabaseClient();
  let eventId = input.id?.trim() || "";

  if (!eventId) {
    const { data, error } = await supabase
      .from("election_events")
      .insert({
        title,
        election_date: electionDate,
        status: "draft",
        created_by: session?.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (error) {
      throw new Error(electionStorageError(error, "election_events"));
    }
    eventId = data.id;
  } else {
    const { error } = await supabase
      .from("election_events")
      .update({
        title,
        election_date: electionDate,
      })
      .eq("id", eventId);

    if (error) {
      throw new Error(electionStorageError(error, "election_events"));
    }
  }

  const { error: deleteError } = await supabase
    .from("election_points")
    .delete()
    .eq("event_id", eventId);

  if (deleteError) {
    throw new Error(electionStorageError(deleteError, "election_points"));
  }

  const pointRows = input.points
    .filter(pointHasContent)
    .map((point, index) => pointInputToRow(eventId, point, index));

  if (pointRows.length > 0) {
    const { error: insertError } = await supabase.from("election_points").insert(pointRows);
    if (insertError) {
      throw new Error(electionStorageError(insertError, "election_points"));
    }
  }

  const workspace = await fetchElectionWorkspace();
  if (!workspace.event) {
    throw new Error("저장한 선거 중계표를 다시 불러오지 못했습니다.");
  }
  return workspace;
}

export async function publishElectionEvent(eventId: string) {
  const session = await getPortalSession();
  if (!canManageElection(session)) {
    throw new Error("선거 중계표 게시 권한이 없습니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("election_events")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: session?.id,
    })
    .eq("id", eventId);

  if (error) {
    throw new Error(electionStorageError(error, "election_events"));
  }

  return fetchElectionWorkspace();
}

export async function closeElectionEvent(eventId: string) {
  const session = await getPortalSession();
  if (!canManageElection(session)) {
    throw new Error("선거 중계표 게시종료 권한이 없습니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("election_events")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: session?.id,
    })
    .eq("id", eventId);

  if (error) {
    throw new Error(electionStorageError(error, "election_events"));
  }
}

export async function fetchTodayPublishedElection() {
  const session = await getPortalSession();
  if (!session?.approved) return null;

  const today = getKstDateKey();
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("election_events")
    .select("id, title, election_date, status, published_at, published_by, closed_at, closed_by, created_by, created_at, updated_at")
    .eq("status", "published")
    .eq("election_date", today)
    .limit(1)
    .maybeSingle<ElectionEventRow>();

  if (error) {
    throw new Error(electionStorageError(error, "election_events"));
  }

  return fetchEventWithPoints(data ?? null);
}

export function normalizeTvuEquipmentName(value: string | null | undefined) {
  const matched = /\bTVU\s*-?\s*(\d{1,3})\b/i.exec(value?.trim() ?? "");
  if (!matched) return "";
  return `TVU-${Number(matched[1])}`;
}

function joinUniqueTexts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  values.forEach((value) => {
    const trimmed = value?.trim() ?? "";
    if (trimmed) seen.add(trimmed);
  });
  return Array.from(seen).join(" / ");
}

export async function fetchTodayElectionTvuOverlays(): Promise<ElectionTvuOverlay[]> {
  const event = await fetchTodayPublishedElection();
  if (!event) return [];

  return event.points
    .map((point) => ({
      point,
      normalizedEquipmentName: normalizeTvuEquipmentName(point.equipmentName),
    }))
    .filter((item) => item.normalizedEquipmentName)
    .map(({ point, normalizedEquipmentName }) => ({
      eventId: event.id,
      eventTitle: event.title,
      electionDate: event.electionDate,
      pointId: point.id,
      sortOrder: point.sortOrder,
      equipmentName: point.equipmentName,
      normalizedEquipmentName,
      equipmentType: point.equipmentType,
      place: point.place,
      cameraStaffName: joinUniqueTexts([point.cameraStaffName, point.cameraStaffNamePm]),
    }));
}

export async function fetchElectionScheduleOverlays(monthKey: string): Promise<ElectionScheduleOverlay[]> {
  const session = getSession() ?? (await getPortalSession());
  if (!session?.approved) return [];

  const { startDate, endDate } = getMonthRangeFromMonthKey(monthKey);
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("election_events")
    .select("id, election_date")
    .eq("status", "published")
    .gte("election_date", startDate)
    .lte("election_date", endDate)
    .returns<Array<{ id: string; election_date: string }>>();

  if (error) {
    throw new Error(electionStorageError(error, "election_events"));
  }

  const events = data ?? [];
  if (events.length === 0) return [];

  const eventDateById = new Map(events.map((event) => [event.id, event.election_date] as const));
  const eventIds = events.map((event) => event.id);
  const { data: pointRows, error: pointError } = await supabase
    .from("election_points")
    .select("id, event_id, sort_order, place, camera_staff_name, camera_staff_user_id, camera_staff_name_pm, camera_staff_user_id_pm")
    .in("event_id", eventIds)
    .eq("is_active", true)
    .returns<
      Pick<
        ElectionPointRow,
        | "id"
        | "event_id"
        | "sort_order"
        | "place"
        | "camera_staff_name"
        | "camera_staff_user_id"
        | "camera_staff_name_pm"
        | "camera_staff_user_id_pm"
      >[]
    >();

  if (pointError) {
    throw new Error(electionStorageError(pointError, "election_points"));
  }

  const profileIds = Array.from(
    new Set(
      (pointRows ?? [])
        .flatMap((point) => [point.camera_staff_user_id, point.camera_staff_user_id_pm])
        .filter(Boolean) as string[],
    ),
  );
  const profileNameById = new Map<string, string>();

  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", profileIds)
      .returns<Array<{ id: string; name: string }>>();
    (profiles ?? []).forEach((profile) => profileNameById.set(profile.id, profile.name));
  }

  return (pointRows ?? [])
    .flatMap((point) => [
      {
        eventId: point.event_id,
        electionDate: eventDateById.get(point.event_id) ?? "",
        pointId: point.id,
        sortOrder: point.sort_order ?? 0,
        place: point.place?.trim() ?? "",
        cameraStaffName: point.camera_staff_name?.trim() ?? "",
        cameraStaffUserId: point.camera_staff_user_id,
        cameraStaffProfileName: point.camera_staff_user_id ? profileNameById.get(point.camera_staff_user_id)?.trim() ?? "" : "",
      },
      {
        eventId: point.event_id,
        electionDate: eventDateById.get(point.event_id) ?? "",
        pointId: point.id,
        sortOrder: point.sort_order ?? 0,
        place: point.place?.trim() ?? "",
        cameraStaffName: point.camera_staff_name_pm?.trim() ?? "",
        cameraStaffUserId: point.camera_staff_user_id_pm,
        cameraStaffProfileName: point.camera_staff_user_id_pm ? profileNameById.get(point.camera_staff_user_id_pm)?.trim() ?? "" : "",
      },
    ])
    .filter((overlay) => overlay.electionDate && overlay.place && (overlay.cameraStaffUserId || overlay.cameraStaffName))
    .sort((left, right) => left.electionDate.localeCompare(right.electionDate) || left.sortOrder - right.sortOrder);
}
