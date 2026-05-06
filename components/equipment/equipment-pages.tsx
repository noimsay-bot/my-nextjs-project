"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  getSession,
  isReadOnlyPortalRole,
  type SessionUser,
} from "@/lib/auth/storage";
import { getEngScheduleBadges, loadEngScheduleHighlights, type EngScheduleBadge, type EngScheduleHighlightMap } from "@/lib/equipment/eng-schedule";
import {
  borrowEngSets,
  borrowEquipmentItems,
  canReturnLoanItem,
  fetchEquipmentItems,
  fetchEquipmentLoanItems,
  fetchEquipmentProfiles,
  returnEquipmentLoanItems,
} from "@/lib/equipment/storage";
import {
  equipmentCategoryConfigs,
  equipmentCategoryLabels,
  equipmentNavItems,
  normalEquipmentCategories,
  type EquipmentCategory,
  type EquipmentItem,
  type EquipmentLoanItem,
  type EquipmentProfile,
  type LiveLoanDetails,
} from "@/lib/equipment/types";
import styles from "./Equipment.module.css";

type Message = { tone: "ok" | "warn" | "note"; text: string };
type ConfirmMode = "borrow" | "return";
type EquipmentItemCardTone = "default" | "live";
type BorrowSelection =
  | {
      kind: "item";
      id: string;
      category: EquipmentCategory;
      label: string;
      isTvu: boolean;
    }
  | {
      kind: "eng_profile";
      id: string;
      category: "eng_set";
      label: string;
      isTvu: false;
    };

const liveDetailEmpty: LiveLoanDetails = {
  trs: "",
  cameraReporter: "",
  audioMan: "",
  location: "",
  note: "",
};
const EQUIPMENT_BORROW_SELECTION_STORAGE_PREFIX = "jtbc-equipment-borrow-selection-v1";
const EQUIPMENT_BORROW_SELECTION_EVENT = "jtbc-equipment-borrow-selection-change";

function getBorrowSelectionStorageKey(profileId: string | null | undefined) {
  return `${EQUIPMENT_BORROW_SELECTION_STORAGE_PREFIX}:${profileId || "anonymous"}`;
}

function getBorrowSelectionKey(selection: Pick<BorrowSelection, "kind" | "id">) {
  return `${selection.kind}:${selection.id}`;
}

function normalizeBorrowSelections(value: unknown): BorrowSelection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const selections: BorrowSelection[] = [];

  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const item = entry as Partial<BorrowSelection>;
    if (typeof item.id !== "string" || typeof item.label !== "string" || typeof item.kind !== "string") return;
    if (item.kind === "item") {
      if (!["camera_lens", "light", "live"].includes(String(item.category))) return;
      const selection: BorrowSelection = {
        kind: "item",
        id: item.id,
        category: item.category as EquipmentCategory,
        label: item.label,
        isTvu: item.isTvu === true,
      };
      const key = getBorrowSelectionKey(selection);
      if (seen.has(key)) return;
      seen.add(key);
      selections.push(selection);
      return;
    }
    if (item.kind === "eng_profile" && item.category === "eng_set") {
      const selection: BorrowSelection = {
        kind: "eng_profile",
        id: item.id,
        category: "eng_set",
        label: item.label,
        isTvu: false,
      };
      const key = getBorrowSelectionKey(selection);
      if (seen.has(key)) return;
      seen.add(key);
      selections.push(selection);
    }
  });

  return selections;
}

function readBorrowSelections(profileId: string | null | undefined) {
  if (typeof window === "undefined") return [] as BorrowSelection[];
  try {
    const raw = window.localStorage.getItem(getBorrowSelectionStorageKey(profileId));
    return normalizeBorrowSelections(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function writeBorrowSelections(profileId: string | null | undefined, selections: BorrowSelection[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getBorrowSelectionStorageKey(profileId), JSON.stringify(selections));
  window.dispatchEvent(new CustomEvent(EQUIPMENT_BORROW_SELECTION_EVENT));
}

function itemToBorrowSelection(item: EquipmentItem): BorrowSelection {
  return {
    kind: "item",
    id: item.id,
    category: item.category,
    label: item.name,
    isTvu: isTvuItem(item),
  };
}

function profileToBorrowSelection(profile: EquipmentProfile): BorrowSelection {
  return {
    kind: "eng_profile",
    id: profile.id,
    category: "eng_set",
    label: `ENG SET - ${profile.name}`,
    isTvu: false,
  };
}

function formatBorrowSelectionLabel(selection: BorrowSelection) {
  return `${equipmentCategoryLabels[selection.category]} · ${selection.label}`;
}

function getTodayDateKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function isTvuItem(item: EquipmentItem) {
  return item.category === "live" && item.groupName.trim().toUpperCase() === "TVU";
}

function isTvuInlineAccessoryItem(item: EquipmentItem) {
  if (item.category !== "live") return false;
  const normalizedName = item.name.replace(/\s+/g, "").toLowerCase();
  return normalizedName === "tvu배터리" || normalizedName === "핀마이크";
}

function getEngTargetProfileId(loanItem: EquipmentLoanItem) {
  const targetProfileId = loanItem.item.metadata.target_profile_id;
  return typeof targetProfileId === "string" ? targetProfileId : "";
}

function groupLoanItemsByBorrower(loanItems: EquipmentLoanItem[]) {
  const groups = new Map<string, { borrowerId: string; borrowerName: string; items: EquipmentLoanItem[] }>();
  loanItems.forEach((loanItem) => {
    const borrowerId = loanItem.loan.borrowerProfileId;
    const existing = groups.get(borrowerId);
    if (existing) {
      existing.items.push(loanItem);
      return;
    }
    groups.set(borrowerId, {
      borrowerId,
      borrowerName: loanItem.loan.borrowerName,
      items: [loanItem],
    });
  });

  return Array.from(groups.values()).sort((left, right) => left.borrowerName.localeCompare(right.borrowerName, "ko"));
}

function getEquipmentGroupDisplayName(groupName: string) {
  return groupName === "단독 카메라" ? "캠코더 / 액션캠" : groupName;
}

function getMetadataString(item: EquipmentItem, key: string) {
  const value = item.metadata[key];
  return typeof value === "string" ? value : "";
}

function getVariantParentLabel(item: EquipmentItem) {
  return getMetadataString(item, "variant_parent");
}

function getVariantLabel(item: EquipmentItem) {
  return getMetadataString(item, "variant_label") || item.name;
}

function isStandaloneBatteryItem(item: EquipmentItem) {
  return getMetadataString(item, "family") === "standalone" && getMetadataString(item, "kind") === "battery";
}

function getStandaloneBatteryKey(item: EquipmentItem) {
  const key = getMetadataString(item, "for");
  return key ? key.toLowerCase() : "";
}

function getStandaloneCameraBatteryKey(item: EquipmentItem) {
  if (item.groupName !== "단독 카메라") return "";
  const target = `${item.code} ${item.name}`.toLowerCase();
  if (target.includes("z-90")) return "z-90";
  if (target.includes("ax40")) return "ax40";
  if (target.includes("rx100")) return "rx100";
  if (target.includes("gopro") || target.includes("고프로")) return "gopro";
  if (target.includes("osmo") || target.includes("오스모")) return "osmo";
  return "";
}

const engBadgePriority: Record<EngScheduleBadge, number> = {
  휴가: 0,
  제크: 1,
  야퇴: 2,
  기본오프: 3,
};

function getEngBadgeSortRank(badges: EngScheduleBadge[]) {
  if (badges.length === 0) return 99;
  return Math.min(...badges.map((badge) => engBadgePriority[badge] ?? 99));
}

function EquipmentNav({ activeHref }: { activeHref: string }) {
  return (
    <div className={styles.nav} aria-label="라이브/장비 하위 메뉴">
      {equipmentNavItems.map((item) => (
        <Link key={item.href} href={item.href} className={`${styles.navLink} ${activeHref === item.href ? styles.navLinkActive : ""}`.trim()}>
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  activeHref,
}: {
  eyebrow: string;
  title: string;
  description: string;
  activeHref: string;
}) {
  return (
    <article className="panel">
      <div className={`panel-pad ${styles.header}`}>
        <div className={styles.headerText}>
          <span className="chip">{eyebrow}</span>
          <h1 className="page-title">{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        <EquipmentNav activeHref={activeHref} />
      </div>
    </article>
  );
}

function LoadingBlocks() {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} className={styles.skeletonCard} />
      ))}
    </div>
  );
}

function StatusPill({ borrowed }: { borrowed: boolean }) {
  return (
    <span className={`${styles.statusPill} ${borrowed ? styles.statusBorrowed : styles.statusAvailable}`.trim()}>
      {borrowed ? "대여중" : "대여가능"}
    </span>
  );
}

function EquipmentItemCard({
  item,
  displayName,
  selected,
  loanItem,
  onToggle,
  allowBorrowedClick = false,
  tone = "default",
}: {
  item: EquipmentItem;
  displayName?: string;
  selected: boolean;
  loanItem?: EquipmentLoanItem;
  onToggle: () => void;
  allowBorrowedClick?: boolean;
  tone?: EquipmentItemCardTone;
}) {
  const borrowed = Boolean(loanItem);
  return (
    <button
      type="button"
      className={[
        styles.itemCard,
        tone === "live" ? styles.itemCardLive : "",
        selected ? styles.itemCardSelected : "",
        selected && tone === "live" ? styles.itemCardSelectedLive : "",
        borrowed ? styles.itemCardBorrowed : "",
      ].join(" ").trim()}
      disabled={borrowed && !allowBorrowedClick}
      onClick={onToggle}
      aria-pressed={selected}
    >
      <span className={styles.itemCardTop}>
        <strong>{displayName ?? item.name}</strong>
        {borrowed ? <StatusPill borrowed /> : null}
      </span>
    </button>
  );
}

function DailyRecords({
  dateKey,
  onDateChange,
  records,
}: {
  dateKey: string;
  onDateChange: (dateKey: string) => void;
  records: EquipmentLoanItem[];
}) {
  return (
    <article className="panel">
      <div className={`panel-pad ${styles.sectionStack}`}>
        <div className={styles.sectionHead}>
          <div>
            <span className="chip">일별 기록</span>
            <h2 className={styles.sectionTitle}>대여 기록</h2>
          </div>
          <label className={styles.dateFilter}>
            <span>날짜</span>
            <input className="field-input" type="date" value={dateKey} onChange={(event) => onDateChange(event.target.value)} />
          </label>
        </div>
        {records.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className="table-like">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>사용자 이름</th>
                  <th>장비명</th>
                  <th>대여 시간</th>
                  <th>반납 시간</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.borrowedAt)}</td>
                    <td>{record.loan.borrowerName}</td>
                    <td>
                      <span className={styles.recordName}>{record.item.name}</span>
                      <span className={styles.recordCategory}>{equipmentCategoryLabels[record.item.category]}</span>
                    </td>
                    <td>{formatDateTime(record.borrowedAt)}</td>
                    <td>{formatDateTime(record.returnedAt)}</td>
                    <td>{record.status === "borrowed" ? "대여중" : "반납완료"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="status note">선택한 날짜의 장비 대여 기록이 없습니다.</div>
        )}
      </div>
    </article>
  );
}

function ConfirmDialog({
  mode,
  title,
  itemLabels,
  liveDetails,
  showLiveFields,
  returnIds,
  returnItems,
  actionPending,
  onClose,
  onConfirm,
  onLiveDetailsChange,
  onReturnIdsChange,
}: {
  mode: ConfirmMode;
  title: string;
  itemLabels: { id: string; label: string }[];
  liveDetails: LiveLoanDetails;
  showLiveFields: boolean;
  returnIds: string[];
  returnItems: EquipmentLoanItem[];
  actionPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onLiveDetailsChange: (details: LiveLoanDetails) => void;
  onReturnIdsChange: (ids: string[]) => void;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="equipment-confirm-title">
        <div className={styles.sectionStack}>
          <div>
            <span className="chip">{mode === "borrow" ? "대여 확인" : "반납 확인"}</span>
            <h2 id="equipment-confirm-title" className={styles.modalTitle}>{title}</h2>
          </div>
          <div className={styles.modalList}>
            {mode === "return"
              ? returnItems.map((item) => (
                  <label key={item.id} className={styles.modalListItem}>
                    <input
                      type="checkbox"
                      checked={returnIds.includes(item.id)}
                      onChange={(event) => {
                        onReturnIdsChange(
                          event.target.checked
                            ? [...returnIds, item.id]
                            : returnIds.filter((id) => id !== item.id),
                        );
                      }}
                    />
                    <span>{equipmentCategoryLabels[item.item.category]} · {item.item.name}</span>
                    <small>{formatDateTime(item.borrowedAt)}</small>
                  </label>
                ))
              : itemLabels.map((item) => (
                  <div key={item.id} className={styles.modalListItem}>
                    <span>{item.label}</span>
                  </div>
                ))}
          </div>
          {showLiveFields ? (
            <div className={styles.liveFields}>
              <label>
                <span>TRS</span>
                <input className="field-input" value={liveDetails.trs} onChange={(event) => onLiveDetailsChange({ ...liveDetails, trs: event.target.value })} />
              </label>
              <label>
                <span>촬영기자</span>
                <input className="field-input" value={liveDetails.cameraReporter} onChange={(event) => onLiveDetailsChange({ ...liveDetails, cameraReporter: event.target.value })} />
              </label>
              <label>
                <span>오디오맨</span>
                <input className="field-input" value={liveDetails.audioMan} onChange={(event) => onLiveDetailsChange({ ...liveDetails, audioMan: event.target.value })} />
              </label>
              <label>
                <span>장소</span>
                <input className="field-input" value={liveDetails.location} onChange={(event) => onLiveDetailsChange({ ...liveDetails, location: event.target.value })} />
              </label>
              <label className={styles.liveNoteField}>
                <span>비고</span>
                <textarea className="field-textarea" value={liveDetails.note} onChange={(event) => onLiveDetailsChange({ ...liveDetails, note: event.target.value })} />
              </label>
            </div>
          ) : null}
          <div className={styles.modalActions}>
            <button type="button" className="btn primary" disabled={actionPending || (mode === "return" && returnIds.length === 0)} onClick={onConfirm}>
              확인
            </button>
            <button type="button" className="btn" disabled={actionPending} onClick={onClose}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoanSummaryByBorrower({
  loanItems,
  emptyText,
}: {
  loanItems: EquipmentLoanItem[];
  emptyText: string;
}) {
  const groups = useMemo(() => groupLoanItemsByBorrower(loanItems), [loanItems]);
  const [expandedBorrowerIds, setExpandedBorrowerIds] = useState<string[]>([]);

  useEffect(() => {
    setExpandedBorrowerIds([]);
  }, [loanItems]);

  if (groups.length === 0) {
    return <div className="status note">{emptyText}</div>;
  }

  return (
    <div className={styles.borrowerGrid}>
      {groups.map((group) => {
        const expanded = expandedBorrowerIds.includes(group.borrowerId);
        return (
          <article key={group.borrowerId} className={styles.borrowerCard}>
            <button
              type="button"
              className={styles.borrowerButton}
              onClick={() => {
                setExpandedBorrowerIds((current) =>
                  expanded ? current.filter((id) => id !== group.borrowerId) : [...current, group.borrowerId],
                );
              }}
              aria-expanded={expanded}
            >
              <strong>{group.borrowerName}</strong>
              <span>{group.items.length}개 대여중</span>
            </button>
            {expanded ? (
              <div className={styles.borrowerItems}>
                {group.items.map((item) => (
                  <div key={item.id} className={styles.borrowerItemRow}>
                    <span>{equipmentCategoryLabels[item.item.category]}</span>
                    <strong>{item.item.name}</strong>
                    <span>{formatDateTime(item.borrowedAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function renderGroupedItems({
  items,
  selectedIds,
  currentByItemId,
  onToggle,
  itemTone = "default",
}: {
  items: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  itemTone?: EquipmentItemCardTone;
}) {
  const groups = Array.from(
    items.reduce((map, item) => {
      const existing = map.get(item.groupName) ?? [];
      existing.push(item);
      map.set(item.groupName, existing);
      return map;
    }, new Map<string, EquipmentItem[]>()),
  );

  return groups.map(([groupName, groupItems]) => (
    <EquipmentGroupSection
      key={groupName}
      groupName={groupName}
      groupItems={groupItems}
      selectedIds={selectedIds}
      currentByItemId={currentByItemId}
      onToggle={onToggle}
      itemTone={itemTone}
    />
  ));
}

function EquipmentGroupSection({
  groupName,
  groupItems,
  selectedIds,
  currentByItemId,
  onToggle,
  itemTone = "default",
}: {
  groupName: string;
  groupItems: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  itemTone?: EquipmentItemCardTone;
}) {
  const [expandedVariantKeys, setExpandedVariantKeys] = useState<string[]>([]);
  const entries = useMemo(() => {
    const variantGroups = new Map<string, EquipmentItem[]>();
    const displayEntries: Array<
      | { type: "item"; key: string; sortOrder: number; item: EquipmentItem }
      | { type: "variant"; key: string; sortOrder: number; parentLabel: string; items: EquipmentItem[] }
    > = [];

    groupItems.forEach((item) => {
      const parentLabel = getVariantParentLabel(item);
      if (!parentLabel) {
        displayEntries.push({ type: "item", key: item.id, sortOrder: item.sortOrder, item });
        return;
      }
      const existing = variantGroups.get(parentLabel) ?? [];
      existing.push(item);
      variantGroups.set(parentLabel, existing);
    });

    variantGroups.forEach((items, parentLabel) => {
      const sortedItems = [...items].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko"));
      displayEntries.push({
        type: "variant",
        key: `${groupName}:${parentLabel}`,
        sortOrder: sortedItems[0]?.sortOrder ?? 0,
        parentLabel,
        items: sortedItems,
      });
    });

    return displayEntries.sort((left, right) => left.sortOrder - right.sortOrder || left.key.localeCompare(right.key, "ko"));
  }, [groupItems, groupName]);

  const toggleVariant = (key: string) => {
    setExpandedVariantKeys((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  };

  return (
    <section className={styles.equipmentGroup}>
      <div className={styles.groupHead}>
        <h3>{getEquipmentGroupDisplayName(groupName)}</h3>
        <span>{groupItems.length}개</span>
      </div>
      <div className={styles.itemGrid}>
        {entries.map((entry) => {
          if (entry.type === "item") {
            return (
              <EquipmentItemCard
                key={entry.key}
                item={entry.item}
                selected={selectedIds.includes(entry.item.id)}
                loanItem={currentByItemId.get(entry.item.id)}
                onToggle={() => onToggle(entry.item.id)}
                tone={itemTone}
              />
            );
          }

          const expanded = expandedVariantKeys.includes(entry.key);
          const selected = entry.items.some((item) => selectedIds.includes(item.id));
          const borrowedCount = entry.items.filter((item) => currentByItemId.has(item.id)).length;
          return (
            <Fragment key={entry.key}>
              <button
                type="button"
                className={[
                  styles.itemCard,
                  itemTone === "live" ? styles.itemCardLive : "",
                  selected ? styles.itemCardSelected : "",
                ].join(" ").trim()}
                onClick={() => toggleVariant(entry.key)}
                aria-expanded={expanded}
              >
                <span className={styles.itemCardTop}>
                  <strong>{entry.parentLabel}</strong>
                  {borrowedCount > 0 ? <StatusPill borrowed /> : null}
                </span>
              </button>
              {expanded ? (
                <div className={styles.inlineBatteryPanel}>
                  <div className={styles.inlineBatteryHead}>
                    <h4>{entry.parentLabel}</h4>
                    <span>{entry.items.length}개</span>
                  </div>
                  <div className={styles.inlineBatteryGrid}>
                    {entry.items.map((item) => (
                      <EquipmentItemCard
                        key={item.id}
                        item={item}
                        displayName={getVariantLabel(item)}
                        selected={selectedIds.includes(item.id)}
                        loanItem={currentByItemId.get(item.id)}
                        onToggle={() => onToggle(item.id)}
                        tone={itemTone}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

function CameraGroups({
  items,
  selectedIds,
  currentByItemId,
  onToggle,
}: {
  items: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
}) {
  const [expandedBatteryAnchors, setExpandedBatteryAnchors] = useState<Record<string, string>>({});
  const familyNames = ["5D", "GH4", "FX3"];
  const familyGroups = familyNames.map((familyName) => ({
    familyName,
    items: items.filter((item) => item.groupName.startsWith(familyName)),
  }));
  const familyItemIds = new Set(familyGroups.flatMap((group) => group.items.map((item) => item.id)));
  const nonFamilyItems = items.filter((item) => !familyItemIds.has(item.id));
  const standaloneBatteryItems = nonFamilyItems.filter(isStandaloneBatteryItem);
  const standalonePrimaryItems = nonFamilyItems.filter((item) => item.groupName === "단독 카메라");
  const leftoverItems = nonFamilyItems.filter((item) => item.groupName !== "단독 카메라" && !isStandaloneBatteryItem(item));
  const batteriesByKey = standaloneBatteryItems.reduce((map, item) => {
    const key = getStandaloneBatteryKey(item);
    if (!key) return map;
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
    return map;
  }, new Map<string, EquipmentItem[]>());

  const handleFamilyBodyToggle = (familyName: string, item: EquipmentItem, batteryItems: EquipmentItem[]) => {
    if (!currentByItemId.has(item.id)) {
      onToggle(item.id);
    }
    if (batteryItems.length > 0) {
      const key = `family:${familyName}`;
      setExpandedBatteryAnchors((current) => {
        if (current[key] !== item.id) {
          return { ...current, [key]: item.id };
        }
        const { [key]: _removed, ...next } = current;
        return next;
      });
    }
  };

  const handleStandaloneToggle = (item: EquipmentItem) => {
    const batteryKey = getStandaloneCameraBatteryKey(item);
    const batteryItems = batteryKey ? batteriesByKey.get(batteryKey) : undefined;
    if (!currentByItemId.has(item.id)) {
      onToggle(item.id);
    }
    if (batteryKey && batteryItems && batteryItems.length > 0) {
      setExpandedBatteryAnchors((current) => {
        if (current[batteryKey] !== item.id) {
          return { ...current, [batteryKey]: item.id };
        }
        const { [batteryKey]: _removed, ...next } = current;
        return next;
      });
    }
  };

  return (
    <div className={styles.sectionStack}>
      {familyGroups.map(({ familyName, items: matchedItems }) => {
        if (matchedItems.length === 0) return null;
        const bodyGroupName = `${familyName} 바디`;
        const batteryGroupName = `${familyName} 배터리`;
        const bodyItems = matchedItems.filter((item) => item.groupName === bodyGroupName);
        const batteryItems = matchedItems.filter((item) => item.groupName === batteryGroupName);
        const otherItems = matchedItems.filter((item) => item.groupName !== bodyGroupName && item.groupName !== batteryGroupName);
        return (
          <section key={familyName} className={styles.familyBlock}>
            <div className={styles.groupHead}>
              <h2>{familyName}</h2>
              <span>바디 / 호환 렌즈</span>
            </div>
            <div className={styles.familySubgroups}>
              {bodyItems.length > 0 ? (
                <section className={styles.equipmentGroup}>
                  <div className={styles.groupHead}>
                    <h3>{bodyGroupName}</h3>
                    <span>{bodyItems.length}개</span>
                  </div>
                  <div className={styles.itemGrid}>
                    {bodyItems.map((item) => {
                      const showBatteries = expandedBatteryAnchors[`family:${familyName}`] === item.id && batteryItems.length > 0;
                      return (
                        <Fragment key={item.id}>
                          <EquipmentItemCard
                            item={item}
                            selected={selectedIds.includes(item.id)}
                            loanItem={currentByItemId.get(item.id)}
                            onToggle={() => handleFamilyBodyToggle(familyName, item, batteryItems)}
                            allowBorrowedClick={batteryItems.length > 0}
                          />
                          {showBatteries ? (
                            <div className={styles.inlineBatteryPanel}>
                              <div className={styles.inlineBatteryHead}>
                                <h4>{batteryGroupName}</h4>
                                <span>{batteryItems.length}개</span>
                              </div>
                              <div className={styles.inlineBatteryGrid}>
                                {batteryItems.map((batteryItem) => (
                                  <EquipmentItemCard
                                    key={batteryItem.id}
                                    item={batteryItem}
                                    selected={selectedIds.includes(batteryItem.id)}
                                    loanItem={currentByItemId.get(batteryItem.id)}
                                    onToggle={() => onToggle(batteryItem.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {otherItems.length > 0 ? renderGroupedItems({ items: otherItems, selectedIds, currentByItemId, onToggle }) : null}
            </div>
          </section>
        );
      })}
      {standalonePrimaryItems.length > 0 ? (
        <section className={styles.familyBlock}>
          <div className={styles.familySubgroups}>
            <section className={styles.equipmentGroup}>
              <div className={styles.groupHead}>
                <h3>캠코더 / 액션캠</h3>
                <span>{standalonePrimaryItems.length}개</span>
              </div>
              <div className={styles.itemGrid}>
                {standalonePrimaryItems.map((item) => {
                  const batteryKey = getStandaloneCameraBatteryKey(item);
                  const batteryItems = batteryKey ? batteriesByKey.get(batteryKey) ?? [] : [];
                  const showBatteries = Boolean(batteryKey && expandedBatteryAnchors[batteryKey] === item.id && batteryItems.length > 0);
                  return (
                    <Fragment key={item.id}>
                      <EquipmentItemCard
                        item={item}
                        selected={selectedIds.includes(item.id)}
                        loanItem={currentByItemId.get(item.id)}
                        onToggle={() => handleStandaloneToggle(item)}
                        allowBorrowedClick={batteryItems.length > 0}
                      />
                      {showBatteries ? (
                        <div key={`${item.id}-batteries`} className={styles.inlineBatteryPanel}>
                          <div className={styles.inlineBatteryHead}>
                            <h4>{item.name} 배터리</h4>
                            <span>{batteryItems.length}개</span>
                          </div>
                          <div className={styles.inlineBatteryGrid}>
                            {batteryItems.map((batteryItem) => (
                              <EquipmentItemCard
                                key={batteryItem.id}
                                item={batteryItem}
                                selected={selectedIds.includes(batteryItem.id)}
                                loanItem={currentByItemId.get(batteryItem.id)}
                                onToggle={() => onToggle(batteryItem.id)}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </section>
            {leftoverItems.length > 0
              ? renderGroupedItems({ items: leftoverItems, selectedIds, currentByItemId, onToggle })
              : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LiveEquipmentGroups({
  items,
  selectedIds,
  currentByItemId,
  onToggle,
}: {
  items: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
}) {
  const [expandedTvuId, setExpandedTvuId] = useState<string | null>(null);
  const tvuItems = items.filter(isTvuItem);
  const tvuAccessoryItems = items.filter(isTvuInlineAccessoryItem);
  const otherItems = items.filter((item) => !isTvuItem(item) && !isTvuInlineAccessoryItem(item));

  const handleTvuToggle = (item: EquipmentItem) => {
    if (!currentByItemId.has(item.id)) {
      onToggle(item.id);
    }
    setExpandedTvuId((current) => (current === item.id ? null : item.id));
  };

  return (
    <div className={styles.sectionStack}>
      {tvuItems.length > 0 ? (
        <section className={styles.equipmentGroup}>
          <div className={styles.groupHead}>
            <h3>TVU</h3>
            <span>{tvuItems.length}개</span>
          </div>
          <div className={styles.itemGrid}>
            {tvuItems.map((item) => {
              const showAccessories = expandedTvuId === item.id && tvuAccessoryItems.length > 0;
              return (
                <Fragment key={item.id}>
                  <EquipmentItemCard
                    item={item}
                    selected={selectedIds.includes(item.id)}
                    loanItem={currentByItemId.get(item.id)}
                    onToggle={() => handleTvuToggle(item)}
                    allowBorrowedClick={tvuAccessoryItems.length > 0}
                    tone="live"
                  />
                  {showAccessories ? (
                    <div className={styles.inlineBatteryPanel}>
                      <div className={styles.inlineBatteryHead}>
                        <h4>{item.name} 부속 장비</h4>
                        <span>{tvuAccessoryItems.length}개</span>
                      </div>
                      <div className={styles.inlineBatteryGrid}>
                        {tvuAccessoryItems.map((accessoryItem) => (
                          <EquipmentItemCard
                            key={accessoryItem.id}
                            item={accessoryItem}
                            selected={selectedIds.includes(accessoryItem.id)}
                            loanItem={currentByItemId.get(accessoryItem.id)}
                            onToggle={() => onToggle(accessoryItem.id)}
                            tone="live"
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </section>
      ) : null}
      {otherItems.length > 0 ? renderGroupedItems({ items: otherItems, selectedIds, currentByItemId, onToggle, itemTone: "live" }) : null}
    </div>
  );
}

export function EquipmentCategoryPage({ category }: { category: EquipmentCategory }) {
  const config = equipmentCategoryConfigs[category];
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [profiles, setProfiles] = useState<EquipmentProfile[]>([]);
  const [currentLoanItems, setCurrentLoanItems] = useState<EquipmentLoanItem[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<BorrowSelection[]>(() => readBorrowSelections(getSession()?.id));
  const [returnIds, setReturnIds] = useState<string[]>([]);
  const [engHighlights, setEngHighlights] = useState<EngScheduleHighlightMap>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [liveDetails, setLiveDetails] = useState<LiveLoanDetails>(liveDetailEmpty);

  const isEngSetPage = category === "eng_set";
  const canMutate = Boolean(session?.approved && !isReadOnlyPortalRole(session.role));
  const highlightDateKey = useMemo(() => getTodayDateKey(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [nextCurrent, nextItems, nextProfiles, nextHighlights] = await Promise.all([
        fetchEquipmentLoanItems({ status: "borrowed" }),
        isEngSetPage ? Promise.resolve([]) : fetchEquipmentItems([category]),
        isEngSetPage ? fetchEquipmentProfiles() : Promise.resolve([]),
        isEngSetPage ? loadEngScheduleHighlights(highlightDateKey) : Promise.resolve(new Map() as EngScheduleHighlightMap),
      ]);
      setCurrentLoanItems(nextCurrent);
      setItems(nextItems);
      setProfiles(nextProfiles);
      setEngHighlights(nextHighlights);
      setSession(getSession());
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "장비 데이터를 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, [category, highlightDateKey, isEngSetPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedEntries(readBorrowSelections(session?.id));
  }, [session?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSelections = () => {
      setSelectedEntries(readBorrowSelections(session?.id));
    };
    window.addEventListener(EQUIPMENT_BORROW_SELECTION_EVENT, syncSelections);
    window.addEventListener("storage", syncSelections);
    return () => {
      window.removeEventListener(EQUIPMENT_BORROW_SELECTION_EVENT, syncSelections);
      window.removeEventListener("storage", syncSelections);
    };
  }, [session?.id]);

  const currentByItemId = useMemo(
    () => new Map(currentLoanItems.map((loanItem) => [loanItem.equipmentItemId, loanItem] as const)),
    [currentLoanItems],
  );

  const currentByEngProfileId = useMemo(() => {
    const map = new Map<string, EquipmentLoanItem>();
    currentLoanItems.forEach((loanItem) => {
      const targetProfileId = getEngTargetProfileId(loanItem);
      if (targetProfileId) {
        map.set(targetProfileId, loanItem);
      }
    });
    return map;
  }, [currentLoanItems]);

  useEffect(() => {
    if (selectedEntries.length === 0 || currentLoanItems.length === 0) return;
    const borrowedItemIds = new Set(currentLoanItems.map((loanItem) => loanItem.equipmentItemId));
    const borrowedEngProfileIds = new Set(
      currentLoanItems
        .map(getEngTargetProfileId)
        .filter(Boolean),
    );
    const nextSelections = selectedEntries.filter((selection) => (
      selection.kind === "item" ? !borrowedItemIds.has(selection.id) : !borrowedEngProfileIds.has(selection.id)
    ));
    if (nextSelections.length === selectedEntries.length) return;
    setSelectedEntries(nextSelections);
    writeBorrowSelections(session?.id, nextSelections);
  }, [currentLoanItems, selectedEntries, session?.id]);

  const selectedIds = useMemo(() => selectedEntries.map((selection) => selection.id), [selectedEntries]);
  const selectedItemSelections = useMemo(
    () => selectedEntries.filter((selection): selection is Extract<BorrowSelection, { kind: "item" }> => selection.kind === "item"),
    [selectedEntries],
  );
  const selectedEngSelections = useMemo(
    () => selectedEntries.filter((selection): selection is Extract<BorrowSelection, { kind: "eng_profile" }> => selection.kind === "eng_profile"),
    [selectedEntries],
  );
  const hasSelectedTvu = useMemo(() => selectedItemSelections.some((selection) => selection.isTvu), [selectedItemSelections]);
  const hasSelectedLiveItem = useMemo(
    () => selectedItemSelections.some((selection) => selection.category === "live"),
    [selectedItemSelections],
  );
  const selectedItems = useMemo(
    () => selectedEntries.map((selection) => ({ id: getBorrowSelectionKey(selection), label: formatBorrowSelectionLabel(selection) })),
    [selectedEntries],
  );
  const itemSelectionById = useMemo(() => new Map(items.map((item) => [item.id, itemToBorrowSelection(item)] as const)), [items]);
  const profileSelectionById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profileToBorrowSelection(profile)] as const)),
    [profiles],
  );

  useEffect(() => {
    if (loading || selectedEntries.length === 0) return;
    const nextSelections = selectedEntries.filter((selection) => {
      if (selection.kind === "item" && selection.category === category) {
        return itemSelectionById.has(selection.id);
      }
      if (selection.kind === "eng_profile" && isEngSetPage) {
        return profileSelectionById.has(selection.id);
      }
      return true;
    });
    if (nextSelections.length === selectedEntries.length) return;
    setSelectedEntries(nextSelections);
    writeBorrowSelections(session?.id, nextSelections);
  }, [category, isEngSetPage, itemSelectionById, loading, profileSelectionById, selectedEntries, session?.id]);

  const returnableItems = useMemo(() => {
    return currentLoanItems.filter((loanItem) => canReturnLoanItem(loanItem));
  }, [currentLoanItems]);

  const showLiveFields = useMemo(() => {
    if (confirmMode !== "borrow") return false;
    return hasSelectedTvu;
  }, [confirmMode, hasSelectedTvu]);

  const sortedEngProfiles = useMemo(() => (
    profiles
      .map((profile, index) => {
        const badges = getEngScheduleBadges(engHighlights, profile.name);
        return {
          profile,
          badges,
          index,
          sortRank: getEngBadgeSortRank(badges),
        };
      })
      .sort((left, right) => left.sortRank - right.sortRank || left.index - right.index)
  ), [engHighlights, profiles]);

  const updateBorrowSelections = useCallback((updater: (current: BorrowSelection[]) => BorrowSelection[]) => {
    setSelectedEntries((current) => {
      const next = updater(current);
      writeBorrowSelections(session?.id, next);
      return next;
    });
  }, [session?.id]);

  const toggleSelection = (itemId: string) => {
    const selection = isEngSetPage ? profileSelectionById.get(itemId) : itemSelectionById.get(itemId);
    if (!selection) return;
    const selectionKey = getBorrowSelectionKey(selection);
    updateBorrowSelections((current) => {
      if (current.some((entry) => getBorrowSelectionKey(entry) === selectionKey)) {
        return current.filter((entry) => getBorrowSelectionKey(entry) !== selectionKey);
      }
      return [...current, selection];
    });
  };

  const openBorrowDialog = () => {
    if (!canMutate) {
      setMessage({ tone: "warn", text: "읽기 전용 계정은 장비 대여/반납을 할 수 없습니다." });
      return;
    }
    if (selectedEntries.length === 0) {
      setMessage({ tone: "note", text: "대여할 장비를 선택해 주세요." });
      return;
    }
    setLiveDetails({
      ...liveDetailEmpty,
      cameraReporter: hasSelectedTvu ? session?.username ?? "" : "",
    });
    setConfirmMode("borrow");
  };

  const openReturnDialog = () => {
    if (!canMutate) {
      setMessage({ tone: "warn", text: "읽기 전용 계정은 장비 대여/반납을 할 수 없습니다." });
      return;
    }
    setReturnIds(returnableItems.map((item) => item.id));
    setConfirmMode("return");
  };

  const confirmBorrow = async () => {
    setActionPending(true);
    try {
      const itemIds = selectedItemSelections.map((selection) => selection.id);
      const engProfileIds = selectedEngSelections.map((selection) => selection.id);
      if (itemIds.length > 0) {
        await borrowEquipmentItems(itemIds, {
          loanType: hasSelectedLiveItem ? "live" : "normal",
          liveDetails: showLiveFields ? liveDetails : undefined,
        });
      }
      if (engProfileIds.length > 0) {
        await borrowEngSets(engProfileIds);
      }
      if (itemIds.length === 0 && engProfileIds.length === 0) {
        throw new Error("대여할 장비를 선택해 주세요.");
      }
      setMessage({ tone: "ok", text: "선택한 장비를 대여 처리했습니다." });
      setConfirmMode(null);
      updateBorrowSelections(() => []);
      await load();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "대여 처리에 실패했습니다." });
    } finally {
      setActionPending(false);
    }
  };

  const confirmReturn = async () => {
    setActionPending(true);
    try {
      await returnEquipmentLoanItems(returnIds);
      setMessage({ tone: "ok", text: "선택한 장비를 반납 처리했습니다." });
      setConfirmMode(null);
      setReturnIds([]);
      await load();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "반납 처리에 실패했습니다." });
    } finally {
      setActionPending(false);
    }
  };

  return (
    <section className={styles.page}>
      <PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} activeHref={config.route} />

      <article className="panel">
        <div className={`panel-pad ${styles.sectionStack}`}>
          <div className={styles.actionBar}>
            <div className={styles.actionSummary}>
              <strong>{selectedIds.length}개 선택됨</strong>
              <span className="muted">대여중 장비는 선택할 수 없습니다.</span>
            </div>
            <div className={styles.actionButtons}>
              <button type="button" className="btn primary" disabled={!canMutate || selectedIds.length === 0 || actionPending} onClick={openBorrowDialog}>
                대여하기
              </button>
              <button type="button" className="btn" disabled={!canMutate || returnableItems.length === 0 || actionPending} onClick={openReturnDialog}>
                반납하기
              </button>
            </div>
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {loading ? (
            <LoadingBlocks />
          ) : isEngSetPage ? (
            <div className={styles.memberGrid}>
              {sortedEngProfiles.map(({ profile, badges }) => {
                const loanItem = currentByEngProfileId.get(profile.id);
                const selected = selectedIds.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className={[
                      styles.memberCard,
                      selected ? styles.itemCardSelected : "",
                      loanItem ? styles.itemCardBorrowed : "",
                      badges.length > 0 ? styles.memberCardHighlighted : "",
                    ].join(" ").trim()}
                    disabled={Boolean(loanItem)}
                    onClick={() => toggleSelection(profile.id)}
                    aria-pressed={selected}
                  >
                    <span className={styles.itemCardTop}>
                      <strong>{profile.name}</strong>
                      <StatusPill borrowed={Boolean(loanItem)} />
                    </span>
                    <span className={styles.memberBadges}>
                      {badges.map((badge) => <small key={badge}>{badge}</small>)}
                    </span>
                    {loanItem ? (
                      <span className={styles.borrowedMeta}>{loanItem.loan.borrowerName} · {formatDateTime(loanItem.borrowedAt)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : category === "camera_lens" ? (
            <CameraGroups items={items} selectedIds={selectedIds} currentByItemId={currentByItemId} onToggle={toggleSelection} />
          ) : category === "live" ? (
            <LiveEquipmentGroups items={items} selectedIds={selectedIds} currentByItemId={currentByItemId} onToggle={toggleSelection} />
          ) : (
            <div className={styles.sectionStack}>
              {renderGroupedItems({ items, selectedIds, currentByItemId, onToggle: toggleSelection })}
            </div>
          )}
        </div>
      </article>

      {confirmMode ? (
        <ConfirmDialog
          mode={confirmMode}
          title={confirmMode === "borrow" ? "선택한 장비를 대여하시겠습니까?" : "선택한 장비를 반납하시겠습니까?"}
          itemLabels={selectedItems}
          liveDetails={liveDetails}
          showLiveFields={showLiveFields}
          returnIds={returnIds}
          returnItems={returnableItems}
          actionPending={actionPending}
          onClose={() => setConfirmMode(null)}
          onConfirm={confirmMode === "borrow" ? confirmBorrow : confirmReturn}
          onLiveDetailsChange={setLiveDetails}
          onReturnIdsChange={setReturnIds}
        />
      ) : null}
    </section>
  );
}

export function EquipmentStatusPage() {
  const [dateKey, setDateKey] = useState(getTodayDateKey);
  const [currentLoanItems, setCurrentLoanItems] = useState<EquipmentLoanItem[]>([]);
  const [dailyRecords, setDailyRecords] = useState<EquipmentLoanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextCurrent, nextRecords] = await Promise.all([
        fetchEquipmentLoanItems({ status: "borrowed" }),
        fetchEquipmentLoanItems({ dateKey }),
      ]);
      setCurrentLoanItems(nextCurrent);
      setDailyRecords(nextRecords);
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "장비대여현황을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, [dateKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const normalCurrent = useMemo(
    () => currentLoanItems.filter((item) => normalEquipmentCategories.includes(item.item.category)),
    [currentLoanItems],
  );
  const liveCurrent = useMemo(
    () => currentLoanItems.filter((item) => item.item.category === "live"),
    [currentLoanItems],
  );

  return (
    <section className={styles.page}>
      <PageHeader
        eyebrow="STATUS"
        title="장비대여현황"
        description="현재 대여 중인 장비를 대여자별로 확인하고 일별 전체 기록을 봅니다."
        activeHref="/equipment/status"
      />
      <article className="panel">
        <div className={`panel-pad ${styles.sectionStack}`}>
          <div className={styles.sectionHead}>
            <div>
              <span className="chip">현재 현황</span>
              <h2 className={styles.sectionTitle}>대여자별 현재 대여 장비</h2>
            </div>
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {loading ? (
            <LoadingBlocks />
          ) : (
            <>
              <LoanSummaryByBorrower loanItems={normalCurrent} emptyText="카메라/렌즈, 조명, ENG SET 현재 대여 장비가 없습니다." />
              {liveCurrent.length > 0 ? (
                <section className={styles.sectionStack}>
                  <div className={styles.groupHead}>
                    <h3>라이브장비</h3>
                    <span>별도 섹션</span>
                  </div>
                  <LoanSummaryByBorrower loanItems={liveCurrent} emptyText="현재 대여 중인 라이브장비가 없습니다." />
                </section>
              ) : null}
            </>
          )}
        </div>
      </article>
      <DailyRecords dateKey={dateKey} onDateChange={setDateKey} records={dailyRecords} />
    </section>
  );
}

export function LiveEquipmentStatusPage() {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [currentLoanItems, setCurrentLoanItems] = useState<EquipmentLoanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextItems, nextCurrent] = await Promise.all([
        fetchEquipmentItems(["live"]),
        fetchEquipmentLoanItems({ categories: ["live"], status: "borrowed" }),
      ]);
      setItems(nextItems);
      setCurrentLoanItems(nextCurrent);
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "라이브장비현황을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentByItemId = useMemo(
    () => new Map(currentLoanItems.map((loanItem) => [loanItem.equipmentItemId, loanItem] as const)),
    [currentLoanItems],
  );
  const tvuItems = useMemo(() => items.filter(isTvuItem), [items]);

  return (
    <section className={styles.page}>
      <PageHeader
        eyebrow="LIVE STATUS"
        title="라이브장비현황"
        description="TVU 중심으로 현재 대여 상황과 현장 정보를 확인합니다."
        activeHref="/equipment/live-status"
      />
      <article className="panel">
        <div className={`panel-pad ${styles.sectionStack}`}>
          <div className={styles.sectionHead}>
            <div>
              <span className="chip">TVU 상황판</span>
              <h2 className={styles.sectionTitle}>TVU 현재 상태</h2>
            </div>
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {loading ? (
            <LoadingBlocks />
          ) : (
            <div className={styles.tableWrap}>
              <table className="table-like">
                <thead>
                  <tr>
                    <th>장비명</th>
                    <th>TRS</th>
                    <th>촬영기자</th>
                    <th>오디오맨</th>
                    <th>장소</th>
                    <th>비고</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {tvuItems.map((item) => {
                    const loanItem = currentByItemId.get(item.id);
                    return (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td>{loanItem?.loan.liveTrs || "-"}</td>
                        <td>{loanItem?.loan.liveCameraReporter || "-"}</td>
                        <td>{loanItem?.loan.liveAudioMan || "-"}</td>
                        <td>{loanItem?.loan.liveLocation || "-"}</td>
                        <td>{loanItem?.loan.liveNote || "-"}</td>
                        <td><StatusPill borrowed={Boolean(loanItem)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
