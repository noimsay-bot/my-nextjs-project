export interface ScheduleAssignmentItem {
  scheduleDate: string;
  scheduleItemId: string;
  photographerProfileId: string | null;
  photographerName: string;
  scheduleContent: string;
}

export function buildScheduleAssignmentItemKey(input: {
  scheduleDate: string;
  photographerName: string;
  scheduleContent: string;
  index?: number;
}) {
  return [
    input.scheduleDate,
    input.photographerName.trim(),
    input.scheduleContent.trim(),
    String(input.index ?? 0),
  ].join("::");
}

export function formatMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getCurrentMonthKey() {
  const today = new Date();
  return formatMonthKey(today.getFullYear(), today.getMonth() + 1);
}

export function formatDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return month && day ? `${month}/${day}` : dateKey;
}
