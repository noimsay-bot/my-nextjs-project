export interface TeamLeadEvaluationPeriod {
  evaluationYear: number;
  startMonthKey: string;
  endMonthKey: string;
  startLabel: string;
  endLabel: string;
  label: string;
}

export function getTeamLeadEvaluationYear(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  return month === 12 ? year + 1 : year;
}

export function parseTeamLeadEvaluationYear(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return null;
  }
  return parsed;
}

export function getTeamLeadEvaluationPeriod(evaluationYear = getTeamLeadEvaluationYear()): TeamLeadEvaluationPeriod {
  return {
    evaluationYear,
    startMonthKey: `${evaluationYear - 1}-12`,
    endMonthKey: `${evaluationYear}-11`,
    startLabel: `${evaluationYear - 1}년 12월`,
    endLabel: `${evaluationYear}년 11월`,
    label: `${evaluationYear}년 평가`,
  };
}

export function getTeamLeadEvaluationYearFromMonthKey(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return month === 12 ? year + 1 : year;
}

export function getRecentTeamLeadEvaluationYears(selectedYear?: number) {
  const currentYear = getTeamLeadEvaluationYear();
  const baseYear = 2026;
  const endYear = Math.max(selectedYear ?? currentYear, currentYear);
  const years = new Set<number>();

  for (let year = baseYear; year <= endYear; year += 1) {
    years.add(year);
  }

  if (selectedYear && selectedYear >= baseYear) {
    years.add(selectedYear);
  }

  return Array.from(years).sort((left, right) => right - left);
}
