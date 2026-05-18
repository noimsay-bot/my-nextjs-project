const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getKstDateKey(date: Date = new Date()) {
  return KST_DATE_FORMATTER.format(date);
}

export function getMonthRangeFromMonthKey(monthKey: string) {
  const matched = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!matched) {
    throw new Error("월 형식이 올바르지 않습니다.");
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const startDate = `${matched[1]}-${matched[2]}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${matched[1]}-${matched[2]}-${String(lastDay).padStart(2, "0")}`;

  return { startDate, endDate };
}
