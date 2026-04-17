import { parseVacationEntry } from "@/lib/schedule/engine";
import { getAssignmentDisplayRank, getDayCategoryDisplayLabel } from "@/lib/schedule/constants";
import { DaySchedule } from "@/lib/schedule/types";

const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDow(dow: number) {
  return dow === 0 ? 6 : dow - 1;
}

function getVisibleAssignments(day: DaySchedule, highlightedName?: string | null) {
  const isWeekendLike = day.isWeekend || day.isHoliday;
  return Object.entries(day.assignments)
    .filter(([category]) => {
      if (isWeekendLike) return category !== "휴가" && category !== "제크";
      return !["국회", "청사", "청와대"].includes(category);
    })
    .sort(([leftCategory], [rightCategory]) => getAssignmentDisplayRank(leftCategory) - getAssignmentDisplayRank(rightCategory))
    .map(([category, names]) => ({
      label: getDayCategoryDisplayLabel(day, category),
      names: names
        .map((name) => (category === "휴가" ? parseVacationEntry(name).name : name))
        .filter(Boolean)
        .map((name) => ({
          name,
          highlighted: Boolean(highlightedName) && name === highlightedName,
        })),
    }))
    .filter((entry) => entry.names.length > 0);
}

function buildCalendarCells(days: DaySchedule[]) {
  if (days.length === 0) return [] as Array<DaySchedule | null>;
  const sorted = [...days].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  const firstOffset = normalizeDow(sorted[0].dow);
  const cells: Array<DaySchedule | null> = Array.from({ length: firstOffset }, () => null);
  cells.push(...sorted);
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

export function renderSchedulePrintHtml({
  title,
  days,
  highlightedName,
}: {
  title: string;
  days: DaySchedule[];
  highlightedName?: string | null;
}) {
  const cells = buildCalendarCells(days);
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const weekCount = weeks.length;

  const rowsHtml = weeks
    .map(
      (week) => `<tr>${week
        .map((day) => {
          if (!day) return '<td class="schedule-print-empty"></td>';
          const assignmentsHtml = getVisibleAssignments(day, highlightedName)
            .map(
              (entry) => `
                <div class="schedule-print-assignment">
                  <strong>${escapeHtml(entry.label)}</strong>
                  <span>${entry.names
                    .map((item) =>
                      item.highlighted
                        ? `<mark class="schedule-print-name-highlight">${escapeHtml(item.name)}</mark>`
                        : escapeHtml(item.name),
                    )
                    .join(", ")}</span>
                </div>`,
            )
            .join("");

          return `
            <td class="schedule-print-cell${day.isOverflowMonth ? " schedule-print-overflow" : ""}">
              <div class="schedule-print-date">
                <span>${escapeHtml(`${day.month}/${day.day}`)}</span>
                <span>${escapeHtml(weekdayLabels[normalizeDow(day.dow)])}</span>
              </div>
              <div class="schedule-print-assignments">${assignmentsHtml || '<div class="schedule-print-empty-line">-</div>'}</div>
            </td>`;
        })
        .join("")}</tr>`,
    )
    .join("");

  return `
    <section data-print-frame="true" class="schedule-print-sheet schedule-print-sheet--weeks-${weekCount}" data-week-count="${weekCount}">
      <header class="schedule-print-header">
        <strong>${escapeHtml(title)}</strong>
      </header>
      <table class="schedule-print-table">
        <thead>
          <tr>${weekdayLabels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>
  `;
}
