import { getUsers } from "@/lib/auth/storage";

export type PressSupportCategory = "assembly" | "prosecution";

export interface PressSupportRow {
  name: string;
  assembly: boolean;
  prosecution: boolean;
}

const PRESS_SUPPORT_STORAGE_KEY = "desk-press-support-v1";

function normalizePressSupportRow(value: Partial<PressSupportRow> | null | undefined) {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!name) return null;

  return {
    name,
    assembly: Boolean(value?.assembly),
    prosecution: Boolean(value?.prosecution),
  } satisfies PressSupportRow;
}

function getEligibleNames() {
  return Array.from(
    new Set(
      getUsers()
        .filter((user) => user.status === "ACTIVE")
        .filter((user) => user.role !== "team_lead" && user.role !== "desk")
        .map((user) => user.username.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, "ko"));
}

function readStoredRows() {
  if (typeof window === "undefined") return [] as PressSupportRow[];

  try {
    const raw = window.localStorage.getItem(PRESS_SUPPORT_STORAGE_KEY);
    if (!raw) return [] as PressSupportRow[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as PressSupportRow[];
    return parsed
      .map((item) => normalizePressSupportRow(item))
      .filter((item): item is PressSupportRow => Boolean(item));
  } catch {
    return [] as PressSupportRow[];
  }
}

export function getPressSupportRows() {
  const storedRows = readStoredRows();
  const storedMap = new Map(storedRows.map((row) => [row.name, row] as const));

  return getEligibleNames().map((name) => {
    const stored = storedMap.get(name);
    return {
      name,
      assembly: stored?.assembly ?? false,
      prosecution: stored?.prosecution ?? false,
    } satisfies PressSupportRow;
  });
}

export function savePressSupportRows(rows: PressSupportRow[]) {
  if (typeof window === "undefined") return;

  const normalized = rows
    .map((row) => normalizePressSupportRow(row))
    .filter((row): row is PressSupportRow => Boolean(row));

  window.localStorage.setItem(PRESS_SUPPORT_STORAGE_KEY, JSON.stringify(normalized));
}

export function togglePressSupportCell(
  rows: PressSupportRow[],
  name: string,
  category: PressSupportCategory,
) {
  return rows.map((row) =>
    row.name === name
      ? {
          ...row,
          [category]: !row[category],
        }
      : row,
  );
}
