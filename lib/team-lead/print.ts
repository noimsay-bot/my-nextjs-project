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
