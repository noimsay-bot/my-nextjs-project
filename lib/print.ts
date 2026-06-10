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

function copyFormState(source: Element, target: Element) {
  const sourceFields = Array.from(source.querySelectorAll("input, textarea, select"));
  const targetFields = Array.from(target.querySelectorAll("input, textarea, select"));

  sourceFields.forEach((sourceField, index) => {
    const targetField = targetFields[index];
    if (!targetField) return;

    if (sourceField instanceof HTMLInputElement && targetField instanceof HTMLInputElement) {
      targetField.value = sourceField.value;
      targetField.setAttribute("value", sourceField.value);
      if (sourceField.type === "checkbox" || sourceField.type === "radio") {
        targetField.checked = sourceField.checked;
        targetField.toggleAttribute("checked", sourceField.checked);
      }
      return;
    }

    if (sourceField instanceof HTMLTextAreaElement && targetField instanceof HTMLTextAreaElement) {
      targetField.value = sourceField.value;
      targetField.textContent = sourceField.value;
      return;
    }

    if (sourceField instanceof HTMLSelectElement && targetField instanceof HTMLSelectElement) {
      targetField.value = sourceField.value;
      Array.from(targetField.options).forEach((option) => {
        option.toggleAttribute("selected", option.value === sourceField.value);
      });
    }
  });
}

function getAncestorClassNames(element: HTMLElement) {
  const classNames: string[] = [];
  let current = element.parentElement;

  while (current && current !== document.body) {
    const className = current.getAttribute("class")?.trim();
    if (className) {
      classNames.unshift(className);
    }
    current = current.parentElement;
  }

  return classNames;
}

function wrapWithAncestorClasses(html: string, classNames: string[]) {
  return classNames.reduceRight(
    (current, className) => `<div class="${escapeHtml(className)}">${current}</div>`,
    html,
  );
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
        display: grid;
        gap: 3px;
        color: #111827;
        font-family: "Segoe UI", "Pretendard", sans-serif;
        text-align: center;
        page-break-inside: avoid;
        overflow: hidden;
      }

      .schedule-print-header {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .schedule-print-header strong {
        font-size: 13px;
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
        padding: 3px 2px;
        background: #e2e8f0;
        color: #111827;
        font-size: 9px;
        font-weight: 800;
        text-align: center;
        line-height: 1.1;
      }

      .schedule-print-table td {
        width: 14.285%;
        height: 18mm;
        padding: 2px;
        vertical-align: top;
        background: #ffffff;
        text-align: center;
        line-height: 1.1;
        overflow: hidden;
      }

      .schedule-print-sheet--weeks-6 .schedule-print-table td {
        height: 16mm;
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
        margin-bottom: 2px;
        padding-bottom: 1px;
        border-bottom: 1px solid #cbd5e1;
        font-size: 8px;
        font-weight: 800;
        line-height: 1.1;
      }

      .schedule-print-assignments {
        display: grid;
        gap: 1px;
        max-height: calc(100% - 14px);
        overflow: hidden;
      }

      .schedule-print-assignment {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1px;
        align-items: start;
        font-size: 7px;
        line-height: 1.05;
        text-align: center;
        padding-top: 1px;
        overflow: hidden;
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
        overflow: hidden;
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
        font-size: 7px;
        line-height: 1.1;
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

export function printElementDocument({
  title,
  element,
  pageSize = "A4 landscape",
  pageMargin = "5mm",
  extraCss = "",
}: {
  title: string;
  element: HTMLElement | null;
  pageSize?: string;
  pageMargin?: string;
  extraCss?: string;
}) {
  if (!element) return false;

  const clone = element.cloneNode(true) as HTMLElement;
  copyFormState(element, clone);

  return printHtmlDocument({
    title,
    pageSize,
    pageMargin,
    bodyHtml: `<main class="screen-print-root">${wrapWithAncestorClasses(clone.outerHTML, getAncestorClassNames(element))}</main>`,
    extraCss: `
      html,
      body {
        background: var(--bg) !important;
        color: var(--text) !important;
      }

      .screen-print-root {
        width: 100%;
        max-width: none;
        color: var(--text);
      }

      .screen-print-root [data-print-only="true"] {
        display: none !important;
      }

      @media print {
        .screen-print-root {
          page-break-inside: auto;
          break-inside: auto;
        }

        .screen-print-root .schedule-calendar-scroll,
        .screen-print-root .schedule-calendar-scroll--daily,
        .screen-print-root .schedule-calendar-scroll--monthly,
        .screen-print-root .schedule-published-panel--fit .schedule-calendar-scroll--daily,
        .screen-print-root .schedule-published-panel--mobile-layout .schedule-calendar-scroll--daily {
          width: 100% !important;
          max-width: none !important;
          overflow: visible !important;
          padding: 0 !important;
        }

        .screen-print-root .schedule-calendar-scroll > div {
          width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
          margin: 0 !important;
          position: static !important;
        }

        .screen-print-root .schedule-calendar-zoom,
        .screen-print-root .schedule-calendar-zoom--daily,
        .screen-print-root .schedule-calendar-zoom--monthly,
        .screen-print-root .schedule-published-panel--fit .schedule-calendar-zoom--daily {
          width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
          position: static !important;
          transform: none !important;
          transform-origin: initial !important;
          will-change: auto !important;
        }

        .screen-print-root .schedule-calendar-grid,
        .screen-print-root .schedule-calendar-grid--daily,
        .screen-print-root .schedule-calendar-grid--monthly,
        .screen-print-root .schedule-calendar-grid--home-mobile-three-day,
        .screen-print-root .schedule-published-panel--fit .schedule-calendar-grid--daily,
        .screen-print-root .schedule-published-panel--mobile-layout .schedule-calendar-grid--home-mobile-three-day {
          width: 100% !important;
          min-width: 0 !important;
          display: grid !important;
          grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
          gap: 5px !important;
          align-items: start !important;
          justify-items: stretch !important;
        }

        .screen-print-root .schedule-calendar-grid--home-mobile-three-day > div {
          display: contents !important;
          width: auto !important;
        }

        .screen-print-root .schedule-weekday {
          display: block !important;
          width: auto !important;
          min-width: 0 !important;
        }

        .screen-print-root .schedule-day-card,
        .screen-print-root .schedule-day-card--monthly,
        .screen-print-root .schedule-published-panel--fit .schedule-day-card,
        .screen-print-root .schedule-published-panel--mobile-layout .schedule-day-card {
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          min-height: 0 !important;
          height: auto !important;
          justify-self: stretch !important;
          overflow: visible !important;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .screen-print-root .schedule-day-head,
        .screen-print-root .schedule-day-head--monthly {
          row-gap: 0 !important;
        }

        .screen-print-root .schedule-assignment-label {
          font-size: 12px !important;
          line-height: 1.1 !important;
        }

        .screen-print-root .schedule-name-grid,
        .screen-print-root .schedule-name-grid--monthly,
        .screen-print-root .schedule-published-panel--fit .schedule-name-grid {
          width: 100% !important;
          min-width: 0 !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 0 !important;
        }

        .screen-print-root .schedule-name-chip,
        .screen-print-root .schedule-name-chip--compact,
        .screen-print-root .schedule-published-panel--fit .schedule-name-chip,
        .screen-print-root .schedule-published-panel--mobile-layout .schedule-name-chip {
          width: auto !important;
          min-width: 0 !important;
          max-width: 100% !important;
          min-height: 24px !important;
          border-radius: 0 !important;
          font-size: 9px !important;
        }

        .screen-print-root .schedule-name-chip__text,
        .screen-print-root .schedule-published-panel--fit .schedule-name-chip__text,
        .screen-print-root .schedule-published-panel--mobile-layout .schedule-name-chip__text {
          min-width: 0 !important;
          max-width: 100% !important;
          white-space: normal !important;
          overflow: visible !important;
          text-overflow: clip !important;
          overflow-wrap: anywhere !important;
          word-break: keep-all !important;
        }
      }

      ${extraCss}
    `,
  });
}
