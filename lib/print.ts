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
        height: 210mm;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        color: #111827;
        font-family: "Segoe UI", "Pretendard", sans-serif;
        text-align: left;
        page-break-after: always;
        page-break-inside: avoid;
        break-after: page;
        break-inside: avoid;
        overflow: hidden;
      }

      .schedule-print-sheet:last-child {
        page-break-after: auto;
        break-after: auto;
      }

      .schedule-print-header {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        min-height: 6mm;
      }

      .schedule-print-header strong {
        font-size: 13pt;
        font-weight: 800;
        line-height: 1.2;
      }

      .schedule-print-weekdays,
      .schedule-print-week {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 0;
      }

      .schedule-print-weekdays {
        margin-bottom: 0;
      }

      .schedule-print-weekdays > div {
        padding: 0.7mm 0.6mm;
        border: 1px solid #cbd5e1;
        border-radius: 0;
        background: #eef2f7;
        color: #0f172a;
        font-size: 8.5pt;
        font-weight: 800;
        text-align: center;
        line-height: 1.1;
      }

      .schedule-print-weeks {
        display: grid;
        gap: 0;
        min-height: 0;
      }

      .schedule-print-week {
        align-items: stretch;
        min-height: 0;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .schedule-print-day {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto 1fr;
        gap: 0.35mm;
        padding: 0.45mm;
        border: 1px solid #cbd5e1;
        border-radius: 0;
        background: #ffffff;
        overflow: hidden;
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
        gap: 0.8mm;
        align-items: center;
        min-width: 0;
      }

      .schedule-print-day-date {
        display: grid;
        gap: 0.2mm;
        justify-items: center;
        min-width: 7.5mm;
        color: #0f172a;
        line-height: 1;
      }

      .schedule-print-day-date strong {
        font-size: 9.2pt;
        font-weight: 900;
      }

      .schedule-print-day-date span {
        font-size: 6.8pt;
        font-weight: 800;
      }

      .schedule-print-day-title {
        display: grid;
        gap: 0.25mm;
        justify-items: center;
        align-content: center;
        min-width: 0;
        text-align: center;
      }

      .schedule-print-day-title strong {
        max-width: 100%;
        font-size: 9.5pt;
        font-weight: 900;
        line-height: 1.05;
        white-space: normal;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }

      .schedule-print-day-badge {
        color: #b91c1c;
        font-size: 7pt;
        font-weight: 900;
        line-height: 1.1;
      }

      .schedule-print-day-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 14mm;
        gap: 0.35mm;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      .schedule-print-day-content--no-vacation {
        grid-template-columns: minmax(0, 1fr);
      }

      .schedule-print-day-body {
        display: grid;
        gap: 0;
        min-width: 0;
        min-height: 0;
        align-content: start;
        overflow: hidden;
      }

      .schedule-print-assignment {
        display: grid;
        grid-template-columns: 8.5mm minmax(0, 1fr);
        gap: 0.4mm;
        align-items: stretch;
        min-width: 0;
        min-height: 0;
        padding: 0.3mm;
        border: 1px solid #d6dee8;
        border-radius: 0;
        background: #ffffff;
      }

      .schedule-print-assignment-label {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        color: #0f172a;
        font-size: 6.8pt;
        font-weight: 900;
        line-height: 1.05;
        text-align: center;
        white-space: pre-line;
      }

      .schedule-print-name-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0;
        align-items: stretch;
        min-width: 0;
        min-height: 0;
      }

      .schedule-print-name {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 4.7mm;
        padding: 0.25mm 0.2mm;
        border: 1px solid #dbe4ee;
        border-radius: 0;
        background: #f8fbff;
        color: #0f172a;
        font-size: 7.8pt;
        font-weight: 800;
        line-height: 1.08;
        text-align: center;
        white-space: nowrap;
        word-break: keep-all;
        overflow: hidden;
      }

      .schedule-print-name > span {
        display: block;
        min-width: 3em;
        max-width: 100%;
        text-align: center;
        white-space: nowrap;
      }

      .schedule-print-name-highlight {
        display: block;
        min-width: 3em;
        max-width: 100%;
        padding: 0.25mm 0.2mm;
        border-radius: 0;
        background: linear-gradient(transparent 18%, #fff176 18%, #fff176 88%, transparent 88%);
        color: inherit;
        font-weight: 900;
        text-align: center;
        white-space: nowrap;
      }

      .schedule-print-empty-line {
        color: #94a3b8;
        font-size: 7.2pt;
        line-height: 1.1;
        text-align: center;
      }

      .schedule-print-vacation {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        border: 1px solid #d6dee8;
        background: #ffffff;
        overflow: hidden;
      }

      .schedule-print-vacation-title {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 4.2mm;
        border-bottom: 1px solid #d6dee8;
        background: #eef2f7;
        color: #0f172a;
        font-size: 6.8pt;
        font-weight: 900;
        line-height: 1;
        text-align: center;
      }

      .schedule-print-vacation-list {
        display: grid;
        align-content: start;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      .schedule-print-vacation-name {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 4.4mm;
        padding: 0.25mm 0.2mm;
        border-bottom: 1px solid #dbe4ee;
        background: #f8fbff;
        color: #0f172a;
        font-size: 7.4pt;
        font-weight: 800;
        line-height: 1.05;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
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
          try {
            window.focus();
            window.print();
          } catch (error) {
            console.warn("자동 출력 호출에 실패했습니다. 브라우저의 인쇄 메뉴를 사용해 주세요.", error);
          }
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
