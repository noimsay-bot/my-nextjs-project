"use client";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCurrentHtmlAttributes() {
  const className = document.documentElement.getAttribute("class");
  const theme = document.documentElement.getAttribute("data-theme");
  return [
    className ? `class="${escapeHtml(className)}"` : "",
    theme ? `data-theme="${escapeHtml(theme)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function printHtmlDocument({
  title,
  bodyHtml,
  pageSize = "A4 landscape",
  pageMargin = "8mm",
  extraCss = "",
}: {
  title: string;
  bodyHtml: string;
  pageSize?: string;
  pageMargin?: string;
  extraCss?: string;
}) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  const copiedStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join("\n");
  const htmlAttributes = getCurrentHtmlAttributes();

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ko"${htmlAttributes ? ` ${htmlAttributes}` : ""}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    ${copiedStyles}
    <style>
      :root {
        color-scheme: light;
      }

      html, body {
        margin: 0;
        background: #ffffff;
        color: #08111d;
      }

      body {
        padding: 0;
      }

      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        box-sizing: border-box;
      }

      [data-print-hide="true"] {
        display: none !important;
      }

      @page {
        size: ${pageSize};
        margin: ${pageMargin};
      }

      .schedule-print-sheet {
        width: 100%;
        display: block;
        color: #111827;
        font-family: "Segoe UI", "Pretendard", sans-serif;
        text-align: left;
        page-break-inside: auto;
        overflow: visible;
      }

      .schedule-print-header {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        margin-bottom: 2mm;
      }

      .schedule-print-header strong {
        font-size: 15pt;
        font-weight: 800;
        line-height: 1.2;
      }

      .schedule-print-weekdays,
      .schedule-print-week {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 1.2mm;
      }

      .schedule-print-weekdays {
        margin-bottom: 1.2mm;
      }

      .schedule-print-weekdays > div {
        padding: 1.4mm 1mm;
        border: 1px solid #cbd5e1;
        border-radius: 1.6mm;
        background: #eef2f7;
        color: #0f172a;
        font-size: 10pt;
        font-weight: 800;
        text-align: center;
        line-height: 1.1;
      }

      .schedule-print-weeks {
        display: grid;
        gap: 1.2mm;
      }

      .schedule-print-week {
        align-items: stretch;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .schedule-print-day {
        min-width: 0;
        min-height: 31mm;
        display: grid;
        grid-template-rows: auto 1fr;
        gap: 1mm;
        padding: 1.4mm;
        border: 1px solid #cbd5e1;
        border-radius: 1.6mm;
        background: #ffffff;
        overflow: visible;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .schedule-print-day--red {
        background: #fff1f2;
        border-color: #fca5a5;
      }

      .schedule-print-day--overflow,
      .schedule-print-day--empty {
        background: #f8fafc;
        color: #94a3b8;
      }

      .schedule-print-day-head {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 1.5mm;
        align-items: center;
        min-width: 0;
      }

      .schedule-print-day-date {
        display: grid;
        gap: 0.4mm;
        justify-items: center;
        min-width: 9mm;
        color: #0f172a;
        line-height: 1;
      }

      .schedule-print-day-date strong {
        font-size: 11pt;
        font-weight: 900;
      }

      .schedule-print-day-date span {
        font-size: 8pt;
        font-weight: 800;
      }

      .schedule-print-day-title {
        display: grid;
        gap: 0.7mm;
        justify-items: center;
        align-content: center;
        min-width: 0;
        text-align: center;
      }

      .schedule-print-day-title strong {
        max-width: 100%;
        font-size: 11.5pt;
        font-weight: 900;
        line-height: 1.05;
        white-space: normal;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }

      .schedule-print-day-badge {
        color: #b91c1c;
        font-size: 8.8pt;
        font-weight: 900;
        line-height: 1.1;
      }

      .schedule-print-day-body {
        display: grid;
        gap: 0.9mm;
        min-width: 0;
        align-content: start;
      }

      .schedule-print-assignment {
        display: grid;
        grid-template-columns: 10mm minmax(0, 1fr);
        gap: 1.1mm;
        align-items: stretch;
        min-width: 0;
        padding: 1mm;
        border: 1px solid #d6dee8;
        border-radius: 1.4mm;
        background: #ffffff;
      }

      .schedule-print-assignment-label {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        color: #0f172a;
        font-size: 8.8pt;
        font-weight: 900;
        line-height: 1.05;
        text-align: center;
        white-space: pre-line;
      }

      .schedule-print-name-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(7mm, 1fr));
        gap: 0.8mm;
        align-items: stretch;
        min-width: 0;
      }

      .schedule-print-name {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 16mm;
        padding: 0.8mm 0.4mm;
        border: 1px solid #dbe4ee;
        border-radius: 0.9mm;
        background: #f8fbff;
        color: #0f172a;
        font-size: 10.5pt;
        font-weight: 800;
        line-height: 1.08;
        text-align: center;
        white-space: nowrap;
        word-break: keep-all;
        overflow: visible;
      }

      .schedule-print-name > span {
        display: block;
        text-align: center;
        writing-mode: vertical-rl;
        text-orientation: upright;
      }

      .schedule-print-name-highlight {
        display: block;
        padding: 0.6mm 0.4mm;
        border-radius: 0.8mm;
        background: linear-gradient(transparent 18%, #fff176 18%, #fff176 88%, transparent 88%);
        color: inherit;
        font-weight: 900;
        text-align: center;
        writing-mode: vertical-rl;
        text-orientation: upright;
        white-space: nowrap;
      }

      .schedule-print-empty-line {
        color: #94a3b8;
        font-size: 9pt;
        line-height: 1.1;
        text-align: center;
      }

      @media print {
        html,
        body {
          width: 100%;
          background: #ffffff !important;
        }

        .schedule-print-sheet {
          width: 100%;
          max-width: none;
        }
      }

      ${extraCss}
    </style>
  </head>
  <body>${bodyHtml}
    <script>
      window.addEventListener("load", function () {
        var shouldSkipAutoPrint = false;
        try {
          shouldSkipAutoPrint = window.localStorage.getItem("codex-disable-auto-print") === "1";
        } catch (error) {
          shouldSkipAutoPrint = false;
        }
        if (shouldSkipAutoPrint) {
          return;
        }
        setTimeout(function () {
          window.focus();
          window.print();
        }, 150);
      });
      window.addEventListener("afterprint", function () {
        window.close();
      });
    </script>
  </body>
</html>`);
  printWindow.document.close();
  return true;
}
