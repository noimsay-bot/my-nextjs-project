"use client";

import type { ReactNode } from "react";
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
  "관리",
];

type MergeColumnKey =
  | "region"
  | "place"
  | "poolVideo"
  | "equipmentName"
  | "trs"
  | "cameraStaff"
  | "audioStaff"
  | "liveTime"
  | "reporter"
  | "address"
  | "note"
  | "lighting";

interface MergeColumnConfig {
  getValues: (point: ElectionPointInput) => string[];
  getPatch: (point: ElectionPointInput) => Partial<DraftPoint>;
  getEmptyPatch: () => Partial<DraftPoint>;
  hasValue?: (point: ElectionPointInput) => boolean;
}

const LIVE_POSITION_CHECKED_VALUE = "checked";
const DEFAULT_EQUIPMENT_NAME = "TVU-";
const AUTO_SAVE_DEBOUNCE_MS = 900;

function getTableColumnClassName(column: string) {
  return column === "중계자리" ? styles.positionColumn : undefined;
}

function renderTableColumnLabel(column: string) {
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

function normalizeMergeValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function isDefaultEquipmentNameOnly(value: string | null | undefined) {
  return normalizeMergeValue(value).toUpperCase() === DEFAULT_EQUIPMENT_NAME;
}

function hasAnyMergeValue(values: string[]) {
  return values.some((value) => normalizeMergeValue(value));
}

const mergeColumnConfigs: Record<MergeColumnKey, MergeColumnConfig> = {
  region: {
    getValues: (point) => [point.region],
    getPatch: (point) => ({ region: point.region }),
    getEmptyPatch: () => ({ region: "" }),
  },
  place: {
    getValues: (point) => [point.place],
    getPatch: (point) => ({ place: point.place }),
    getEmptyPatch: () => ({ place: "" }),
  },
  poolVideo: {
    getValues: (point) => [point.poolVideo],
    getPatch: (point) => ({ poolVideo: point.poolVideo }),
    getEmptyPatch: () => ({ poolVideo: "" }),
  },
  equipmentName: {
    getValues: (point) => [isDefaultEquipmentNameOnly(point.equipmentName) ? "" : point.equipmentName],
    getPatch: (point) => ({ equipmentName: point.equipmentName }),
    getEmptyPatch: () => ({ equipmentName: DEFAULT_EQUIPMENT_NAME }),
    hasValue: (point) => Boolean(normalizeMergeValue(point.equipmentName) && !isDefaultEquipmentNameOnly(point.equipmentName)),
  },
  trs: {
    getValues: (point) => [point.trs],
    getPatch: (point) => ({ trs: point.trs }),
    getEmptyPatch: () => ({ trs: "" }),
  },
  cameraStaff: {
    getValues: (point) => [point.cameraStaffName, point.cameraStaffUserId ?? "", point.cameraStaffNamePm, point.cameraStaffUserIdPm ?? ""],
    getPatch: (point) => ({
      cameraStaffName: point.cameraStaffName,
      cameraStaffUserId: point.cameraStaffUserId,
      cameraStaffNamePm: point.cameraStaffNamePm,
      cameraStaffUserIdPm: point.cameraStaffUserIdPm,
    }),
    getEmptyPatch: () => ({
      cameraStaffName: "",
      cameraStaffUserId: null,
      cameraStaffNamePm: "",
      cameraStaffUserIdPm: null,
    }),
  },
  audioStaff: {
    getValues: (point) => [point.audioStaffName, point.audioStaffUserId ?? "", point.audioStaffNamePm],
    getPatch: (point) => ({
      audioStaffName: point.audioStaffName,
      audioStaffUserId: point.audioStaffUserId,
      audioStaffNamePm: point.audioStaffNamePm,
    }),
    getEmptyPatch: () => ({
      audioStaffName: "",
      audioStaffUserId: null,
      audioStaffNamePm: "",
    }),
  },
  liveTime: {
    getValues: (point) => [point.liveTime, point.liveTimePm],
    getPatch: (point) => ({ liveTime: point.liveTime, liveTimePm: point.liveTimePm }),
    getEmptyPatch: () => ({ liveTime: "", liveTimePm: "" }),
  },
  reporter: {
    getValues: (point) => [point.reporterName, point.reporterUserId ?? "", point.reporterNamePm],
    getPatch: (point) => ({
      reporterName: point.reporterName,
      reporterUserId: point.reporterUserId,
      reporterNamePm: point.reporterNamePm,
    }),
    getEmptyPatch: () => ({
      reporterName: "",
      reporterUserId: null,
      reporterNamePm: "",
    }),
  },
  address: {
    getValues: (point) => [point.address],
    getPatch: (point) => ({ address: point.address }),
    getEmptyPatch: () => ({ address: "" }),
  },
  note: {
    getValues: (point) => [point.note],
    getPatch: (point) => ({ note: point.note }),
    getEmptyPatch: () => ({ note: "" }),
  },
  lighting: {
    getValues: (point) => [point.lighting],
    getPatch: (point) => ({ lighting: point.lighting }),
    getEmptyPatch: () => ({ lighting: "" }),
  },
};

function getMergeColumnConfig(columnKey: MergeColumnKey) {
  return mergeColumnConfigs[columnKey];
}

function hasMergeColumnValue(point: ElectionPointInput, columnKey: MergeColumnKey) {
  const config = getMergeColumnConfig(columnKey);
  return config.hasValue ? config.hasValue(point) : hasAnyMergeValue(config.getValues(point));
}

function areMergeColumnValuesEqual(
  left: ElectionPointInput,
  right: ElectionPointInput,
  columnKey: MergeColumnKey,
) {
  const config = getMergeColumnConfig(columnKey);
  const leftValues = config.getValues(left);
  const rightValues = config.getValues(right);
  if (leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => normalizeMergeValue(value) === normalizeMergeValue(rightValues[index]));
}

function isCellCoveredByPreviousRow(
  points: ElectionPointInput[],
  rowIndex: number,
  columnKey: MergeColumnKey,
) {
  if (rowIndex <= 0) return false;
  const current = points[rowIndex];
  const previous = points[rowIndex - 1];
  return (
    hasMergeColumnValue(current, columnKey) &&
    hasMergeColumnValue(previous, columnKey) &&
    areMergeColumnValuesEqual(previous, current, columnKey)
  );
}

function getMergeStartIndex(points: ElectionPointInput[], rowIndex: number, columnKey: MergeColumnKey) {
  let startIndex = rowIndex;
  while (startIndex > 0 && isCellCoveredByPreviousRow(points, startIndex, columnKey)) {
    startIndex -= 1;
  }
  return startIndex;
}

function getMergeRowSpan(points: ElectionPointInput[], rowIndex: number, columnKey: MergeColumnKey) {
  if (isCellCoveredByPreviousRow(points, rowIndex, columnKey)) return 0;
  const point = points[rowIndex];
  if (!point || !hasMergeColumnValue(point, columnKey)) return 1;

  let rowSpan = 1;
  for (let nextIndex = rowIndex + 1; nextIndex < points.length; nextIndex += 1) {
    const nextPoint = points[nextIndex];
    if (
      !hasMergeColumnValue(nextPoint, columnKey) ||
      !areMergeColumnValuesEqual(point, nextPoint, columnKey)
    ) {
      break;
    }
    rowSpan += 1;
  }
  return rowSpan;
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

function formatElectionBoardTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  return trimmed ? `${trimmed} 배치표` : "선거 중계표";
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

function ReadOnlyMergedCell({
  points,
  index,
  columnKey,
  className,
  children,
}: {
  points: ElectionPointInput[];
  index: number;
  columnKey: MergeColumnKey;
  className?: string;
  children: ReactNode;
}) {
  const rowSpan = getMergeRowSpan(points, index, columnKey);
  if (rowSpan === 0) return null;
  return (
    <td rowSpan={rowSpan > 1 ? rowSpan : undefined} className={className}>
      {children}
    </td>
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
}: {
  morning: string;
  afternoon: string;
  onMorningChange: (value: string) => void;
  onAfternoonChange: (value: string) => void;
  listId?: string;
}) {
  return (
    <div className={styles.splitStack}>
      <label>
        <span>오전</span>
        <input className="field-input" list={listId} value={morning} onChange={(event) => onMorningChange(event.target.value)} />
      </label>
      <label>
        <span>오후</span>
        <input className="field-input" list={listId} value={afternoon} onChange={(event) => onAfternoonChange(event.target.value)} />
      </label>
    </div>
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
                {tableColumns.slice(0, -1).map((column) => (
                  <th key={column} className={getTableColumnClassName(column)}>{renderTableColumnLabel(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {event.points.length ? (
                event.points.map((point, index) => (
                  <tr key={point.id}>
                    <td className={styles.numberCell}>{index + 1}.</td>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="region">
                      {readOnlyValue(point.region)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="place">
                      {readOnlyValue(point.place)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="poolVideo">
                      {readOnlyValue(point.poolVideo)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="equipmentName">
                      {readOnlyValue(point.equipmentName)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="trs">
                      {readOnlyValue(point.trs)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="cameraStaff">
                      {readOnlySplitValue(point.cameraStaffName, point.cameraStaffNamePm)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="audioStaff">
                      {readOnlySplitValue(point.audioStaffName, point.audioStaffNamePm)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="liveTime">
                      {readOnlySplitValue(point.liveTime, point.liveTimePm)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="reporter">
                      {readOnlySplitValue(point.reporterName, point.reporterNamePm)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="address">
                      {readOnlyValue(point.address)}
                    </ReadOnlyMergedCell>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="note">
                      {readOnlyValue(point.note)}
                    </ReadOnlyMergedCell>
                    <td className={styles.positionColumn}>
                      <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.livePosition) ? styles.positionReadOnlyOn : ""}`.trim()} />
                    </td>
                    <ReadOnlyMergedCell points={event.points} index={index} columnKey="lighting">
                      {readOnlyValue(point.lighting)}
                    </ReadOnlyMergedCell>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={15}>
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
      setAutoSaveStatus("saved");
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

  const updateMergedPoint = (index: number, columnKey: MergeColumnKey, patch: Partial<DraftPoint>) => {
    setDraft((current) => {
      if (!current) return current;
      const rowSpan = Math.max(1, getMergeRowSpan(current.points, index, columnKey));
      return {
        ...current,
        points: current.points.map((point, pointIndex) =>
          pointIndex >= index && pointIndex < index + rowSpan ? { ...point, ...patch } : point,
        ),
      };
    });
  };

  const mergeCellWithPrevious = (index: number, columnKey: MergeColumnKey) => {
    setDraft((current) => {
      if (!current || index <= 0) return current;
      const sourceStartIndex = getMergeStartIndex(current.points, index - 1, columnKey);
      const sourcePoint = current.points[sourceStartIndex];
      if (!sourcePoint || !hasMergeColumnValue(sourcePoint, columnKey)) return current;

      const rowSpan = Math.max(1, getMergeRowSpan(current.points, index, columnKey));
      const patch = getMergeColumnConfig(columnKey).getPatch(sourcePoint);
      return {
        ...current,
        points: current.points.map((point, pointIndex) =>
          pointIndex >= index && pointIndex < index + rowSpan ? { ...point, ...patch } : point,
        ),
      };
    });
  };

  const unmergeCell = (index: number, columnKey: MergeColumnKey) => {
    setDraft((current) => {
      if (!current) return current;
      const rowSpan = getMergeRowSpan(current.points, index, columnKey);
      if (rowSpan <= 1) return current;

      const emptyPatch = getMergeColumnConfig(columnKey).getEmptyPatch();
      return {
        ...current,
        points: current.points.map((point, pointIndex) =>
          pointIndex > index && pointIndex < index + rowSpan ? { ...point, ...emptyPatch } : point,
        ),
      };
    });
  };

  const renderMergedCell = ({
    index,
    columnKey,
    className,
    children,
  }: {
    index: number;
    columnKey: MergeColumnKey;
    className?: string;
    children: ReactNode;
  }) => {
    if (!draft) return null;
    const rowSpan = getMergeRowSpan(draft.points, index, columnKey);
    if (rowSpan === 0) return null;

    const previousCanMerge = index > 0 && hasMergeColumnValue(draft.points[index - 1], columnKey);
    const control = rowSpan > 1 ? (
      <button
        type="button"
        className={`${styles.mergeCellControl} ${styles.mergeCellControlActive}`.trim()}
        disabled={saving}
        onClick={() => unmergeCell(index, columnKey)}
        title="셀 병합 해제"
        aria-label="셀 병합 해제"
      >
        ⤢
      </button>
    ) : previousCanMerge ? (
      <button
        type="button"
        className={styles.mergeCellControl}
        disabled={saving}
        onClick={() => mergeCellWithPrevious(index, columnKey)}
        title="윗행과 셀 병합"
        aria-label="윗행과 셀 병합"
      >
        ↕
      </button>
    ) : null;

    return (
      <td
        rowSpan={rowSpan > 1 ? rowSpan : undefined}
        className={`${styles.mergeableCell} ${className ?? ""}`.trim()}
      >
        <div className={styles.mergeCellInner}>
          {children}
          {control}
        </div>
      </td>
    );
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
      updateMergedPoint(index, "cameraStaff", { cameraStaffName: value, cameraStaffUserId: userId });
      return;
    }
    updateMergedPoint(index, "cameraStaff", { cameraStaffNamePm: value, cameraStaffUserIdPm: userId });
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
      setAutoSaveStatus("saved");
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
      <section className={styles.page}>
        <article className="panel">
          <div className={`panel-pad ${styles.header}`}>
            <div className={styles.titleBlock}>
              <h1 className="page-title">{formatElectionBoardTitle(publishedEvent?.title)}</h1>
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
      </section>
    );
  }

  const currentStatus = draft?.status ?? "draft";

  return (
    <section className={styles.page}>
      <article className="panel">
        <div className={`panel-pad ${styles.header}`}>
          <div className={styles.titleBlock}>
            <h1 className="page-title">{formatElectionBoardTitle(savedDisplayTitle)}</h1>
            <span className={getStatusClassName(currentStatus)}>{statusLabels[currentStatus]}</span>
          </div>
          <div className={styles.actions}>
            <span className={styles.autoSaveStatus} aria-live="polite">
              {autoSaveStatus === "pending"
                ? "자동 저장 대기"
                : autoSaveStatus === "saving"
                  ? "자동 저장 중"
                  : autoSaveStatus === "saved"
                    ? "자동 저장됨"
                    : autoSaveStatus === "error"
                      ? "자동 저장 실패"
                      : "자동 저장"}
            </span>
            <button type="button" className="btn" disabled={saving || !draft} onClick={saveDraft}>
              {saving ? "저장 중" : "저장"}
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
                      return (
                      <tr key={point.localId}>
                        <td className={styles.numberCell}>
                          {index + 1}.
                        </td>
                        {renderMergedCell({
                          index,
                          columnKey: "region",
                          children: (
                            <input className="field-input" value={point.region} onChange={(event) => updateMergedPoint(index, "region", { region: event.target.value })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "place",
                          className: styles.placeColumn,
                          children: (
                            <input className="field-input" value={point.place} onChange={(event) => updateMergedPoint(index, "place", { place: event.target.value })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "poolVideo",
                          children: (
                            <select className="field-select" value={point.poolVideo} onChange={(event) => updateMergedPoint(index, "poolVideo", { poolVideo: event.target.value })}>
                              <option value="">선택</option>
                              {getPoolVideoOptions(point.poolVideo).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "equipmentName",
                          children: (
                            <input className="field-input" value={point.equipmentName} onChange={(event) => updateMergedPoint(index, "equipmentName", { equipmentName: event.target.value })} placeholder="TVU-21" />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "trs",
                          children: (
                            <input className="field-input" value={point.trs} onChange={(event) => updateMergedPoint(index, "trs", { trs: event.target.value })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "cameraStaff",
                          className: styles.staffColumn,
                          children: split ? (
                            <SplitTextInput
                              morning={point.cameraStaffName}
                              afternoon={point.cameraStaffNamePm}
                              listId="election-profile-options"
                              onMorningChange={(value) => updateCameraStaff(index, "am", value)}
                              onAfternoonChange={(value) => updateCameraStaff(index, "pm", value)}
                            />
                          ) : (
                            <input className="field-input" list="election-profile-options" value={point.cameraStaffName} onChange={(event) => updateCameraStaff(index, "am", event.target.value)} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "audioStaff",
                          className: styles.staffColumn,
                          children: split ? (
                            <SplitTextInput
                              morning={point.audioStaffName}
                              afternoon={point.audioStaffNamePm}
                              onMorningChange={(value) => updateMergedPoint(index, "audioStaff", { audioStaffName: value, audioStaffUserId: null })}
                              onAfternoonChange={(value) => updateMergedPoint(index, "audioStaff", { audioStaffNamePm: value })}
                            />
                          ) : (
                            <input className="field-input" value={point.audioStaffName} onChange={(event) => updateMergedPoint(index, "audioStaff", { audioStaffName: event.target.value, audioStaffUserId: null })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "liveTime",
                          className: styles.staffColumn,
                          children: split ? (
                            <SplitTextInput
                              morning={point.liveTime}
                              afternoon={point.liveTimePm}
                              onMorningChange={(value) => updateMergedPoint(index, "liveTime", { liveTime: value })}
                              onAfternoonChange={(value) => updateMergedPoint(index, "liveTime", { liveTimePm: value })}
                            />
                          ) : (
                            <input className="field-input" value={point.liveTime} onChange={(event) => updateMergedPoint(index, "liveTime", { liveTime: event.target.value })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "reporter",
                          className: styles.staffColumn,
                          children: split ? (
                            <SplitTextInput
                              morning={point.reporterName}
                              afternoon={point.reporterNamePm}
                              onMorningChange={(value) => updateMergedPoint(index, "reporter", { reporterName: value, reporterUserId: null })}
                              onAfternoonChange={(value) => updateMergedPoint(index, "reporter", { reporterNamePm: value })}
                            />
                          ) : (
                            <input className="field-input" value={point.reporterName} onChange={(event) => updateMergedPoint(index, "reporter", { reporterName: event.target.value, reporterUserId: null })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "address",
                          className: styles.wideColumn,
                          children: (
                            <input className="field-input" value={point.address} onChange={(event) => updateMergedPoint(index, "address", { address: event.target.value })} />
                          ),
                        })}
                        {renderMergedCell({
                          index,
                          columnKey: "note",
                          className: styles.wideColumn,
                          children: (
                            <input className="field-input" value={point.note} onChange={(event) => updateMergedPoint(index, "note", { note: event.target.value })} />
                          ),
                        })}
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
                        {renderMergedCell({
                          index,
                          columnKey: "lighting",
                          children: (
                            <input className="field-input" value={point.lighting} onChange={(event) => updateMergedPoint(index, "lighting", { lighting: event.target.value })} />
                          ),
                        })}
                        <td>
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
    </section>
  );
}
