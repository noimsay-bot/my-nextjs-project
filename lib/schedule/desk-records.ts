export type DeskRecordKind = "long-service-leave" | "health-check";

export const DESK_RECORD_YEAR = 2026;

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

export function getDeskRecordEntries(kind: DeskRecordKind) {
  return readEntriesFromStorage(kind);
}

export function saveDeskRecordEntries(kind: DeskRecordKind, entries: DeskRecordEntry[]) {
  if (typeof window === "undefined") return;
  const { storageKey } = getDeskRecordConfig(kind);
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
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
