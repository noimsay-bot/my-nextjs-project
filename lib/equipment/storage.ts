import { getSession, hasAdminAccess, isReadOnlyPortalRole } from "@/lib/auth/storage";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
} from "@/lib/supabase/portal";
import type {
  EquipmentCategory,
  EquipmentItem,
  EquipmentLoan,
  EquipmentLoanItem,
  EquipmentLoanStatus,
  EquipmentLoanType,
  EquipmentProfile,
  LiveLoanDetails,
} from "@/lib/equipment/types";

const EQUIPMENT_SCHEMA_GUIDE =
  "Supabase SQL Editor에서 supabase/incremental_equipment_loans.sql을 실행해 주세요.";

interface EquipmentItemRow {
  id: string;
  category: EquipmentCategory;
  group_name: string;
  name: string;
  code: string;
  sort_order: number | null;
  is_active: boolean | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

interface EquipmentLoanRow {
  id: string;
  borrower_profile_id: string;
  borrowed_at: string;
  returned_at: string | null;
  status: EquipmentLoanStatus;
  loan_type: EquipmentLoanType;
  live_trs: string | null;
  live_camera_reporter: string | null;
  live_audio_man: string | null;
  live_location: string | null;
  live_note: string | null;
  created_at: string;
  updated_at: string;
}

interface EquipmentLoanItemRow {
  id: string;
  loan_id: string;
  equipment_item_id: string;
  borrowed_at: string;
  returned_at: string | null;
  status: EquipmentLoanStatus;
  equipment_items: EquipmentItemRow | null;
  equipment_loans: EquipmentLoanRow | null;
}

interface ProfileNameRow {
  id: string;
  name: string;
}

interface EquipmentProfileRow {
  id: string;
  name: string;
  role: string;
  approved: boolean;
}

export interface EquipmentLoanItemQuery {
  categories?: EquipmentCategory[];
  status?: EquipmentLoanStatus;
  dateKey?: string;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function rowToItem(row: EquipmentItemRow): EquipmentItem {
  return {
    id: row.id,
    category: row.category,
    groupName: row.group_name,
    name: row.name,
    code: row.code,
    sortOrder: row.sort_order ?? 0,
    isActive: row.is_active ?? true,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLoan(row: EquipmentLoanRow, borrowerName: string): EquipmentLoan {
  return {
    id: row.id,
    borrowerProfileId: row.borrower_profile_id,
    borrowerName,
    borrowedAt: row.borrowed_at,
    returnedAt: row.returned_at,
    status: row.status,
    loanType: row.loan_type,
    liveTrs: row.live_trs,
    liveCameraReporter: row.live_camera_reporter,
    liveAudioMan: row.live_audio_man,
    liveLocation: row.live_location,
    liveNote: row.live_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDateRange(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = new Date(year, (month ?? 1) - 1, day ?? 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function getEquipmentStorageErrorMessage(error: unknown, objectLabel: string) {
  const message = getSupabaseStorageErrorMessage(error, objectLabel);
  if (message.includes("구조가 아직 적용되지 않았습니다")) {
    return `Supabase ${objectLabel} 구조가 아직 적용되지 않았습니다. ${EQUIPMENT_SCHEMA_GUIDE}`;
  }
  return message;
}

async function fetchBorrowerNames(profileIds: string[]) {
  const uniqueIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, string>();
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", uniqueIds)
    .returns<ProfileNameRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  return new Map((data ?? []).map((row) => [row.id, row.name] as const));
}

export async function fetchEquipmentItems(categories?: EquipmentCategory[]) {
  const session = await getPortalSession();
  if (!session?.approved) {
    return [];
  }

  const supabase = await getPortalSupabaseClient();
  let query = supabase
    .from("equipment_items")
    .select("id, category, group_name, name, code, sort_order, is_active, metadata, created_at, updated_at")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (categories?.length) {
    query = query.in("category", categories);
  }

  const { data, error } = await query.returns<EquipmentItemRow[]>();
  if (error) {
    throw new Error(getEquipmentStorageErrorMessage(error, "equipment_items"));
  }

  return (data ?? []).map(rowToItem);
}

export async function fetchEquipmentProfiles() {
  const session = await getPortalSession();
  if (!session?.approved) {
    return [];
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, approved")
    .eq("approved", true)
    .order("name", { ascending: true })
    .returns<EquipmentProfileRow[]>();

  if (error) {
    throw new Error(getEquipmentStorageErrorMessage(error, "profiles"));
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    approved: row.approved,
  })) satisfies EquipmentProfile[];
}

export async function fetchEquipmentLoanItems(options: EquipmentLoanItemQuery = {}) {
  const session = await getPortalSession();
  if (!session?.approved) {
    return [];
  }

  const supabase = await getPortalSupabaseClient();
  let query = supabase
    .from("equipment_loan_items")
    .select(`
      id,
      loan_id,
      equipment_item_id,
      borrowed_at,
      returned_at,
      status,
      equipment_items!inner (
        id,
        category,
        group_name,
        name,
        code,
        sort_order,
        is_active,
        metadata,
        created_at,
        updated_at
      ),
      equipment_loans!inner (
        id,
        borrower_profile_id,
        borrowed_at,
        returned_at,
        status,
        loan_type,
        live_trs,
        live_camera_reporter,
        live_audio_man,
        live_location,
        live_note,
        created_at,
        updated_at
      )
    `)
    .order("borrowed_at", { ascending: false });

  if (options.categories?.length) {
    query = query.in("equipment_items.category", options.categories);
  }

  if (options.status) {
    query = query.eq("status", options.status);
  }

  if (options.dateKey) {
    const { startIso, endIso } = getDateRange(options.dateKey);
    query = query.gte("borrowed_at", startIso).lt("borrowed_at", endIso);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(getEquipmentStorageErrorMessage(error, "equipment_loan_items"));
  }

  const rows = (data ?? []) as unknown as EquipmentLoanItemRow[];
  const borrowerNames = await fetchBorrowerNames(
    rows
      .map((row) => row.equipment_loans?.borrower_profile_id ?? "")
      .filter(Boolean),
  );

  return rows.flatMap((row): EquipmentLoanItem[] => {
    if (!row.equipment_items || !row.equipment_loans) {
      return [];
    }

    const borrowerName = borrowerNames.get(row.equipment_loans.borrower_profile_id) ?? "사용자";
    return [
      {
        id: row.id,
        loanId: row.loan_id,
        equipmentItemId: row.equipment_item_id,
        borrowedAt: row.borrowed_at,
        returnedAt: row.returned_at,
        status: row.status,
        item: rowToItem(row.equipment_items),
        loan: rowToLoan(row.equipment_loans, borrowerName),
      },
    ];
  });
}

function assertCanMutate() {
  const session = getSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  if (isReadOnlyPortalRole(session.role)) {
    throw new Error("읽기 전용 계정은 장비 대여/반납을 할 수 없습니다.");
  }
  return session;
}

export function canReturnLoanItem(loanItem: EquipmentLoanItem) {
  const session = getSession();
  if (!session?.approved) return false;
  return loanItem.loan.borrowerProfileId === session.id || hasAdminAccess(session.role);
}

export async function borrowEquipmentItems(
  itemIds: string[],
  options: {
    loanType?: EquipmentLoanType;
    liveDetails?: LiveLoanDetails;
  } = {},
) {
  assertCanMutate();
  const normalizedIds = Array.from(new Set(itemIds.map((item) => item.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    throw new Error("대여할 장비를 선택해 주세요.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.rpc("borrow_equipment_items", {
    p_equipment_item_ids: normalizedIds,
    p_loan_type: options.loanType ?? "normal",
    p_live_trs: options.liveDetails?.trs?.trim() || null,
    p_live_camera_reporter: options.liveDetails?.cameraReporter?.trim() || null,
    p_live_audio_man: options.liveDetails?.audioMan?.trim() || null,
    p_live_location: options.liveDetails?.location?.trim() || null,
    p_live_note: options.liveDetails?.note?.trim() || null,
  });

  if (error) {
    throw new Error(getEquipmentStorageErrorMessage(error, "equipment loan"));
  }
}

export async function borrowEngSets(profileIds: string[]) {
  assertCanMutate();
  const normalizedIds = Array.from(new Set(profileIds.map((item) => item.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    throw new Error("대여할 ENG SET을 선택해 주세요.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.rpc("borrow_eng_sets", {
    p_target_profile_ids: normalizedIds,
  });

  if (error) {
    throw new Error(getEquipmentStorageErrorMessage(error, "ENG SET loan"));
  }
}

export async function returnEquipmentLoanItems(loanItemIds: string[]) {
  assertCanMutate();
  const normalizedIds = Array.from(new Set(loanItemIds.map((item) => item.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    throw new Error("반납할 장비를 선택해 주세요.");
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase.rpc("return_equipment_loan_items", {
    p_loan_item_ids: normalizedIds,
  });

  if (error) {
    throw new Error(getEquipmentStorageErrorMessage(error, "equipment return"));
  }

  const returnedCount = typeof data === "number" ? data : 0;
  if (returnedCount === 0) {
    throw new Error("반납 가능한 장비가 없습니다.");
  }
}
