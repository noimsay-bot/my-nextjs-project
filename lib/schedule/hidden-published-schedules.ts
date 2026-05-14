import { getPortalSupabaseClient, getSupabaseStorageErrorMessage, isSupabaseSchemaMissingError } from "@/lib/supabase/portal";

const HIDDEN_PUBLISHED_SCHEDULES_STATE_KEY = "hidden_published_schedules_v1";

interface PortalUserSettingRow {
  state: unknown;
}

function getHiddenPublishedScheduleStorageKey(sessionId?: string | null, username?: string | null) {
  const actorKey = sessionId?.trim() || username?.trim() || "anonymous";
  return `j-special-force-hidden-published-schedules:${actorKey}`;
}

function normalizeHiddenPublishedMonthKeys(monthKeys: unknown) {
  if (!Array.isArray(monthKeys)) return [] as string[];
  return Array.from(
    new Set(
      monthKeys
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => /^\d{4}-\d{2}$/.test(item)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function readStateMonthKeys(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  return normalizeHiddenPublishedMonthKeys((state as { monthKeys?: unknown }).monthKeys);
}

export function readLocalHiddenPublishedMonthKeys(sessionId?: string | null, username?: string | null) {
  if (typeof window === "undefined") return [] as string[];
  try {
    const raw = window.localStorage.getItem(getHiddenPublishedScheduleStorageKey(sessionId, username));
    if (!raw) return [];
    return normalizeHiddenPublishedMonthKeys(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalHiddenPublishedMonthKeys(
  monthKeys: string[],
  sessionId?: string | null,
  username?: string | null,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getHiddenPublishedScheduleStorageKey(sessionId, username),
    JSON.stringify(normalizeHiddenPublishedMonthKeys(monthKeys)),
  );
}

export async function saveHiddenPublishedMonthKeys(
  monthKeys: string[],
  sessionId?: string | null,
  username?: string | null,
) {
  const normalized = normalizeHiddenPublishedMonthKeys(monthKeys);
  writeLocalHiddenPublishedMonthKeys(normalized, sessionId, username);
  if (!sessionId) return normalized;

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("portal_user_settings").upsert(
    {
      profile_id: sessionId,
      key: HIDDEN_PUBLISHED_SCHEDULES_STATE_KEY,
      state: { monthKeys: normalized },
    },
    { onConflict: "profile_id,key" },
  );

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "portal_user_settings"));
  }

  return normalized;
}

export async function loadHiddenPublishedMonthKeys(sessionId?: string | null, username?: string | null) {
  const localMonthKeys = readLocalHiddenPublishedMonthKeys(sessionId, username);
  if (!sessionId) return localMonthKeys;

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("portal_user_settings")
    .select("state")
    .eq("profile_id", sessionId)
    .eq("key", HIDDEN_PUBLISHED_SCHEDULES_STATE_KEY)
    .maybeSingle<PortalUserSettingRow>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) return localMonthKeys;
    throw new Error(getSupabaseStorageErrorMessage(error, "portal_user_settings"));
  }

  if (!data && localMonthKeys.length > 0) {
    void saveHiddenPublishedMonthKeys(localMonthKeys, sessionId, username).catch(() => undefined);
    return localMonthKeys;
  }

  const remoteMonthKeys = readStateMonthKeys(data?.state);
  writeLocalHiddenPublishedMonthKeys(remoteMonthKeys, sessionId, username);
  return remoteMonthKeys;
}
