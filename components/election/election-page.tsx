"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeElectionEvent,
  fetchElectionWorkspace,
  publishElectionEvent,
  saveElectionWorkspace,
} from "@/lib/election/storage";
import { getKstDateKey } from "@/lib/election/dates";
import type {
  ElectionEvent,
  ElectionPointInput,
  ElectionProfileOption,
  ElectionSaveInput,
  ElectionStatus,
} from "@/lib/election/types";
import { subscribeToAuth } from "@/lib/auth/storage";
import styles from "./Election.module.css";

type Message = { tone: "ok" | "warn" | "note"; text: string };
type DayPart = "am" | "pm";
type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
type PrintPaperSize = "A3" | "A4";
type PrintOrientation = "portrait" | "landscape";

interface DraftPoint extends ElectionPointInput {
  localId: string;
}

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
] as const;

const tableColumns = [
  "관리",
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
  "조명",
];

const readOnlyTableColumns = tableColumns.filter((column) => column !== "관리");
const staffNameColumns = new Set(["촬영기자", "오디오맨", "취재기자"]);
const LIVE_POSITION_CHECKED_VALUE = "checked";
const DEFAULT_EQUIPMENT_NAME = "TVU-";
const AUTO_SAVE_DEBOUNCE_MS = 900;
const ELECTION_PRINT_STYLE_ID = "election-print-page-style";

function getTableColumnClassName(column: string) {
  if (column === "관리") return styles.managementColumn;
  if (column === "#") return styles.numberColumn;
  if (column === "코리아풀영상") return styles.poolVideoColumn;
  if (staffNameColumns.has(column)) return styles.nameColumn;
  if (column === "중계시간") return styles.timeColumn;
  if (column === "주소") return styles.addressColumn;
  if (column === "비고") return styles.wideColumn;
  return column === "중계자리" ? styles.positionColumn : undefined;
}

function renderTableColumnLabel(column: string) {
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

function canMoveRegionGroup(points: Pick<ElectionPointInput, "region">[], index: number, direction: "up" | "down") {
  const range = getRegionGroupRange(points, index);
  return direction === "up" ? range.start > 0 : range.end < points.length - 1;
}

function canMovePointWithinRegion(points: Pick<ElectionPointInput, "region">[], index: number, direction: "up" | "down") {
  const range = getRegionGroupRange(points, index);
  return direction === "up" ? index > range.start : index < range.end;
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

function upsertElectionPrintPageStyle(paperSize: PrintPaperSize, orientation: PrintOrientation) {
  const styleText = `@page { size: ${paperSize} ${orientation}; margin: 10mm; }`;
  let styleElement = document.getElementById(ELECTION_PRINT_STYLE_ID) as HTMLStyleElement | null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = ELECTION_PRINT_STYLE_ID;
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = styleText;
}

function ElectionPrintControls({
  paperSize,
  orientation,
  disabled,
  onPaperSizeChange,
  onOrientationChange,
  onPrint,
}: {
  paperSize: PrintPaperSize;
  orientation: PrintOrientation;
  disabled?: boolean;
  onPaperSizeChange: (value: PrintPaperSize) => void;
  onOrientationChange: (value: PrintOrientation) => void;
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
    lighting: "",
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
          lighting: point.lighting,
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
  return (
    <span className={`${styles.readOnlyCell} ${display === "-" ? styles.readOnlyCellEmpty : ""}`.trim()}>
      {display}
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

function SplitTextInput({
  morning,
  afternoon,
  onMorningChange,
  onAfternoonChange,
  listId,
  placeholder,
}: {
  morning: string;
  afternoon: string;
  onMorningChange: (value: string) => void;
  onAfternoonChange: (value: string) => void;
  listId?: string;
  placeholder?: string;
}) {
  return (
    <div className={styles.splitStack}>
      <label>
        <span>오전</span>
        <input className="field-input" list={listId} value={morning} placeholder={placeholder} onChange={(event) => onMorningChange(event.target.value)} />
      </label>
      <label>
        <span>오후</span>
        <input className="field-input" list={listId} value={afternoon} placeholder={placeholder} onChange={(event) => onAfternoonChange(event.target.value)} />
      </label>
    </div>
  );
}

function ElectionPrintableTable({
  title,
  electionDate,
  points,
}: {
  title: string;
  electionDate: string;
  points: ElectionPointInput[];
}) {
  return (
    <article className={styles.printSheet}>
      <header className={styles.printHeader}>
        <h1>{formatElectionBoardTitle(title)}</h1>
        <span>{electionDate}</span>
      </header>
      <table className={styles.printTable}>
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
              return (
                <tr key={`${point.sortOrder}-${index}`}>
                  <td className={styles.numberCell}>{index + 1}.</td>
                  {regionRowSpan > 0 ? (
                    <td rowSpan={regionRowSpan > 1 ? regionRowSpan : undefined}>{readOnlyValue(point.region)}</td>
                  ) : null}
                  <td>{readOnlyValue(point.place)}</td>
                  <td className={styles.poolVideoColumn}>{readOnlyValue(point.poolVideo)}</td>
                  <td>{readOnlyValue(point.equipmentName)}</td>
                  <td>{readOnlyValue(point.trs)}</td>
                  <td className={styles.nameColumn}>{readOnlySplitValue(point.cameraStaffName, point.cameraStaffNamePm)}</td>
                  <td className={styles.nameColumn}>{readOnlySplitValue(point.audioStaffName, point.audioStaffNamePm)}</td>
                  <td className={styles.timeColumn}>{readOnlySplitValue(point.liveTime, point.liveTimePm)}</td>
                  <td className={styles.nameColumn}>{readOnlySplitValue(point.reporterName, point.reporterNamePm)}</td>
                  <td className={styles.addressColumn}>{readOnlyValue(point.address)}</td>
                  <td className={styles.wideColumn}>{readOnlyValue(point.note)}</td>
                  <td className={styles.positionColumn}>
                    <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.livePosition) ? styles.positionReadOnlyOn : ""}`.trim()} />
                  </td>
                  <td>{readOnlyValue(point.lighting)}</td>
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

function ElectionReadOnlyTable({ event }: { event: ElectionEvent }) {
  return (
    <article className="panel">
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
          <table className={`table-like ${styles.table}`}>
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
                  const regionRowSpan = getRegionRowSpan(event.points, index);
                  return (
                  <tr key={point.id}>
                    <td className={styles.numberCell}>{index + 1}.</td>
                    {regionRowSpan > 0 ? (
                      <td rowSpan={regionRowSpan > 1 ? regionRowSpan : undefined}>
                        {readOnlyValue(point.region)}
                      </td>
                    ) : null}
                    <td>{readOnlyValue(point.place)}</td>
                    <td className={styles.poolVideoColumn}>{readOnlyValue(point.poolVideo)}</td>
                    <td>{readOnlyValue(point.equipmentName)}</td>
                    <td>{readOnlyValue(point.trs)}</td>
                    <td className={styles.nameColumn}>{readOnlySplitValue(point.cameraStaffName, point.cameraStaffNamePm)}</td>
                    <td className={styles.nameColumn}>{readOnlySplitValue(point.audioStaffName, point.audioStaffNamePm)}</td>
                    <td className={styles.timeColumn}>{readOnlySplitValue(point.liveTime, point.liveTimePm)}</td>
                    <td className={styles.nameColumn}>{readOnlySplitValue(point.reporterName, point.reporterNamePm)}</td>
                    <td className={styles.addressColumn}>{readOnlyValue(point.address)}</td>
                    <td className={styles.wideColumn}>{readOnlyValue(point.note)}</td>
                    <td className={styles.positionColumn}>
                      <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.livePosition) ? styles.positionReadOnlyOn : ""}`.trim()} />
                    </td>
                    <td>{readOnlyValue(point.lighting)}</td>
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
  const draftRef = useRef<DraftEvent | null>(null);
  const autoSaveReadyRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveInFlightRef = useRef(false);
  const autoSavePendingRef = useRef(false);
  const lastSavedSignatureRef = useRef("");

  const profileNames = useMemo(() => profiles.map((profile) => profile.name), [profiles]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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

  useEffect(() => subscribeToAuth(() => void load()), [load]);

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
    if (!snapshot || !canManage) return;

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
    window.setTimeout(() => window.print(), 0);
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

  const addPointToRegion = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const range = getRegionGroupRange(current.points, index);
      const region = current.points[range.start]?.region ?? "";
      if (!region.trim()) return current;
      const nextPoint = {
        ...createBlankPoint(current.points.length),
        region,
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
      await closeElectionEvent(draft.id);
      const nextDraft = createBlankDraft();
      setDraft(nextDraft);
      draftRef.current = nextDraft;
      lastSavedSignatureRef.current = getDraftSaveSignature(nextDraft);
      setPublishedEvent(null);
      setSavedDisplayTitle(null);
      setAutoSaveStatus("idle");
      setMessage({ tone: "ok", text: "게시종료했습니다. 새 선거 중계표를 작성할 수 있습니다." });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "게시종료에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className={styles.page}>
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
      <section className={`${styles.page} ${styles.printRoot}`.trim()}>
        <div className={styles.screenOnly}>
          <article className="panel">
            <div className={`panel-pad ${styles.header}`}>
              <div className={styles.titleBlock}>
                <h1 className="page-title">{formatElectionBoardTitle(publishedEvent?.title)}</h1>
              </div>
              <div className={styles.actions}>
                <ElectionPrintControls
                  paperSize={printPaperSize}
                  orientation={printOrientation}
                  disabled={!publishedEvent}
                  onPaperSizeChange={setPrintPaperSize}
                  onOrientationChange={setPrintOrientation}
                  onPrint={printElectionBoard}
                />
              </div>
            </div>
          </article>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {publishedEvent ? (
            <ElectionReadOnlyTable event={publishedEvent} />
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
            <ElectionPrintableTable title={publishedEvent.title} electionDate={publishedEvent.electionDate} points={publishedEvent.points} />
          </div>
        ) : null}
      </section>
    );
  }

  const currentStatus = draft?.status ?? "draft";
  const autoSaveStatusLabel = getAutoSaveStatusLabel(autoSaveStatus);

  return (
    <section className={`${styles.page} ${styles.printRoot}`.trim()}>
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
              <ElectionPrintControls
                paperSize={printPaperSize}
                orientation={printOrientation}
                disabled={!draft}
                onPaperSizeChange={setPrintPaperSize}
                onOrientationChange={setPrintOrientation}
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

          <article className="panel">
            <div className={`panel-pad ${styles.emptyPanel}`}>
              <div className={styles.toolbar}>
                <div className={styles.summary}>{draft.points.length}개 포인트</div>
                <button type="button" className="btn" disabled={saving} onClick={addPoint}>
                  행 추가
                </button>
              </div>
              <datalist id="election-profile-options">
                {profileNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className={styles.tableWrap}>
                <table className={`table-like ${styles.table}`}>
                  <thead>
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={column} className={getTableColumnClassName(column)}>{renderTableColumnLabel(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.points.map((point, index) => {
                      const split = isPointSplit(point);
                      const regionRowSpan = getRegionRowSpan(draft.points, index);
                      const hasRegionText = Boolean(normalizeRegionValue(point.region));
                      return (
                      <tr key={point.localId}>
                        <td className={styles.managementColumn}>
                          <div className={styles.rowActions}>
                            <button
                              type="button"
                              className="btn"
                              disabled={saving}
                              onClick={() => (split ? mergePoint(index, point) : splitPoint(point))}
                            >
                              {split ? "합치기" : "오전/오후"}
                            </button>
                            <button type="button" className={`btn ${styles.deleteButton}`} disabled={saving} onClick={() => removePoint(index)}>
                              삭제
                            </button>
                          </div>
                        </td>
                        <td className={styles.numberCell}>
                          {index + 1}.
                        </td>
                        {regionRowSpan > 0 ? (
                          <td
                            className={styles.regionColumn}
                            rowSpan={regionRowSpan > 1 ? regionRowSpan : undefined}
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
                        <td className={styles.placeColumn}>
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
                        <td className={styles.poolVideoColumn}>
                          <select className="field-select" value={point.poolVideo} onChange={(event) => updatePoint(index, { poolVideo: event.target.value })}>
                            <option value="">선택</option>
                            {getPoolVideoOptions(point.poolVideo).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input className="field-input" value={point.equipmentName} onChange={(event) => updatePoint(index, { equipmentName: event.target.value })} placeholder="TVU-21" />
                        </td>
                        <td>
                          <input className="field-input" value={point.trs} onChange={(event) => updatePoint(index, { trs: event.target.value })} />
                        </td>
                        <td className={styles.nameColumn}>
                          {split ? (
                            <SplitTextInput
                              morning={point.cameraStaffName}
                              afternoon={point.cameraStaffNamePm}
                              listId="election-profile-options"
                              onMorningChange={(value) => updateCameraStaff(index, "am", value)}
                              onAfternoonChange={(value) => updateCameraStaff(index, "pm", value)}
                            />
                          ) : (
                            <input className="field-input" list="election-profile-options" value={point.cameraStaffName} onChange={(event) => updateCameraStaff(index, "am", event.target.value)} />
                          )}
                        </td>
                        <td className={styles.nameColumn}>
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
                        </td>
                        <td className={styles.timeColumn}>
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
                        </td>
                        <td className={styles.nameColumn}>
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
                        </td>
                        <td className={styles.addressColumn}>
                          <input className="field-input" value={point.address} onChange={(event) => updatePoint(index, { address: event.target.value })} />
                        </td>
                        <td className={styles.wideColumn}>
                          <input className="field-input" value={point.note} onChange={(event) => updatePoint(index, { note: event.target.value })} />
                        </td>
                        <td className={styles.positionColumn}>
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
                        </td>
                        <td>
                          <input className="field-input" value={point.lighting} onChange={(event) => updatePoint(index, { lighting: event.target.value })} />
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
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
          />
        </div>
      ) : null}
    </section>
  );
}
