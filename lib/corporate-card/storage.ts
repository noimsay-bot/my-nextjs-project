import { getSession } from "@/lib/auth/storage";
import { getPortalSupabaseClient, getSupabaseStorageErrorMessage } from "@/lib/supabase/portal";
import { buildCorporateCardMemo } from "@/lib/corporate-card/memo";
import type { ScheduleAssignmentItem } from "@/lib/corporate-card/schedule";

interface ScheduleAssignmentRpcRow {
  schedule_date: string;
  schedule_item_id: string;
  photographer_profile_id: string | null;
  photographer_name: string;
  schedule_content: string;
}

interface PartnerEntryRow {
  id: string;
  schedule_date: string;
  schedule_item_id: string;
  photographer_profile_id: string | null;
  photographer_name: string;
  schedule_content: string;
  audio_man_name: string | null;
  senior_name: string | null;
  partner_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerScheduleAssignment extends ScheduleAssignmentItem {
  audioManName: string;
  seniorName: string;
}

export interface MyScheduleAssignmentItem extends ScheduleAssignmentItem {
  audioManName: string;
  seniorName: string;
  generatedText: string;
  missingFields: string[];
}

function rowToAssignment(row: ScheduleAssignmentRpcRow): ScheduleAssignmentItem {
  return {
    scheduleDate: row.schedule_date,
    scheduleItemId: row.schedule_item_id,
    photographerProfileId: row.photographer_profile_id,
    photographerName: row.photographer_name,
    scheduleContent: row.schedule_content,
  };
}

function getSchemaMessage(error: unknown, objectLabel: string) {
  return getSupabaseStorageErrorMessage(error, objectLabel);
}

export async function fetchMyScheduleAssignments(monthKey: string) {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .rpc("get_my_schedule_assignment_items", { p_month_key: monthKey })
    .returns<ScheduleAssignmentRpcRow[]>();

  if (error) {
    throw new Error(getSchemaMessage(error, "내 일정"));
  }

  const rows = Array.isArray(data) ? (data as ScheduleAssignmentRpcRow[]) : [];
  return rows.map(rowToAssignment);
}

export async function fetchPartnerScheduleAssignments(dateKey: string) {
  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .rpc("get_partner_schedule_assignment_items", { p_schedule_date: dateKey })
    .returns<ScheduleAssignmentRpcRow[]>();

  if (error) {
    throw new Error(getSchemaMessage(error, "파트너 일정"));
  }

  const rows = Array.isArray(data) ? (data as ScheduleAssignmentRpcRow[]) : [];
  const assignments = rows.map(rowToAssignment);
  const ids = assignments.map((item) => item.scheduleItemId);
  if (ids.length === 0) {
    return [] as PartnerScheduleAssignment[];
  }

  const { data: entryRows, error: entryError } = await supabase
    .from("schedule_partner_entries")
    .select("id, schedule_date, schedule_item_id, photographer_profile_id, photographer_name, schedule_content, audio_man_name, senior_name, partner_profile_id, created_at, updated_at")
    .in("schedule_item_id", ids)
    .returns<PartnerEntryRow[]>();

  if (entryError) {
    throw new Error(getSchemaMessage(entryError, "schedule_partner_entries"));
  }

  const entryMap = new Map((entryRows ?? []).map((row) => [row.schedule_item_id, row] as const));
  return assignments.map((assignment) => {
    const entry = entryMap.get(assignment.scheduleItemId);
    return {
      ...assignment,
      audioManName: entry?.audio_man_name ?? "",
      seniorName: entry?.senior_name ?? "",
    };
  });
}

export async function savePartnerScheduleEntry(input: PartnerScheduleAssignment) {
  const session = getSession();
  if (!session?.approved || session.role !== "partner") {
    throw new Error("파트너 권한이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("schedule_partner_entries").upsert(
    {
      schedule_date: input.scheduleDate,
      schedule_item_id: input.scheduleItemId,
      photographer_profile_id: input.photographerProfileId,
      photographer_name: input.photographerName,
      schedule_content: input.scheduleContent,
      audio_man_name: input.audioManName.trim() || null,
      senior_name: input.seniorName.trim() || null,
      partner_profile_id: session.id,
    },
    { onConflict: "schedule_item_id" },
  );

  if (error) {
    throw new Error(getSchemaMessage(error, "schedule_partner_entries"));
  }
}

export async function fetchMyScheduleAssignmentsWithPartnerInfo(monthKey: string) {
  const session = getSession();
  if (!session?.approved) {
    return [] as MyScheduleAssignmentItem[];
  }

  const supabase = await getPortalSupabaseClient();
  const assignments = await fetchMyScheduleAssignments(monthKey);
  const ids = assignments.map((item) => item.scheduleItemId);
  if (ids.length === 0) {
    return [] as MyScheduleAssignmentItem[];
  }

  const { data: partnerRows, error: partnerError } = await supabase
    .from("schedule_partner_entries")
    .select("id, schedule_date, schedule_item_id, photographer_profile_id, photographer_name, schedule_content, audio_man_name, senior_name, partner_profile_id, created_at, updated_at")
    .in("schedule_item_id", ids)
    .returns<PartnerEntryRow[]>();

  if (partnerError) {
    throw new Error(getSchemaMessage(partnerError, "schedule_partner_entries"));
  }

  const partnerMap = new Map((partnerRows ?? []).map((row) => [row.schedule_item_id, row] as const));

  return assignments.map((assignment) => {
    const partner = partnerMap.get(assignment.scheduleItemId);
    const audioManName = partner?.audio_man_name?.trim() ?? "";
    const seniorName = partner?.senior_name?.trim() ?? "";
    const generatedText = buildCorporateCardMemo({
      date: assignment.scheduleDate,
      scheduleContent: assignment.scheduleContent,
      userName: session.username,
      audioManName,
      seniorName,
    });
    const missingFields = [
      audioManName ? "" : "오디오맨",
      seniorName ? "" : "형님",
    ].filter(Boolean);

    return {
      ...assignment,
      audioManName,
      seniorName,
      generatedText,
      missingFields,
    };
  });
}
