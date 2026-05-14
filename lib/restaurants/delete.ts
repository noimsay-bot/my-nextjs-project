import { getSessionAsync, isReadOnlyPortalRole } from "@/lib/auth/storage";
import { createClient } from "@/lib/supabase/client";

export async function deleteRestaurant(authorId: string, restaurantId: string) {
  try {
    const session = await getSessionAsync();
    if (!session?.approved || session.id !== authorId) {
      return {
        ok: false as const,
        message: "로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.",
      };
    }

    if (isReadOnlyPortalRole(session.role)) {
      return {
        ok: false as const,
        message: "Observer 등급은 맛집을 삭제할 수 없습니다.",
      };
    }

    if (!restaurantId.trim()) {
      return {
        ok: false as const,
        message: "삭제할 맛집을 찾지 못했습니다.",
      };
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("restaurants")
      .delete()
      .eq("id", restaurantId)
      .eq("author_id", authorId)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    if (!data) {
      return {
        ok: false as const,
        message: "본인이 등록한 맛집만 삭제할 수 있습니다.",
      };
    }

    return {
      ok: true as const,
      message: "맛집을 삭제했습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "맛집 삭제에 실패했습니다.",
    };
  }
}
