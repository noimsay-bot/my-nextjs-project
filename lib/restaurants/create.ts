import { createClient } from "@/lib/supabase/client";
import { getSessionAsync, isReadOnlyPortalRole } from "@/lib/auth/storage";
import type { RestaurantCreateInput } from "@/lib/restaurants/types";

function parseCoordinate(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateRestaurantInput(input: RestaurantCreateInput) {
  const name = input.name.trim();
  if (!name) {
    return {
      ok: false as const,
      message: "가게명을 입력해 주세요.",
    };
  }

  const lat = parseCoordinate(input.lat);
  if (lat === null || lat < -90 || lat > 90) {
    return {
      ok: false as const,
      message: "위도는 숫자로 입력해 주세요.",
    };
  }

  const lng = parseCoordinate(input.lng);
  if (lng === null || lng < -180 || lng > 180) {
    return {
      ok: false as const,
      message: "경도는 숫자로 입력해 주세요.",
    };
  }

  const note = input.note.trim();
  if (note.length > 100) {
    return {
      ok: false as const,
      message: "한줄 코멘트는 100자 이내로 입력해 주세요.",
    };
  }

  return {
    ok: true as const,
    payload: {
      name,
      address: input.address.trim(),
      note,
      placeId: input.placeId.trim(),
      lat,
      lng,
    },
  };
}

export async function createRestaurant(authorId: string, input: RestaurantCreateInput) {
  const validated = validateRestaurantInput(input);
  if (!validated.ok) {
    return validated;
  }

  const session = await getSessionAsync();
  if (!session?.approved || session.id !== authorId.trim()) {
    return {
      ok: false as const,
      message: "로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.",
    };
  }

  if (isReadOnlyPortalRole(session.role)) {
    return {
      ok: false as const,
      message: "Advisor와 Observer 등급은 맛집을 등록할 수 없습니다.",
    };
  }

  if (!authorId.trim()) {
    return {
      ok: false as const,
      message: "로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.",
    };
  }

  try {
    const supabase = createClient();
    if (validated.payload.placeId) {
      const duplicateResult = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("place_id", validated.payload.placeId)
        .limit(1);

      if (!duplicateResult.error && (duplicateResult.data?.length ?? 0) > 0) {
        return {
          ok: false as const,
          message: "이미 등록된 음식점입니다.",
        };
      }
    }

    const insertPayloads = [
      {
        name: validated.payload.name,
        address: validated.payload.address || null,
        note: validated.payload.note || null,
        place_id: validated.payload.placeId || null,
        lat: validated.payload.lat,
        lng: validated.payload.lng,
        author_id: authorId,
      },
      {
        name: validated.payload.name,
        address: validated.payload.address || null,
        note: validated.payload.note || null,
        lat: validated.payload.lat,
        lng: validated.payload.lng,
        author_id: authorId,
      },
      {
        name: validated.payload.name,
        address: validated.payload.address || null,
        place_id: validated.payload.placeId || null,
        lat: validated.payload.lat,
        lng: validated.payload.lng,
        author_id: authorId,
      },
      {
        name: validated.payload.name,
        address: validated.payload.address || null,
        lat: validated.payload.lat,
        lng: validated.payload.lng,
        author_id: authorId,
      },
    ];

    let error: { message?: string } | null = null;
    for (const payload of insertPayloads) {
      const result = await supabase.from("restaurants").insert(payload);
      if (!result.error) {
        error = null;
        break;
      }
      error = result.error;
    }

    if (error) {
      return {
        ok: false as const,
        message: error.message ?? "맛집 저장에 실패했습니다.",
      };
    }

    return {
      ok: true as const,
      message: "맛집을 등록했습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "맛집 저장에 실패했습니다.",
    };
  }
}
