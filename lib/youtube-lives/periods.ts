// 모바일 라이브 날짜/집계 구간 계산. 모든 기준은 KST(UTC+9, 서머타임 없음)다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 수집을 시작한 첫 구간: 2025.12.1 ~ 2026.11.30 = 2026년. */
export const FIRST_LIVE_PERIOD_YEAR = 2026;
/** 구간 안에서의 월 표시 순서(12월 ~ 11월). */
export const LIVE_PERIOD_MONTHS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export interface LivePeriod {
  year: number;
  label: string;
  startIso: string;
  endIso: string;
}

export interface LiveMonthCount {
  month: number;
  label: string;
  count: number;
}

export interface LivePeriodStats {
  period: LivePeriod;
  total: number;
  months: LiveMonthCount[];
}

function toKstParts(value: string | number | Date) {
  const shifted = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getKstDateKey(value: string | number | Date = Date.now()) {
  const parts = toKstParts(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getKstTimeLabel(value: string | number | Date) {
  const parts = toKstParts(value);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function getYesterdayKstDateKey(now = Date.now()) {
  return getKstDateKey(now - DAY_MS);
}

export function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+09:00`));
}

export function addDaysToDateKey(dateKey: string, offset: number) {
  return getKstDateKey(Date.parse(`${dateKey}T00:00:00+09:00`) + offset * DAY_MS);
}

/** KST 하루의 [시작, 끝) 범위를 UTC ISO로 돌려준다. */
export function getKstDayRange(dateKey: string) {
  const startMs = Date.parse(`${dateKey}T00:00:00+09:00`);
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(startMs + DAY_MS).toISOString(),
  };
}

/** 12월 1일 ~ 다음 해 11월 30일 구간. 구간 이름은 끝나는 해다. */
export function getLivePeriod(year: number): LivePeriod {
  return {
    year,
    label: `${year}년 (${year - 1}.12.1 ~ ${year}.11.30)`,
    startIso: new Date(Date.parse(`${year - 1}-12-01T00:00:00+09:00`)).toISOString(),
    endIso: new Date(Date.parse(`${year}-12-01T00:00:00+09:00`)).toISOString(),
  };
}

export function getLivePeriodYear(value: string | number | Date = Date.now()) {
  const parts = toKstParts(value);
  return parts.month === 12 ? parts.year + 1 : parts.year;
}

/** 첫 구간부터 현재 구간까지, 최신 구간이 먼저 오도록 돌려준다. */
export function getLivePeriods(now = Date.now()) {
  const currentYear = Math.max(getLivePeriodYear(now), FIRST_LIVE_PERIOD_YEAR);
  const periods: LivePeriod[] = [];
  for (let year = currentYear; year >= FIRST_LIVE_PERIOD_YEAR; year -= 1) {
    periods.push(getLivePeriod(year));
  }
  return periods;
}

/** 체크된 라이브의 시작 시각 목록으로 구간 합계와 월별 건수를 만든다. */
export function buildLivePeriodStats(period: LivePeriod, startedAtList: string[]): LivePeriodStats {
  const countByMonth = new Map<number, number>();
  let total = 0;
  for (const startedAt of startedAtList) {
    if (startedAt < period.startIso || startedAt >= period.endIso) continue;
    const { month } = toKstParts(startedAt);
    countByMonth.set(month, (countByMonth.get(month) ?? 0) + 1);
    total += 1;
  }
  return {
    period,
    total,
    months: LIVE_PERIOD_MONTHS.map((month) => ({
      month,
      label: `${month}월`,
      count: countByMonth.get(month) ?? 0,
    })),
  };
}
