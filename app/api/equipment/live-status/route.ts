import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

const LIVE_STATUS_MANAGER_ROLES = new Set(["desk", "team_lead", "admin"]);

interface ProfileRow {
  id: string;
  name: string;
  role: string;
  approved: boolean;
}

interface LiveStatusPayloadEntry {
  equipmentItemId?: unknown;
  trs?: unknown;
  cameraReporter?: unknown;
  audioMan?: unknown;
  location?: unknown;
  note?: unknown;
}

interface NormalizedLiveStatusEntry {
  equipment_item_id: string;
  live_trs: string | null;
  live_camera_reporter: string | null;
  live_audio_man: string | null;
  live_location: string | null;
  live_note: string | null;
}

interface ActiveLiveLoanItemRow {
  loan_id: string;
  equipment_item_id: string;
  equipment_loans: {
    id: string;
    status: string;
  } | null;
}

interface EquipmentItemRow {
  id: string;
  is_active: boolean | null;
  metadata: unknown;
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeNullableText(value: unknown, maxLength: number) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function parseTrsValues(value: string | null) {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function normalizeEntry(entry: LiveStatusPayloadEntry): NormalizedLiveStatusEntry | null {
  const equipmentItemId = normalizeText(entry.equipmentItemId, 80);
  if (!equipmentItemId) return null;
  return {
    equipment_item_id: equipmentItemId,
    live_trs: normalizeNullableText(entry.trs, 120),
    live_camera_reporter: normalizeNullableText(entry.cameraReporter, 120),
    live_audio_man: normalizeNullableText(entry.audioMan, 120),
    live_location: normalizeNullableText(entry.location, 160),
    live_note: normalizeNullableText(entry.note, 240),
  };
}

function assertUniqueTrs(entries: NormalizedLiveStatusEntry[]) {
  const ownerByTrs = new Map<string, string>();

  entries.forEach((entry) => {
    parseTrsValues(entry.live_trs).forEach((trs) => {
      const existingOwner = ownerByTrs.get(trs);
      if (existingOwner && existingOwner !== entry.equipment_item_id) {
        throw new Error(`이미 다른 라이브장비에 입력된 TRS입니다: ${trs}`);
      }
      ownerByTrs.set(trs, entry.equipment_item_id);
    });
  });
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasLiveStatusContent(entry: NormalizedLiveStatusEntry) {
  return Boolean(
    entry.live_trs ||
      entry.live_camera_reporter ||
      entry.live_audio_man ||
      entry.live_location ||
      entry.live_note,
  );
}

function isBorrowableItem(row: EquipmentItemRow | undefined) {
  if (!row?.is_active) return false;
  const metadata = normalizeMetadata(row.metadata);
  return (
    metadata.is_under_repair !== true &&
    metadata.is_under_repair !== "true" &&
    metadata.borrowable !== false &&
    metadata.borrowable !== "false"
  );
}

async function requireLiveStatusManager() {
  if (!hasSupabaseAdminEnv()) {
    return {
      response: NextResponse.json(
        { message: "Supabase 관리자 환경변수가 없어 라이브장비 현황판을 저장할 수 없습니다." },
        { status: 500 },
      ),
      admin: null,
      profile: null,
    };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      response: NextResponse.json({ message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 }),
      admin: null,
      profile: null,
    };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, name, role, approved")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError || !profile || !profile.approved || !LIVE_STATUS_MANAGER_ROLES.has(profile.role)) {
    return {
      response: NextResponse.json({ message: "라이브장비 현황판 저장 권한이 없습니다." }, { status: 403 }),
      admin: null,
      profile: null,
    };
  }

  return { response: null, admin, profile };
}

export async function POST(request: Request) {
  try {
    const auth = await requireLiveStatusManager();
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as { entries?: unknown } | null;
    const entries = Array.isArray(body?.entries)
      ? body.entries
          .map((entry) => normalizeEntry((entry ?? {}) as LiveStatusPayloadEntry))
          .filter((entry): entry is NormalizedLiveStatusEntry => Boolean(entry))
      : [];

    if (entries.length === 0) {
      return NextResponse.json({ message: "저장할 라이브장비 현황이 없습니다." }, { status: 400 });
    }

    assertUniqueTrs(entries);

    const itemIds = entries.map((entry) => entry.equipment_item_id);
    const { data: itemRows, error: itemRowsError } = await auth.admin
      .from("equipment_items")
      .select("id, is_active, metadata")
      .in("id", itemIds)
      .returns<EquipmentItemRow[]>();

    if (itemRowsError) {
      throw new Error(itemRowsError.message);
    }

    const itemById = new Map((itemRows ?? []).map((row) => [row.id, row] as const));
    const { data: activeRows, error: activeRowsError } = await auth.admin
      .from("equipment_loan_items")
      .select(`
        loan_id,
        equipment_item_id,
        equipment_loans!inner (
          id,
          status
        )
      `)
      .in("equipment_item_id", itemIds)
      .eq("status", "borrowed")
      .eq("equipment_loans.status", "borrowed")
      .returns<ActiveLiveLoanItemRow[]>();

    if (activeRowsError) {
      throw new Error(activeRowsError.message);
    }

    const activeLoanByItemId = new Map(
      (activeRows ?? [])
        .filter((row) => row.equipment_loans?.status === "borrowed")
        .map((row) => [row.equipment_item_id, row.loan_id] as const),
    );

    const updatedLoanIds = new Set<string>();
    const returnedLoanIds = new Set<string>();
    const returnedItemIds = new Set<string>();
    for (const entry of entries) {
      const activeLoanId = activeLoanByItemId.get(entry.equipment_item_id);
      const shouldBeBorrowed = hasLiveStatusContent(entry);

      if (!shouldBeBorrowed) {
        if (!activeLoanId || returnedLoanIds.has(activeLoanId)) continue;

        const { data: returnedRows, error: returnError } = await auth.admin
          .from("equipment_loan_items")
          .update({
            status: "returned",
            returned_at: new Date().toISOString(),
          } as never)
          .eq("loan_id", activeLoanId)
          .eq("status", "borrowed")
          .select("equipment_item_id")
          .returns<Array<{ equipment_item_id: string }>>();

        if (returnError) {
          throw new Error(returnError.message);
        }

        (returnedRows ?? []).forEach((row) => returnedItemIds.add(row.equipment_item_id));

        const { error: loanReturnError } = await auth.admin
          .from("equipment_loans")
          .update({
            status: "returned",
            returned_at: new Date().toISOString(),
          } as never)
          .eq("id", activeLoanId);

        if (loanReturnError) {
          throw new Error(loanReturnError.message);
        }

        returnedLoanIds.add(activeLoanId);
        continue;
      }

      if (!activeLoanId) {
        if (!isBorrowableItem(itemById.get(entry.equipment_item_id))) {
          throw new Error("대여 처리할 수 없는 라이브장비가 포함되어 있습니다.");
        }

        const now = new Date().toISOString();
        const { data: loan, error: loanInsertError } = await auth.admin
          .from("equipment_loans")
          .insert({
            borrower_profile_id: auth.profile.id,
            borrowed_at: now,
            status: "borrowed",
            loan_type: "live",
            live_trs: entry.live_trs,
            live_camera_reporter: entry.live_camera_reporter,
            live_audio_man: entry.live_audio_man,
            live_location: entry.live_location,
            live_note: entry.live_note,
          } as never)
          .select("id")
          .single<{ id: string }>();

        if (loanInsertError || !loan?.id) {
          throw new Error(loanInsertError?.message ?? "라이브장비 대여 기록을 생성하지 못했습니다.");
        }

        const { error: loanItemInsertError } = await auth.admin
          .from("equipment_loan_items")
          .insert({
            loan_id: loan.id,
            equipment_item_id: entry.equipment_item_id,
            borrowed_at: now,
            status: "borrowed",
          } as never);

        if (loanItemInsertError) {
          await auth.admin.from("equipment_loans").delete().eq("id", loan.id);
          throw new Error(loanItemInsertError.message);
        }

        updatedLoanIds.add(loan.id);
        continue;
      }

      if (updatedLoanIds.has(activeLoanId)) continue;

      const { error: loanUpdateError } = await auth.admin
        .from("equipment_loans")
        .update({
          live_trs: entry.live_trs,
          live_camera_reporter: entry.live_camera_reporter,
          live_audio_man: entry.live_audio_man,
          live_location: entry.live_location,
          live_note: entry.live_note,
        } as never)
        .eq("id", activeLoanId)
        .eq("status", "borrowed");

      if (loanUpdateError) {
        throw new Error(loanUpdateError.message);
      }
      updatedLoanIds.add(activeLoanId);
    }

    const boardDeleteIds = Array.from(new Set([...itemIds, ...returnedItemIds]));
    const { error: boardError } = await auth.admin
      .from("live_equipment_status_board")
      .delete()
      .in("equipment_item_id", boardDeleteIds);

    if (boardError) {
      throw new Error(boardError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "라이브장비 현황판 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}
