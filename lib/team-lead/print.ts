"use client";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPrintDate(value = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export interface TeamLeadPrintPage {
  title: string;
  bodyHtml: string;
  size?: "standard" | "dense" | "compact";
}

export interface TeamLeadReferenceNotesPrintCard {
  name: string;
  roleLabel: string;
  items: string[];
}

interface TeamLeadReferenceNotesPrintCardFragment extends TeamLeadReferenceNotesPrintCard {
  continued: boolean;
}

const REFERENCE_NOTE_CHUNK_LENGTH = 450;
const REFERENCE_NOTE_PAGE_WEIGHT = 14;

function splitReferenceNoteText(value: string) {
  const text = value.trim();
  if (!text) return [];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > REFERENCE_NOTE_CHUNK_LENGTH) {
    let splitIndex = remaining.lastIndexOf("\n", REFERENCE_NOTE_CHUNK_LENGTH);
    if (splitIndex < REFERENCE_NOTE_CHUNK_LENGTH / 2) {
      splitIndex = remaining.lastIndexOf(" ", REFERENCE_NOTE_CHUNK_LENGTH);
    }
    if (splitIndex < REFERENCE_NOTE_CHUNK_LENGTH / 2) {
      splitIndex = REFERENCE_NOTE_CHUNK_LENGTH;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function getReferenceNotesCardWeight(card: TeamLeadReferenceNotesPrintCard) {
  if (card.items.length === 0) return 1;
  return card.items.reduce((total, item) => total + Math.max(1, Math.ceil(item.trim().length / 45)), 0);
}

function expandReferenceNotesPrintCards(cards: TeamLeadReferenceNotesPrintCard[]) {
  return cards.flatMap<TeamLeadReferenceNotesPrintCardFragment>((card) => {
    const items = card.items.flatMap(splitReferenceNoteText);
    if (items.length === 0) {
      return [{ ...card, items: [], continued: false }];
    }

    const fragments: TeamLeadReferenceNotesPrintCardFragment[] = [];
    let fragmentItems: string[] = [];
    let fragmentWeight = 0;

    items.forEach((item) => {
      const itemWeight = Math.max(1, Math.ceil(item.length / 45));
      if (fragmentItems.length > 0 && fragmentWeight + itemWeight > REFERENCE_NOTE_PAGE_WEIGHT) {
        fragments.push({
          ...card,
          items: fragmentItems,
          continued: fragments.length > 0,
        });
        fragmentItems = [];
        fragmentWeight = 0;
      }
      fragmentItems.push(item);
      fragmentWeight += itemWeight;
    });

    if (fragmentItems.length > 0) {
      fragments.push({
        ...card,
        items: fragmentItems,
        continued: fragments.length > 0,
      });
    }

    return fragments;
  });
}

function groupReferenceNotesPrintCards(cards: TeamLeadReferenceNotesPrintCardFragment[]) {
  const groups: TeamLeadReferenceNotesPrintCardFragment[][] = [];
  let current: TeamLeadReferenceNotesPrintCardFragment[] = [];
  let currentWeight = 0;

  cards.forEach((card) => {
    const cardWeight = getReferenceNotesCardWeight(card);
    if (current.length > 0 && (current.length >= 8 || currentWeight + cardWeight > REFERENCE_NOTE_PAGE_WEIGHT)) {
      groups.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(card);
    currentWeight += cardWeight;
  });

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

export function buildTeamLeadReferenceNotesPrintPages(
  evaluationYear: number,
  cards: TeamLeadReferenceNotesPrintCard[],
  options: { hasUnsavedDrafts?: boolean } = {},
): TeamLeadPrintPage[] {
  const groups = groupReferenceNotesPrintCards(expandReferenceNotesPrintCards(cards));
  const periodLabel = `${evaluationYear - 1}년 12월 ~ ${evaluationYear}년 11월 기준`;
  const draftLabel = options.hasUnsavedDrafts ? " · 미저장 초안 포함" : "";

  return groups.map((group, pageIndex) => ({
    title: groups.length > 1 ? `참고사항 (${pageIndex + 1}/${groups.length})` : "참고사항",
    size: group.length >= 6 ? "dense" : "standard",
    bodyHtml: `
      <div class="team-lead-print-note">${escapeHtml(periodLabel)} · 현재 화면 입력값 기준${draftLabel}</div>
      <table class="team-lead-print-table">
        <colgroup>
          <col style="width: 18%" />
          <col style="width: 12%" />
          <col style="width: 70%" />
        </colgroup>
        <thead>
          <tr>
            <th>이름</th>
            <th>구분</th>
            <th>참고사항</th>
          </tr>
        </thead>
        <tbody>
          ${group
            .map((card) => {
              const items = card.items.map((item) => item.trim()).filter(Boolean);
              const itemHtml =
                items.length > 0
                  ? `<ol class="team-lead-print-reference-list">${items
                      .map((item) => `<li>${escapeHtml(item)}</li>`)
                      .join("")}</ol>`
                  : '<span class="team-lead-print-empty">추가된 항목이 없습니다.</span>';
              return `
                <tr>
                  <td><strong>${escapeHtml(card.name)}${card.continued ? " (계속)" : ""}</strong></td>
                  <td>${escapeHtml(card.roleLabel)}</td>
                  <td class="team-lead-print-reference-cell">${itemHtml}</td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>`,
  }));
}

function buildPrintDocument(title: string, pages: TeamLeadPrintPage[]) {
  const printedAt = formatPrintDate();
  const pageHtml = pages
    .map((page) => {
      const sizeClass = page.size ? `team-lead-print-page--${page.size}` : "team-lead-print-page--standard";
      return `
        <section class="team-lead-print-page ${sizeClass}">
          <header class="team-lead-print-header">
            <strong>${escapeHtml(page.title)}</strong>
            <span>출력일시 ${escapeHtml(printedAt)}</span>
          </header>
          <div class="team-lead-print-body">${page.bodyHtml}</div>
        </section>`;
    })
    .join("");

  return `<!doctype html>
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root {
          color-scheme: light;
        }

        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        @page {
          size: A4 landscape;
          margin: 10mm;
        }

        html, body {
          margin: 0;
          background: #ffffff;
          color: #111827;
          font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
        }

        body {
          padding: 0;
        }

        .team-lead-print-page {
          width: 100%;
          min-height: 180mm;
          height: 180mm;
          display: grid;
          grid-template-rows: auto 1fr;
          gap: 8px;
          page-break-after: always;
          overflow: hidden;
        }

        .team-lead-print-page:last-child {
          page-break-after: auto;
        }

        .team-lead-print-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: end;
          padding-bottom: 6px;
          border-bottom: 2px solid #cbd5e1;
        }

        .team-lead-print-header strong {
          font-size: 18px;
          font-weight: 800;
          line-height: 1.2;
        }

        .team-lead-print-header span {
          font-size: 11px;
          color: #475569;
          white-space: nowrap;
        }

        .team-lead-print-body {
          display: grid;
          align-content: start;
          gap: 8px;
          overflow: hidden;
        }

        .team-lead-print-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 10px;
        }

        .team-lead-print-page--dense .team-lead-print-table {
          font-size: 9px;
        }

        .team-lead-print-page--compact .team-lead-print-table {
          font-size: 7.2px;
        }

        .team-lead-print-table th,
        .team-lead-print-table td {
          border: 1px solid #94a3b8;
          padding: 4px 5px;
          text-align: center;
          vertical-align: middle;
          line-height: 1.2;
          word-break: break-word;
        }

        .team-lead-print-page--compact .team-lead-print-table th,
        .team-lead-print-page--compact .team-lead-print-table td {
          padding: 2px 3px;
        }

        .team-lead-print-table th {
          background: #e2e8f0;
          font-weight: 800;
        }

        .team-lead-print-table td strong {
          font-weight: 800;
        }

        .team-lead-print-note {
          font-size: 11px;
          color: #475569;
        }

        .team-lead-print-reference-cell {
          text-align: left !important;
          vertical-align: top !important;
        }

        .team-lead-print-reference-list {
          display: grid;
          gap: 3px;
          margin: 0;
          padding-left: 18px;
        }

        .team-lead-print-reference-list li {
          text-align: left;
          white-space: pre-wrap;
        }

        .team-lead-print-empty {
          color: #64748b;
        }
      </style>
    </head>
    <body>
      ${pageHtml}
    </body>
  </html>`;
}

export function printTeamLeadDocument(title: string, pages: TeamLeadPrintPage[]) {
  if (typeof document === "undefined") return false;

  const existingFrame = document.getElementById("team-lead-print-frame");
  if (existingFrame) {
    existingFrame.remove();
  }

  const frame = document.createElement("iframe");
  frame.id = "team-lead-print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.visibility = "hidden";
  document.body.appendChild(frame);

  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    return false;
  }

  const html = buildPrintDocument(title, pages);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  const cleanup = () => {
    window.setTimeout(() => {
      frame.remove();
    }, 300);
  };

  printWindow.onafterprint = cleanup;
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    window.setTimeout(cleanup, 2000);
  }, 250);

  return true;
}

export function escapeTeamLeadPrintHtml(value: string) {
  return escapeHtml(value);
}
