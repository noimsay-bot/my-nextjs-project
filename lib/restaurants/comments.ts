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

export async function updateRestaurantComment(editorId: string, commentId: string, input: RestaurantCommentCreateInput) {
  const validated = validateCommentContent(input);
  if (!validated.ok) {
    return validated;
  }

  try {
    const supabase = createClient();
    const { data: commentRow, error: commentError } = await supabase
      .from("restaurant_comments")
      .select("id, restaurant_id, author_id")
      .eq("id", commentId)
      .maybeSingle<{ id: string; restaurant_id: string; author_id: string }>();

    if (commentError) {
      return {
        ok: false as const,
        message: commentError.message,
      };
    }

    if (!commentRow) {
      return {
        ok: false as const,
        message: "수정할 코멘트를 찾지 못했습니다.",
      };
    }

    let canEdit = commentRow.author_id === editorId;
    if (!canEdit) {
      const { data: restaurantRow, error: restaurantError } = await supabase
        .from("restaurants")
        .select("author_id")
        .eq("id", commentRow.restaurant_id)
        .maybeSingle<{ author_id: string }>();

      if (restaurantError) {
        return {
          ok: false as const,
          message: restaurantError.message,
        };
      }

      canEdit = restaurantRow?.author_id === editorId;
    }

    if (!canEdit) {
      return {
        ok: false as const,
        message: "코멘트 작성자 또는 맛집 등록자만 수정할 수 있습니다.",
      };
    }

    const { error } = await supabase
      .from("restaurant_comments")
      .update({
        content: validated.content,
      })
      .eq("id", commentId);

    if (error) {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    return {
      ok: true as const,
      message: "코멘트를 수정했습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "코멘트 수정에 실패했습니다.",
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
