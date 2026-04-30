import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

export type DeskRecordKind = "long-service-leave" | "health-check";

export const DESK_RECORD_YEAR = 2026;
export const DESK_RECORDS_EVENT = "j-desk-records-updated";
export const DESK_RECORDS_STATUS_EVENT = "j-desk-records-status";
const DESK_RECORDS_STATE_KEY = "desk_records_v1";

export interface DeskRecordEntry {
  id: string;
  name: string;
  date: string;
  note: string;
  dateKeys: string[];
}

export interface DeskRecordConfig {
  kind: DeskRecordKind;
  title: string;
  chip: string;
  description: string;
  storageKey: string;
  seedEntries: DeskRecordEntry[];
}

interface DeskRecordStore {
  "long-service-leave": DeskRecordEntry[];
  "health-check": DeskRecordEntry[];
}

interface ScheduleSettingsStateRow {
  key: string;
  state: unknown;
}

const seedEntriesByKind: Record<DeskRecordKind, Array<Omit<DeskRecordEntry, "id" | "dateKeys">>> = {
  "long-service-leave": [
    { name: "손준수", date: "", note: "근속 메일 온 날짜부터 1년간 가능합니다" },
    { name: "김영묵", date: "", note: "" },
    { name: "주수영", date: "", note: "" },
    { name: "이동현", date: "", note: "" },
    { name: "반일훈", date: "", note: "" },
    { name: "김재식", date: "", note: "" },
    { name: "박재현", date: "", note: "" },
    { name: "신동환", date: "2.10-26 (10)출산", note: "" },
    { name: "이주현", date: "", note: "" },
    { name: "구본준", date: "", note: "" },
    { name: "이학진", date: "", note: "" },
    { name: "장후원", date: "", note: "" },
    { name: "변경태", date: "", note: "" },
    { name: "황현우", date: "", note: "" },
    { name: "김미란", date: "", note: "" },
    { name: "유규열", date: "", note: "" },
    { name: "김준택", date: "", note: "" },
    { name: "방극철", date: "", note: "" },
    { name: "홍승재", date: "", note: "" },
    { name: "김상현", date: "", note: "" },
    { name: "이주원", date: "", note: "" },
    { name: "이경", date: "", note: "" },
    { name: "공영수", date: "", note: "" },
    { name: "신승규", date: "", note: "" },
    { name: "정상원", date: "", note: "" },
    { name: "정철원", date: "", note: "" },
    { name: "최무룡", date: "", note: "" },
    { name: "김진광", date: "3.23 - 27 (5일) 근속", note: "" },
    { name: "조용희", date: "10.12-23 (근속)(10일)", note: "" },
    { name: "이완근", date: "4.1-8.31(육아휴직)", note: "" },
    { name: "박대권", date: "", note: "" },
    { name: "이지수", date: "", note: "" },
    { name: "김대호", date: "", note: "" },
    { name: "이현일", date: "3.30 - 4/3 (근속)", note: "" },
    { name: "유연경", date: "", note: "" },
    { name: "정재우", date: "", note: "" },
  ],
  "health-check": [
    { name: "김영묵", date: "26.4.7", note: "사회부와 출입처 날짜가 겹치지 않게 예약 해 주시기 바랍니다." },
    { name: "홍승재", date: "", note: "" },
    { name: "공영수", date: "", note: "" },
    { name: "구본준", date: "", note: "" },
    { name: "김대호", date: "", note: "" },
    { name: "김미란", date: "", note: "" },
    { name: "김상현", date: "26.6.12", note: "" },
    { name: "장후원", date: "26.11.20", note: "" },
    { name: "김재식", date: "26.10.23", note: "" },
    { name: "김준택", date: "", note: "" },
    { name: "김진광", date: "", note: "" },
    { name: "박대권", date: "", note: "" },
    { name: "박재현", date: "26.7.21", note: "" },
    { name: "반일훈", date: "", note: "" },
    { name: "방극철", date: "", note: "" },
    { name: "변경태", date: "", note: "" },
    { name: "신동환", date: "26.5.14", note: "" },
    { name: "신승규", date: "", note: "" },
    { name: "유규열", date: "26.11.13", note: "" },
    { name: "유연경", date: "", note: "" },
    { name: "이경", date: "26.12.11", note: "" },
    { name: "이동현", date: "", note: "" },
    { name: "이완근", date: "26.10.8", note: "" },
    { name: "이주원", date: "", note: "" },
    { name: "이주현", date: "", note: "" },
    { name: "이지수", date: "", note: "" },
    { name: "이학진", date: "", note: "" },
    { name: "이현일", date: "", note: "" },
    { name: "정상원", date: "", note: "" },
    { name: "정재우", date: "", note: "" },
    { name: "정철원", date: "", note: "" },
    { name: "조용희", date: "26.12.4", note: "" },
    { name: "주수영", date: "", note: "" },
    { name: "최무룡", date: "", note: "" },
    { name: "홍승재", date: "", note: "" },
    { name: "황현우", date: "26.5.21", note: "" },
  ],
};

const configByKind: Record<DeskRecordKind, Omit<DeskRecordConfig, "seedEntries">> = {
  "long-service-leave": {
    kind: "long-service-leave",
    title: "2026년 근속휴가 관리",
    chip: "DESK 근속휴가",
    description: "첨부된 근속휴가 시트를 그대로 옮긴 관리 페이지입니다. 날짜와 비고를 직접 수정해 계속 관리할 수 있습니다.",
    storageKey: "desk-long-service-leave-records-v1",
  },
  "health-check": {
    kind: "health-check",
    title: "2026년 검진 관리",
    chip: "DESK 검진",
    description: "첨부된 건강검진 시트를 기준으로 만든 관리 페이지입니다. 검진은 공가라 날짜가 겹치지 않게 확인해 주세요.",
    storageKey: "desk-health-check-records-v1",
  },
};

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseYearToken(value: string | undefined, fallbackYear: number) {
  if (!value) return fallbackYear;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallbackYear;
  if (value.length === 2) return 2000 + numeric;
  return numeric;
}

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function expandDateRange(startDateKey: string, endDateKey: string) {
  const start = new Date(`${startDateKey}T00:00:00`);
  const end = new Date(`${endDateKey}T00:00:00`);
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const dateKeys: string[] = [];
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    dateKeys.push(toDateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
  }
  return dateKeys;
}

function normalizeDateKeyList(dateKeys: string[]) {
  return Array.from(
    new Set(
      dateKeys
        .map((dateKey) => dateKey.trim())
        .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function parseDeskRecordDateKeys(value: string, fallbackYear = DESK_RECORD_YEAR) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return [];

  const rangeMatch = compact.match(
    /(?:(\d{2,4})[./-])?(\d{1,2})[./-](\d{1,2})[~\-](?:(\d{2,4})[./-])?(\d{1,2})(?:[./-](\d{1,2}))?/,
  );
  if (rangeMatch) {
    const startYear = parseYearToken(rangeMatch[1], fallbackYear);
    const startMonth = Number(rangeMatch[2]);
    const startDay = Number(rangeMatch[3]);
    const endYear = parseYearToken(rangeMatch[4], startYear);
    const endMonth = rangeMatch[6] ? Number(rangeMatch[5]) : startMonth;
    const endDay = rangeMatch[6] ? Number(rangeMatch[6]) : Number(rangeMatch[5]);

    if (isValidDateParts(startYear, startMonth, startDay) && isValidDateParts(endYear, endMonth, endDay)) {
      return expandDateRange(
        toDateKey(startYear, startMonth, startDay),
        toDateKey(endYear, endMonth, endDay),
      );
    }
  }

  const singleMatch = compact.match(/(?:(\d{2,4})[./-])?(\d{1,2})[./-](\d{1,2})/);
  if (singleMatch) {
    const year = parseYearToken(singleMatch[1], fallbackYear);
    const month = Number(singleMatch[2]);
    const day = Number(singleMatch[3]);
    if (isValidDateParts(year, month, day)) {
      return [toDateKey(year, month, day)];
    }
  }

  return [];
}

export function formatDeskRecordDateKeys(dateKeys: string[]) {
  const normalized = normalizeDateKeyList(dateKeys);
  if (normalized.length === 0) return "";
  const formatOne = (dateKey: string) => {
    const [yearText, monthText, dayText] = dateKey.split("-");
    return `${yearText.slice(2)}.${Number(monthText)}.${Number(dayText)}`;
  };
  if (normalized.length === 1) {
    return formatOne(normalized[0]);
  }
  return `${formatOne(normalized[0])} ~ ${formatOne(normalized[normalized.length - 1])}`;
}

function normalizeDeskRecordEntry(kind: DeskRecordKind, entry: Partial<DeskRecordEntry>, index: number): DeskRecordEntry {
  const dateKeys =
    Array.isArray(entry.dateKeys) && entry.dateKeys.length > 0
      ? normalizeDateKeyList(entry.dateKeys)
      : parseDeskRecordDateKeys(typeof entry.date === "string" ? entry.date : "");

  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `${kind}-${index + 1}`,
    name: typeof entry.name === "string" ? entry.name : "",
    date:
      typeof entry.date === "string" && entry.date.trim().length > 0
        ? entry.date
        : formatDeskRecordDateKeys(dateKeys),
    note: typeof entry.note === "string" ? entry.note : "",
    dateKeys,
  };
}

function createSeedEntries(kind: DeskRecordKind) {
  return seedEntriesByKind[kind].map((entry, index) =>
    normalizeDeskRecordEntry(kind, { id: `${kind}-${index + 1}`, ...entry }, index),
  );
}

function createSeedStore(): DeskRecordStore {
  return {
    "long-service-leave": createSeedEntries("long-service-leave"),
    "health-check": createSeedEntries("health-check"),
  };
}

export function getDeskRecordConfig(kind: DeskRecordKind): DeskRecordConfig {
  return {
    ...configByKind[kind],
    seedEntries: createSeedEntries(kind),
  };
}

function readEntriesFromStorage(kind: DeskRecordKind) {
  if (typeof window === "undefined") {
    return getDeskRecordConfig(kind).seedEntries;
  }

  const { storageKey, seedEntries } = getDeskRecordConfig(kind);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return seedEntries;
  }

  try {
    const parsed = JSON.parse(raw) as DeskRecordEntry[];
    if (!Array.isArray(parsed)) return seedEntries;
    return parsed.map((entry, index) => normalizeDeskRecordEntry(kind, entry, index));
  } catch {
    return seedEntries;
  }
}

function createStoreFromLocalStorage(): DeskRecordStore {
  return {
    "long-service-leave": readEntriesFromStorage("long-service-leave"),
    "health-check": readEntriesFromStorage("health-check"),
  };
}

function normalizeDeskRecordStore(store: unknown): DeskRecordStore {
  const localOrSeed = createStoreFromLocalStorage();
  if (!store || typeof store !== "object") {
    return localOrSeed;
  }

  const record = store as Record<string, unknown>;
  return {
    "long-service-leave": Array.isArray(record["long-service-leave"])
      ? (record["long-service-leave"] as unknown[]).map((entry, index) =>
          normalizeDeskRecordEntry("long-service-leave", entry as Partial<DeskRecordEntry>, index),
        )
      : localOrSeed["long-service-leave"],
    "health-check": Array.isArray(record["health-check"])
      ? (record["health-check"] as unknown[]).map((entry, index) =>
          normalizeDeskRecordEntry("health-check", entry as Partial<DeskRecordEntry>, index),
        )
      : localOrSeed["health-check"],
  };
}

let deskRecordCache: DeskRecordStore | null = null;
let deskRecordRefreshPromise: Promise<DeskRecordStore> | null = null;
let deskRecordPersistTimer: ReturnType<typeof setTimeout> | null = null;
let deskRecordPersistResolvers: Array<() => void> = [];

function ensureDeskRecordCache() {
  if (!deskRecordCache) {
    deskRecordCache = createStoreFromLocalStorage();
  }
  return deskRecordCache;
}

function cloneDeskRecordStore(store: DeskRecordStore): DeskRecordStore {
  return {
    "long-service-leave": store["long-service-leave"].map((entry, index) =>
      normalizeDeskRecordEntry("long-service-leave", entry, index),
    ),
    "health-check": store["health-check"].map((entry, index) =>
      normalizeDeskRecordEntry("health-check", entry, index),
    ),
  };
}

function hasLocalStorageOverride(kind: DeskRecordKind) {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(getDeskRecordConfig(kind).storageKey));
}

function writeEntriesToLocalStorage(kind: DeskRecordKind, entries: DeskRecordEntry[]) {
  if (typeof window === "undefined") return;
  const { storageKey } = getDeskRecordConfig(kind);
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
}

function isDeskPriorityEntry(value: string) {
  return /^(근속휴가|건강검진)\s*:/.test(value.trim());
}

function buildDeskPriorityMapFromStore(store: DeskRecordStore) {
  const map: Record<string, string[]> = {};
  const pushEntry = (dateKey: string, value: string) => {
    map[dateKey] = [...(map[dateKey] ?? []), value];
  };

  store["long-service-leave"].forEach((entry) => {
    entry.dateKeys.forEach((dateKey) => pushEntry(dateKey, `근속휴가:${entry.name}`));
  });
  store["health-check"].forEach((entry) => {
    entry.dateKeys.forEach((dateKey) => pushEntry(dateKey, `건강검진:${entry.name}`));
  });

  return map;
}

function buildDeskPrioritySetMap(store: DeskRecordStore) {
  return new Map(
    Object.entries(buildDeskPriorityMapFromStore(store)).map(([dateKey, entries]) => [dateKey, new Set(entries)] as const),
  );
}

function parseVacationStateText(value: string) {
  const map: Record<string, string[]> = {};
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const matched = /^(\d{4}-\d{2}-\d{2})\s*:\s*(.+)$/.exec(line);
      if (!matched) return;
      const [, dateKey, rawEntries] = matched;
      const entries = rawEntries.split(",").map((entry) => entry.trim()).filter(Boolean);
      if (entries.length > 0) {
        map[dateKey] = entries;
      }
    });
  return map;
}

function serializeVacationStateText(map: Record<string, string[]>) {
  return Object.keys(map)
    .sort((left, right) => left.localeCompare(right))
    .map((dateKey) => {
      const entries = map[dateKey].map((entry) => entry.trim()).filter(Boolean);
      if (entries.length === 0) return null;
      return `${dateKey}:${entries.join(",")}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function filterActiveDeskPriorityEntries(dateKey: string, entries: string[], activeMap: Map<string, Set<string>>) {
  const activeEntries = activeMap.get(dateKey) ?? null;
  return entries.filter((entry) => !isDeskPriorityEntry(entry) || Boolean(activeEntries?.has(entry)));
}

function scrubDeskPriorityFromSchedule(schedule: unknown, activeMap: Map<string, Set<string>>) {
  if (!schedule || typeof schedule !== "object") return { schedule, changed: false };
  const record = schedule as Record<string, unknown>;
  const days = Array.isArray(record.days) ? record.days : null;
  if (!days) return { schedule, changed: false };

  let changed = false;
  const nextDays = days.map((day) => {
    if (!day || typeof day !== "object") return day;
    const dayRecord = day as Record<string, unknown>;
    const dateKey = typeof dayRecord.dateKey === "string" ? dayRecord.dateKey : "";
    if (!dateKey) return day;

    const assignments = dayRecord.assignments && typeof dayRecord.assignments === "object"
      ? { ...(dayRecord.assignments as Record<string, string[]>) }
      : {};
    const currentVacationEntries =
      Array.isArray(assignments["휴가"]) ? assignments["휴가"] : Array.isArray(dayRecord.vacations) ? (dayRecord.vacations as string[]) : [];
    const nextVacationEntries = filterActiveDeskPriorityEntries(dateKey, currentVacationEntries, activeMap);

    if (JSON.stringify(currentVacationEntries) === JSON.stringify(nextVacationEntries)) {
      return day;
    }

    changed = true;
    if (nextVacationEntries.length > 0) {
      assignments["휴가"] = nextVacationEntries;
    } else {
      delete assignments["휴가"];
    }

    return {
      ...dayRecord,
      assignments,
      vacations: nextVacationEntries,
    };
  });

  if (!changed) return { schedule, changed: false };
  return {
    schedule: {
      ...record,
      days: nextDays,
    },
    changed: true,
  };
}

function syncLocalStorageFromCache(store: DeskRecordStore) {
  writeEntriesToLocalStorage("long-service-leave", store["long-service-leave"]);
  writeEntriesToLocalStorage("health-check", store["health-check"]);
}

function emitDeskRecordEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DESK_RECORDS_EVENT));
}

function emitDeskRecordStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DESK_RECORDS_STATUS_EVENT, { detail }));
}

async function persistDeskRecordStoreNow(store: DeskRecordStore) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase.from("schedule_settings").upsert({
    key: DESK_RECORDS_STATE_KEY,
    state: store,
    updated_by: session.id,
  });

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "schedule_settings"));
  }
}

async function cleanupDeskPriorityScheduleArtifacts(store: DeskRecordStore) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const activeMap = buildDeskPrioritySetMap(store);

  const [{ data: globalRow, error: globalError }, { data: monthRows, error: monthError }] = await Promise.all([
    supabase.from("schedule_settings").select("key,state").eq("key", "global").maybeSingle<ScheduleSettingsStateRow>(),
    supabase.from("schedule_months").select("month_key,draft_state,published_state"),
  ]);

  if (globalError) {
    throw new Error(getSupabaseStorageErrorMessage(globalError, "schedule_settings"));
  }
  if (monthError) {
    throw new Error(getSupabaseStorageErrorMessage(monthError, "schedule_months"));
  }

  const globalState = globalRow?.state && typeof globalRow.state === "object"
    ? { ...(globalRow.state as Record<string, unknown>) }
    : null;

  if (globalState) {
    const currentVacations = typeof globalState.vacations === "string" ? globalState.vacations : "";
    const currentMap = parseVacationStateText(currentVacations);
    const nextMap = Object.fromEntries(
      Object.entries(currentMap)
        .map(([dateKey, entries]) => [dateKey, filterActiveDeskPriorityEntries(dateKey, entries, activeMap)])
        .filter(([, entries]) => entries.length > 0),
    ) as Record<string, string[]>;
    const nextVacations = serializeVacationStateText(nextMap);

    if (nextVacations !== currentVacations) {
      const { error } = await supabase.from("schedule_settings").upsert({
        key: "global",
        state: {
          ...globalState,
          vacations: nextVacations,
        },
        updated_by: session.id,
      });
      if (error) {
        throw new Error(getSupabaseStorageErrorMessage(error, "schedule_settings"));
      }
    }
  }

  const changedRows = (monthRows ?? [])
    .map((row) => {
      const draftResult = scrubDeskPriorityFromSchedule(row.draft_state, activeMap);
      const publishedResult = scrubDeskPriorityFromSchedule(row.published_state, activeMap);
      if (!draftResult.changed && !publishedResult.changed) {
        return null;
      }
      return {
        month_key: row.month_key,
        draft_state: draftResult.schedule,
        published_state: publishedResult.schedule,
        updated_by: session.id,
      };
    })
    .filter(Boolean);

  if (changedRows.length > 0) {
    const { error } = await supabase.from("schedule_months").upsert(changedRows);
    if (error) {
      throw new Error(getSupabaseStorageErrorMessage(error, "schedule_months"));
    }
  }
}

export async function refreshDeskRecordStore() {
  if (deskRecordRefreshPromise) {
    return deskRecordRefreshPromise;
  }

  deskRecordRefreshPromise = (async () => {
    const fallbackStore = createStoreFromLocalStorage();
    const session = await getPortalSession();
    if (!session?.approved) {
      deskRecordCache = fallbackStore;
      return cloneDeskRecordStore(fallbackStore);
    }

    const supabase = await getPortalSupabaseClient();
    const { data, error } = await supabase
      .from("schedule_settings")
      .select("key, state")
      .eq("key", DESK_RECORDS_STATE_KEY)
      .maybeSingle<ScheduleSettingsStateRow>();

    if (error) {
      if (isSupabaseSchemaMissingError(error)) {
        console.warn(getSupabaseStorageErrorMessage(error, "schedule_settings"));
        deskRecordCache = fallbackStore;
        return cloneDeskRecordStore(fallbackStore);
      }
      throw new Error(error.message);
    }

    if (!data?.state) {
      deskRecordCache = fallbackStore;
      if (hasLocalStorageOverride("long-service-leave") || hasLocalStorageOverride("health-check")) {
        await persistDeskRecordStoreNow(fallbackStore);
      }
      return cloneDeskRecordStore(fallbackStore);
    }

    const nextStore = normalizeDeskRecordStore(data.state);
    deskRecordCache = nextStore;
    syncLocalStorageFromCache(nextStore);
    return cloneDeskRecordStore(nextStore);
  })().finally(() => {
    deskRecordRefreshPromise = null;
  });

  return deskRecordRefreshPromise;
}

function saveDeskRecordStore(store: DeskRecordStore) {
  const previous = cloneDeskRecordStore(ensureDeskRecordCache());
  deskRecordCache = cloneDeskRecordStore(store);
  syncLocalStorageFromCache(store);
  emitDeskRecordEvent();

  if (deskRecordPersistTimer) {
    clearTimeout(deskRecordPersistTimer);
  }

  return new Promise<void>((resolve) => {
    deskRecordPersistResolvers.push(resolve);
    deskRecordPersistTimer = setTimeout(() => {
      deskRecordPersistTimer = null;
      void persistDeskRecordStoreNow(cloneDeskRecordStore(store))
        .then(async () => {
          await cleanupDeskPriorityScheduleArtifacts(store);
        })
        .catch(async (error) => {
          emitDeskRecordStatus({
            ok: false,
            message: error instanceof Error ? error.message : "인원 기록 저장에 실패했습니다. DB 기준 상태로 복구합니다.",
          });
          deskRecordCache = previous;
          syncLocalStorageFromCache(previous);
          emitDeskRecordEvent();
          await refreshDeskRecordStore();
        })
        .finally(() => {
          const resolvers = [...deskRecordPersistResolvers];
          deskRecordPersistResolvers = [];
          resolvers.forEach((item) => item());
        });
    }, 180);
  });
}

export function getDeskRecordEntries(kind: DeskRecordKind) {
  const store = ensureDeskRecordCache();
  return store[kind].map((entry, index) => normalizeDeskRecordEntry(kind, entry, index));
}

export function saveDeskRecordEntries(kind: DeskRecordKind, entries: DeskRecordEntry[]) {
  const store = ensureDeskRecordCache();
  const nextEntries = entries.map((entry, index) => normalizeDeskRecordEntry(kind, entry, index));
  void saveDeskRecordStore({
    ...store,
    [kind]: nextEntries,
  });
}

export function resetDeskRecordEntries(kind: DeskRecordKind) {
  const seedEntries = getDeskRecordConfig(kind).seedEntries;
  saveDeskRecordEntries(kind, seedEntries);
  return seedEntries;
}

export function getDeskPriorityVacationMap(monthKey?: string) {
  const map: Record<string, string[]> = {};
  const pushEntry = (dateKey: string, value: string) => {
    if (monthKey && !dateKey.startsWith(`${monthKey}-`)) return;
    map[dateKey] = [...(map[dateKey] ?? []), value];
  };

  getDeskRecordEntries("long-service-leave").forEach((entry) => {
    entry.dateKeys.forEach((dateKey) => pushEntry(dateKey, `근속휴가:${entry.name}`));
  });

  getDeskRecordEntries("health-check").forEach((entry) => {
    entry.dateKeys.forEach((dateKey) => pushEntry(dateKey, `건강검진:${entry.name}`));
  });

  return map;
}
