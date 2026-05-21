import { NextResponse } from "next/server";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { EquipmentCategory } from "@/lib/equipment/types";

const MANAGEABLE_CATEGORIES = new Set<EquipmentCategory>(["camera_lens", "light", "live"]);
const MANAGER_ROLES = new Set(["desk", "team_lead", "admin"]);

interface ProfileRow {
  id: string;
  name: string;
  role: string;
  approved: boolean;
}

interface EquipmentItemManagementRow {
  id: string;
  category: EquipmentCategory;
  group_name: string;
  name: string;
  is_active: boolean | null;
  metadata: unknown;
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeCategory(value: unknown): EquipmentCategory | null {
  if (typeof value !== "string") return null;
  if (!MANAGEABLE_CATEGORIES.has(value as EquipmentCategory)) return null;
  return value as EquipmentCategory;
}

function isProtectedLiveEquipment(row: Pick<EquipmentItemManagementRow, "category" | "group_name" | "metadata">) {
  if (row.category !== "live") return false;
  const metadata = normalizeMetadata(row.metadata);
  const groupName = row.group_name.trim().toUpperCase();
  return (
    groupName === "TVU" ||
    metadata.rental === true ||
    metadata.rental === "true" ||
    metadata.regional_transmission === true ||
    metadata.regional_transmission === "true"
  );
}

function createManagedCode(category: EquipmentCategory) {
  return `${category}-managed-${crypto.randomUUID()}`;
}

async function requireEquipmentManager() {
  if (!hasSupabaseAdminEnv()) {
    return {
      response: NextResponse.json(
        { message: "Supabase 관리자 환경변수가 없어 사이트 내 장비 관리를 처리할 수 없습니다." },
        { status: 500 },
      ),
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
      profile: null,
    };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, name, role, approved")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError || !profile || !profile.approved || !MANAGER_ROLES.has(profile.role)) {
    return {
      response: NextResponse.json({ message: "장비 관리 권한이 없습니다." }, { status: 403 }),
      profile: null,
    };
  }

  return { response: null, profile, admin };
}

export async function POST(request: Request) {
  try {
    const auth = await requireEquipmentManager();
    if (auth.response) return auth.response;

    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    const category = normalizeCategory(payload?.category);
    const groupName = normalizeText(payload?.groupName, 80);
    const name = normalizeText(payload?.name, 120);

    if (!category) {
      return NextResponse.json({ message: "추가할 장비 분류를 확인해 주세요." }, { status: 400 });
    }
    if (!groupName) {
      return NextResponse.json({ message: "장비 그룹을 입력해 주세요." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ message: "장비명을 입력해 주세요." }, { status: 400 });
    }
    if (category === "live" && groupName.trim().toUpperCase() === "TVU") {
      return NextResponse.json(
        { message: "TVU 장비는 기존 임대 TVU 관리 기능을 사용해 주세요." },
        { status: 400 },
      );
    }

    const { data: orderRows, error: orderError } = await auth.admin
      .from("equipment_items")
      .select("sort_order")
      .eq("category", category)
      .eq("group_name", groupName)
      .order("sort_order", { ascending: false })
      .limit(1)
      .returns<Array<{ sort_order: number | null }>>();

    if (orderError) {
      throw new Error(orderError.message);
    }

    const sortOrder = (orderRows?.[0]?.sort_order ?? 990) + 10;
    const now = new Date().toISOString();
    const payloadToInsert = {
      category,
      group_name: groupName,
      name,
      code: createManagedCode(category),
      sort_order: sortOrder,
      is_active: true,
      metadata: {
        managed_by_site: true,
        managed_created_by: auth.profile.id,
        managed_created_at: now,
      },
    };

    const { error } = await auth.admin
      .from("equipment_items")
      .insert(payloadToInsert as never);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "장비 추가에 실패했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireEquipmentManager();
    if (auth.response) return auth.response;

    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    const itemId = normalizeText(payload?.itemId, 80);
    const isActive = typeof payload?.isActive === "boolean" ? payload.isActive : null;

    if (!itemId) {
      return NextResponse.json({ message: "변경할 장비를 선택해 주세요." }, { status: 400 });
    }
    if (isActive === null) {
      return NextResponse.json({ message: "장비 활성화 상태를 확인해 주세요." }, { status: 400 });
    }

    const { data: item, error: itemError } = await auth.admin
      .from("equipment_items")
      .select("id, category, group_name, name, is_active, metadata")
      .eq("id", itemId)
      .maybeSingle<EquipmentItemManagementRow>();

    if (itemError) {
      throw new Error(itemError.message);
    }
    if (!item || !MANAGEABLE_CATEGORIES.has(item.category)) {
      return NextResponse.json({ message: "관리 가능한 장비를 찾지 못했습니다." }, { status: 404 });
    }
    if (isProtectedLiveEquipment(item)) {
      return NextResponse.json(
        { message: "TVU/지역 전송 장비는 이 관리 패널에서 비활성화할 수 없습니다." },
        { status: 400 },
      );
    }

    if (!isActive) {
      const { data: activeLoanRows, error: activeLoanError } = await auth.admin
        .from("equipment_loan_items")
        .select("id")
        .eq("equipment_item_id", itemId)
        .eq("status", "borrowed")
        .limit(1)
        .returns<Array<{ id: string }>>();

      if (activeLoanError) {
        throw new Error(activeLoanError.message);
      }
      if ((activeLoanRows ?? []).length > 0) {
        return NextResponse.json({ message: "대여중인 장비는 비활성화할 수 없습니다." }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const currentMetadata = normalizeMetadata(item.metadata);
    const nextMetadata = {
      ...currentMetadata,
      managed_by_site: currentMetadata.managed_by_site ?? true,
      managed_updated_by: auth.profile.id,
      managed_updated_at: now,
      managed_active_action: isActive ? "activated" : "deactivated",
    };

    const { error } = await auth.admin
      .from("equipment_items")
      .update({
        is_active: isActive,
        metadata: nextMetadata,
      } as never)
      .eq("id", itemId);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "장비 상태 변경에 실패했습니다." },
      { status: 500 },
    );
  }
}
