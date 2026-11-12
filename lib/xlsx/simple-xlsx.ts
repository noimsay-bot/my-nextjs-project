// 표 하나짜리 .xlsx를 의존성 없이 만드는 최소 작성기.
// 무압축(stored) ZIP 안에 워크북 XML을 넣고, 문자열은 inlineStr로 쓴다.

export type SimpleXlsxCell = string | number | null;

export interface SimpleXlsxSheet {
  name: string;
  rows: SimpleXlsxCell[][];
  /** 열 너비(문자 수). 생략한 열은 기본 너비다. */
  columnWidths?: number[];
}

export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let name = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

function buildSheetXml(sheet: SimpleXlsxSheet) {
  const cols = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          if (cell === null || cell === "") return "";
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files: Array<{ path: string; content: string }>) {
  const encoder = new TextEncoder();
  const entries = files.map((file) => {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    return { name, data, crc: crc32(data) };
  });

  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const offsets: number[] = [];
  let cursor = 0;

  for (const entry of entries) {
    offsets.push(cursor);
    view.setUint32(cursor, 0x04034b50, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 0x0800, true);
    view.setUint16(cursor + 8, 0, true);
    view.setUint16(cursor + 10, 0, true);
    view.setUint16(cursor + 12, DOS_DATE, true);
    view.setUint32(cursor + 14, entry.crc, true);
    view.setUint32(cursor + 18, entry.data.length, true);
    view.setUint32(cursor + 22, entry.data.length, true);
    view.setUint16(cursor + 26, entry.name.length, true);
    view.setUint16(cursor + 28, 0, true);
    output.set(entry.name, cursor + 30);
    output.set(entry.data, cursor + 30 + entry.name.length);
    cursor += 30 + entry.name.length + entry.data.length;
  }

  const centralStart = cursor;
  entries.forEach((entry, index) => {
    view.setUint32(cursor, 0x02014b50, true);
    view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 20, true);
    view.setUint16(cursor + 8, 0x0800, true);
    view.setUint16(cursor + 10, 0, true);
    view.setUint16(cursor + 12, 0, true);
    view.setUint16(cursor + 14, DOS_DATE, true);
    view.setUint32(cursor + 16, entry.crc, true);
    view.setUint32(cursor + 20, entry.data.length, true);
    view.setUint32(cursor + 24, entry.data.length, true);
    view.setUint16(cursor + 28, entry.name.length, true);
    view.setUint32(cursor + 42, offsets[index], true);
    output.set(entry.name, cursor + 46);
    cursor += 46 + entry.name.length;
  });

  view.setUint32(cursor, 0x06054b50, true);
  view.setUint16(cursor + 8, entries.length, true);
  view.setUint16(cursor + 10, entries.length, true);
  view.setUint32(cursor + 12, cursor - centralStart, true);
  view.setUint32(cursor + 16, centralStart, true);
  return output;
}

export function buildSimpleXlsx(sheet: SimpleXlsxSheet) {
  const sheetName = escapeXml(sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return buildStoredZip([
    {
      path: "[Content_Types].xml",
      content: `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      path: "_rels/.rels",
      content: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      content: `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    { path: "xl/worksheets/sheet1.xml", content: buildSheetXml(sheet) },
  ]);
}
