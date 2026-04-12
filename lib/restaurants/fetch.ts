import { createClient } from "@/lib/supabase/client";
import type { RestaurantCommentRow, RestaurantDetailData, RestaurantRow } from "@/lib/restaurants/types";

const RESTAURANT_COLUMNS_CANDIDATES = [
  "id, name, address, note, place_id, lat, lng, author_id, created_at",
  "id, name, address, note, lat, lng, author_id, created_at",
  "id, name, address, place_id, lat, lng, author_id, created_at",
  "id, name, address, lat, lng, author_id, created_at",
];

function mapRestaurantRow(item: Record<string, unknown>): RestaurantRow | null {
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.lat !== "number" ||
    typeof item.lng !== "number" ||
    typeof item.author_id !== "string" ||
    typeof item.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: item.id,
    name: item.name.trim(),
    address: typeof item.address === "string" && item.address.trim() ? item.address.trim() : null,
    note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : null,
    placeId: typeof item.place_id === "string" && item.place_id.trim() ? item.place_id.trim() : null,
    lat: item.lat,
    lng: item.lng,
    authorId: item.author_id,
    authorName: null,
    createdAt: item.created_at,
  };
}

async function fetchProfileNames(authorIds: string[]) {
  if (authorIds.length === 0) {
    return new Map<string, string>();
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", authorIds);

  if (error) {
    return new Map<string, string>();
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return new Map(
    rows.flatMap((item) => {
      if (typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim()) {
        return [];
      }
      return [[item.id, item.name.trim()] as const];
    }),
  );
}

export async function fetchRestaurants() {
  try {
    const supabase = createClient();
    let rawRows: Array<Record<string, unknown>> | null = null;
    let error: { message?: string } | null = null;

    for (const columns of RESTAURANT_COLUMNS_CANDIDATES) {
      const result = await supabase
        .from("restaurants")
        .select(columns)
        .order("created_at", { ascending: false });
      if (!result.error) {
        rawRows = (result.data ?? null) as unknown as Array<Record<string, unknown>> | null;
        error = null;
        break;
      }
      error = result.error;
    }

    if (error) {
      return {
        ok: false as const,
        message: error.message,
        restaurants: [] as RestaurantRow[],
      };
    }

    const restaurants: RestaurantRow[] = (rawRows ?? []).flatMap((item) => {
      const mapped = mapRestaurantRow(item);
      return mapped ? [mapped] : [];
    });
    const authorNames = await fetchProfileNames(Array.from(new Set(restaurants.map((restaurant) => restaurant.authorId))));

    return {
      ok: true as const,
      restaurants: restaurants.map((restaurant) => ({
        ...restaurant,
        authorName: authorNames.get(restaurant.authorId) ?? null,
      })),
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "맛집 데이터를 불러오지 못했습니다.",
      restaurants: [] as RestaurantRow[],
    };
  }
}

export async function fetchRestaurantDetail(restaurantId: string) {
  try {
    const supabase = createClient();
    let rawRow: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;

    for (const columns of RESTAURANT_COLUMNS_CANDIDATES) {
      const result = await supabase
        .from("restaurants")
        .select(columns)
        .eq("id", restaurantId)
        .maybeSingle();
      if (!result.error) {
        rawRow = (result.data ?? null) as unknown as Record<string, unknown> | null;
        error = null;
        break;
      }
      error = result.error;
    }

    if (error) {
      return {
        ok: false as const,
        message: error.message,
        detail: { restaurant: null, comments: [] } as RestaurantDetailData,
      };
    }

    if (!rawRow) {
      return {
        ok: true as const,
        detail: { restaurant: null, comments: [] } as RestaurantDetailData,
      };
    }

    const restaurant = mapRestaurantRow(rawRow);
    const authorNames = restaurant ? await fetchProfileNames([restaurant.authorId]) : new Map<string, string>();

    return {
      ok: true as const,
      detail: {
        restaurant: restaurant
          ? {
              ...restaurant,
              authorName: authorNames.get(restaurant.authorId) ?? null,
            }
          : null,
        comments: [],
      } satisfies RestaurantDetailData,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "맛집 상세 정보를 불러오지 못했습니다.",
      detail: { restaurant: null, comments: [] } as RestaurantDetailData,
    };
  }
}

export async function fetchRestaurantComments(restaurantId: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("restaurant_comments")
      .select("id, restaurant_id, author_id, content, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      return {
        ok: false as const,
        message: error.message,
        comments: [] as RestaurantCommentRow[],
      };
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const comments: RestaurantCommentRow[] = rows.flatMap((item) => {
      if (
        typeof item.id !== "string" ||
        typeof item.restaurant_id !== "string" ||
        typeof item.author_id !== "string" ||
        typeof item.content !== "string" ||
        typeof item.created_at !== "string"
      ) {
        return [];
      }

      return [
        {
          id: item.id,
          restaurantId: item.restaurant_id,
          authorId: item.author_id,
          authorName: null,
          content: item.content,
          createdAt: item.created_at,
        },
      ];
    });

    return {
      ok: true as const,
      comments,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "코멘트를 불러오지 못했습니다.",
      comments: [] as RestaurantCommentRow[],
    };
  }
}
