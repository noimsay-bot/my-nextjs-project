import { getPortalSupabaseClient, getSupabaseStorageErrorMessage, isSupabaseSchemaMissingError } from "@/lib/supabase/portal";
import type { EquipmentCategory } from "@/lib/equipment/types";

export type EquipmentBorrowSelection =
  | {
      kind: "item";
      id: string;
      category: EquipmentCategory;
      label: string;
      isTvu: boolean;
    }
  | {
      kind: "eng_profile";
      id: string;
      category: "eng_set";
      label: string;
      isTvu: false;
    };

const EQUIPMENT_BORROW_SELECTIONS_STATE_KEY = "equipment_borrow_selections_v1";
const LEGACY_EQUIPMENT_BORROW_SELECTION_STORAGE_PREFIX = "jtbc-equipment-borrow-selection-v1";
export const EQUIPMENT_BORROW_SELECTION_EVENT = "jtbc-equipment-borrow-selection-change";
const EQUIPMENT_BORROW_SELECTION_CATEGORIES = new Set<EquipmentCategory>(["camera_lens", "light", "eng_set", "live"]);

interface PortalUserSettingRow {
  state: unknown;
}

function getLegacyBorrowSelectionStorageKey(profileId: string | null | undefined) {
  return `${LEGACY_EQUIPMENT_BORROW_SELECTION_STORAGE_PREFIX}:${profileId || "anonymous"}`;
}

export function getEquipmentBorrowSelectionKey(selection: Pick<EquipmentBorrowSelection, "kind" | "id">) {
  return `${selection.kind}:${selection.id}`;
}

export function normalizeEquipmentBorrowSelections(value: unknown): EquipmentBorrowSelection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const selections: EquipmentBorrowSelection[] = [];

  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const item = entry as Partial<EquipmentBorrowSelection>;
    if (typeof item.id !== "string" || !item.id.trim()) return;
    if (typeof item.label !== "string" || !item.label.trim()) return;
    if (item.kind === "item" && typeof item.category === "string") {
      if (!EQUIPMENT_BORROW_SELECTION_CATEGORIES.has(item.category as EquipmentCategory)) return;
      const selection: EquipmentBorrowSelection = {
        kind: "item",
        id: item.id,
        category: item.category as EquipmentCategory,
        label: item.label,
        isTvu: Boolean(item.isTvu),
      };
      const key = getEquipmentBorrowSelectionKey(selection);
      if (seen.has(key)) return;
      seen.add(key);
      selections.push(selection);
      return;
    }
    if (item.kind === "eng_profile" && item.category === "eng_set") {
      const selection: EquipmentBorrowSelection = {
        kind: "eng_profile",
        id: item.id,
        category: "eng_set",
        label: item.label,
        isTvu: false,
      };
      const key = getEquipmentBorrowSelectionKey(selection);
      if (seen.has(key)) return;
      seen.add(key);
      selections.push(selection);
    }
  });

  return selections;
}

function readStateBorrowSelections(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [] as EquipmentBorrowSelection[];
  return normalizeEquipmentBorrowSelections((state as { selections?: unknown }).selections);
}

function readLegacyEquipmentBorrowSelections(profileId: string | null | undefined) {
  if (typeof window === "undefined") return [] as EquipmentBorrowSelection[];
  try {
    const raw = window.localStorage.getItem(getLegacyBorrowSelectionStorageKey(profileId));
    return normalizeEquipmentBorrowSelections(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function clearLegacyEquipmentBorrowSelections(profileId: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getLegacyBorrowSelectionStorageKey(profileId));
  } catch {
    // Legacy cleanup is best-effort.
  }
}

function mergeEquipmentBorrowSelections(
  legacySelections: EquipmentBorrowSelection[],
  remoteSelections: EquipmentBorrowSelection[],
) {
  return normalizeEquipmentBorrowSelections([...remoteSelections, ...legacySelections]);
}

function borrowSelectionsEqual(left: EquipmentBorrowSelection[], right: EquipmentBorrowSelection[]) {
  return JSON.stringify(normalizeEquipmentBorrowSelections(left)) === JSON.stringify(normalizeEquipmentBorrowSelections(right));
}

function emitBorrowSelectionEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EQUIPMENT_BORROW_SELECTION_EVENT));
}

export async function saveEquipmentBorrowSelections(
  profileId: string | null | undefined,
  selections: EquipmentBorrowSelection[],
) {
  const normalized = normalizeEquipmentBorrowSelections(selections);
  if (!profileId) {
    emitBorrowSelectionEvent();
    return normalized;
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("portal_user_settings").upsert(
    {
      profile_id: profileId,
      key: EQUIPMENT_BORROW_SELECTIONS_STATE_KEY,
      state: { selections: normalized },
    },
    { onConflict: "profile_id,key" },
  );

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "portal_user_settings"));
  }

  emitBorrowSelectionEvent();
  return normalized;
}

export async function loadEquipmentBorrowSelections(profileId: string | null | undefined) {
  const legacySelections = readLegacyEquipmentBorrowSelections(profileId);
  if (!profileId) return legacySelections;

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("portal_user_settings")
    .select("state")
    .eq("profile_id", profileId)
    .eq("key", EQUIPMENT_BORROW_SELECTIONS_STATE_KEY)
    .maybeSingle<PortalUserSettingRow>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) return legacySelections;
    throw new Error(getSupabaseStorageErrorMessage(error, "portal_user_settings"));
  }

  const remoteSelections = readStateBorrowSelections(data?.state);
  const mergedSelections = mergeEquipmentBorrowSelections(legacySelections, remoteSelections);
  if (legacySelections.length > 0 && !borrowSelectionsEqual(mergedSelections, remoteSelections)) {
    await saveEquipmentBorrowSelections(profileId, mergedSelections);
    clearLegacyEquipmentBorrowSelections(profileId);
    return mergedSelections;
  }

  if (legacySelections.length > 0) {
    clearLegacyEquipmentBorrowSelections(profileId);
  }

  return remoteSelections;
}
