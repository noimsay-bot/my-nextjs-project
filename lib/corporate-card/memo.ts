export interface CorporateCardMemoInput {
  date: string | Date;
  scheduleContent: string;
  userName: string;
  audioManName?: string | null;
  seniorName?: string | null;
}

function formatMemoDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    const compact = String(value).replace(/\D/g, "");
    return compact.length >= 8 ? compact.slice(4, 8) : compact.slice(0, 4);
  }

  return `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function normalizePart(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function buildCorporateCardMemo(input: CorporateCardMemoInput) {
  return [
    formatMemoDate(input.date),
    normalizePart(input.scheduleContent),
    "일정식대",
    normalizePart(input.userName),
    normalizePart(input.audioManName),
    normalizePart(input.seniorName),
  ]
    .filter(Boolean)
    .join(" ");
}
