// 일정배정 한 달치를 엑셀(.xlsx)로 내려받는다.
// 화면과 같은 getScheduleAssignmentRows()로 행을 만들어 화면 내용과 엑셀 내용이 어긋나지 않게 한다.

import type { GeneratedSchedule, ScheduleBigEvent } from "@/lib/schedule/types";
import {
  createDefaultScheduleAssignmentDayRows,
  createDefaultScheduleAssignmentEntry,
  getScheduleAssignmentRows,
  type ScheduleAssignmentDataStore,
  type ScheduleAssignmentVisibleTripTag,
} from "@/lib/team-lead/storage";
import { buildSimpleXlsx, XLSX_MIME_TYPE, type SimpleXlsxCell } from "@/lib/xlsx/simple-xlsx";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function formatTime(value: string, confirmed: boolean) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return confirmed ? `${trimmed} (확정)` : trimmed;
}

export function buildScheduleAssignmentMonthSheetRows(
  monthSchedule: GeneratedSchedule,
  store: ScheduleAssignmentDataStore,
  bigEvents: ScheduleBigEvent[] | null,
  visibleTripTagMap: Map<string, ScheduleAssignmentVisibleTripTag>,
) {
  const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
  const monthRows = store.rows[monthSchedule.monthKey] ?? {};
  const days = monthSchedule.days
    .filter((day) => day.month === monthSchedule.month && day.year === monthSchedule.year)
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  const bodyRows: Array<{
    base: SimpleXlsxCell[];
    schedules: string[];
    trip: SimpleXlsxCell[];
  }> = [];

  days.forEach((day) => {
    const rows = getScheduleAssignmentRows(
      day,
      monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows(),
      bigEvents,
    );
    const holidayMark = day.isHoliday || day.isCustomHoliday || day.isWeekdayHoliday ? " (휴일)" : "";

    rows.forEach((row) => {
      const name = row.name.trim();
      if (!name) return;
      const entry = monthEntries[row.key] ?? createDefaultScheduleAssignmentEntry();
      const schedules = entry.schedules
        .map((schedule, index) => {
          const text = schedule.trim();
          if (!text) return "";
          return entry.exclusiveVideo[index] ? `${text} [단독]` : text;
        })
        .filter(Boolean);
      const visibleTrip = visibleTripTagMap.get(row.key);
      const travelType = entry.travelType || visibleTrip?.travelType || "";
      const tripLabel = travelType === "당일출장" ? "" : entry.tripTagLabel.trim() || visibleTrip?.tripTagLabel || "";

      bodyRows.push({
        base: [
          day.dateKey,
          `${WEEKDAY_LABELS[day.dow] ?? ""}${holidayMark}`,
          row.duty,
          name,
          formatTime(entry.clockIn, entry.clockInConfirmed),
          formatTime(entry.clockOut, entry.clockOutConfirmed),
        ],
        schedules,
        trip: [travelType, tripLabel],
      });
    });
  });

  const scheduleColumnCount = Math.max(1, ...bodyRows.map((row) => row.schedules.length));
  const header: SimpleXlsxCell[] = [
    "날짜",
    "요일",
    "근무구분",
    "이름",
    "출근",
    "퇴근",
    ...Array.from({ length: scheduleColumnCount }, (_, index) => `일정${index + 1}`),
    "출장구분",
    "출장명",
  ];
  const rows: SimpleXlsxCell[][] = [
    header,
    ...bodyRows.map((row) => [
      ...row.base,
      ...Array.from({ length: scheduleColumnCount }, (_, index) => row.schedules[index] ?? ""),
      ...row.trip,
    ]),
  ];
  // 하단 합계: 한 달 동안 입력된 일정 칸 수(이름 있는 행의 비어 있지 않은 일정)를 출력한다.
  const totalScheduleCount = bodyRows.reduce((sum, row) => sum + row.schedules.length, 0);
  const totalRow: SimpleXlsxCell[] = Array.from({ length: header.length }, () => "");
  totalRow[0] = "총 일정";
  totalRow[6] = `${totalScheduleCount}개`;
  rows.push(Array.from({ length: header.length }, () => ""), totalRow);
  const columnWidths = [12, 8, 12, 10, 14, 14, ...Array.from({ length: scheduleColumnCount }, () => 30), 10, 20];

  return { rows, columnWidths, totalScheduleCount };
}

// 엑셀 하단 합계와 같은 기준으로 한 달 일정 총개수를 센다(월 버튼 팝업용).
export function countScheduleAssignmentMonthSchedules(
  monthSchedule: GeneratedSchedule,
  store: ScheduleAssignmentDataStore,
  bigEvents: ScheduleBigEvent[] | null,
) {
  const monthEntries = store.entries[monthSchedule.monthKey] ?? {};
  const monthRows = store.rows[monthSchedule.monthKey] ?? {};
  let total = 0;

  monthSchedule.days
    .filter((day) => day.month === monthSchedule.month && day.year === monthSchedule.year)
    .forEach((day) => {
      const rows = getScheduleAssignmentRows(
        day,
        monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows(),
        bigEvents,
      );
      rows.forEach((row) => {
        if (!row.name.trim()) return;
        const entry = monthEntries[row.key];
        if (!entry) return;
        total += entry.schedules.filter((schedule) => schedule.trim()).length;
      });
    });

  return total;
}

export function downloadXlsxFile(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME_TYPE }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadScheduleAssignmentMonthXlsx(
  monthSchedule: GeneratedSchedule,
  store: ScheduleAssignmentDataStore,
  bigEvents: ScheduleBigEvent[] | null,
  visibleTripTagMap: Map<string, ScheduleAssignmentVisibleTripTag>,
) {
  const { rows, columnWidths } = buildScheduleAssignmentMonthSheetRows(
    monthSchedule,
    store,
    bigEvents,
    visibleTripTagMap,
  );
  const label = `${monthSchedule.year}년${String(monthSchedule.month).padStart(2, "0")}월`;
  const bytes = buildSimpleXlsx({ name: label, rows, columnWidths });
  downloadXlsxFile(bytes, `일정배정_${label}.xlsx`);
}
