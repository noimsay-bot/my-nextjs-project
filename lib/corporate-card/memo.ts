export interface CorporateCardMemoInput {
  date: string | Date;
  scheduleContent: string;
  userName: string;
  audioManName?: string | null;
  seniorName?: string | null;
}

const PARENTHESIZED_TEXT_PATTERN = /\s*\(([^()]*)\)/g;
const PERSON_TOKEN_SPLIT_PATTERN = /[,/·&+]+|\s+/g;
const KOREAN_SURNAME_CHARS =
  "김이박최정강조윤장임한오서신권황안송류유홍전고문양손배백허남심노하곽성차주우구민진엄채원천방공현함변염여추도소석선설마길라반";
const PERSON_ROLE_TOKENS = new Set(["기자", "PD", "피디", "앵커", "팀장", "부장", "국장", "데스크"]);
const ENGLISH_PERSON_TOKEN_PATTERN = /^[A-Z][a-z][A-Za-z.'-]*$/;

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

function isPersonLikeParenthetical(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/[0-9]/.test(normalized) && !/^0{2,4}$/.test(normalized)) return false;

  const tokens = normalized
    .split(PERSON_TOKEN_SPLIT_PATTERN)
    .map((token) => token.trim())
    .filter((token) => !PERSON_ROLE_TOKENS.has(token))
    .filter(Boolean);

  return tokens.length > 0 && tokens.every(isPersonNameToken);
}

function isPersonNameToken(token: string) {
  if (/^0{2,4}$/.test(token)) return true;
  if (/^[가-힣]{2,4}$/.test(token)) return KOREAN_SURNAME_CHARS.includes(token[0] ?? "");
  return ENGLISH_PERSON_TOKEN_PATTERN.test(token);
}

export function omitParenthesizedPeople(value: string) {
  return value
    .replace(PARENTHESIZED_TEXT_PATTERN, (match, inner: string) => (isPersonLikeParenthetical(inner) ? "" : match))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function buildCorporateCardMemo(input: CorporateCardMemoInput) {
  return [
    formatMemoDate(input.date),
    omitParenthesizedPeople(normalizePart(input.scheduleContent)),
    "일정식대",
    normalizePart(input.userName),
    normalizePart(input.audioManName),
    normalizePart(input.seniorName),
  ]
    .filter(Boolean)
    .join(" ");
}
