"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeElectionEvent,
  fetchElectionWorkspace,
  publishElectionEvent,
  saveElectionWorkspace,
} from "@/lib/election/storage";
import { getKstDateKey } from "@/lib/election/dates";
import { ELECTION_PRINT_CSS, renderElectionPrintHtml } from "@/lib/election/print-layout";
import type {
  ElectionEvent,
  ElectionPointInput,
  ElectionProfileOption,
  ElectionSaveInput,
  ElectionStatus,
} from "@/lib/election/types";
import { printHtmlDocument } from "@/lib/print";
import { getSession, subscribeToAuth } from "@/lib/auth/storage";
import type { SessionUser } from "@/lib/auth/storage";
import styles from "./Election.module.css";

type Message = { tone: "ok" | "warn" | "note"; text: string };
type DayPart = "am" | "pm";

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

interface DraftPointGroup {
  key: string;
  region: string;
  pointIndexes: number[];
}

const statusLabels: Record<ElectionStatus, string> = {
  draft: "작성중",
  published: "게시중",
  closed: "최종 저장",
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

const LIVE_POSITION_CHECKED_VALUE = "checked";
const DEFAULT_EQUIPMENT_NAME = "TVU-";

function getTableColumnClassName(column: string) {
  return column === "중계자리" ? styles.positionColumn : undefined;
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

function getAuthReloadKey(session: SessionUser | null) {
  if (!session) return "anonymous";
  return `${session.id}:${session.approved}:${session.actualRole}`;
}

function buildDraftPointGroups(points: DraftPoint[]): DraftPointGroup[] {
  const groups: DraftPointGroup[] = [];

  points.forEach((point, index) => {
    const region = point.region.trim();

    const previousGroup = groups.at(-1);
    if (previousGroup && previousGroup.region === region) {
      previousGroup.pointIndexes.push(index);
      return;
    }

    groups.push({
      key: `${point.localId}-${index}`,
      region,
      pointIndexes: [index],
    });
  });

  return groups;
}

function buildReadOnlyPointGroups(points: ElectionEvent["points"]): Array<{ key: string; region: string; points: ElectionEvent["points"] }> {
  const groups: Array<{ key: string; region: string; points: ElectionEvent["points"] }> = [];

  points.forEach((point, index) => {
    const region = point.region.trim();

    const previousGroup = groups.at(-1);
    if (previousGroup && previousGroup.region === region) {
      previousGroup.points.push(point);
      return;
    }

    groups.push({
      key: `${point.id}-${index}`,
      region,
      points: [point],
    });
  });

  return groups;
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
    points: draft.points.map((point, index) => ({ ...point, region: point.region.trim(), sortOrder: index })),
  };
}

function getStatusClassName(status: ElectionStatus) {
  if (status === "published") return `${styles.statusBadge} ${styles.statusPublished}`;
  if (status === "closed") return `${styles.statusBadge} ${styles.statusClosed}`;
  return `${styles.statusBadge} ${styles.statusDraft}`;
}

function formatElectionBoardTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  return trimmed ? `${trimmed} 중계표` : "선거 계획표";
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
  const pointGroups = buildReadOnlyPointGroups(event.points);
  let pointNumber = 0;

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
                  <th key={column} className={getTableColumnClassName(column)}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pointGroups.length ? (
                pointGroups.flatMap((group) =>
                  group.points.map((point, groupPointIndex) => {
                    pointNumber += 1;

                    return (
                      <tr key={point.id}>
                        <td className={styles.numberCell}>{pointNumber}.</td>
                        {groupPointIndex === 0 ? (
                          <td rowSpan={group.points.length} className={styles.readOnlyRegionCell}>
                            {readOnlyValue(group.region)}
                          </td>
                        ) : null}
                        <td>{readOnlyValue(point.place)}</td>
                        <td>{readOnlyValue(point.poolVideo)}</td>
                        <td>{readOnlyValue(point.equipmentName)}</td>
                        <td>{readOnlyValue(point.trs)}</td>
                        <td>{readOnlySplitValue(point.cameraStaffName, point.cameraStaffNamePm)}</td>
                        <td>{readOnlySplitValue(point.audioStaffName, point.audioStaffNamePm)}</td>
                        <td>{readOnlySplitValue(point.liveTime, point.liveTimePm)}</td>
                        <td>{readOnlySplitValue(point.reporterName, point.reporterNamePm)}</td>
                        <td>{readOnlyValue(point.address)}</td>
                        <td>{readOnlyValue(point.note)}</td>
                        <td className={styles.positionColumn}>
                          <span className={`${styles.positionReadOnly} ${isLivePositionChecked(point.livePosition) ? styles.positionReadOnlyOn : ""}`.trim()} />
                        </td>
                        <td>{readOnlyValue(point.lighting)}</td>
                      </tr>
                    );
                  }),
                )
              ) : (
                <tr>
                  <td colSpan={tableColumns.length - 1}>
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

function ArchivedElectionList({
  events,
  selectedEvent,
  onSelect,
}: {
  events: ElectionEvent[];
  selectedEvent: ElectionEvent | null;
  onSelect: (eventId: string) => void;
}) {
  if (events.length === 0) return null;

  return (
    <>
      <article className="panel">
        <div className={`panel-pad ${styles.emptyPanel}`}>
          <div className={styles.toolbar}>
            <div>
              <span className={styles.statusBadge}>기록</span>
              <h2 style={{ margin: "10px 0 4px" }}>최종 저장된 선거</h2>
              <div className={styles.summary}>최근 {events.length}개 선거 중계표</div>
            </div>
          </div>
          <div className={styles.archiveList}>
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                className={`btn ${selectedEvent?.id === event.id ? "primary" : ""}`.trim()}
                onClick={() => onSelect(event.id)}
              >
                {event.title} · {event.electionDate}
              </button>
            ))}
          </div>
        </div>
      </article>
      {selectedEvent ? <ElectionReadOnlyTable event={selectedEvent} /> : null}
    </>
  );
}

export function ElectionPage() {
  const [draft, setDraft] = useState<DraftEvent | null>(null);
  const [publishedEvent, setPublishedEvent] = useState<ElectionEvent | null>(null);
  const [archivedEvents, setArchivedEvents] = useState<ElectionEvent[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ElectionProfileOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [splitRowIds, setSplitRowIds] = useState<Record<string, true>>({});
  const [savedDisplayTitle, setSavedDisplayTitle] = useState<string | null>(null);
  const authReloadKeyRef = useRef(getAuthReloadKey(getSession()));

  const profileNames = useMemo(() => profiles.map((profile) => profile.name), [profiles]);
  const selectedArchivedEvent = useMemo(
    () => archivedEvents.find((event) => event.id === selectedArchiveId) ?? null,
    [archivedEvents, selectedArchiveId],
  );
  const draftPointGroups = useMemo(() => (draft ? buildDraftPointGroups(draft.points) : []), [draft]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const workspace = await fetchElectionWorkspace();
      setCanManage(workspace.canManage);
      setProfiles(workspace.profiles);
      setArchivedEvents(workspace.archivedEvents);
      setPublishedEvent(workspace.canManage ? null : workspace.event);
      setDraft(workspace.canManage ? (workspace.event ? eventToDraft(workspace.event) : createBlankDraft()) : null);
      setSelectedArchiveId((current) =>
        current && workspace.archivedEvents.some((event) => event.id === current) ? current : null,
      );
      setSavedDisplayTitle(workspace.event?.title ?? null);
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "선거 중계표를 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribeToAuth((nextSession) => {
        const nextKey = getAuthReloadKey(nextSession);
        if (authReloadKeyRef.current === nextKey) return;
        authReloadKeyRef.current = nextKey;
        void load();
      }),
    [load],
  );

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

  const updateGroupRegion = (pointIndexes: number[], region: string) => {
    const indexSet = new Set(pointIndexes);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        points: current.points.map((point, pointIndex) => (indexSet.has(pointIndex) ? { ...point, region } : point)),
      };
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

  const addRegion = () => {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, points: [...current.points, createBlankPoint(current.points.length)] };
    });
  };

  const addPointToGroup = (pointIndexes: number[], region: string) => {
    setDraft((current) => {
      if (!current) return current;
      const insertIndex = Math.max(...pointIndexes) + 1;
      const nextPoint = { ...createBlankPoint(insertIndex), region };
      const nextPoints = [
        ...current.points.slice(0, insertIndex),
        nextPoint,
        ...current.points.slice(insertIndex),
      ].map((point, index) => ({ ...point, sortOrder: index }));

      return { ...current, points: nextPoints };
    });
  };

  const removePoint = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const nextPoints = current.points.filter((_, pointIndex) => pointIndex !== index);
      return { ...current, points: nextPoints.length ? nextPoints : [createBlankPoint(0)] };
    });
  };

  const persistDraft = async (successMessage?: string) => {
    if (!draft) return null;
    const workspace = await saveElectionWorkspace(draftToSaveInput(draft));
    setCanManage(workspace.canManage);
    setProfiles(workspace.profiles);
    setArchivedEvents(workspace.archivedEvents);
    setDraft(workspace.event ? eventToDraft(workspace.event) : createBlankDraft());
    setSavedDisplayTitle(workspace.event?.title ?? null);
    if (successMessage) {
      setMessage({ tone: "ok", text: successMessage });
    }
    return workspace.event;
  };

  const publishDraft = async () => {
    setSaving(true);
    try {
      const savedEvent = await persistDraft();
      if (!savedEvent) return;
      const workspace = await publishElectionEvent(savedEvent.id);
      setCanManage(workspace.canManage);
      setProfiles(workspace.profiles);
      setArchivedEvents(workspace.archivedEvents);
      setDraft(workspace.event ? eventToDraft(workspace.event) : createBlankDraft());
      setSavedDisplayTitle(workspace.event?.title ?? null);
      setMessage({ tone: "ok", text: "선거 중계표를 게시했습니다. 게시 중에도 수정 후 다시 게시하면 홈과 공개 페이지에 반영됩니다." });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "선거 중계표 게시에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const finalizeDraft = async () => {
    if (!draft) return;
    const ok = window.confirm("최종 저장하면 더 이상 수정할 수 없고 공개 페이지와 홈에서 내려갑니다. 계속하시겠습니까?");
    if (!ok) return;

    setSaving(true);
    try {
      const savedEvent = await persistDraft();
      if (!savedEvent) return;
      const workspace = await closeElectionEvent(savedEvent.id);
      setCanManage(workspace.canManage);
      setDraft(createBlankDraft());
      setProfiles(workspace.profiles);
      setArchivedEvents(workspace.archivedEvents);
      setSelectedArchiveId(savedEvent.id);
      setPublishedEvent(null);
      setSavedDisplayTitle(null);
      setMessage({ tone: "ok", text: "최종 저장했습니다. 입력칸을 초기화했으니 다음 선거 중계표를 작성할 수 있습니다." });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "최종 저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const printElectionBoard = () => {
    const printSource = canManage ? draft : publishedEvent;
    if (!printSource) return;

    const title = formatElectionBoardTitle(printSource.title);
    const ok = printHtmlDocument({
      title,
      pageSize: "A3 portrait",
      pageMargin: "5mm",
      extraCss: ELECTION_PRINT_CSS,
      bodyHtml: renderElectionPrintHtml({
        title,
        electionDate: printSource.electionDate,
        status: printSource.status,
        points: printSource.points,
      }),
    });

    if (!ok) {
      setMessage({ tone: "warn", text: "팝업 차단으로 출력 창을 열지 못했습니다." });
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
            <div className={styles.actions}>
              <button type="button" className="btn" disabled={!publishedEvent} onClick={printElectionBoard}>
                출력
              </button>
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
            <h1 className="page-title">{formatElectionBoardTitle(draft?.title ?? savedDisplayTitle)}</h1>
            <span className={getStatusClassName(currentStatus)}>{statusLabels[currentStatus]}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn" disabled={!draft} onClick={printElectionBoard}>
              출력
            </button>
            <button type="button" className="btn" disabled={saving || !draft} onClick={finalizeDraft}>
              {saving ? "최종 저장 중" : "최종 저장"}
            </button>
            <button type="button" className="btn primary" disabled={saving || !draft} onClick={publishDraft}>
              게시
            </button>
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
                <button type="button" className="btn" disabled={saving} onClick={addRegion}>
                  지역 추가
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
                        <th key={column} className={getTableColumnClassName(column)}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draftPointGroups.map((group) => (
                      <Fragment key={group.key}>
                        <tr key={`${group.key}-region`} className={styles.regionHeaderRow}>
                          <td colSpan={tableColumns.length}>
                            <div className={styles.regionHeader}>
                              <label className={styles.regionField}>
                                <span>지역</span>
                                <input
                                  className="field-input"
                                  value={group.region}
                                  onChange={(event) => updateGroupRegion(group.pointIndexes, event.target.value)}
                                  placeholder="예: 정당"
                                />
                              </label>
                              <div className={styles.regionActions}>
                                <span>{group.pointIndexes.length}개 장소</span>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={saving}
                                  onClick={() => addPointToGroup(group.pointIndexes, group.region)}
                                >
                                  장소 추가
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {group.pointIndexes.map((index) => {
                          const point = draft.points[index];
                          const split = isPointSplit(point);

                          return (
                            <tr key={point.localId}>
                              <td className={styles.numberCell}>
                                {index + 1}.
                              </td>
                              <td className={styles.groupChildCell} aria-label={group.region || "미분류 지역"} />
                              <td className={styles.placeColumn}>
                                <input className="field-input" value={point.place} onChange={(event) => updatePoint(index, { place: event.target.value })} />
                              </td>
                              <td>
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
                              <td className={styles.staffColumn}>
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
                              <td className={styles.staffColumn}>
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
                              <td className={styles.staffColumn}>
                                {split ? (
                                  <SplitTextInput
                                    morning={point.liveTime}
                                    afternoon={point.liveTimePm}
                                    onMorningChange={(value) => updatePoint(index, { liveTime: value })}
                                    onAfternoonChange={(value) => updatePoint(index, { liveTimePm: value })}
                                  />
                                ) : (
                                  <input className="field-input" value={point.liveTime} onChange={(event) => updatePoint(index, { liveTime: event.target.value })} />
                                )}
                              </td>
                              <td className={styles.staffColumn}>
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
                              <td className={styles.wideColumn}>
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
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </>
      ) : null}

      <ArchivedElectionList
        events={archivedEvents}
        selectedEvent={selectedArchivedEvent}
        onSelect={setSelectedArchiveId}
      />
    </section>
  );
}
