import { getPortalSupabaseClient, getSupabaseStorageErrorMessage, isSupabaseSchemaMissingError } from "@/lib/supabase/portal";

export type MyWorkCalendarCustomTextMap = Record<string, string[]>;

const MY_WORK_CALENDAR_CUSTOM_TEXTS_STATE_KEY = "my_work_calendar_custom_texts_v1";
const MY_WORK_CALENDAR_CUSTOM_TEXTS_STORAGE_PREFIX = "jtbc-my-work-calendar-custom-text-v1";
const MAX_CUSTOM_TEXTS_PER_DAY = 5;

interface PortalUserSettingRow {
  state: unknown;
}

function getCustomTextStorageKey(sessionId?: string | null, username?: string | null) {
  const actorKey = sessionId?.trim() || username?.trim() || "anonymous";
  return `${MY_WORK_CALENDAR_CUSTOM_TEXTS_STORAGE_PREFIX}:${actorKey}`;
}

function normalizeCustomTextList(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_TEXTS_PER_DAY);
}

function normalizeCustomTextMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as MyWorkCalendarCustomTextMap;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([dateKey, values]) => [dateKey, normalizeCustomTextList(values)] as const)
      .filter(([dateKey, values]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && values.length > 0),
  ) as MyWorkCalendarCustomTextMap;
}

function readStateCustomTexts(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return {} as MyWorkCalendarCustomTextMap;
  }

  const stateRecord = state as { customTexts?: unknown; texts?: unknown };
  return normalizeCustomTextMap(stateRecord.customTexts ?? stateRecord.texts);
}

function hasCustomTexts(texts: MyWorkCalendarCustomTextMap) {
  return Object.values(texts).some((values) => values.length > 0);
}

export function readLocalMyWorkCalendarCustomTexts(sessionId?: string | null, username?: string | null) {
  if (typeof window === "undefined") return {} as MyWorkCalendarCustomTextMap;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getCustomTextStorageKey(sessionId, username)) ?? "{}");
    return normalizeCustomTextMap(parsed);
  } catch {
    return {};
  }
}

export function writeLocalMyWorkCalendarCustomTexts(
  texts: MyWorkCalendarCustomTextMap,
  sessionId?: string | null,
  username?: string | null,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getCustomTextStorageKey(sessionId, username),
    JSON.stringify(normalizeCustomTextMap(texts)),
  );
}

export async function saveMyWorkCalendarCustomTexts(
  texts: MyWorkCalendarCustomTextMap,
  sessionId?: string | null,
  username?: string | null,
) {
  const normalized = normalizeCustomTextMap(texts);
  writeLocalMyWorkCalendarCustomTexts(normalized, sessionId, username);
  if (!sessionId) return normalized;

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("portal_user_settings").upsert(
    {
      profile_id: sessionId,
      key: MY_WORK_CALENDAR_CUSTOM_TEXTS_STATE_KEY,
      state: { customTexts: normalized },
    },
    { onConflict: "profile_id,key" },
  );

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "portal_user_settings"));
  }

  return normalized;
}

export async function loadMyWorkCalendarCustomTexts(sessionId?: string | null, username?: string | null) {
  const localTexts = readLocalMyWorkCalendarCustomTexts(sessionId, username);
  if (!sessionId) return localTexts;

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("portal_user_settings")
    .select("state")
    .eq("profile_id", sessionId)
    .eq("key", MY_WORK_CALENDAR_CUSTOM_TEXTS_STATE_KEY)
    .maybeSingle<PortalUserSettingRow>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) return localTexts;
    throw new Error(getSupabaseStorageErrorMessage(error, "portal_user_settings"));
  }

  if (!data && hasCustomTexts(localTexts)) {
    void saveMyWorkCalendarCustomTexts(localTexts, sessionId, username).catch(() => undefined);
    return localTexts;
  }

  const remoteTexts = readStateCustomTexts(data?.state);
  writeLocalMyWorkCalendarCustomTexts(remoteTexts, sessionId, username);
  return remoteTexts;
}
