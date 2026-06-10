import { parseVacationEntry } from "@/lib/schedule/engine";
import { getAssignmentDisplayRank, getDayCategoryDisplayLabel, isAutoManagedGeneralAssignment } from "@/lib/schedule/constants";
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

function getPrintDayBadge(day: DaySchedule) {
  if (day.isWeekend) return "";
  if (day.isCustomHoliday || day.isWeekdayHoliday) return "평일 휴일";
  if (day.isHoliday) return "휴일";
  return "";
}

function getPrintCategoryLabel(day: DaySchedule, category: string) {
  const label = getDayCategoryDisplayLabel(day, category);
  return label === "뉴스대기" ? "뉴스\n대기" : label;
}

function shouldExcludePrintCategory(day: DaySchedule, category: string) {
  const normalizedCategory = category.replace(/\s/g, "");
  const normalizedLabel = getPrintCategoryLabel(day, category).replace(/\s/g, "");
  return isAutoManagedGeneralAssignment(day, category) || normalizedCategory.includes("월드컵") || normalizedLabel.includes("월드컵");
}

function normalizePrintName(category: string, name: string) {
  return (category === "휴가" ? parseVacationEntry(name).name : name).trim();
}

function getVacationNames(day: DaySchedule) {
  return (day.assignments["휴가"] ?? [])
    .map((name) => normalizePrintName("휴가", name))
    .filter(Boolean);
}

function getVisibleAssignments(day: DaySchedule, highlightedName?: string | null) {
  const isWeekendLike = day.isWeekend || day.isHoliday;
  return Object.entries(day.assignments)
    .filter(([category, names]) => {
      if (!Array.isArray(names) || names.length === 0) return false;
      if (category === "휴가") return false;
      if (shouldExcludePrintCategory(day, category)) return false;
      if (isWeekendLike) return category !== "제크" && !["국회", "청사", "청와대"].includes(category);
      return !["국회", "청사", "청와대"].includes(category);
    })
    .sort(([leftCategory], [rightCategory]) => {
      if (isWeekendLike) {
        if (leftCategory === "야근" && rightCategory !== "야근") return 1;
        if (rightCategory === "야근" && leftCategory !== "야근") return -1;
      }
      return getAssignmentDisplayRank(leftCategory) - getAssignmentDisplayRank(rightCategory);
    })
    .map(([category, names]) => ({
      label: getPrintCategoryLabel(day, category),
      names: names
        .map((name) => normalizePrintName(category, name))
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

function renderName(item: { name: string; highlighted: boolean }) {
  const content = escapeHtml(item.name);
  return item.highlighted
    ? `<mark class="schedule-print-name-highlight">${content}</mark>`
    : `<span>${content}</span>`;
}

function renderVacationPanel(names: string[]) {
  return `
    <aside class="schedule-print-vacation">
      <div class="schedule-print-vacation-title">휴가</div>
      <div class="schedule-print-vacation-list">
        ${names.map((name) => `<div class="schedule-print-vacation-name">${escapeHtml(name)}</div>`).join("")}
      </div>
    </aside>`;
}

function renderDayCard(day: DaySchedule | null, highlightedName?: string | null) {
  if (!day) {
    return '<article class="schedule-print-day schedule-print-day--empty" aria-hidden="true"></article>';
  }

  const assignmentsHtml = getVisibleAssignments(day, highlightedName)
    .map(
      (entry) => `
        <section class="schedule-print-assignment">
          <div class="schedule-print-assignment-label">${escapeHtml(entry.label)}</div>
          <div class="schedule-print-name-list">
            ${entry.names.map((item) => `<div class="schedule-print-name">${renderName(item)}</div>`).join("")}
          </div>
        </section>`,
    )
    .join("");
  const showVacationPanel = !(day.isWeekend || day.isHoliday);
  const vacationNames = showVacationPanel ? getVacationNames(day) : [];
  const dayBadge = getPrintDayBadge(day);
  const classes = [
    "schedule-print-day",
    day.isWeekend || day.isWeekdayHoliday ? "schedule-print-day--red" : "",
    day.isOverflowMonth ? "schedule-print-day--overflow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <article class="${classes}">
      <header class="schedule-print-day-head">
        <div class="schedule-print-day-date">
          <strong>${escapeHtml(`${day.month}/${day.day}`)}</strong>
          <span>${escapeHtml(weekdayLabels[normalizeDow(day.dow)])}</span>
        </div>
        <div class="schedule-print-day-title">
          ${dayBadge ? `<span class="schedule-print-day-badge">${escapeHtml(dayBadge)}</span>` : ""}
          ${day.headerName ? `<strong>${escapeHtml(day.headerName)}</strong>` : ""}
        </div>
      </header>
      <div class="schedule-print-day-content${showVacationPanel ? "" : " schedule-print-day-content--no-vacation"}">
        <div class="schedule-print-day-body">
          ${assignmentsHtml || '<div class="schedule-print-empty-line">-</div>'}
        </div>
        ${showVacationPanel ? renderVacationPanel(vacationNames) : ""}
      </div>
    </article>`;
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

  return `
    <section data-print-frame="true" class="schedule-print-sheet schedule-print-card-sheet schedule-print-card-sheet--weeks-${weekCount}" data-week-count="${weekCount}">
      <header class="schedule-print-header">
        <strong>${escapeHtml(title)}</strong>
      </header>
      <div class="schedule-print-weekdays">
        ${weekdayLabels.map((label) => `<div>${escapeHtml(label)}</div>`).join("")}
      </div>
      <div class="schedule-print-weeks" style="grid-template-rows: repeat(${weekCount}, minmax(0, 1fr));">
        ${weeks
          .map(
            (week) => `
              <div class="schedule-print-week">
                ${week.map((day) => renderDayCard(day, highlightedName)).join("")}
              </div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}
