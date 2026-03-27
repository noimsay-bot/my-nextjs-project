"use client";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function printHtmlDocument({ title, bodyHtml }: { title: string; bodyHtml: string }) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  const copiedStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join("\n");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ko">
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
        size: A4 landscape;
        margin: 8mm;
      }

      .schedule-print-sheet {
        width: 100%;
        display: grid;
        gap: 4px;
        color: #111827;
        font-family: "Segoe UI", "Pretendard", sans-serif;
        text-align: center;
        page-break-inside: avoid;
      }

      .schedule-print-header {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .schedule-print-header strong {
        font-size: 15px;
        font-weight: 800;
        line-height: 1.2;
      }

      .schedule-print-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .schedule-print-table th,
      .schedule-print-table td {
        border: 1px solid #64748b;
      }

      .schedule-print-table th {
        padding: 4px 3px;
        background: #e2e8f0;
        color: #111827;
        font-size: 10px;
        font-weight: 800;
        text-align: center;
        line-height: 1.1;
      }

      .schedule-print-table td {
        width: 14.285%;
        height: 21mm;
        padding: 3px;
        vertical-align: top;
        background: #ffffff;
        text-align: center;
        line-height: 1.1;
      }

      .schedule-print-empty {
        background: #f8fafc;
      }

      .schedule-print-overflow {
        background: #f8fafc;
      }

      .schedule-print-date {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        margin-bottom: 3px;
        padding-bottom: 2px;
        border-bottom: 1px solid #cbd5e1;
        font-size: 9px;
        font-weight: 800;
        line-height: 1.1;
      }

      .schedule-print-assignments {
        display: grid;
        gap: 2px;
      }

      .schedule-print-assignment {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1px;
        align-items: start;
        font-size: 8px;
        line-height: 1.1;
        text-align: center;
        padding-top: 2px;
      }

      .schedule-print-assignment + .schedule-print-assignment {
        border-top: 1px solid #cbd5e1;
      }

      .schedule-print-assignment strong {
        font-weight: 800;
      }

      .schedule-print-assignment span {
        word-break: keep-all;
        text-align: center;
      }

      .schedule-print-name-highlight {
        display: inline;
        padding: 0 2px;
        background: linear-gradient(transparent 18%, #fff176 18%, #fff176 88%, transparent 88%);
        color: inherit;
        font-weight: 800;
      }

      .schedule-print-empty-line {
        color: #94a3b8;
        font-size: 8px;
        line-height: 1.1;
      }
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
