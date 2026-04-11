import { createClient } from "@/lib/supabase/client";
import type { RestaurantCommentCreateInput } from "@/lib/restaurants/types";

function validateCommentContent(input: RestaurantCommentCreateInput) {
  const content = input.content.trim();
  if (!content) {
    return {
      ok: false as const,
      message: "코멘트를 입력해 주세요.",
    };
  }
  if (content.length > 200) {
    return {
      ok: false as const,
      message: "코멘트는 200자 이내로 입력해 주세요.",
    };
  }
  return {
    ok: true as const,
    content,
  };
}

export async function createRestaurantComment(authorId: string, restaurantId: string, input: RestaurantCommentCreateInput) {
  const validated = validateCommentContent(input);
  if (!validated.ok) {
    return validated;
  }

  try {
    const supabase = createClient();
    const { error } = await supabase.from("restaurant_comments").insert({
      restaurant_id: restaurantId,
      author_id: authorId,
      content: validated.content,
    });

    if (error) {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    return {
      ok: true as const,
      message: "코멘트를 남겼습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "코멘트 저장에 실패했습니다.",
    };
  }
}

export async function deleteRestaurantComment(authorId: string, commentId: string) {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("restaurant_comments")
      .delete()
      .eq("id", commentId)
      .eq("author_id", authorId);

    if (error) {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    return {
      ok: true as const,
      message: "코멘트를 삭제했습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "코멘트 삭제에 실패했습니다.",
    };
  }
}
