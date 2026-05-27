"use client";

import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  closeElectionEvent,
  fetchElectionWorkspace,
  publishElectionEvent,
  saveElectionWorkspace,
} from "@/lib/election/storage";
import { getKstDateKey } from "@/lib/election/dates";
import type {
  ElectionEvent,
  ElectionCellColorKey,
  ElectionCellColors,
  ElectionPoint,
  ElectionPointInput,
  ElectionProfileOption,
  ElectionSaveInput,
  ElectionStatus,
} from "@/lib/election/types";
import { getSession, subscribeToAuth, type SessionUser } from "@/lib/auth/storage";
import styles from "./Election.module.css";

type Message = { tone: "ok" | "warn" | "note"; text: string };
type DayPart = "am" | "pm";
type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
type PrintPaperSize = "A3" | "A4";
type PrintOrientation = "portrait" | "landscape";
type PrintColorMode = "color" | "mono";
type ColorPaintPalette = "light" | "dark";
type ColorPaintSelection = { color: string; palette: ColorPaintPalette };
type PaintTarget = "region" | ElectionCellColorKey;

interface DraftPoint extends ElectionPointInput {
  localId: string;
}

type LocationPoint = DraftPoint | ElectionPoint;

interface DraftEvent {
  id: string | null;
  title: string;
  electionDate: string;
  status: ElectionStatus;
  points: DraftPoint[];
}

const statusLabels: Record<ElectionStatus, string> = {
  draft: "작성중",
  published: "게시중",
  closed: "종료",
};

const poolVideoOptions = [
  "JTBC",
  "kbs",
  "mbc",
  "sbs",
  "tv조선",
  "채널a",
  "연합tv",
  "ktv",
  "obs",
  "ytn",
  "mbn",
  "국회방송",
] as const;

const tableColumns = [
  "#",
  "지역",
  "장소",
  "코리아풀영상",
  "장비배정",
  "TRS",
  "촬영기자",
  "오디오맨",
  "중계시간",
  "취재기자",
  "주소",
  "비고",
  "중계자리",
  "LAN",
  "조명",
] as const;

const readOnlyTableColumns = tableColumns;
type ElectionTableColumn = (typeof tableColumns)[number];
const staffNameColumns = new Set(["촬영기자", "오디오맨", "취재기자"]);
const LIVE_POSITION_CHECKED_VALUE = "checked";
const DEFAULT_EQUIPMENT_NAME = "TVU-";
const AUTO_SAVE_DEBOUNCE_MS = 900;
const ELECTION_PRINT_STYLE_ID = "election-print-page-style";
const ELECTION_PRINT_COLOR_MODE_CLASS = "election-print-color-mode";
const ELECTION_COLUMN_WIDTH_STORAGE_KEY = "jtbc-election-column-widths-v1";
const printPaperDimensions: Record<PrintPaperSize, { width: number; height: number }> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
};

const defaultColumnWidths: Record<ElectionTableColumn, number> = {
  "#": 30,
  "지역": 86,
  "장소": 128,
  "코리아풀영상": 82,
  "장비배정": 106,
  "TRS": 78,
  "촬영기자": 106,
  "오디오맨": 104,
  "중계시간": 116,
  "취재기자": 106,
  "주소": 290,
  "비고": 146,
  "중계자리": 54,
  "LAN": 54,
  "조명": 82,
};

const minColumnWidths: Record<ElectionTableColumn, number> = {
  "#": 26,
  "지역": 58,
  "장소": 72,
  "코리아풀영상": 58,
  "장비배정": 72,
  "TRS": 54,
  "촬영기자": 72,
  "오디오맨": 72,
  "중계시간": 78,
  "취재기자": 72,
  "주소": 120,
  "비고": 86,
  "중계자리": 42,
  "LAN": 42,
  "조명": 58,
};

const regionColorOptions = [
  { value: "", label: "없음", background: "transparent", text: "#0f172a" },
  { value: "region-sky", label: "하늘", background: "#dff3ff", text: "#0f172a" },
  { value: "region-mint", label: "민트", background: "#def7ec", text: "#0f172a" },
  { value: "region-rose", label: "분홍", background: "#ffe4e6", text: "#0f172a" },
  { value: "region-amber", label: "노랑", background: "#fef3c7", text: "#0f172a" },
  { value: "region-lavender", label: "보라", background: "#ede9fe", text: "#0f172a" },
  { value: "region-slate", label: "회색", background: "#e2e8f0", text: "#0f172a" },
] as const;

const cellColorOptions = [
  { value: "", label: "없음", background: "transparent", text: "#0f172a" },
  { value: "cell-blue", label: "파랑", background: "#1d4ed8", text: "#ffffff" },
  { value: "cell-green", label: "초록", background: "#047857", text: "#ffffff" },
  { value: "cell-red", label: "빨강", background: "#be123c", text: "#ffffff" },
  { value: "cell-purple", label: "보라", background: "#6d28d9", text: "#ffffff" },
  { value: "cell-amber", label: "갈색", background: "#b45309", text: "#ffffff" },
  { value: "cell-slate", label: "진회색", background: "#334155", text: "#ffffff" },
] as const;

type TableMeasurements = {
  headerHeight: number;
  rowHeights: Record<string, number>;
};

function sanitizeColumnWidths(input: unknown): Record<ElectionTableColumn, number> {
  const source = input && typeof input === "object" ? input as Partial<Record<ElectionTableColumn, unknown>> : {};
  return tableColumns.reduce<Record<ElectionTableColumn, number>>((widths, column) => {
    const value = Number(source[column]);
    widths[column] = Number.isFinite(value)
      ? Math.max(minColumnWidths[column], Math.min(520, Math.round(value)))
      : defaultColumnWidths[column];
    return widths;
  }, {} as Record<ElectionTableColumn, number>);
}

function readStoredColumnWidths() {
  if (typeof window === "undefined") return sanitizeColumnWidths(null);
  try {
    return sanitizeColumnWidths(JSON.parse(window.localStorage.getItem(ELECTION_COLUMN_WIDTH_STORAGE_KEY) ?? "null"));
  } catch {
    return sanitizeColumnWidths(null);
  }
}

function getTableColumnsWidth(columns: readonly ElectionTableColumn[], widths: Record<ElectionTableColumn, number>) {
  return columns.reduce((sum, column) => sum + widths[column], 0);
}

function getPointLocationKey(point: LocationPoint) {
  if ("localId" in point) return point.localId;
  return point.id;
}

function normalizeLocationName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
}

function locationTextIncludesUserName(value: string | null | undefined, username: string) {
  const normalizedValue = normalizeLocationName(value);
  const normalizedName = normalizeLocationName(username);
  return Boolean(normalizedName && normalizedValue.includes(normalizedName));
}

function pointMatchesSession(point: LocationPoint, session: SessionUser) {
  const userId = session.id;
  const userIdMatched = [
    point.cameraStaffUserId,
    point.cameraStaffUserIdPm,
    point.audioStaffUserId,
    point.reporterUserId,
  ].some((id) => Boolean(id && id === userId));

  if (userIdMatched) return true;

  return [
    point.cameraStaffName,
    point.cameraStaffNamePm,
    point.audioStaffName,
    point.audioStaffNamePm,
    point.reporterName,
    point.reporterNamePm,
  ].some((name) => locationTextIncludesUserName(name, session.username));
}

function getTableColumnClassName(column: ElectionTableColumn) {
  if (column === "#") return styles.numberColumn;
  if (column === "코리아풀영상") return styles.poolVideoColumn;
  if (staffNameColumns.has(column)) return styles.nameColumn;
  if (column === "중계시간") return styles.timeColumn;
  if (column === "주소") return styles.addressColumn;
  if (column === "비고") return styles.wideColumn;
  return column === "중계자리" || column === "LAN" ? styles.positionColumn : undefined;
}

function renderTableColumnLabel(column: ElectionTableColumn) {
  if (column === "코리아풀영상") {
    return (
      <>
        코리아풀
        <br />
        영상
      </>
    );
  }
  if (column === "중계자리") {
    return (
      <>
        중계
        <br />
        자리
      </>
    );
  }
  return column;
}

function ElectionTableColGroup({
  columns,
  widths,
}: {
  columns: readonly ElectionTableColumn[];
  widths: Record<ElectionTableColumn, number>;
}) {
  return (
    <colgroup>
      {columns.map((column) => (
        <col key={column} style={{ width: `${widths[column]}px` }} />
      ))}
    </colgroup>
  );
}

function areTableMeasurementsEqual(left: TableMeasurements, right: TableMeasurements) {
  if (left.headerHeight !== right.headerHeight) return false;
  const leftKeys = Object.keys(left.rowHeights);
  const rightKeys = Object.keys(right.rowHeights);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left.rowHeights[key] === right.rowHeights[key]);
}

function normalizeRegionValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function getRegionGroupRange(points: Pick<ElectionPointInput, "region">[], index: number) {
  const region = normalizeRegionValue(points[index]?.region);
  if (!region) return { start: index, end: index };

  let start = index;
  while (start > 0 && normalizeRegionValue(points[start - 1]?.region) === region) {
    start -= 1;
  }

  let end = index;
  while (end < points.length - 1 && normalizeRegionValue(points[end + 1]?.region) === region) {
    end += 1;
  }

  return { start, end };
}

function isRegionCellCoveredByPreviousRow(points: Pick<ElectionPointInput, "region">[], index: number) {
  if (index <= 0) return false;
  const region = normalizeRegionValue(points[index]?.region);
  return Boolean(region && normalizeRegionValue(points[index - 1]?.region) === region);
}

function getRegionRowSpan(points: Pick<ElectionPointInput, "region">[], index: number) {
  if (isRegionCellCoveredByPreviousRow(points, index)) return 0;
  const range = getRegionGroupRange(points, index);
  return range.end - range.start + 1;
}

function hasElectionManagerViewRole(session: SessionUser | null | undefined) {
  return session?.role === "desk" || session?.role === "team_lead" || session?.role === "admin";
}

function hasElectionGeneralPreviewRole(session: SessionUser | null | undefined) {
  return session?.role === "desk" || session?.role === "team_lead";
}

function isRegionGroupEnd(points: Pick<ElectionPointInput, "region">[], index: number) {
  const region = normalizeRegionValue(points[index]?.region);
  return Boolean(region && getRegionGroupRange(points, index).end === index);
}

function canMoveRegionGroup(points: Pick<ElectionPointInput, "region">[], index: number, direction: "up" | "down") {
  const range = getRegionGroupRange(points, index);
  return direction === "up" ? range.start > 0 : range.end < points.length - 1;
}

function canMovePointWithinRegion(points: Pick<ElectionPointInput, "region">[], index: number, direction: "up" | "down") {
  const range = getRegionGroupRange(points, index);
  return direction === "up" ? index > range.start : index < range.end;
}

function getRegionColorOption(value: string) {
  return regionColorOptions.find((option) => option.value === value);
}

function getCellColorOption(value: string) {
  return cellColorOptions.find((option) => option.value === value);
}

function getKnownColorOption(value: string) {
  return getCellColorOption(value) ?? getRegionColorOption(value);
}

function isKnownColorToken(value: string) {
  return Boolean(getKnownColorOption(value)?.value);
}

function getRegionGroupColor(points: Pick<ElectionPointInput, "region" | "regionColor">[], index: number) {
  const range = getRegionGroupRange(points, index);
  for (let pointIndex = range.start; pointIndex <= range.end; pointIndex += 1) {
    const color = points[pointIndex]?.regionColor?.trim() ?? "";
    if (isKnownColorToken(color)) return color;
  }
  return "";
}

function getCellColor(point: Pick<ElectionPointInput, "cellColors">, key: ElectionCellColorKey) {
  const color = point.cellColors?.[key]?.trim() ?? "";
  return isKnownColorToken(color) ? color : "";
}

function getCellDisplayColor(points: ElectionPointInput[], point: ElectionPointInput, index: number, key: ElectionCellColorKey) {
  return getCellColor(point, key) || getRegionGroupColor(points, index);
}

function getColorStyle(value: string): CSSProperties | undefined {
  const option = getCellColorOption(value) ?? getRegionColorOption(value);
  if (!option?.value) return undefined;
  return {
    "--election-cell-bg": option.background,
    "--election-cell-color": option.text,
  } as CSSProperties;
}

function getColorableCellClassName(baseClassName: string | undefined, color: string) {
  return [
    baseClassName,
    styles.colorableCell,
    color ? styles.coloredCell : "",
    getCellColorOption(color)?.value ? styles.darkColorCell : "",
  ].filter(Boolean).join(" ");
}

function ReorderMenu({
  label,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  if (!canMoveUp && !canMoveDown) {
    return (
      <button type="button" className={styles.cellActionButton} disabled title={`${label} 이동`} aria-label={`${label} 이동`}>
        ↕
      </button>
    );
  }

  return (
    <details className={styles.reorderMenu}>
      <summary className={styles.cellActionButton} title={`${label} 이동`} aria-label={`${label} 이동`}>
        ↕
      </summary>
      <span className={styles.reorderMenuPanel}>
        <button type="button" className={styles.cellActionButton} disabled={!canMoveUp} onClick={onMoveUp} title={`${label} 위로`} aria-label={`${label} 위로`}>
          ↑
        </button>
        <button type="button" className={styles.cellActionButton} disabled={!canMoveDown} onClick={onMoveDown} title={`${label} 아래로`} aria-label={`${label} 아래로`}>
          ↓
        </button>
      </span>
    </details>
  );
}

function ColorPaintMenu({
  selection,
  disabled,
  onSelect,
  onCancel,
}: {
  selection: ColorPaintSelection | null;
  disabled?: boolean;
  onSelect: (selection: ColorPaintSelection) => void;
  onCancel: () => void;
}) {
  const selected = selection?.color ? getKnownColorOption(selection.color) : null;
  return (
    <details className={styles.colorPaintMenu}>
      <summary
        className={`${styles.colorPaintButton} ${selection ? styles.colorPaintButtonActive : ""}`.trim()}
        title="색상 지정"
        aria-label="색상 지정"
      >
        <span
          className={`${styles.colorSwatch} ${selected?.value ? "" : styles.colorSwatchEmpty}`.trim()}
          style={selected?.value ? { backgroundColor: selected.background } : undefined}
        />
        <span>색상 지정</span>
      </summary>
      <div className={styles.colorPaintPanel}>
        <div className={styles.colorPaletteGroup}>
          <span className={styles.colorPaletteTitle}>연한</span>
          <div className={styles.colorPaletteGrid}>
            {regionColorOptions.map((option) => (
              <button
                type="button"
                key={`light-${option.value || "none"}`}
                className={`${styles.colorOption} ${selection?.palette === "light" && option.value === selection.color ? styles.colorOptionSelected : ""}`.trim()}
                disabled={disabled}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  onSelect({ color: option.value, palette: "light" });
                }}
                title={`연한 색상: ${option.label}`}
                aria-label={`연한 색상: ${option.label}`}
              >
                <span
                  className={`${styles.colorSwatch} ${option.value ? "" : styles.colorSwatchEmpty}`.trim()}
                  style={option.value ? { backgroundColor: option.background } : undefined}
                />
              </button>
            ))}
          </div>
        </div>
        <div className={styles.colorPaletteGroup}>
          <span className={styles.colorPaletteTitle}>진한</span>
          <div className={styles.colorPaletteGrid}>
            {cellColorOptions.map((option) => (
              <button
                type="button"
                key={`dark-${option.value || "none"}`}
                className={`${styles.colorOption} ${selection?.palette === "dark" && option.value === selection.color ? styles.colorOptionSelected : ""}`.trim()}
                disabled={disabled}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  onSelect({ color: option.value, palette: "dark" });
                }}
                title={`진한 색상: ${option.label}`}
                aria-label={`진한 색상: ${option.label}`}
              >
                <span
                  className={`${styles.colorSwatch} ${option.value ? "" : styles.colorSwatchEmpty}`.trim()}
                  style={option.value ? { backgroundColor: option.background } : undefined}
                />
              </button>
            ))}
          </div>
        </div>
        {selection ? (
          <button type="button" className={styles.colorPaintCancel} disabled={disabled} onClick={onCancel}>
            해제
          </button>
        ) : null}
      </div>
    </details>
  );
}

function upsertElectionPrintPageStyle(paperSize: PrintPaperSize, orientation: PrintOrientation) {
  const dimensions = printPaperDimensions[paperSize];
  const width = orientation === "landscape" ? dimensions.height : dimensions.width;
  const height = orientation === "landscape" ? dimensions.width : dimensions.height;
  const styleText = `
@page {
  size: ${width}mm ${height}mm;
  margin: 10mm;
}

@media print {
  body.election-print-mode .${styles.printSheet} {
    width: calc(${width}mm - 20mm);
    min-height: calc(${height}mm - 20mm);
  }
}
`;
  let styleElement = document.getElementById(ELECTION_PRINT_STYLE_ID) as HTMLStyleElement | null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = ELECTION_PRINT_STYLE_ID;
    styleElement.media = "print";
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = styleText;
}

function ElectionPrintControls({
  paperSize,
  orientation,
  colorMode,
  disabled,
  onPaperSizeChange,
  onOrientationChange,
  onColorModeChange,
  onPrint,
}: {
  paperSize: PrintPaperSize;
  orientation: PrintOrientation;
  colorMode: PrintColorMode;
  disabled?: boolean;
  onPaperSizeChange: (value: PrintPaperSize) => void;
  onOrientationChange: (value: PrintOrientation) => void;
  onColorModeChange: (value: PrintColorMode) => void;
  onPrint: () => void;
}) {
  return (
    <div className={styles.printControls}>
      <select
        className="field-select"
        value={paperSize}
        aria-label="출력 용지"
        onChange={(event) => onPaperSizeChange(event.target.value as PrintPaperSize)}
      >
        <option value="A3">A3</option>
        <option value="A4">A4</option>
      </select>
      <select
        className="field-select"
        value={orientation}
        aria-label="출력 방향"
        onChange={(event) => onOrientationChange(event.target.value as PrintOrientation)}
      >
        <option value="portrait">세로</option>
        <option value="landscape">가로</option>
      </select>
      <select
        className="field-select"
        value={colorMode}
        aria-label="출력 컬러"
        onChange={(event) => onColorModeChange(event.target.value as PrintColorMode)}
      >
        <option value="color">컬러</option>
        <option value="mono">흑백</option>
      </select>
      <button type="button" className="btn" disabled={disabled} onClick={onPrint}>
        출력
      </button>
    </div>
  );
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankPoint(sortOrder = 0): DraftPoint {
  return {
    localId: createLocalId(),
    sortOrder,
    region: "",
    place: "",
    poolVideo: "",
    equipmentName: DEFAULT_EQUIPMENT_NAME,
    equipmentType: "",
    trs: "",
    cameraStaffName: "",
    cameraStaffUserId: null,
    cameraStaffNamePm: "",
    cameraStaffUserIdPm: null,
    audioStaffName: "",
    audioStaffUserId: null,
    audioStaffNamePm: "",
    reporterName: "",
    reporterUserId: null,
    reporterNamePm: "",
    liveTime: "",
    liveTimePm: "",
    address: "",
    note: "",
    livePosition: "",
    lan: "",
    lighting: "",
    regionColor: "",
    cellColors: {},
    isActive: true,
  };
}

function createBlankDraft(): DraftEvent {
  return {
    id: null,
    title: "",
    electionDate: getKstDateKey(),
    status: "draft",
    points: [createBlankPoint(0)],
  };
}

function eventToDraft(event: ElectionEvent): DraftEvent {
  return {
    id: event.id,
    title: event.title,
    electionDate: event.electionDate,
    status: event.status,
    points: event.points.length
      ? event.points.map((point, index) => ({
          localId: point.id || createLocalId(),
          sortOrder: index,
          region: point.region,
          place: point.place,
          poolVideo: point.poolVideo,
          equipmentName: point.equipmentName || DEFAULT_EQUIPMENT_NAME,
          equipmentType: point.equipmentType,
          trs: point.trs,
          cameraStaffName: point.cameraStaffName,
          cameraStaffUserId: point.cameraStaffUserId,
          cameraStaffNamePm: point.cameraStaffNamePm,
          cameraStaffUserIdPm: point.cameraStaffUserIdPm,
          audioStaffName: point.audioStaffName,
          audioStaffUserId: point.audioStaffUserId,
          audioStaffNamePm: point.audioStaffNamePm,
          reporterName: point.reporterName,
          reporterUserId: point.reporterUserId,
          reporterNamePm: point.reporterNamePm,
          liveTime: point.liveTime,
          liveTimePm: point.liveTimePm,
          address: point.address,
          note: point.note,
          livePosition: point.livePosition,
          lan: point.lan,
          lighting: point.lighting,
          regionColor: point.regionColor,
          cellColors: point.cellColors,
          isActive: point.isActive,
        }))
      : [createBlankPoint(0)],
  };
}

function draftToSaveInput(draft: DraftEvent): ElectionSaveInput {
  return {
    id: draft.id,
    title: draft.title,
    electionDate: draft.electionDate,
    points: draft.points.map((point, index) => ({ ...point, sortOrder: index })),
  };
}

function draftToReadOnlyEvent(draft: DraftEvent): ElectionEvent {
  const now = new Date().toISOString();
  return {
    id: draft.id ?? "election-closed-preview",
    title: draft.title,
    electionDate: draft.electionDate,
    status: draft.status,
    publishedAt: null,
    publishedBy: null,
    closedAt: null,
    closedBy: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    points: draft.points.map((point, index) => ({
      id: point.id ?? point.localId,
      eventId: draft.id ?? "",
      sortOrder: index,
      region: point.region,
      place: point.place,
      poolVideo: point.poolVideo,
      equipmentName: point.equipmentName,
      equipmentType: point.equipmentType,
      trs: point.trs,
      cameraStaffName: point.cameraStaffName,
      cameraStaffUserId: point.cameraStaffUserId,
      cameraStaffNamePm: point.cameraStaffNamePm,
      cameraStaffUserIdPm: point.cameraStaffUserIdPm,
      audioStaffName: point.audioStaffName,
      audioStaffUserId: point.audioStaffUserId,
      audioStaffNamePm: point.audioStaffNamePm,
      reporterName: point.reporterName,
      reporterUserId: point.reporterUserId,
      reporterNamePm: point.reporterNamePm,
      liveTime: point.liveTime,
      liveTimePm: point.liveTimePm,
      address: point.address,
      note: point.note,
      livePosition: point.livePosition,
      lan: point.lan,
      lighting: point.lighting,
      regionColor: point.regionColor,
      cellColors: point.cellColors,
      isActive: point.isActive,
      createdAt: now,
      updatedAt: now,
    } satisfies ElectionPoint)),
  };
}

function getDraftSaveSignature(draft: DraftEvent | null) {
  if (!draft) return "";
  const input = draftToSaveInput(draft);
  return JSON.stringify({
    title: input.title,
    electionDate: input.electionDate,
    points: input.points,
  });
}

function getStatusClassName(status: ElectionStatus) {
  if (status === "published") return `${styles.statusBadge} ${styles.statusPublished}`;
  if (status === "closed") return `${styles.statusBadge} ${styles.statusClosed}`;
  return `${styles.statusBadge} ${styles.statusDraft}`;
}

function getAutoSaveStatusLabel(status: AutoSaveStatus) {
  if (status === "pending") return "자동 저장 대기";
  if (status === "saving") return "자동 저장 중";
  if (status === "saved") return "자동 저장됨";
  if (status === "error") return "자동 저장 실패";
  return null;
}

function formatElectionBoardTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  return trimmed ? `${trimmed} 취재 배치표` : "취재 배치표";
}

function readOnlyValue(value: string | null | undefined) {
  const display = value?.trim() || "-";
  const lines = display === "-" ? [] : display.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (lines.length > 1) {
    return (
      <span className={`${styles.readOnlyCell} ${styles.readOnlyCellMultiline}`}>
        {lines.map((line, index) => (
          <span key={`${line}-${index}`}>{line}</span>
        ))}
      </span>
    );
  }

  return (
    <span className={`${styles.readOnlyCell} ${display === "-" ? styles.readOnlyCellEmpty : ""}`.trim()}>
      {lines[0] ?? display}
    </span>
  );
}

function isLivePositionChecked(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === LIVE_POSITION_CHECKED_VALUE || normalized === "true" || normalized === "yes" || normalized === "1";
}

function readOnlySplitValue(morning: string | null | undefined, afternoon: string | null | undefined) {
  const morningText = morning?.trim() || "-";
  const afternoonText = afternoon?.trim() || "-";
  if (afternoonText === "-") {
    return readOnlyValue(morningText);
  }

  return (
    <span className={styles.readOnlySplit}>
      <span><b>오전</b>{morningText}</span>
      <span><b>오후</b>{afternoonText}</span>
    </span>
  );
}

function getPrintTableStyle(pointCount: number, orientation: PrintOrientation) {
  const fontSize = pointCount <= 6 ? 12 : pointCount <= 10 ? 11 : pointCount <= 16 ? 10 : pointCount <= 24 ? 9 : 8.4;
  const headerFontSize = Math.max(8.8, fontSize - 0.6);
  const splitLabelFontSize = Math.max(7.6, fontSize - 1.4);
  const nameBoost = orientation === "portrait"
    ? pointCount <= 10 ? 2.2 : pointCount <= 18 ? 1.8 : pointCount <= 28 ? 1.45 : 1.15
    : pointCount <= 18 ? 1.2 : 0.9;
  const nameFontSize = fontSize + nameBoost;
  const cellPadding = pointCount <= 10 ? "5px 3px" : pointCount <= 18 ? "4px 3px" : "3px 2px";

  return {
    "--election-print-font-size": `${fontSize}px`,
    "--election-print-name-font-size": `${nameFontSize}px`,
    "--election-print-header-font-size": `${headerFontSize}px`,
    "--election-print-split-label-font-size": `${splitLabelFontSize}px`,
    "--election-print-cell-padding": cellPadding,
  } as CSSProperties;
}

function hasAfternoonValues(point: ElectionPointInput) {
  return Boolean(
    point.cameraStaffNamePm.trim() ||
    point.audioStaffNamePm.trim() ||
    point.reporterNamePm.trim() ||
    point.liveTimePm.trim(),
  );
}

function resolveProfileIdByName(profiles: ElectionProfileOption[], name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return profiles.find((profile) => profile.name.trim() === trimmed)?.id ?? null;
}

function getPoolVideoOptions(value: string) {
  const trimmed = value.trim();
  if (!trimmed || poolVideoOptions.includes(trimmed as (typeof poolVideoOptions)[number])) {
    return poolVideoOptions;
  }
  return [trimmed, ...poolVideoOptions];
}

function showInputPicker(input: HTMLInputElement) {
  try {
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // Some browsers restrict picker opening unless it is triggered by a direct user gesture.
  }
}

function SplitTextInput({
  morning,
  afternoon,
  onMorningChange,
  onAfternoonChange,
  listId,
  inputClassName,
  placeholder,
}: {
  morning: string;
  afternoon: string;
  onMorningChange: (value: string) => void;
  onAfternoonChange: (value: string) => void;
  listId?: string;
  inputClassName?: string;
  placeholder?: string;
}) {
  const className = ["field-input", inputClassName].filter(Boolean).join(" ");
  const inputPickerProps = listId
    ? {
        onClick: (event: ReactMouseEvent<HTMLInputElement>) => showInputPicker(event.currentTarget),
      }
    : {};

  return (
    <div className={styles.splitStack}>
      <label>
        <span>오전</span>
        <input className={className} list={listId} value={morning} placeholder={placeholder} onChange={(event) => onMorningChange(event.target.value)} {...inputPickerProps} />
      </label>
      <label>
        <span>오후</span>
        <input className={className} list={listId} value={afternoon} placeholder={placeholder} onChange={(event) => onAfternoonChange(event.target.value)} {...inputPickerProps} />
      </label>
    </div>
  );
}

function getAddressInputLines(value: string) {
  const lines = value.split(/\r?\n/);
  return lines.length > 0 ? lines : [""];
}

function setAddressInputLine(value: string, index: number, nextLine: string) {
  const lines = getAddressInputLines(value);
  lines[index] = nextLine;
  return lines.join("\n");
}

function addAddressInputLine(value: string) {
  return [...getAddressInputLines(value), ""].join("\n");
}

function removeAddressInputLine(value: string, index: number) {
  const lines = getAddressInputLines(value);
  if (lines.length <= 1) return "";
  return lines.filter((_, lineIndex) => lineIndex !== index).join("\n");
}

function SunMoonIcon() {
  return (
    <span className={styles.sunMoonIcon} aria-hidden="true">
      <span>☼</span>
      <span>☾</span>
    </span>
  );
}

function TrashIcon() {
  return (
    <svg className={styles.trashIcon} aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M9 4h6l1 2h4v2H4V6h4l1-2Z" />
      <path d="M7 10h10l-.7 10H7.7L7 10Zm3 2v6h1.5v-6H10Zm2.5 0v6H14v-6h-1.5Z" />
    </svg>
  );
}

function ElectionPrintableTable({
  title,
  electionDate,
  points,
  orientation,
  forcePlainViewerTable = false,
}: {
  title: string;
  electionDate: string;
  points: ElectionPointInput[];
  orientation: PrintOrientation;
  forcePlainViewerTable?: boolean;
}) {
  return (
    <article className={styles.printSheet}>
      <header className={styles.printHeader}>
        <h1>{formatElectionBoardTitle(title)}</h1>
        <span>{electionDate}</span>
      </header>
      <table
        className={`${styles.printTable} ${forcePlainViewerTable ? styles.viewerPlainTable : ""}`.trim()}
        style={getPrintTableStyle(points.length, orientation)}
      >
        <thead>
          <tr>
            {readOnlyTableColumns.map((column) => (
              <th key={column} className={getTableColumnClassName(column)}>{renderTableColumnLabel(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.length ? (
            points.map((point, index) => {
              const regionRowSpan = getRegionRowSpan(points, index);
              const hasRegionText = Boolean(normalizeRegionValue(point.region));
              const isRegionBoundary = isRegionGroupEnd(points, index);
              const regionColor = getRegionGroupColor(points, index);
              const placeColor = getCellDisplayColor(points, point, index, "place");
              const poolVideoColor = getCellDisplayColor(points, point, index, "poolVideo");
              const equipmentNameColor = getCellDisplayColor(points, point, index, "equipmentName");
              const trsColor = getCellDisplayColor(points, point, index, "trs");
              const cameraStaffColor = getCellDisplayColor(points, point, index, "cameraStaff");
              const audioStaffColor = getCellDisplayColor(points, point, index, "audioStaff");
              const liveTimeColor = getCellDisplayColor(points, point, index, "liveTime");
              const reporterColor = getCellDisplayColor(points, point, index, "reporter");
              const addressColor = getCellDisplayColor(points, point, index, "address");
              const noteColor = getCellDisplayColor(points, point, index, "note");
              const livePositionColor = getCellDisplayColor(points, point, index, "livePosition");
              const lanColor = getCellDisplayColor(points, point, index, "lan");
              const lightingColor = getCellDisplayColor(points, point, index, "lighting");
              return (
                <tr key={`${point.sortOrder}-${index}`} className={isRegionBoundary ? styles.regionGroupEnd : undefined}>
                  <td className={styles.numberCell}>{index + 1}.</td>
                  {regionRowSpan > 0 ? (
                    <td
                      className={`${getColorableCellClassName(undefined, regionColor)} ${hasRegionText ? styles.regionGroupBoundaryCell : ""}`.trim()}
                      style={getColorStyle(regionColor)}
                      rowSpan={regionRowSpan > 1 ? regionRowSpan : undefined}
                    >
                      {readOnlyValue(point.region)}
                    </td>
                  ) : null}
                  <td className={getColorableCellClassName(undefined, placeColor)} style={getColorStyle(placeColor)}>{readOnlyValue(point.place)}</td>
                  <td className={getColorableCellClassName(styles.poolVideoColumn, poolVideoColor)} style={getColorStyle(poolVideoColor)}>{readOnlyValue(point.poolVideo)}</td>
                  <td className={getColorableCellClassName(undefined, equipmentNameColor)} style={getColorStyle(equipmentNameColor)}>{readOnlyValue(point.equipmentName)}</td>
                  <td className={getColorableCellClassName(undefined, trsColor)} style={getColorStyle(trsColor)}>{readOnlyValue(point.trs)}</td>
                  <td className={getColorableCellClassName(styles.nameColumn, cameraStaffColor)} style={getColorStyle(cameraStaffColor)}>{readOnlySplitValue(point.cameraStaffName, point.cameraStaffNamePm)}</td>
                  <td className={getColorableCellClassName(styles.nameColumn, audioStaffColor)} style={getColorStyle(audioStaffColor)}>{readOnlySplitValue(point.audioStaffName, point.audioStaffNamePm)}</td>
                  <td className={getColorableCellClassName(styles.timeColumn, liveTimeColor)} style={getColorStyle(liveTimeColor)}>{readOnlySplitValue(point.liveTime, point.liveTimePm)}</td>
                  <td className={getColorableCellClassName(styles.nameColumn, reporterColor)} style={getColorStyle(reporterColor)}>{readOnlySplitValue(point.reporterName, point.reporterNamePm)}</td>
                  <td className={getColorableCellClassName(styles.addressColumn, addressColor)} style={getColorStyle(addressColor)}>{readOnlyValue(point.address)}</td>
                  <td className={getColorableCellClassName(styles.wideColumn, noteColor)} style={getColorStyle(noteColor)}>{readOnlyValue(point.note)}</td>
                  <td className={getColorableCellClassName(styles.positionColumn, livePositionColor)} style={getColorStyle(livePositionColor)}>
                    <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.livePosition) ? styles.positionReadOnlyOn : ""}`.trim()} />
                  </td>
                  <td className={getColorableCellClassName(styles.positionColumn, lanColor)} style={getColorStyle(lanColor)}>
                    <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.lan) ? styles.positionReadOnlyOn : ""}`.trim()} />
                  </td>
                  <td className={getColorableCellClassName(undefined, lightingColor)} style={getColorStyle(lightingColor)}>{readOnlyValue(point.lighting)}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={readOnlyTableColumns.length}>입력된 중계 포인트가 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function ElectionReadOnlyTable({
  event,
  highlightedLocationKeys,
  forcePlainViewerTable,
}: {
  event: ElectionEvent;
  highlightedLocationKeys: string[];
  forcePlainViewerTable: boolean;
}) {
  return (
    <article className={`panel ${styles.wideTablePanel}`}>
      <div className={`panel-pad ${styles.emptyPanel}`}>
        <div className={styles.toolbar}>
          <div>
            <span className={getStatusClassName(event.status)}>{statusLabels[event.status]}</span>
            <h2 style={{ margin: "10px 0 4px" }}>{event.title}</h2>
            <div className={styles.summary}>{event.electionDate}</div>
          </div>
          <div className={styles.summary}>{event.points.length}개 포인트</div>
        </div>
        <div className={styles.tableWrap}>
          <table className={`table-like ${styles.table} ${forcePlainViewerTable ? styles.viewerPlainTable : ""}`.trim()}>
            <thead>
              <tr>
                {readOnlyTableColumns.map((column) => (
                  <th key={column} className={getTableColumnClassName(column)}>{renderTableColumnLabel(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {event.points.length ? (
                event.points.map((point, index) => {
                  const pointLocationKey = getPointLocationKey(point);
                  const isOwnLocationHighlighted = highlightedLocationKeys.includes(pointLocationKey);
                  const regionRowSpan = getRegionRowSpan(event.points, index);
                  const hasRegionText = Boolean(normalizeRegionValue(point.region));
                  const isRegionBoundary = isRegionGroupEnd(event.points, index);
                  const regionColor = getRegionGroupColor(event.points, index);
                  const placeColor = getCellDisplayColor(event.points, point, index, "place");
                  const poolVideoColor = getCellDisplayColor(event.points, point, index, "poolVideo");
                  const equipmentNameColor = getCellDisplayColor(event.points, point, index, "equipmentName");
                  const trsColor = getCellDisplayColor(event.points, point, index, "trs");
                  const cameraStaffColor = getCellDisplayColor(event.points, point, index, "cameraStaff");
                  const audioStaffColor = getCellDisplayColor(event.points, point, index, "audioStaff");
                  const liveTimeColor = getCellDisplayColor(event.points, point, index, "liveTime");
                  const reporterColor = getCellDisplayColor(event.points, point, index, "reporter");
                  const addressColor = getCellDisplayColor(event.points, point, index, "address");
                  const noteColor = getCellDisplayColor(event.points, point, index, "note");
                  const livePositionColor = getCellDisplayColor(event.points, point, index, "livePosition");
                  const lanColor = getCellDisplayColor(event.points, point, index, "lan");
                  const lightingColor = getCellDisplayColor(event.points, point, index, "lighting");
                  return (
                  <tr
                    key={point.id}
                    className={[
                      isOwnLocationHighlighted ? styles.myLocationRow : "",
                      isRegionBoundary ? styles.regionGroupEnd : "",
                    ].filter(Boolean).join(" ") || undefined}
                    data-election-point-key={pointLocationKey}
                  >
                    <td className={styles.numberCell}>
                      {isOwnLocationHighlighted ? <span className={styles.ownLocationBadge}>내 위치</span> : null}
                      {index + 1}.
                    </td>
                    {regionRowSpan > 0 ? (
                      <td
                        className={`${getColorableCellClassName(undefined, regionColor)} ${hasRegionText ? styles.regionGroupBoundaryCell : ""}`.trim()}
                        style={getColorStyle(regionColor)}
                        rowSpan={regionRowSpan > 1 ? regionRowSpan : undefined}
                      >
                        {readOnlyValue(point.region)}
                      </td>
                    ) : null}
                    <td className={getColorableCellClassName(undefined, placeColor)} style={getColorStyle(placeColor)}>{readOnlyValue(point.place)}</td>
                    <td className={getColorableCellClassName(styles.poolVideoColumn, poolVideoColor)} style={getColorStyle(poolVideoColor)}>{readOnlyValue(point.poolVideo)}</td>
                    <td className={getColorableCellClassName(undefined, equipmentNameColor)} style={getColorStyle(equipmentNameColor)}>{readOnlyValue(point.equipmentName)}</td>
                    <td className={getColorableCellClassName(undefined, trsColor)} style={getColorStyle(trsColor)}>{readOnlyValue(point.trs)}</td>
                    <td className={getColorableCellClassName(styles.nameColumn, cameraStaffColor)} style={getColorStyle(cameraStaffColor)}>{readOnlySplitValue(point.cameraStaffName, point.cameraStaffNamePm)}</td>
                    <td className={getColorableCellClassName(styles.nameColumn, audioStaffColor)} style={getColorStyle(audioStaffColor)}>{readOnlySplitValue(point.audioStaffName, point.audioStaffNamePm)}</td>
                    <td className={getColorableCellClassName(styles.timeColumn, liveTimeColor)} style={getColorStyle(liveTimeColor)}>{readOnlySplitValue(point.liveTime, point.liveTimePm)}</td>
                    <td className={getColorableCellClassName(styles.nameColumn, reporterColor)} style={getColorStyle(reporterColor)}>{readOnlySplitValue(point.reporterName, point.reporterNamePm)}</td>
                    <td className={getColorableCellClassName(styles.addressColumn, addressColor)} style={getColorStyle(addressColor)}>{readOnlyValue(point.address)}</td>
                    <td className={getColorableCellClassName(styles.wideColumn, noteColor)} style={getColorStyle(noteColor)}>{readOnlyValue(point.note)}</td>
                    <td className={getColorableCellClassName(styles.positionColumn, livePositionColor)} style={getColorStyle(livePositionColor)}>
                      <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.livePosition) ? styles.positionReadOnlyOn : ""}`.trim()} />
                    </td>
                    <td className={getColorableCellClassName(styles.positionColumn, lanColor)} style={getColorStyle(lanColor)}>
                      <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.lan) ? styles.positionReadOnlyOn : ""}`.trim()} />
                    </td>
                    <td className={getColorableCellClassName(undefined, lightingColor)} style={getColorStyle(lightingColor)}>{readOnlyValue(point.lighting)}</td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={readOnlyTableColumns.length}>
                    <div className="status note">입력된 중계 포인트가 없습니다.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

export function ElectionPage() {
  const [draft, setDraft] = useState<DraftEvent | null>(null);
  const [publishedEvent, setPublishedEvent] = useState<ElectionEvent | null>(null);
  const [profiles, setProfiles] = useState<ElectionProfileOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [splitRowIds, setSplitRowIds] = useState<Record<string, true>>({});
  const [savedDisplayTitle, setSavedDisplayTitle] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [printPaperSize, setPrintPaperSize] = useState<PrintPaperSize>("A3");
  const [printOrientation, setPrintOrientation] = useState<PrintOrientation>("portrait");
  const [printColorMode, setPrintColorMode] = useState<PrintColorMode>("color");
  const [columnWidths, setColumnWidths] = useState<Record<ElectionTableColumn, number>>(() => sanitizeColumnWidths(null));
  const [paintSelection, setPaintSelection] = useState<ColorPaintSelection | null>(null);
  const [currentSession, setCurrentSession] = useState<SessionUser | null>(() => getSession());
  const [highlightedLocationKeys, setHighlightedLocationKeys] = useState<string[]>([]);
  const [managerGeneralView, setManagerGeneralView] = useState(false);
  const draftRef = useRef<DraftEvent | null>(null);
  const autoSaveReadyRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveInFlightRef = useRef(false);
  const autoSavePendingRef = useRef(false);
  const lastSavedSignatureRef = useRef("");
  const tableHeaderRowRef = useRef<HTMLTableRowElement | null>(null);
  const tableRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [tableMeasurements, setTableMeasurements] = useState<TableMeasurements>({ headerHeight: 0, rowHeights: {} });

  const profileNames = useMemo(() => profiles.map((profile) => profile.name), [profiles]);
  const pointMeasurementKey = draft?.points.map((point) => point.localId).join("|") ?? "";
  const editableTableWidth = useMemo(() => getTableColumnsWidth(tableColumns, columnWidths), [columnWidths]);
  const paintModeActive = Boolean(paintSelection);

  const setPointRowRef = useCallback((localId: string, element: HTMLTableRowElement | null) => {
    if (element) {
      tableRowRefs.current.set(localId, element);
      return;
    }
    tableRowRefs.current.delete(localId);
  }, []);

  const startColumnResize = useCallback((column: ElectionTableColumn, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const minWidth = minColumnWidths[column];

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(520, Math.round(startWidth + pointerEvent.clientX - startX)));
      setColumnWidths((current) => ({ ...current, [column]: nextWidth }));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [columnWidths]);

  const resetColumnWidth = useCallback((column: ElectionTableColumn) => {
    setColumnWidths((current) => ({ ...current, [column]: defaultColumnWidths[column] }));
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setColumnWidths(readStoredColumnWidths());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ELECTION_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useLayoutEffect(() => {
    if (!draft) {
      setTableMeasurements({ headerHeight: 0, rowHeights: {} });
      return;
    }

    const updateMeasurements = () => {
      const nextMeasurements: TableMeasurements = {
        headerHeight: tableHeaderRowRef.current?.getBoundingClientRect().height ?? 0,
        rowHeights: {},
      };
      for (const point of draft.points) {
        const row = tableRowRefs.current.get(point.localId);
        if (row) {
          nextMeasurements.rowHeights[point.localId] = row.getBoundingClientRect().height;
        }
      }
      setTableMeasurements((current) => (
        areTableMeasurementsEqual(current, nextMeasurements) ? current : nextMeasurements
      ));
    };

    updateMeasurements();

    if (typeof ResizeObserver === "undefined") return;
    const resizeObserver = new ResizeObserver(updateMeasurements);
    if (tableHeaderRowRef.current) resizeObserver.observe(tableHeaderRowRef.current);
    for (const point of draft.points) {
      const row = tableRowRefs.current.get(point.localId);
      if (row) resizeObserver.observe(row);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [draft, pointMeasurementKey]);

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current === null) return;
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    autoSaveReadyRef.current = false;
    clearAutoSaveTimer();
    try {
      const workspace = await fetchElectionWorkspace();
      const nextDraft = workspace.canManage ? (workspace.event ? eventToDraft(workspace.event) : createBlankDraft()) : null;
      setCanManage(workspace.canManage);
      setProfiles(workspace.profiles);
      setPublishedEvent(workspace.canManage ? null : workspace.event);
      setDraft(nextDraft);
      draftRef.current = nextDraft;
      lastSavedSignatureRef.current = getDraftSaveSignature(nextDraft);
      setSavedDisplayTitle(workspace.event?.title ?? null);
      setAutoSaveStatus("idle");
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "선거 중계표를 불러오지 못했습니다." });
    } finally {
      autoSaveReadyRef.current = true;
      setLoading(false);
    }
  }, [clearAutoSaveTimer]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToAuth((session) => {
    setCurrentSession(session);
    void load();
  }), [load]);

  const locateMyRows = useCallback((points: LocationPoint[]) => {
    if (!currentSession) {
      setHighlightedLocationKeys([]);
      setMessage({ tone: "warn", text: "로그인 정보를 확인하지 못해 내 위치를 찾을 수 없습니다." });
      return;
    }

    const nextKeys = points
      .filter((point) => pointMatchesSession(point, currentSession))
      .map(getPointLocationKey);

    const alreadyHighlighted =
      nextKeys.length > 0 &&
      nextKeys.length === highlightedLocationKeys.length &&
      nextKeys.every((key) => highlightedLocationKeys.includes(key));

    if (alreadyHighlighted) {
      setHighlightedLocationKeys([]);
      setMessage({ tone: "note", text: "내 위치 강조를 해제했습니다." });
      return;
    }

    setHighlightedLocationKeys(nextKeys);

    if (!nextKeys.length) {
      setMessage({ tone: "note", text: `${currentSession.username} 이름이 들어간 행을 찾지 못했습니다.` });
      return;
    }

    setMessage({ tone: "ok", text: `${currentSession.username} 위치 ${nextKeys.length}곳을 강조했습니다.` });

    window.requestAnimationFrame(() => {
      const escapedKey = window.CSS?.escape ? window.CSS.escape(nextKeys[0]) : nextKeys[0].replaceAll('"', '\\"');
      document
        .querySelector<HTMLElement>(`[data-election-point-key="${escapedKey}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [currentSession, highlightedLocationKeys]);

  const persistDraftSnapshot = useCallback(async (snapshot: DraftEvent, options?: { showMessage?: boolean }) => {
    const signature = getDraftSaveSignature(snapshot);
    const workspace = await saveElectionWorkspace(draftToSaveInput(snapshot));
    if (!workspace.event) {
      throw new Error("저장한 선거 중계표를 다시 불러오지 못했습니다.");
    }

    lastSavedSignatureRef.current = signature;
    setCanManage(workspace.canManage);
    setProfiles(workspace.profiles);
    setSavedDisplayTitle(workspace.event.title);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        id: workspace.event?.id ?? current.id,
        status: workspace.event?.status ?? current.status,
      };
    });

    if (options?.showMessage) {
      setMessage({ tone: "ok", text: "선거 중계표를 저장했습니다." });
    }

    return workspace.event;
  }, []);

  const runAutoSave = useCallback(async () => {
    const snapshot = draftRef.current;
    if (!snapshot || !canManage || snapshot.status === "closed") return;

    const signature = getDraftSaveSignature(snapshot);
    if (!signature || signature === lastSavedSignatureRef.current) {
      setAutoSaveStatus("idle");
      return;
    }

    if (autoSaveInFlightRef.current) {
      autoSavePendingRef.current = true;
      return;
    }

    autoSaveInFlightRef.current = true;
    setAutoSaveStatus("saving");
    try {
      await persistDraftSnapshot(snapshot);
      setAutoSaveStatus("saved");
    } catch (error) {
      setAutoSaveStatus("error");
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "선거 중계표 자동 저장에 실패했습니다." });
    } finally {
      autoSaveInFlightRef.current = false;
      const currentSignature = getDraftSaveSignature(draftRef.current);
      if (autoSavePendingRef.current || (currentSignature && currentSignature !== lastSavedSignatureRef.current)) {
        autoSavePendingRef.current = false;
        clearAutoSaveTimer();
        autoSaveTimerRef.current = window.setTimeout(() => {
          autoSaveTimerRef.current = null;
          void runAutoSave();
        }, AUTO_SAVE_DEBOUNCE_MS);
      }
    }
  }, [canManage, clearAutoSaveTimer, persistDraftSnapshot]);

  useEffect(() => {
    if (!autoSaveReadyRef.current || !canManage || !draft) return;
    if (draft.status === "closed") return;
    const signature = getDraftSaveSignature(draft);
    if (signature === lastSavedSignatureRef.current) return;

    setAutoSaveStatus("pending");
    clearAutoSaveTimer();
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void runAutoSave();
    }, AUTO_SAVE_DEBOUNCE_MS);

    return clearAutoSaveTimer;
  }, [canManage, clearAutoSaveTimer, draft, runAutoSave]);

  useEffect(() => {
    return () => {
      clearAutoSaveTimer();
    };
  }, [clearAutoSaveTimer]);

  useEffect(() => {
    if (autoSaveStatus !== "saved") return;
    const timer = window.setTimeout(() => {
      setAutoSaveStatus((current) => (current === "saved" ? "idle" : current));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [autoSaveStatus]);

  useEffect(() => {
    const clearPrintMode = () => {
      document.body.classList.remove("election-print-mode");
      document.body.classList.remove(ELECTION_PRINT_COLOR_MODE_CLASS);
    };

    window.addEventListener("afterprint", clearPrintMode);
    return () => {
      window.removeEventListener("afterprint", clearPrintMode);
      clearPrintMode();
    };
  }, []);

  const printElectionBoard = () => {
    upsertElectionPrintPageStyle(printPaperSize, printOrientation);
    document.body.classList.add("election-print-mode");
    document.body.classList.toggle(ELECTION_PRINT_COLOR_MODE_CLASS, printColorMode === "color");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
  };

  const updateDraft = (patch: Partial<Pick<DraftEvent, "title" | "electionDate">>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updatePoint = (index: number, patch: Partial<DraftPoint>) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        points: current.points.map((point, pointIndex) => (pointIndex === index ? { ...point, ...patch } : point)),
      };
    });
  };

  const updateRegionGroup = (index: number, region: string) => {
    setDraft((current) => {
      if (!current) return current;
      const range = getRegionGroupRange(current.points, index);
      return {
        ...current,
        points: current.points.map((point, pointIndex) =>
          pointIndex >= range.start && pointIndex <= range.end ? { ...point, region } : point,
        ),
      };
    });
  };

  const updateRegionGroupColor = (index: number, regionColor: string) => {
    setDraft((current) => {
      if (!current) return current;
      const range = getRegionGroupRange(current.points, index);
      return {
        ...current,
        points: current.points.map((point, pointIndex) =>
          pointIndex >= range.start && pointIndex <= range.end ? { ...point, regionColor } : point,
        ),
      };
    });
  };

  const updatePointCellColor = (index: number, key: ElectionCellColorKey, color: string) => {
    setDraft((current) => {
      if (!current) return current;
      const point = current.points[index];
      if (!point) return current;

      const nextCellColors: ElectionCellColors = { ...point.cellColors };
      if (color) {
        nextCellColors[key] = color;
      } else {
        delete nextCellColors[key];
      }

      return {
        ...current,
        points: current.points.map((currentPoint, pointIndex) =>
          pointIndex === index ? { ...currentPoint, cellColors: nextCellColors } : currentPoint,
        ),
      };
    });
  };

  const applyPaintToCell = (event: ReactPointerEvent<HTMLTableCellElement>, index: number, target: PaintTarget) => {
    if (!paintSelection || saving) return;
    event.preventDefault();
    event.stopPropagation();

    if (target === "region") {
      updateRegionGroupColor(index, paintSelection.color);
    } else {
      updatePointCellColor(index, target, paintSelection.color);
    }

    setPaintSelection(null);
  };

  const getEditableCellClassName = (baseClassName: string | undefined, color: string) => (
    [
      getColorableCellClassName(baseClassName, color),
      paintModeActive ? styles.paintableCell : "",
    ].filter(Boolean).join(" ")
  );

  const addPointToRegion = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const range = getRegionGroupRange(current.points, index);
      const region = current.points[range.start]?.region ?? "";
      const regionColor = getRegionGroupColor(current.points, index);
      if (!region.trim()) return current;
      const nextPoint = {
        ...createBlankPoint(current.points.length),
        region,
        regionColor,
      };
      return {
        ...current,
        points: [
          ...current.points.slice(0, range.end + 1),
          nextPoint,
          ...current.points.slice(range.end + 1),
        ],
      };
    });
  };

  const moveRegionGroup = (index: number, direction: "up" | "down") => {
    setDraft((current) => {
      if (!current) return current;
      const range = getRegionGroupRange(current.points, index);
      if (direction === "up") {
        if (range.start <= 0) return current;
        const previousRange = getRegionGroupRange(current.points, range.start - 1);
        return {
          ...current,
          points: [
            ...current.points.slice(0, previousRange.start),
            ...current.points.slice(range.start, range.end + 1),
            ...current.points.slice(previousRange.start, range.start),
            ...current.points.slice(range.end + 1),
          ],
        };
      }

      if (range.end >= current.points.length - 1) return current;
      const nextRange = getRegionGroupRange(current.points, range.end + 1);
      return {
        ...current,
        points: [
          ...current.points.slice(0, range.start),
          ...current.points.slice(nextRange.start, nextRange.end + 1),
          ...current.points.slice(range.start, range.end + 1),
          ...current.points.slice(nextRange.end + 1),
        ],
      };
    });
  };

  const movePointWithinRegion = (index: number, direction: "up" | "down") => {
    setDraft((current) => {
      if (!current) return current;
      if (!canMovePointWithinRegion(current.points, index, direction)) return current;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      const nextPoints = [...current.points];
      [nextPoints[index], nextPoints[targetIndex]] = [nextPoints[targetIndex], nextPoints[index]];
      return { ...current, points: nextPoints };
    });
  };

  const isPointSplit = (point: DraftPoint) => Boolean(splitRowIds[point.localId] || hasAfternoonValues(point));

  const splitPoint = (point: DraftPoint) => {
    setSplitRowIds((current) => ({ ...current, [point.localId]: true }));
  };

  const mergePoint = (index: number, point: DraftPoint) => {
    updatePoint(index, {
      cameraStaffNamePm: "",
      cameraStaffUserIdPm: null,
      audioStaffNamePm: "",
      reporterNamePm: "",
      liveTimePm: "",
    });
    setSplitRowIds((current) => {
      const next = { ...current };
      delete next[point.localId];
      return next;
    });
  };

  const updateCameraStaff = (index: number, part: DayPart, value: string) => {
    const userId = resolveProfileIdByName(profiles, value);
    if (part === "am") {
      updatePoint(index, { cameraStaffName: value, cameraStaffUserId: userId });
      return;
    }
    updatePoint(index, { cameraStaffNamePm: value, cameraStaffUserIdPm: userId });
  };

  const addPoint = () => {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, points: [...current.points, createBlankPoint(current.points.length)] };
    });
  };

  const removePoint = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const nextPoints = current.points.filter((_, pointIndex) => pointIndex !== index);
      return { ...current, points: nextPoints.length ? nextPoints : [createBlankPoint(0)] };
    });
  };

  const saveDraft = async () => {
    if (!draft) return null;
    if (draft.status === "closed") {
      setMessage({ tone: "warn", text: "게시종료된 선거 중계표는 수정할 수 없습니다. 새 선거표를 만든 뒤 저장해 주세요." });
      return null;
    }
    clearAutoSaveTimer();
    setSaving(true);
    try {
      const savedEvent = await persistDraftSnapshot(draft, { showMessage: true });
      setAutoSaveStatus("idle");
      return savedEvent;
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "선거 중계표 저장에 실패했습니다." });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async () => {
    if (draft?.status === "closed") {
      setMessage({ tone: "warn", text: "게시종료된 선거 중계표는 다시 게시할 수 없습니다. 새 선거표를 만든 뒤 게시해 주세요." });
      return;
    }
    const savedEvent = await saveDraft();
    if (!savedEvent) return;
    setSaving(true);
    try {
      const workspace = await publishElectionEvent(savedEvent.id);
      setCanManage(workspace.canManage);
      setProfiles(workspace.profiles);
      setDraft(workspace.event ? eventToDraft(workspace.event) : createBlankDraft());
      setSavedDisplayTitle(workspace.event?.title ?? null);
      setMessage({ tone: "ok", text: "선거 중계표를 게시했습니다." });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "선거 중계표 게시에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const closePublishedEvent = async () => {
    if (!draft?.id) return;
    const ok = window.confirm("게시종료 후 저장하시겠습니까?");
    if (!ok) return;

    setSaving(true);
    try {
      const workspace = await closeElectionEvent(draft.id);
      const nextDraft = workspace.event ? eventToDraft(workspace.event) : { ...draft, status: "closed" as const };
      setDraft(nextDraft);
      draftRef.current = nextDraft;
      lastSavedSignatureRef.current = getDraftSaveSignature(nextDraft);
      setPublishedEvent(null);
      setSavedDisplayTitle(nextDraft.title);
      setAutoSaveStatus("idle");
      setMessage({ tone: "ok", text: "게시종료했습니다. 데이터는 읽기 전용으로 유지되고 일반 사용자 사이드바에서는 선거 메뉴가 숨겨집니다." });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "게시종료에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const startNewDraft = () => {
    clearAutoSaveTimer();
    const nextDraft = createBlankDraft();
    setDraft(nextDraft);
    draftRef.current = nextDraft;
    lastSavedSignatureRef.current = getDraftSaveSignature(nextDraft);
    setSavedDisplayTitle(null);
    setAutoSaveStatus("idle");
    setMessage({ tone: "note", text: "새 선거 중계표를 작성합니다." });
  };

  if (loading) {
    return (
      <section className={`${styles.page} ${styles.electionPageScope}`}>
        <article className="panel">
          <div className="panel-pad">
            <div className="status note">선거 중계표를 불러오는 중입니다.</div>
          </div>
        </article>
      </section>
    );
  }

  if (!canManage) {
    return (
      <section className={`${styles.page} ${styles.printRoot} ${styles.electionPageScope}`.trim()}>
        <div className={styles.screenOnly}>
          <article className="panel">
            <div className={`panel-pad ${styles.header}`}>
              <div className={styles.titleBlock}>
                <h1 className="page-title">{formatElectionBoardTitle(publishedEvent?.title)}</h1>
              </div>
              <div className={styles.actions}>
                <button type="button" className="btn" disabled={!publishedEvent || !currentSession} onClick={() => publishedEvent ? locateMyRows(publishedEvent.points) : undefined}>
                  내 위치보기
                </button>
                <ElectionPrintControls
                  paperSize={printPaperSize}
                  orientation={printOrientation}
                  colorMode={printColorMode}
                  disabled={!publishedEvent}
                  onPaperSizeChange={setPrintPaperSize}
                  onOrientationChange={setPrintOrientation}
                  onColorModeChange={setPrintColorMode}
                  onPrint={printElectionBoard}
                />
              </div>
            </div>
          </article>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {publishedEvent ? (
            <ElectionReadOnlyTable
              event={publishedEvent}
              highlightedLocationKeys={highlightedLocationKeys}
              forcePlainViewerTable={!hasElectionManagerViewRole(currentSession)}
            />
          ) : (
            <article className="panel">
              <div className="panel-pad">
                <div className="status note">게시된 선거 중계표가 없습니다.</div>
              </div>
            </article>
          )}
        </div>
        {publishedEvent ? (
          <div className={styles.printOnly}>
            <ElectionPrintableTable
              title={publishedEvent.title}
              electionDate={publishedEvent.electionDate}
              points={publishedEvent.points}
              orientation={printOrientation}
              forcePlainViewerTable={!hasElectionManagerViewRole(currentSession)}
            />
          </div>
        ) : null}
      </section>
    );
  }

  const currentStatus = draft?.status ?? "draft";
  const autoSaveStatusLabel = getAutoSaveStatusLabel(autoSaveStatus);
  const closedReadOnlyEvent = draft && currentStatus === "closed" ? draftToReadOnlyEvent(draft) : null;
  const canUseManagerGeneralView = canManage && hasElectionGeneralPreviewRole(currentSession);
  const managerGeneralViewEvent = canUseManagerGeneralView && managerGeneralView && draft ? draftToReadOnlyEvent(draft) : null;

  if (closedReadOnlyEvent) {
    return (
      <section className={`${styles.page} ${styles.printRoot} ${styles.electionPageScope}`.trim()}>
        <div className={styles.screenOnly}>
          <article className="panel">
            <div className={`panel-pad ${styles.header}`}>
              <div className={styles.titleBlock}>
                <h1 className="page-title">{formatElectionBoardTitle(closedReadOnlyEvent.title)}</h1>
                <div className={styles.statusLine}>
                  <span className={getStatusClassName("closed")}>{statusLabels.closed}</span>
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" className="btn" disabled={!currentSession} onClick={() => locateMyRows(closedReadOnlyEvent.points)}>
                  내 위치보기
                </button>
                {canUseManagerGeneralView ? (
                  <button type="button" className="btn" onClick={() => setManagerGeneralView((current) => !current)}>
                    {managerGeneralView ? "관리보기" : "일반보기"}
                  </button>
                ) : null}
                <ElectionPrintControls
                  paperSize={printPaperSize}
                  orientation={printOrientation}
                  colorMode={printColorMode}
                  disabled={false}
                  onPaperSizeChange={setPrintPaperSize}
                  onOrientationChange={setPrintOrientation}
                  onColorModeChange={setPrintColorMode}
                  onPrint={printElectionBoard}
                />
                {!managerGeneralView ? (
                  <button type="button" className="btn primary" disabled={saving} onClick={startNewDraft}>
                    새 선거표 작성
                  </button>
                ) : null}
              </div>
            </div>
          </article>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          <ElectionReadOnlyTable
            event={closedReadOnlyEvent}
            highlightedLocationKeys={highlightedLocationKeys}
            forcePlainViewerTable={managerGeneralView || !hasElectionManagerViewRole(currentSession)}
          />
        </div>
        <div className={styles.printOnly}>
          <ElectionPrintableTable
            title={closedReadOnlyEvent.title}
            electionDate={closedReadOnlyEvent.electionDate}
            points={closedReadOnlyEvent.points}
            orientation={printOrientation}
            forcePlainViewerTable={managerGeneralView || !hasElectionManagerViewRole(currentSession)}
          />
        </div>
      </section>
    );
  }

  if (managerGeneralViewEvent) {
    return (
      <section className={`${styles.page} ${styles.printRoot} ${styles.electionPageScope}`.trim()}>
        <div className={styles.screenOnly}>
          <article className="panel">
            <div className={`panel-pad ${styles.header}`}>
              <div className={styles.titleBlock}>
                <h1 className="page-title">{formatElectionBoardTitle(managerGeneralViewEvent.title)}</h1>
                <div className={styles.statusLine}>
                  <span className={getStatusClassName(currentStatus)}>{statusLabels[currentStatus]}</span>
                  <span className={styles.autoSaveStatus}>일반보기</span>
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" className="btn" disabled={!currentSession} onClick={() => locateMyRows(managerGeneralViewEvent.points)}>
                  내 위치보기
                </button>
                <button type="button" className="btn" onClick={() => setManagerGeneralView(false)}>
                  편집보기
                </button>
                <ElectionPrintControls
                  paperSize={printPaperSize}
                  orientation={printOrientation}
                  colorMode={printColorMode}
                  disabled={false}
                  onPaperSizeChange={setPrintPaperSize}
                  onOrientationChange={setPrintOrientation}
                  onColorModeChange={setPrintColorMode}
                  onPrint={printElectionBoard}
                />
              </div>
            </div>
          </article>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          <ElectionReadOnlyTable
            event={managerGeneralViewEvent}
            highlightedLocationKeys={highlightedLocationKeys}
            forcePlainViewerTable
          />
        </div>
        <div className={styles.printOnly}>
          <ElectionPrintableTable
            title={managerGeneralViewEvent.title}
            electionDate={managerGeneralViewEvent.electionDate}
            points={managerGeneralViewEvent.points}
            orientation={printOrientation}
            forcePlainViewerTable
          />
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.page} ${styles.printRoot} ${styles.electionPageScope}`.trim()}>
      <div className={styles.screenOnly}>
        <article className="panel">
          <div className={`panel-pad ${styles.header}`}>
            <div className={styles.titleBlock}>
              <h1 className="page-title">{formatElectionBoardTitle(savedDisplayTitle)}</h1>
              <div className={styles.statusLine}>
                <span className={getStatusClassName(currentStatus)}>{statusLabels[currentStatus]}</span>
                {autoSaveStatusLabel ? (
                  <span className={styles.autoSaveStatus} aria-live="polite">
                    {autoSaveStatusLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <div className={styles.actions}>
              <button type="button" className="btn" disabled={!draft || !currentSession} onClick={() => draft ? locateMyRows(draft.points) : undefined}>
                내 위치보기
              </button>
              {canUseManagerGeneralView ? (
                <button type="button" className="btn" disabled={!draft} onClick={() => setManagerGeneralView(true)}>
                  일반보기
                </button>
              ) : null}
              <ElectionPrintControls
                paperSize={printPaperSize}
                orientation={printOrientation}
                colorMode={printColorMode}
                disabled={!draft}
                onPaperSizeChange={setPrintPaperSize}
                onOrientationChange={setPrintOrientation}
                onColorModeChange={setPrintColorMode}
                onPrint={printElectionBoard}
              />
              <button type="button" className="btn" disabled={saving || !draft} onClick={saveDraft}>
                {saving ? "최종저장 중" : "최종저장"}
              </button>
              <button type="button" className="btn primary" disabled={saving || !draft} onClick={publishDraft}>
                게시
              </button>
              {currentStatus === "published" ? (
                <button type="button" className="btn" disabled={saving || !draft?.id} onClick={closePublishedEvent}>
                  게시종료
                </button>
              ) : null}
            </div>
          </div>
        </article>

        {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}

        {draft ? (
          <>
            <article className="panel">
              <div className={`panel-pad ${styles.formGrid}`}>
                <div className={styles.field}>
                  <label htmlFor="election-title">선거명</label>
                  <input
                    id="election-title"
                    className="field-input"
                    value={draft.title}
                    maxLength={120}
                    onChange={(event) => updateDraft({ title: event.target.value })}
                    placeholder="예: 제9회 전국동시지방선거"
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="election-date">선거일</label>
                  <input
                    id="election-date"
                    className="field-input"
                    type="date"
                    value={draft.electionDate}
                    onChange={(event) => updateDraft({ electionDate: event.target.value })}
                  />
                </div>
              </div>
            </article>

          <article className={`panel ${styles.wideTablePanel}`}>
            <div className={`panel-pad ${styles.emptyPanel}`}>
              <div className={styles.toolbar}>
                <div className={styles.summary}>{draft.points.length}개 포인트</div>
                <div className={styles.toolbarActions}>
                  <ColorPaintMenu
                    selection={paintSelection}
                    disabled={saving}
                    onSelect={setPaintSelection}
                    onCancel={() => setPaintSelection(null)}
                  />
                  <button type="button" className="btn" disabled={saving} onClick={addPoint}>
                    행 추가
                  </button>
                </div>
              </div>
              <datalist id="election-profile-options">
                {profileNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className={styles.tableShell}>
                <div className={styles.managementRail} aria-label="행 관리">
                  <div
                    className={styles.managementRailHeader}
                    style={tableMeasurements.headerHeight ? { height: tableMeasurements.headerHeight } : undefined}
                  >
                    관리
                  </div>
                  <div className={styles.managementRailBody}>
                    {draft.points.map((point, index) => {
                      const split = isPointSplit(point);
                      return (
                        <div
                          key={point.localId}
                          className={styles.managementRailCell}
                          style={tableMeasurements.rowHeights[point.localId] ? { height: tableMeasurements.rowHeights[point.localId] } : undefined}
                        >
                          <details className={styles.rowActionMenu}>
                            <summary
                              className={styles.rowActionTrigger}
                              aria-label="행 관리 메뉴"
                              title="행 관리"
                              aria-disabled={saving}
                              onClick={(event) => {
                                if (saving) event.preventDefault();
                              }}
                              onKeyDown={(event) => {
                                if (saving && (event.key === "Enter" || event.key === " ")) event.preventDefault();
                              }}
                            >
                              +
                            </summary>
                            <div className={styles.rowActionPanel}>
                              <button
                                type="button"
                                className={styles.rowIconButton}
                                disabled={saving}
                                onClick={() => (split ? mergePoint(index, point) : splitPoint(point))}
                                aria-label={split ? "오전 오후 합치기" : "오전 오후 나누기"}
                                title={split ? "오전 오후 합치기" : "오전 오후 나누기"}
                              >
                                <SunMoonIcon />
                              </button>
                              <button
                                type="button"
                                className={`${styles.rowIconButton} ${styles.deleteButton}`}
                                disabled={saving}
                                onClick={() => removePoint(index)}
                                aria-label="행 삭제"
                                title="행 삭제"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className={`${styles.tableWrap} ${styles.editableTableWrap}`} style={{ "--election-editable-table-width": `${editableTableWidth}px` } as CSSProperties}>
                  <table className={`table-like ${styles.table} ${styles.resizableTable}`}>
                    <ElectionTableColGroup columns={tableColumns} widths={columnWidths} />
                    <thead>
                      <tr ref={tableHeaderRowRef}>
                        {tableColumns.map((column) => (
                          <th
                            key={column}
                            className={[getTableColumnClassName(column), styles.resizableHeader].filter(Boolean).join(" ")}
                          >
                            <span className={styles.resizableHeaderLabel}>{renderTableColumnLabel(column)}</span>
                            <button
                              type="button"
                              className={styles.columnResizeHandle}
                              aria-label={`${column} 칸 너비 조절`}
                              title="드래그해서 칸 너비 조절"
                              onPointerDown={(event) => startColumnResize(column, event)}
                              onDoubleClick={() => resetColumnWidth(column)}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                  <tbody>
                    {draft.points.map((point, index) => {
                      const split = isPointSplit(point);
                      const regionRowSpan = getRegionRowSpan(draft.points, index);
                      const hasRegionText = Boolean(normalizeRegionValue(point.region));
                      const isRegionBoundary = isRegionGroupEnd(draft.points, index);
                      const regionColor = getRegionGroupColor(draft.points, index);
                      const placeColor = getCellDisplayColor(draft.points, point, index, "place");
                      const poolVideoColor = getCellDisplayColor(draft.points, point, index, "poolVideo");
                      const equipmentNameColor = getCellDisplayColor(draft.points, point, index, "equipmentName");
                      const trsColor = getCellDisplayColor(draft.points, point, index, "trs");
                      const cameraStaffColor = getCellDisplayColor(draft.points, point, index, "cameraStaff");
                      const audioStaffColor = getCellDisplayColor(draft.points, point, index, "audioStaff");
                      const liveTimeColor = getCellDisplayColor(draft.points, point, index, "liveTime");
                      const reporterColor = getCellDisplayColor(draft.points, point, index, "reporter");
                      const addressColor = getCellDisplayColor(draft.points, point, index, "address");
                      const noteColor = getCellDisplayColor(draft.points, point, index, "note");
                      const livePositionColor = getCellDisplayColor(draft.points, point, index, "livePosition");
                      const lanColor = getCellDisplayColor(draft.points, point, index, "lan");
                      const lightingColor = getCellDisplayColor(draft.points, point, index, "lighting");
                      const pointLocationKey = getPointLocationKey(point);
                      const isOwnLocationHighlighted = highlightedLocationKeys.includes(pointLocationKey);
                      return (
                      <tr
                        key={point.localId}
                        ref={(element) => setPointRowRef(point.localId, element)}
                        className={[
                          isOwnLocationHighlighted ? styles.myLocationRow : "",
                          isRegionBoundary ? styles.regionGroupEnd : "",
                        ].filter(Boolean).join(" ") || undefined}
                        data-election-point-key={pointLocationKey}
                      >
                        <td className={styles.numberCell}>
                          {isOwnLocationHighlighted ? <span className={styles.ownLocationBadge}>내 위치</span> : null}
                          {index + 1}.
                        </td>
                        {regionRowSpan > 0 ? (
                          <td
                            className={`${getEditableCellClassName(styles.regionColumn, regionColor)} ${hasRegionText ? styles.regionGroupBoundaryCell : ""}`.trim()}
                            style={getColorStyle(regionColor)}
                            rowSpan={regionRowSpan > 1 ? regionRowSpan : undefined}
                            onPointerDownCapture={(event) => applyPaintToCell(event, index, "region")}
                          >
                            <div className={styles.regionCellInner}>
                              <input className="field-input" value={point.region} onChange={(event) => updateRegionGroup(index, event.target.value)} />
                              {hasRegionText ? (
                                <div className={styles.cellActionRow}>
                                  <button
                                    type="button"
                                    className={styles.cellActionButton}
                                    disabled={saving}
                                    onClick={() => addPointToRegion(index)}
                                    title="같은 지역 하위 행 추가"
                                    aria-label="같은 지역 하위 행 추가"
                                  >
                                    +
                                  </button>
                                  <ReorderMenu
                                    label="지역"
                                    canMoveUp={canMoveRegionGroup(draft.points, index, "up")}
                                    canMoveDown={canMoveRegionGroup(draft.points, index, "down")}
                                    onMoveUp={() => moveRegionGroup(index, "up")}
                                    onMoveDown={() => moveRegionGroup(index, "down")}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                        <td
                          className={getEditableCellClassName(styles.placeColumn, placeColor)}
                          style={getColorStyle(placeColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "place")}
                        >
                          <div className={styles.placeCellInner}>
                            <input className="field-input" value={point.place} onChange={(event) => updatePoint(index, { place: event.target.value })} />
                            {hasRegionText ? (
                              <ReorderMenu
                                label="장소"
                                canMoveUp={canMovePointWithinRegion(draft.points, index, "up")}
                                canMoveDown={canMovePointWithinRegion(draft.points, index, "down")}
                                onMoveUp={() => movePointWithinRegion(index, "up")}
                                onMoveDown={() => movePointWithinRegion(index, "down")}
                              />
                            ) : null}
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.poolVideoColumn, poolVideoColor)}
                          style={getColorStyle(poolVideoColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "poolVideo")}
                        >
                          <div className={styles.cellEditor}>
                            <select className="field-select" value={point.poolVideo} onChange={(event) => updatePoint(index, { poolVideo: event.target.value })}>
                              <option value=""></option>
                              {getPoolVideoOptions(point.poolVideo).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(undefined, equipmentNameColor)}
                          style={getColorStyle(equipmentNameColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "equipmentName")}
                        >
                          <div className={styles.cellEditor}>
                            <input className="field-input" value={point.equipmentName} onChange={(event) => updatePoint(index, { equipmentName: event.target.value })} placeholder="TVU-21" />
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(undefined, trsColor)}
                          style={getColorStyle(trsColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "trs")}
                        >
                          <div className={styles.cellEditor}>
                            <input className="field-input" value={point.trs} onChange={(event) => updatePoint(index, { trs: event.target.value })} />
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.nameColumn, cameraStaffColor)}
                          style={getColorStyle(cameraStaffColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "cameraStaff")}
                        >
                          <div className={styles.cellEditor}>
                            {split ? (
                              <SplitTextInput
                                morning={point.cameraStaffName}
                                afternoon={point.cameraStaffNamePm}
                                listId="election-profile-options"
                                inputClassName={styles.staffListInput}
                                onMorningChange={(value) => updateCameraStaff(index, "am", value)}
                                onAfternoonChange={(value) => updateCameraStaff(index, "pm", value)}
                              />
                            ) : (
                              <input
                                className={`field-input ${styles.staffListInput}`}
                                list="election-profile-options"
                                value={point.cameraStaffName}
                                onClick={(event) => showInputPicker(event.currentTarget)}
                                onChange={(event) => updateCameraStaff(index, "am", event.target.value)}
                              />
                            )}
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.nameColumn, audioStaffColor)}
                          style={getColorStyle(audioStaffColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "audioStaff")}
                        >
                          <div className={styles.cellEditor}>
                            {split ? (
                              <SplitTextInput
                                morning={point.audioStaffName}
                                afternoon={point.audioStaffNamePm}
                                onMorningChange={(value) => updatePoint(index, { audioStaffName: value, audioStaffUserId: null })}
                                onAfternoonChange={(value) => updatePoint(index, { audioStaffNamePm: value })}
                              />
                            ) : (
                              <input className="field-input" value={point.audioStaffName} onChange={(event) => updatePoint(index, { audioStaffName: event.target.value, audioStaffUserId: null })} />
                            )}
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.timeColumn, liveTimeColor)}
                          style={getColorStyle(liveTimeColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "liveTime")}
                        >
                          <div className={styles.cellEditor}>
                            {split ? (
                              <SplitTextInput
                                morning={point.liveTime}
                                afternoon={point.liveTimePm}
                                placeholder="10:00 - 12:00"
                                onMorningChange={(value) => updatePoint(index, { liveTime: value })}
                                onAfternoonChange={(value) => updatePoint(index, { liveTimePm: value })}
                              />
                            ) : (
                              <input className="field-input" value={point.liveTime} placeholder="10:00 - 12:00" onChange={(event) => updatePoint(index, { liveTime: event.target.value })} />
                            )}
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.nameColumn, reporterColor)}
                          style={getColorStyle(reporterColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "reporter")}
                        >
                          <div className={styles.cellEditor}>
                            {split ? (
                              <SplitTextInput
                                morning={point.reporterName}
                                afternoon={point.reporterNamePm}
                                onMorningChange={(value) => updatePoint(index, { reporterName: value, reporterUserId: null })}
                                onAfternoonChange={(value) => updatePoint(index, { reporterNamePm: value })}
                              />
                            ) : (
                              <input className="field-input" value={point.reporterName} onChange={(event) => updatePoint(index, { reporterName: event.target.value, reporterUserId: null })} />
                            )}
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.addressColumn, addressColor)}
                          style={getColorStyle(addressColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "address")}
                        >
                          <div className={styles.addressEditor}>
                            <div className={styles.addressRows}>
                              {getAddressInputLines(point.address).map((addressLine, addressIndex) => (
                                <div key={addressIndex} className={styles.addressRow}>
                                  <input
                                    className="field-input"
                                    value={addressLine}
                                    onChange={(event) =>
                                      updatePoint(index, {
                                        address: setAddressInputLine(point.address, addressIndex, event.target.value),
                                      })
                                    }
                                  />
                                  {addressIndex === 0 ? (
                                    <button
                                      type="button"
                                      className={styles.cellActionButton}
                                      disabled={saving}
                                      onClick={() => updatePoint(index, { address: addAddressInputLine(point.address) })}
                                      title="주소칸 추가"
                                      aria-label="주소칸 추가"
                                    >
                                      +
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className={styles.cellActionButton}
                                      disabled={saving}
                                      onClick={() => updatePoint(index, { address: removeAddressInputLine(point.address, addressIndex) })}
                                      title="주소칸 삭제"
                                      aria-label="주소칸 삭제"
                                    >
                                      -
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.wideColumn, noteColor)}
                          style={getColorStyle(noteColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "note")}
                        >
                          <div className={styles.cellEditor}>
                            <input className="field-input" value={point.note} onChange={(event) => updatePoint(index, { note: event.target.value })} />
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.positionColumn, livePositionColor)}
                          style={getColorStyle(livePositionColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "livePosition")}
                        >
                          <div className={styles.positionCellInner}>
                            <label
                              className={`${styles.positionToggle} ${isLivePositionChecked(point.livePosition) ? styles.positionToggleOn : ""}`.trim()}
                              title="중계자리"
                            >
                              <input
                                type="checkbox"
                                checked={isLivePositionChecked(point.livePosition)}
                                onChange={(event) =>
                                  updatePoint(index, {
                                    livePosition: event.target.checked ? LIVE_POSITION_CHECKED_VALUE : "",
                                  })
                                }
                              />
                            </label>
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(styles.positionColumn, lanColor)}
                          style={getColorStyle(lanColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "lan")}
                        >
                          <div className={styles.positionCellInner}>
                            <label
                              className={`${styles.positionToggle} ${isLivePositionChecked(point.lan) ? styles.positionToggleOn : ""}`.trim()}
                              title="LAN"
                            >
                              <input
                                type="checkbox"
                                checked={isLivePositionChecked(point.lan)}
                                onChange={(event) =>
                                  updatePoint(index, {
                                    lan: event.target.checked ? LIVE_POSITION_CHECKED_VALUE : "",
                                  })
                                }
                              />
                            </label>
                          </div>
                        </td>
                        <td
                          className={getEditableCellClassName(undefined, lightingColor)}
                          style={getColorStyle(lightingColor)}
                          onPointerDownCapture={(event) => applyPaintToCell(event, index, "lighting")}
                        >
                          <div className={styles.cellEditor}>
                            <input className="field-input" value={point.lighting} onChange={(event) => updatePoint(index, { lighting: event.target.value })} />
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            </article>
          </>
        ) : null}
      </div>
      {draft ? (
        <div className={styles.printOnly}>
          <ElectionPrintableTable
            title={draft.title}
            electionDate={draft.electionDate}
            points={draft.points}
            orientation={printOrientation}
            forcePlainViewerTable={managerGeneralView}
          />
        </div>
      ) : null}
    </section>
  );
}
