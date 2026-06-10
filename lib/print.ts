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
  pageMargin = "8mm",
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
        color: var(--text);
      }

      .screen-print-root [data-print-only="true"] {
        display: none !important;
      }

      @media print {
        .screen-print-root {
          page-break-inside: avoid;
          break-inside: avoid;
        }
      }

      ${extraCss}
    `,
  });
}
