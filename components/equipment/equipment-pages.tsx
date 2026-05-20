"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSession,
  hasDeskAccess,
  isReadOnlyPortalRole,
  subscribeToAuth,
  type SessionUser,
} from "@/lib/auth/storage";
import { getEngScheduleBadges, loadEngScheduleHighlights, type EngScheduleBadge, type EngScheduleHighlightMap } from "@/lib/equipment/eng-schedule";
import {
  borrowEngSets,
  borrowEquipmentItems,
  canReturnLoanItem,
  fetchEquipmentItems,
  fetchLiveEquipmentItemsForManagement,
  fetchEquipmentLoanItems,
  fetchEquipmentProfiles,
  fetchLiveEquipmentStatusEntries,
  renameRentalTvuItem,
  returnEquipmentLoanItems,
  saveLiveEquipmentStatusEntries,
  setEquipmentItemsRepairStatus,
  setRentalTvuItemsActive,
  setTvuGridStatus,
} from "@/lib/equipment/storage";
import {
  fetchTodayElectionTvuOverlays,
  normalizeTvuEquipmentName,
} from "@/lib/election/storage";
import type { ElectionTvuOverlay } from "@/lib/election/types";
import {
  equipmentCategoryConfigs,
  equipmentCategoryLabels,
  equipmentNavItems,
  normalEquipmentCategories,
  type EquipmentCategory,
  type EquipmentItem,
  type EquipmentLoanItem,
  type EquipmentProfile,
  type LiveEquipmentStatusEntry,
  type LiveEquipmentStatusSaveEntry,
  type LiveLoanDetails,
} from "@/lib/equipment/types";
import { vacationStyleTones } from "@/lib/schedule/vacation-styles";
import styles from "./Equipment.module.css";

type Message = { tone: "ok" | "warn" | "note"; text: string };
type ConfirmMode = "borrow" | "return";
type RentalTvuMode = "activate" | "deactivate";
type EquipmentItemCardTone = "default" | "live";
type RepairDraftByItemId = Record<string, boolean>;
type LiveStatusDraftByItemId = Record<string, LiveLoanDetails>;
type LiveAccessoryGroupKey = "pin_mic" | "distributor";
type StandaloneInlineAccessoryEntry =
  | { type: "item"; key: string; sortOrder: number; item: EquipmentItem }
  | { type: "variant"; key: string; sortOrder: number; parentLabel: string; items: EquipmentItem[] };
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
const LIVE_TRS_OPTIONS = [
  "1755",
  "1756",
  "1761",
  "1762",
  "1767",
  "1768",
  "1769",
  "1770",
  "1771",
  "1772",
  "1773",
  "1774",
  "1775",
  "1776",
  "1779",
  "1780",
] as const;
const LIVE_TRS_OPTION_SET = new Set<string>(LIVE_TRS_OPTIONS);
const LIVE_ACCESSORY_GROUPS: readonly LiveAccessoryGroupKey[] = ["pin_mic", "distributor"];
const EQUIPMENT_BORROW_SELECTION_STORAGE_PREFIX = "jtbc-equipment-borrow-selection-v1";
const EQUIPMENT_BORROW_SELECTION_EVENT = "jtbc-equipment-borrow-selection-change";
const HIDDEN_ENG_SET_PROFILE_NAMES = new Set([
  "공영수",
  "김대호",
  "김미란",
  "김상현",
  "김영묵",
  "손준수",
  "신승규",
  "영취공용",
  "오반장",
  "유연경",
  "이경",
  "이동현",
  "이주현",
  "이현일",
  "장후원",
  "주수영",
  "홍승재",
]);

function isHiddenEngSetProfile(profile: EquipmentProfile) {
  return HIDDEN_ENG_SET_PROFILE_NAMES.has(profile.name.trim());
}

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
      if (!["camera_lens", "light", "eng_set", "live"].includes(String(item.category))) return;
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
    label: getEquipmentDisplayName(item),
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

function parseSelectedTrs(value: string) {
  const selected: string[] = [];
  const seen = new Set<string>();
  value.split(",").forEach((entry) => {
    const trs = entry.trim();
    if (!LIVE_TRS_OPTION_SET.has(trs) || seen.has(trs)) return;
    seen.add(trs);
    selected.push(trs);
  });
  return selected;
}

function formatSelectedTrs(selectedTrs: readonly string[]) {
  return selectedTrs.join(", ");
}

function toggleSelectedTrs(currentValue: string, trs: string) {
  const current = parseSelectedTrs(currentValue);
  const next = current.includes(trs)
    ? current.filter((entry) => entry !== trs)
    : [...current, trs];
  return formatSelectedTrs(next);
}

function formatTrsSummary(selectedTrs: readonly string[]) {
  if (selectedTrs.length <= 2) return formatSelectedTrs(selectedTrs);
  return `${selectedTrs[0]} 외 ${selectedTrs.length - 1}개`;
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

function getTvuNumber(item: EquipmentItem) {
  if (!isTvuItem(item)) return null;
  const metadataRegionalNumber = item.metadata.regional_number;
  if (typeof metadataRegionalNumber === "number" && Number.isFinite(metadataRegionalNumber)) return metadataRegionalNumber;
  if (typeof metadataRegionalNumber === "string" && /^\d+$/.test(metadataRegionalNumber.trim())) return Number(metadataRegionalNumber);
  const metadataNumber = item.metadata.rental_number;
  if (typeof metadataNumber === "number" && Number.isFinite(metadataNumber)) return metadataNumber;
  if (typeof metadataNumber === "string" && /^\d+$/.test(metadataNumber.trim())) return Number(metadataNumber);
  const codeMatched = /^live-(?:rental-|regional-)?tvu-(\d+)$/i.exec(item.code.trim());
  if (codeMatched) return Number(codeMatched[1]);
  const matched = /^TVU\s*-?\s*(\d+)$/i.exec(item.name.trim());
  if (!matched) return null;
  return Number(matched[1]);
}

function formatTvuDisplayName(name: string) {
  const matched = /^TVU\s*-?\s*(\d+)$/i.exec(name.trim());
  if (!matched) return name;
  return `TVU-${Number(matched[1])}`;
}

function getEquipmentDisplayName(item: EquipmentItem) {
  return isTvuItem(item) ? formatTvuDisplayName(item.name) : item.name;
}

function isGlobalTvuItem(item: EquipmentItem) {
  const metadataNetwork = typeof item.metadata.network === "string" ? item.metadata.network.trim().toLowerCase() : "";
  if (metadataNetwork === "global") return true;
  const tvuNumber = getTvuNumber(item);
  return tvuNumber !== null && tvuNumber >= 15 && tvuNumber <= 19;
}

function isGridTvuItem(item: EquipmentItem) {
  return isTvuItem(item) && (item.metadata.grid === true || item.metadata.grid === "true");
}

function isRentalTvuItem(item: EquipmentItem) {
  if (!isTvuItem(item)) return false;
  if (item.metadata.rental === true || item.metadata.rental === "true") return true;
  return /^live-rental-tvu-\d+$/i.test(item.code.trim());
}

function isRegionalTransmissionTvuItem(item: EquipmentItem) {
  if (!isTvuItem(item)) return false;
  if (item.metadata.regional_transmission === true || item.metadata.regional_transmission === "true") return true;
  return /^live-regional-tvu-\d+$/i.test(item.code.trim());
}

function isBorrowableEquipmentItem(item: EquipmentItem) {
  return item.metadata.borrowable !== false && item.metadata.borrowable !== "false" && !isRegionalTransmissionTvuItem(item);
}

function hasRentalTvuManagerRole(role: SessionUser["role"] | null | undefined) {
  return role === "desk" || role === "team_lead" || role === "admin";
}

const hiddenEquipmentChoiceCodes = new Set([
  "camera-5d-lens-24-105mm",
  "camera-5d-lens-28-300mm",
  "camera-fx3-lens-24-105mm-02",
  "camera-standalone-ax40-03",
  "camera-standalone-gopro",
  "camera-drone-dji-s-1000",
  "camera-drone-inspiper-1",
  "camera-drone-inspiper-2",
  "live-cubotec",
  "live-bnc-cable",
]);

function isHiddenEquipmentChoiceItem(item: EquipmentItem) {
  if (hiddenEquipmentChoiceCodes.has(item.code)) return true;
  if (item.code.startsWith("camera-gopro-battery-")) return true;
  if (item.category !== "live") return false;
  const normalizedName = item.name.replace(/\s+/g, "").toLowerCase();
  return normalizedName === "쿠보텍" || normalizedName === "bnc케이블";
}

function isTvuInlineAccessoryItem(item: EquipmentItem) {
  if (item.category !== "live") return false;
  const kind = getMetadataString(item, "kind");
  if (kind === "tvu_battery" || kind === "pin_mic" || kind === "distributor") return true;
  const normalizedName = item.name.replace(/\s+/g, "").toLowerCase();
  return normalizedName === "tvu배터리" || normalizedName.startsWith("핀마이크") || normalizedName.startsWith("분배기");
}

function isTvuBatteryItem(item: EquipmentItem) {
  if (item.category !== "live") return false;
  if (getMetadataString(item, "kind") === "tvu_battery") return true;
  return item.name.replace(/\s+/g, "").toLowerCase() === "tvu배터리";
}

function getLiveAccessoryGroupKey(item: EquipmentItem): LiveAccessoryGroupKey | null {
  if (item.category !== "live") return null;
  const kind = getMetadataString(item, "kind");
  if (kind === "pin_mic" || kind === "distributor") return kind;
  const normalizedName = item.name.replace(/\s+/g, "").toLowerCase();
  if (normalizedName.startsWith("핀마이크")) return "pin_mic";
  if (normalizedName.startsWith("분배기")) return "distributor";
  return null;
}

function getLiveAccessoryGroupLabel(groupKey: LiveAccessoryGroupKey) {
  return groupKey === "pin_mic" ? "핀마이크" : "분배기";
}

function getLiveAccessoryOptionNumber(item: EquipmentItem) {
  const matched = /(\d+)\s*번/.exec(item.name);
  return matched ? Number(matched[1]) : Number.POSITIVE_INFINITY;
}

function getLiveAccessoryOptionLabel(item: EquipmentItem) {
  const optionNumber = getLiveAccessoryOptionNumber(item);
  return Number.isFinite(optionNumber) ? `${optionNumber}번` : getVariantLabel(item);
}

function getLiveAccessorySummary(items: EquipmentItem[], selectedIds: string[]) {
  const selectedLabels = items
    .filter((item) => selectedIds.includes(item.id))
    .map(getLiveAccessoryOptionLabel);
  if (selectedLabels.length === 0) return "";
  if (selectedLabels.length <= 2) return selectedLabels.join(", ");
  return `${selectedLabels[0]} 외 ${selectedLabels.length - 1}개`;
}

function getEngTargetProfileId(loanItem: EquipmentLoanItem) {
  const targetProfileId = loanItem.item.metadata.target_profile_id;
  return typeof targetProfileId === "string" ? targetProfileId : "";
}

function isSharedEngSetItem(item: EquipmentItem) {
  return item.category === "eng_set" && getMetadataString(item, "kind") === "shared_eng_set";
}

function normalizeLiveStatusDraft(value?: Partial<LiveLoanDetails> | null): LiveLoanDetails {
  return {
    trs: value?.trs?.trim() ?? "",
    cameraReporter: value?.cameraReporter?.trim() ?? "",
    audioMan: value?.audioMan?.trim() ?? "",
    location: value?.location?.trim() ?? "",
    note: value?.note?.trim() ?? "",
  };
}

function liveStatusDraftsEqual(left?: LiveLoanDetails, right?: LiveLoanDetails) {
  const normalizedLeft = normalizeLiveStatusDraft(left);
  const normalizedRight = normalizeLiveStatusDraft(right);
  return (
    normalizedLeft.trs === normalizedRight.trs &&
    normalizedLeft.cameraReporter === normalizedRight.cameraReporter &&
    normalizedLeft.audioMan === normalizedRight.audioMan &&
    normalizedLeft.location === normalizedRight.location &&
    normalizedLeft.note === normalizedRight.note
  );
}

function createLiveStatusDraftByItemId(entries: LiveEquipmentStatusEntry[]) {
  return entries.reduce<LiveStatusDraftByItemId>((map, entry) => {
    map[entry.equipmentItemId] = normalizeLiveStatusDraft(entry);
    return map;
  }, {});
}

function getLoanLiveStatusDraft(loanItem?: EquipmentLoanItem): LiveLoanDetails {
  return {
    trs: loanItem?.loan.liveTrs?.trim() ?? "",
    cameraReporter: loanItem?.loan.liveCameraReporter?.trim() ?? "",
    audioMan: loanItem?.loan.liveAudioMan?.trim() ?? "",
    location: loanItem?.loan.liveLocation?.trim() ?? "",
    note: loanItem?.loan.liveNote?.trim() ?? "",
  };
}

function resolveLiveStatusDraft(manualDraft: LiveLoanDetails | undefined, loanItem?: EquipmentLoanItem): LiveLoanDetails {
  const manual = normalizeLiveStatusDraft(manualDraft);
  const linked = getLoanLiveStatusDraft(loanItem);
  return {
    trs: manual.trs || linked.trs,
    cameraReporter: manual.cameraReporter || linked.cameraReporter,
    audioMan: manual.audioMan || linked.audioMan,
    location: manual.location || linked.location,
    note: manual.note || linked.note,
  };
}

function stripLinkedLiveStatusDraft(displayDraft: LiveLoanDetails | undefined, loanItem?: EquipmentLoanItem): LiveLoanDetails {
  const display = normalizeLiveStatusDraft(displayDraft);
  const linked = getLoanLiveStatusDraft(loanItem);
  return {
    trs: display.trs === linked.trs ? "" : display.trs,
    cameraReporter: display.cameraReporter === linked.cameraReporter ? "" : display.cameraReporter,
    audioMan: display.audioMan === linked.audioMan ? "" : display.audioMan,
    location: display.location === linked.location ? "" : display.location,
    note: display.note === linked.note ? "" : display.note,
  };
}

function mergeElectionOverlayText(left: string, right: string) {
  const values = new Set(
    [left, right]
      .flatMap((value) => value.split("/"))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return Array.from(values).join(" / ");
}

function buildElectionTvuOverlayMap(overlays: ElectionTvuOverlay[]) {
  return overlays.reduce<Map<string, ElectionTvuOverlay>>((map, overlay) => {
    const key = overlay.normalizedEquipmentName;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, overlay);
      return map;
    }

    map.set(key, {
      ...existing,
      place: mergeElectionOverlayText(existing.place, overlay.place),
      cameraStaffName: mergeElectionOverlayText(existing.cameraStaffName, overlay.cameraStaffName),
      equipmentType: existing.equipmentType === "rental" || overlay.equipmentType === "rental" ? "rental" : existing.equipmentType,
    });
    return map;
  }, new Map());
}

function getElectionOverlayForItem(item: EquipmentItem, overlaysByTvuName: Map<string, ElectionTvuOverlay>) {
  return overlaysByTvuName.get(normalizeTvuEquipmentName(getEquipmentDisplayName(item))) ?? null;
}

function applyElectionOverlayToLiveDraft(draft: LiveLoanDetails, overlay: ElectionTvuOverlay | null): LiveLoanDetails {
  if (!overlay) return draft;
  return {
    ...draft,
    cameraReporter: overlay.cameraStaffName || draft.cameraReporter,
    location: overlay.place || draft.location,
  };
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

function getStandaloneVariantParentLabel(item: EquipmentItem) {
  if (item.groupName !== "단독 카메라") return "";
  const variantParent = getVariantParentLabel(item);
  if (variantParent) return variantParent;
  const matched = /^(.*?)\s+\d+\s*번$/i.exec(item.name.trim());
  return matched?.[1]?.trim() ?? "";
}

function getStandaloneVariantOptionLabel(item: EquipmentItem) {
  const optionNumber = getLiveAccessoryOptionNumber(item);
  return Number.isFinite(optionNumber) ? `${optionNumber}번` : getVariantLabel(item);
}

function getStandaloneInlineAccessoryKey(item: EquipmentItem) {
  if (getMetadataString(item, "family") !== "standalone") return "";
  return getMetadataString(item, "for").toLowerCase();
}

function isStandaloneInlineAccessoryItem(item: EquipmentItem) {
  return getStandaloneInlineAccessoryKey(item) !== "" && getMetadataString(item, "kind") !== "camera";
}

function getStandaloneCameraBatteryKey(item: EquipmentItem) {
  if (item.groupName !== "단독 카메라") return "";
  if (getMetadataString(item, "kind") === "etc") return "etc";
  const target = `${item.code} ${item.name}`.toLowerCase();
  if (target.includes("z-90")) return "z-90";
  if (target.includes("ax40")) return "ax40";
  if (target.includes("rx100")) return "rx100";
  if (target.includes("gopro") || target.includes("고프로")) return "gopro";
  if (target.includes("osmo") || target.includes("오스모")) return "osmo";
  if (target.includes("기타")) return "etc";
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

function canViewEquipmentStatus(session: SessionUser | null) {
  return Boolean(session?.approved && hasDeskAccess(session.role) && hasDeskAccess(session.actualRole));
}

function EquipmentNav({ activeHref, showStatusLink }: { activeHref: string; showStatusLink: boolean }) {
  const visibleNavItems = equipmentNavItems.filter((item) => item.href !== "/equipment/status" || showStatusLink);

  return (
    <div className={styles.nav} aria-label="TVU/장비 하위 메뉴">
      {visibleNavItems.map((item) => (
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
  activeHref,
  showStatusLink,
}: {
  eyebrow: string;
  title: string;
  activeHref: string;
  showStatusLink: boolean;
}) {
  return (
    <article className="panel">
      <div className={`panel-pad ${styles.header}`}>
        <div className={styles.headerText}>
          <span className="chip">{eyebrow}</span>
          <h1 className="page-title">{title}</h1>
        </div>
        <EquipmentNav activeHref={activeHref} showStatusLink={showStatusLink} />
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

function StatusPill({
  borrowed,
  repairing = false,
  availableLabel = "대여가능",
  borrowedLabel = "대여중",
}: {
  borrowed: boolean;
  repairing?: boolean;
  availableLabel?: string;
  borrowedLabel?: string;
}) {
  const statusClassName = borrowed
    ? styles.statusBorrowed
    : repairing
      ? styles.statusRepairing
      : styles.statusAvailable;
  const label = borrowed ? borrowedLabel : repairing ? "수리중" : availableLabel;
  return (
    <span className={`${styles.statusPill} ${statusClassName}`.trim()}>
      {label}
    </span>
  );
}

function EquipmentItemCard({
  item,
  displayName,
  selected,
  loanItem,
  onToggle,
  onDoubleClick,
  doubleClickTitle,
  allowBorrowedClick = false,
  tone = "default",
  repairMode = false,
  repairDraftByItemId,
  disabled = false,
}: {
  item: EquipmentItem;
  displayName?: string;
  selected: boolean;
  loanItem?: EquipmentLoanItem;
  onToggle: () => void;
  onDoubleClick?: () => void;
  doubleClickTitle?: string;
  allowBorrowedClick?: boolean;
  tone?: EquipmentItemCardTone;
  repairMode?: boolean;
  repairDraftByItemId?: RepairDraftByItemId;
  disabled?: boolean;
}) {
  const borrowed = Boolean(loanItem);
  const repairTarget = repairDraftByItemId?.[item.id] ?? item.isUnderRepair;
  const repairing = repairMode ? repairTarget : item.isUnderRepair;
  const repairChanged = repairMode && repairTarget !== item.isUnderRepair;
  const showGlobalBadge = isGlobalTvuItem(item);
  const showGridBadge = isGridTvuItem(item);
  const showRentalBadge = isRentalTvuItem(item);
  const showRegionalBadge = isRegionalTransmissionTvuItem(item);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
  }, []);

  return (
    <button
      type="button"
      className={[
        styles.itemCard,
        tone === "live" ? styles.itemCardLive : "",
        selected ? styles.itemCardSelected : "",
        selected && tone === "live" ? styles.itemCardSelectedLive : "",
        borrowed ? styles.itemCardBorrowed : "",
        repairing ? styles.itemCardRepairing : "",
        repairChanged ? styles.itemCardRepairPending : "",
      ].join(" ").trim()}
      disabled={disabled || (repairMode ? borrowed : (borrowed && !allowBorrowedClick) || repairing)}
      onClick={() => {
        if (!onDoubleClick) {
          onToggle();
          return;
        }
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
        }
        clickTimerRef.current = setTimeout(() => {
          clickTimerRef.current = null;
          onToggle();
        }, 180);
      }}
      onDoubleClick={(event) => {
        if (!onDoubleClick) return;
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
      aria-pressed={repairMode ? repairChanged : selected}
      title={doubleClickTitle}
    >
      <span className={styles.itemCardTop}>
        <span className={styles.itemNameStack}>
          <strong>{displayName ?? getEquipmentDisplayName(item)}</strong>
          {showGlobalBadge ? (
            <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
              Global
            </span>
          ) : null}
          {showGridBadge ? (
            <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
              Grid
            </span>
          ) : null}
          {showRentalBadge ? (
            <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
              임대
            </span>
          ) : null}
          {showRegionalBadge ? (
            <span className={styles.regionalBadge}>
              지역
            </span>
          ) : null}
        </span>
        {repairChanged ? (
          <span className={`${styles.statusPill} ${repairing ? styles.statusRepairing : styles.statusAvailable}`.trim()}>
            {repairing ? "수리 예정" : "해제 예정"}
          </span>
        ) : borrowed || repairing ? (
          <StatusPill borrowed={borrowed} repairing={repairing} />
        ) : null}
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
                      <span className={styles.recordName}>{getEquipmentDisplayName(record.item)}</span>
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
          {mode === "return" ? (
            <div className={styles.modalListToolbar}>
              <span>{returnIds.length}개 선택됨</span>
              <button type="button" className="btn" disabled={actionPending || returnIds.length === 0} onClick={() => onReturnIdsChange([])}>
                전체 선택해제
              </button>
            </div>
          ) : null}
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
                    <span>{equipmentCategoryLabels[item.item.category]} · {getEquipmentDisplayName(item.item)}</span>
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
                    <strong>
                      {getEquipmentDisplayName(item.item)}
                      {isRentalTvuItem(item.item) ? (
                        <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                          임대
                        </span>
                      ) : null}
                    </strong>
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
  repairMode = false,
  repairDraftByItemId,
}: {
  items: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  itemTone?: EquipmentItemCardTone;
  repairMode?: boolean;
  repairDraftByItemId?: RepairDraftByItemId;
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
      repairMode={repairMode}
      repairDraftByItemId={repairDraftByItemId}
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
  repairMode = false,
  repairDraftByItemId,
}: {
  groupName: string;
  groupItems: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  itemTone?: EquipmentItemCardTone;
  repairMode?: boolean;
  repairDraftByItemId?: RepairDraftByItemId;
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
                repairMode={repairMode}
                repairDraftByItemId={repairDraftByItemId}
              />
            );
          }

          const expanded = expandedVariantKeys.includes(entry.key);
          const selected = entry.items.some((item) => selectedIds.includes(item.id));
          const borrowedCount = entry.items.filter((item) => currentByItemId.has(item.id)).length;
          const repairingCount = entry.items.filter((item) => item.isUnderRepair).length;
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
                  {borrowedCount > 0 || repairingCount > 0 ? <StatusPill borrowed={borrowedCount > 0} repairing={repairingCount > 0} /> : null}
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
                        repairMode={repairMode}
                        repairDraftByItemId={repairDraftByItemId}
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
  repairMode = false,
  repairDraftByItemId,
}: {
  items: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  repairMode?: boolean;
  repairDraftByItemId?: RepairDraftByItemId;
}) {
  const [expandedBatteryAnchors, setExpandedBatteryAnchors] = useState<Record<string, string>>({});
  const [expandedStandaloneVariantKeys, setExpandedStandaloneVariantKeys] = useState<string[]>([]);
  const familyNames = ["FX3", "5D", "GH4"];
  const familyGroups = familyNames.map((familyName) => ({
    familyName,
    items: items.filter((item) => item.groupName.startsWith(familyName)),
  }));
  const familyItemIds = new Set(familyGroups.flatMap((group) => group.items.map((item) => item.id)));
  const nonFamilyItems = items.filter((item) => !familyItemIds.has(item.id));
  const standaloneInlineAccessoryItems = nonFamilyItems.filter(isStandaloneInlineAccessoryItem);
  const visibleStandaloneInlineAccessoryItems = repairMode ? [] : standaloneInlineAccessoryItems;
  const standalonePrimaryItems = nonFamilyItems.filter((item) => (
    item.groupName === "단독 카메라" && (repairMode || !isStandaloneInlineAccessoryItem(item))
  ));
  const leftoverItems = nonFamilyItems.filter((item) => item.groupName !== "단독 카메라" && !isStandaloneInlineAccessoryItem(item));
  const standaloneAccessoryEntriesByKey = useMemo(() => {
    const entriesByKey = new Map<string, StandaloneInlineAccessoryEntry[]>();
    const variantGroups = new Map<string, { accessoryKey: string; parentLabel: string; items: EquipmentItem[] }>();
    const addEntry = (accessoryKey: string, entry: StandaloneInlineAccessoryEntry) => {
      const existing = entriesByKey.get(accessoryKey) ?? [];
      existing.push(entry);
      entriesByKey.set(accessoryKey, existing);
    };

    visibleStandaloneInlineAccessoryItems.forEach((item) => {
      const key = getStandaloneInlineAccessoryKey(item);
      if (!key) return;
      const parentLabel = getVariantParentLabel(item);
      if (!parentLabel) {
        addEntry(key, { type: "item", key: item.id, sortOrder: item.sortOrder, item });
        return;
      }

      const variantGroupKey = `${key}:${parentLabel}`;
      const group = variantGroups.get(variantGroupKey) ?? { accessoryKey: key, parentLabel, items: [] };
      group.items.push(item);
      variantGroups.set(variantGroupKey, group);
    });

    variantGroups.forEach((group) => {
      const sortedItems = [...group.items].sort((left, right) => (
        getLiveAccessoryOptionNumber(left) - getLiveAccessoryOptionNumber(right)
        || left.sortOrder - right.sortOrder
        || left.name.localeCompare(right.name, "ko")
      ));
      addEntry(group.accessoryKey, {
        type: "variant",
        key: `standalone-accessory:${group.accessoryKey}:${group.parentLabel}`,
        sortOrder: sortedItems[0]?.sortOrder ?? 0,
        parentLabel: group.parentLabel,
        items: sortedItems,
      });
    });

    entriesByKey.forEach((entries, key) => {
      entriesByKey.set(key, entries.sort((left, right) => left.sortOrder - right.sortOrder || left.key.localeCompare(right.key, "ko")));
    });

    return entriesByKey;
  }, [visibleStandaloneInlineAccessoryItems]);
  const standaloneEntries = useMemo(() => {
    const variantGroups = new Map<string, EquipmentItem[]>();
    const entries: Array<
      | { type: "item"; key: string; sortOrder: number; item: EquipmentItem }
      | { type: "variant"; key: string; sortOrder: number; parentLabel: string; items: EquipmentItem[] }
    > = [];

    standalonePrimaryItems.forEach((item) => {
      const parentLabel = getStandaloneVariantParentLabel(item);
      if (!parentLabel) {
        entries.push({ type: "item", key: item.id, sortOrder: item.sortOrder, item });
        return;
      }
      const existing = variantGroups.get(parentLabel) ?? [];
      existing.push(item);
      variantGroups.set(parentLabel, existing);
    });

    variantGroups.forEach((variantItems, parentLabel) => {
      const sortedItems = [...variantItems].sort((left, right) => (
        getLiveAccessoryOptionNumber(left) - getLiveAccessoryOptionNumber(right)
        || left.sortOrder - right.sortOrder
        || left.name.localeCompare(right.name, "ko")
      ));
      entries.push({
        type: "variant",
        key: `standalone:${parentLabel}`,
        sortOrder: sortedItems[0]?.sortOrder ?? 0,
        parentLabel,
        items: sortedItems,
      });
    });

    return entries.sort((left, right) => left.sortOrder - right.sortOrder || left.key.localeCompare(right.key, "ko"));
  }, [standalonePrimaryItems]);

  const toggleStandaloneVariant = (key: string) => {
    setExpandedStandaloneVariantKeys((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  };

  const handleFamilyBodyToggle = (familyName: string, item: EquipmentItem, hasAccessoryItems: boolean) => {
    if (repairMode) {
      onToggle(item.id);
      return;
    }
    if (!currentByItemId.has(item.id)) {
      onToggle(item.id);
    }
    if (hasAccessoryItems) {
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
    if (repairMode) {
      onToggle(item.id);
      return;
    }
    const accessoryKey = getStandaloneCameraBatteryKey(item);
    const accessoryEntries = accessoryKey ? standaloneAccessoryEntriesByKey.get(accessoryKey) : undefined;
    const expandOnly = accessoryKey === "etc" && accessoryEntries && accessoryEntries.length > 0;
    if (!expandOnly && !currentByItemId.has(item.id)) {
      onToggle(item.id);
    }
    if (accessoryKey && accessoryEntries && accessoryEntries.length > 0) {
      setExpandedBatteryAnchors((current) => {
        if (current[accessoryKey] !== item.id) {
          return { ...current, [accessoryKey]: item.id };
        }
        const { [accessoryKey]: _removed, ...next } = current;
        return next;
      });
    }
  };

  const renderStandaloneAccessoryPanel = (anchorItem: EquipmentItem, entries: StandaloneInlineAccessoryEntry[]) => (
    <div key={`${anchorItem.id}-accessories`} className={styles.inlineBatteryPanel}>
      <div className={styles.inlineBatteryHead}>
        <h4>{anchorItem.name} 옵션</h4>
        <span>{entries.reduce((total, entry) => total + (entry.type === "variant" ? entry.items.length : 1), 0)}개</span>
      </div>
      <div className={styles.inlineBatteryGrid}>
        {entries.map((entry) => {
          if (entry.type === "item") {
            return (
              <EquipmentItemCard
                key={entry.key}
                item={entry.item}
                selected={selectedIds.includes(entry.item.id)}
                loanItem={currentByItemId.get(entry.item.id)}
                onToggle={() => onToggle(entry.item.id)}
                repairMode={repairMode}
                repairDraftByItemId={repairDraftByItemId}
              />
            );
          }

          const expanded = expandedStandaloneVariantKeys.includes(entry.key);
          const selected = entry.items.some((item) => selectedIds.includes(item.id));
          const summary = getLiveAccessorySummary(entry.items, selectedIds);
          const borrowedCount = entry.items.filter((item) => currentByItemId.has(item.id)).length;
          const repairingCount = entry.items.filter((item) => item.isUnderRepair).length;
          return (
            <Fragment key={entry.key}>
              <button
                type="button"
                className={[
                  styles.itemCard,
                  selected ? styles.itemCardSelected : "",
                ].join(" ").trim()}
                onClick={() => toggleStandaloneVariant(entry.key)}
                aria-expanded={expanded}
              >
                <span className={styles.itemCardTop}>
                  <strong>{entry.parentLabel}</strong>
                  {summary ? <small>{summary}</small> : null}
                  {borrowedCount > 0 || repairingCount > 0 ? <StatusPill borrowed={borrowedCount > 0} repairing={repairingCount > 0} /> : null}
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
                        displayName={getStandaloneVariantOptionLabel(item)}
                        selected={selectedIds.includes(item.id)}
                        loanItem={currentByItemId.get(item.id)}
                        onToggle={() => onToggle(item.id)}
                        repairMode={repairMode}
                        repairDraftByItemId={repairDraftByItemId}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={styles.sectionStack}>
      {familyGroups.map(({ familyName, items: matchedItems }) => {
        if (matchedItems.length === 0) return null;
        const familyExpansionKey = `family:${familyName}`;
        const bodyGroupName = `${familyName} 바디`;
        const batteryGroupName = `${familyName} 배터리`;
        const bodyItems = matchedItems.filter((item) => item.groupName === bodyGroupName);
        const batteryItems = matchedItems.filter((item) => item.groupName === batteryGroupName);
        const otherItems = matchedItems.filter((item) => item.groupName !== bodyGroupName && item.groupName !== batteryGroupName);
        const hasAccessoryItems = otherItems.length > 0 || batteryItems.length > 0;
        const expandedBodyId = expandedBatteryAnchors[familyExpansionKey];
        return (
          <section key={familyName} className={styles.familyBlock}>
            <div className={styles.groupHead}>
              <h2>{familyName}</h2>
              <span>바디 / 호환 렌즈</span>
            </div>
            <div className={styles.familySubgroups}>
              {bodyItems.length > 0 ? (
                <section className={styles.equipmentGroup}>
                  <div className={styles.itemGrid}>
                    {bodyItems.map((item) => {
                      return (
                        <Fragment key={item.id}>
                          <EquipmentItemCard
                            item={item}
                            selected={selectedIds.includes(item.id)}
                            loanItem={currentByItemId.get(item.id)}
                            onToggle={() => handleFamilyBodyToggle(familyName, item, hasAccessoryItems)}
                            allowBorrowedClick={hasAccessoryItems}
                            repairMode={repairMode}
                            repairDraftByItemId={repairDraftByItemId}
                          />
                        </Fragment>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {expandedBodyId && hasAccessoryItems
                ? renderGroupedItems({ items: [...otherItems, ...batteryItems], selectedIds, currentByItemId, onToggle, repairMode, repairDraftByItemId })
                : null}
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
                {standaloneEntries.map((entry) => {
                  if (entry.type === "item") {
                    const accessoryKey = getStandaloneCameraBatteryKey(entry.item);
                    const accessoryEntries = accessoryKey ? standaloneAccessoryEntriesByKey.get(accessoryKey) ?? [] : [];
                    const showAccessories = Boolean(accessoryKey && expandedBatteryAnchors[accessoryKey] === entry.item.id && accessoryEntries.length > 0);
                    return (
                      <Fragment key={entry.key}>
                        <EquipmentItemCard
                          item={entry.item}
                          selected={selectedIds.includes(entry.item.id)}
                          loanItem={currentByItemId.get(entry.item.id)}
                          onToggle={() => handleStandaloneToggle(entry.item)}
                          allowBorrowedClick={accessoryEntries.length > 0}
                          repairMode={repairMode}
                          repairDraftByItemId={repairDraftByItemId}
                        />
                        {showAccessories ? renderStandaloneAccessoryPanel(entry.item, accessoryEntries) : null}
                      </Fragment>
                    );
                  }

                  const expanded = expandedStandaloneVariantKeys.includes(entry.key);
                  const selected = entry.items.some((item) => selectedIds.includes(item.id));
                  const summary = getLiveAccessorySummary(entry.items, selectedIds);
                  const borrowedCount = entry.items.filter((item) => currentByItemId.has(item.id)).length;
                  const repairingCount = entry.items.filter((item) => item.isUnderRepair).length;
                  return (
                    <Fragment key={entry.key}>
                      <button
                        type="button"
                        className={[
                          styles.itemCard,
                          selected ? styles.itemCardSelected : "",
                        ].join(" ").trim()}
                        onClick={() => toggleStandaloneVariant(entry.key)}
                        aria-expanded={expanded}
                      >
                        <span className={styles.itemCardTop}>
                          <strong>{entry.parentLabel}</strong>
                          {summary ? <small>{summary}</small> : null}
                          {borrowedCount > 0 || repairingCount > 0 ? <StatusPill borrowed={borrowedCount > 0} repairing={repairingCount > 0} /> : null}
                        </span>
                      </button>
                      {expanded ? (
                        <div className={styles.inlineBatteryPanel}>
                          <div className={styles.inlineBatteryHead}>
                            <h4>{entry.parentLabel}</h4>
                            <span>{entry.items.length}개</span>
                          </div>
                          <div className={styles.inlineBatteryGrid}>
                            {entry.items.map((item) => {
                              const accessoryKey = getStandaloneCameraBatteryKey(item);
                              const accessoryEntries = accessoryKey ? standaloneAccessoryEntriesByKey.get(accessoryKey) ?? [] : [];
                              const showAccessories = Boolean(accessoryKey && expandedBatteryAnchors[accessoryKey] === item.id && accessoryEntries.length > 0);
                              return (
                                <Fragment key={item.id}>
                                  <EquipmentItemCard
                                    item={item}
                                    displayName={getStandaloneVariantOptionLabel(item)}
                                    selected={selectedIds.includes(item.id)}
                                    loanItem={currentByItemId.get(item.id)}
                                    onToggle={() => handleStandaloneToggle(item)}
                                    allowBorrowedClick={accessoryEntries.length > 0}
                                    repairMode={repairMode}
                                    repairDraftByItemId={repairDraftByItemId}
                                  />
                                  {showAccessories ? renderStandaloneAccessoryPanel(item, accessoryEntries) : null}
                                </Fragment>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </section>
            {leftoverItems.length > 0
              ? renderGroupedItems({ items: leftoverItems, selectedIds, currentByItemId, onToggle, repairMode, repairDraftByItemId })
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
  selectedTrsValues,
  onTrsToggle,
  repairMode = false,
  repairDraftByItemId,
  rentalTvuMode = null,
  rentalTvuSelectedIds = [],
  onRentalTvuToggle,
  canManageTvuGrid = false,
  gridPendingItemId = null,
  onTvuGridToggle,
}: {
  items: EquipmentItem[];
  selectedIds: string[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  selectedTrsValues: string[];
  onTrsToggle: (trs: string) => void;
  repairMode?: boolean;
  repairDraftByItemId?: RepairDraftByItemId;
  rentalTvuMode?: RentalTvuMode | null;
  rentalTvuSelectedIds?: string[];
  onRentalTvuToggle?: (itemId: string) => void;
  canManageTvuGrid?: boolean;
  gridPendingItemId?: string | null;
  onTvuGridToggle?: (item: EquipmentItem) => void;
}) {
  const [expandedTvuId, setExpandedTvuId] = useState<string | null>(null);
  const [expandedTrsTvuId, setExpandedTrsTvuId] = useState<string | null>(null);
  const [expandedAccessoryGroup, setExpandedAccessoryGroup] = useState<{ tvuId: string; groupKey: LiveAccessoryGroupKey } | null>(null);
  const tvuItems = items.filter(isTvuItem);
  const tvuAccessoryItems = items.filter(isTvuInlineAccessoryItem);
  const visibleTvuAccessoryItems = tvuAccessoryItems
    .filter((item) => !isTvuBatteryItem(item))
    .filter((item) => !isHiddenEquipmentChoiceItem(item));
  const liveAccessoryGroups = LIVE_ACCESSORY_GROUPS.map((groupKey) => ({
    groupKey,
    label: getLiveAccessoryGroupLabel(groupKey),
    items: visibleTvuAccessoryItems
      .filter((accessoryItem) => getLiveAccessoryGroupKey(accessoryItem) === groupKey)
      .sort((left, right) => getLiveAccessoryOptionNumber(left) - getLiveAccessoryOptionNumber(right)),
  })).filter((group) => group.items.length > 0);
  const otherItems = items.filter((item) => !isTvuItem(item) && !isTvuInlineAccessoryItem(item) && !isHiddenEquipmentChoiceItem(item));

  const handleTvuToggle = (item: EquipmentItem) => {
    if (rentalTvuMode === "deactivate" && isRentalTvuItem(item)) {
      onRentalTvuToggle?.(item.id);
      setExpandedTvuId(null);
      setExpandedTrsTvuId(null);
      setExpandedAccessoryGroup(null);
      return;
    }
    if (repairMode) {
      onToggle(item.id);
      return;
    }
    const selected = selectedIds.includes(item.id);
    if (!currentByItemId.has(item.id)) {
      onToggle(item.id);
    }
    setExpandedTvuId((current) => (selected || current === item.id ? null : item.id));
    setExpandedTrsTvuId(null);
    setExpandedAccessoryGroup(null);
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
              const accessoryCount = liveAccessoryGroups.length + 1;
              const showAccessories = expandedTvuId === item.id;
              const showTrsOptions = expandedTrsTvuId === item.id;
              const rentalDeactivateTarget = rentalTvuMode === "deactivate" && isRentalTvuItem(item);
              const expandedGroup = expandedAccessoryGroup?.tvuId === item.id
                ? liveAccessoryGroups.find((group) => group.groupKey === expandedAccessoryGroup.groupKey)
                : null;
              return (
                <Fragment key={item.id}>
                  <EquipmentItemCard
                    item={item}
                    selected={rentalDeactivateTarget ? rentalTvuSelectedIds.includes(item.id) : selectedIds.includes(item.id)}
                    loanItem={currentByItemId.get(item.id)}
                    onToggle={() => handleTvuToggle(item)}
                    onDoubleClick={canManageTvuGrid && !repairMode && !rentalTvuMode ? () => onTvuGridToggle?.(item) : undefined}
                    doubleClickTitle={canManageTvuGrid ? "더블클릭으로 Grid 표시를 추가/삭제" : undefined}
                    allowBorrowedClick={rentalDeactivateTarget ? false : tvuAccessoryItems.length > 0 || canManageTvuGrid}
                    tone="live"
                    repairMode={repairMode}
                    repairDraftByItemId={repairDraftByItemId}
                    disabled={gridPendingItemId === item.id}
                  />
                  {showAccessories ? (
                    <div className={styles.inlineBatteryPanel}>
                      <div className={styles.inlineBatteryHead}>
                        <h4>{getEquipmentDisplayName(item)} 부속 장비</h4>
                        <span>{accessoryCount}개</span>
                      </div>
                      <div className={styles.inlineBatteryGrid}>
                        <button
                          type="button"
                          className={[
                            styles.itemCard,
                            styles.itemCardLive,
                            selectedTrsValues.length > 0 ? styles.itemCardSelectedLive : "",
                          ].join(" ").trim()}
                          onClick={() => {
                            setExpandedAccessoryGroup(null);
                            setExpandedTrsTvuId((current) => (current === item.id ? null : item.id));
                          }}
                          aria-expanded={showTrsOptions}
                        >
                          <span className={styles.itemCardTop}>
                            <strong>TRS</strong>
                            {selectedTrsValues.length > 0 ? <small>{formatTrsSummary(selectedTrsValues)}</small> : null}
                          </span>
                        </button>
                        {liveAccessoryGroups.map((group) => {
                          const summary = getLiveAccessorySummary(group.items, selectedIds);
                          const expanded = expandedGroup?.groupKey === group.groupKey;
                          return (
                            <button
                              key={group.groupKey}
                              type="button"
                              className={[
                                styles.itemCard,
                                styles.itemCardLive,
                                summary ? styles.itemCardSelectedLive : "",
                              ].join(" ").trim()}
                              onClick={() => {
                                setExpandedTrsTvuId(null);
                                setExpandedAccessoryGroup((current) => (
                                  current?.tvuId === item.id && current.groupKey === group.groupKey
                                    ? null
                                    : { tvuId: item.id, groupKey: group.groupKey }
                                ));
                              }}
                              aria-expanded={expanded}
                            >
                              <span className={styles.itemCardTop}>
                                <strong>{group.label}</strong>
                                {summary ? <small>{summary}</small> : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {showTrsOptions ? (
                        <div className={styles.trsOptionPanel}>
                          <div className={styles.trsOptionGrid}>
                            {LIVE_TRS_OPTIONS.map((trs) => (
                              <button
                                key={trs}
                                type="button"
                                className={[
                                  styles.trsOptionButton,
                                  selectedTrsValues.includes(trs) ? styles.trsOptionButtonSelected : "",
                                ].join(" ").trim()}
                                onClick={() => onTrsToggle(trs)}
                                aria-pressed={selectedTrsValues.includes(trs)}
                              >
                                {trs}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {expandedGroup ? (
                        <div className={styles.trsOptionPanel}>
                          <div className={styles.trsOptionGrid}>
                            {expandedGroup.items.map((accessoryItem) => {
                              const loanItem = currentByItemId.get(accessoryItem.id);
                              const repairTarget = repairDraftByItemId?.[accessoryItem.id] ?? accessoryItem.isUnderRepair;
                              const repairChanged = repairMode && repairTarget !== accessoryItem.isUnderRepair;
                              const selected = repairMode ? repairChanged : selectedIds.includes(accessoryItem.id);
                              const disabled = repairMode ? Boolean(loanItem) : Boolean(loanItem) || accessoryItem.isUnderRepair;
                              return (
                                <button
                                  key={accessoryItem.id}
                                  type="button"
                                  className={[
                                    styles.trsOptionButton,
                                    selected ? styles.trsOptionButtonSelected : "",
                                  ].join(" ").trim()}
                                  onClick={() => onToggle(accessoryItem.id)}
                                  aria-pressed={selected}
                                  disabled={disabled}
                                >
                                  <span>{getLiveAccessoryOptionLabel(accessoryItem)}</span>
                                  {loanItem ? <small>대여중</small> : accessoryItem.isUnderRepair ? <small>수리중</small> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </section>
      ) : null}
      {otherItems.length > 0 ? renderGroupedItems({ items: otherItems, selectedIds, currentByItemId, onToggle, itemTone: "live", repairMode, repairDraftByItemId }) : null}
    </div>
  );
}

function RegionalTransmissionSection({
  items,
  currentByItemId,
  onToggle,
  repairMode = false,
  repairDraftByItemId,
}: {
  items: EquipmentItem[];
  currentByItemId: Map<string, EquipmentLoanItem>;
  onToggle: (itemId: string) => void;
  repairMode?: boolean;
  repairDraftByItemId?: RepairDraftByItemId;
}) {
  if (items.length === 0) return null;

  return (
    <section className={styles.equipmentGroup}>
      <div className={styles.groupHead}>
        <h3>지역 전송장비</h3>
        <span>{items.length}개</span>
      </div>
      <div className={styles.itemGrid}>
        {items.map((item) => {
          const repairTarget = repairDraftByItemId?.[item.id] ?? item.isUnderRepair;
          const repairChanged = repairMode && repairTarget !== item.isUnderRepair;
          return (
            <EquipmentItemCard
              key={item.id}
              item={item}
              selected={repairChanged}
              loanItem={currentByItemId.get(item.id)}
              onToggle={() => {
                if (repairMode) onToggle(item.id);
              }}
              tone="live"
              repairMode={repairMode}
              repairDraftByItemId={repairDraftByItemId}
              disabled={!repairMode}
            />
          );
        })}
      </div>
    </section>
  );
}

function RentalTvuCard({
  item,
  selected,
  selectionMode,
  canManage,
  canManageTvuGrid,
  editing,
  editName,
  disabled,
  gridPending,
  onToggle,
  onTvuGridToggle,
  onStartEdit,
  onEditNameChange,
  onConfirmEdit,
  onCancelEdit,
}: {
  item: EquipmentItem;
  selected: boolean;
  selectionMode: boolean;
  canManage: boolean;
  canManageTvuGrid: boolean;
  editing: boolean;
  editName: string;
  disabled: boolean;
  gridPending: boolean;
  onToggle: () => void;
  onTvuGridToggle: () => void;
  onStartEdit: () => void;
  onEditNameChange: (value: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
}) {
  const canToggleGrid = canManageTvuGrid && !selectionMode && !editing;
  const showGridBadge = isGridTvuItem(item);
  const cardDisabled = disabled || gridPending || (!selectionMode && !canToggleGrid);

  return (
    <article
      className={[
        styles.itemCard,
        styles.itemCardLive,
        styles.rentalTvuCard,
        selected ? styles.itemCardSelectedLive : "",
      ].join(" ").trim()}
    >
      <button
        type="button"
        className={styles.rentalTvuCardMain}
        disabled={cardDisabled}
        onClick={() => {
          if (selectionMode) {
            onToggle();
          }
        }}
        onDoubleClick={(event) => {
          if (!canToggleGrid) return;
          event.preventDefault();
          event.stopPropagation();
          onTvuGridToggle();
        }}
        aria-pressed={selected}
        title={canToggleGrid ? "더블클릭으로 Grid 표시를 추가/삭제" : undefined}
      >
        <span className={styles.itemCardTop}>
          <span className={styles.itemNameStack}>
            <strong>{getEquipmentDisplayName(item)}</strong>
            {showGridBadge ? (
              <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                Grid
              </span>
            ) : null}
            <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
              임대
            </span>
          </span>
        </span>
      </button>
      {canManage ? (
        editing ? (
          <form
            className={styles.rentalTvuEditForm}
            onSubmit={(event) => {
              event.preventDefault();
              onConfirmEdit();
            }}
          >
            <input
              className="field-input"
              value={editName}
              maxLength={80}
              onChange={(event) => onEditNameChange(event.target.value)}
              aria-label={`${getEquipmentDisplayName(item)} 이름`}
              disabled={disabled}
            />
            <div className={styles.rentalTvuCardActions}>
              <button type="submit" className="btn primary" disabled={disabled || editName.trim().length === 0}>
                확인
              </button>
              <button type="button" className="btn" disabled={disabled} onClick={onCancelEdit}>
                취소
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.rentalTvuCardActions}>
            <button type="button" className={`btn ${styles.rentalTvuNameEditButton}`} disabled={selectionMode || disabled} onClick={onStartEdit}>
              이름수정
            </button>
          </div>
        )
      ) : null}
    </article>
  );
}

function RentalTvuSection({
  inactiveItems,
  activeItems,
  mode,
  selectedIds,
  canManage,
  canManageTvuGrid = false,
  gridPendingItemId = null,
  actionPending,
  editingItemId,
  editName,
  onModeStart,
  onModeCancel,
  onModeConfirm,
  onSelectionToggle,
  onTvuGridToggle,
  onEditStart,
  onEditNameChange,
  onEditConfirm,
  onEditCancel,
}: {
  inactiveItems: EquipmentItem[];
  activeItems: EquipmentItem[];
  mode: RentalTvuMode | null;
  selectedIds: string[];
  canManage: boolean;
  canManageTvuGrid?: boolean;
  gridPendingItemId?: string | null;
  actionPending: boolean;
  editingItemId: string | null;
  editName: string;
  onModeStart: (mode: RentalTvuMode) => void;
  onModeCancel: () => void;
  onModeConfirm: () => void;
  onSelectionToggle: (itemId: string) => void;
  onTvuGridToggle?: (item: EquipmentItem) => void;
  onEditStart: (item: EquipmentItem) => void;
  onEditNameChange: (value: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
}) {
  return (
    <section className={`${styles.equipmentGroup} ${styles.rentalTvuSection}`.trim()}>
      <div className={styles.groupHead}>
        <h3>임대 장비</h3>
        <span>{inactiveItems.length}개 대기 · {activeItems.length}개 활성</span>
      </div>
      <div className={styles.rentalTvuToolbar}>
        <p>
          {mode === "activate"
            ? "활성화할 임대 장비를 선택하세요."
            : mode === "deactivate"
              ? "비활성화할 임대 장비는 위 TVU 섹션에서 선택하세요."
              : "TVU21~TVU40 임대 장비를 필요할 때 현재 TVU 목록에 추가합니다."}
        </p>
        {canManage ? (
          <div className={styles.actionButtons}>
            {mode ? (
              <>
                <button type="button" className="btn primary" disabled={selectedIds.length === 0 || actionPending} onClick={onModeConfirm}>
                  확인
                </button>
                <button type="button" className="btn" disabled={actionPending} onClick={onModeCancel}>
                  취소
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn primary" disabled={inactiveItems.length === 0 || actionPending} onClick={() => onModeStart("activate")}>
                  활성화
                </button>
                <button type="button" className="btn" disabled={activeItems.length === 0 || actionPending} onClick={() => onModeStart("deactivate")}>
                  비활성화
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {inactiveItems.length > 0 ? (
        <div className={styles.itemGrid}>
          {inactiveItems.map((item) => (
            <RentalTvuCard
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              selectionMode={mode === "activate"}
              canManage={canManage}
              canManageTvuGrid={canManageTvuGrid}
              editing={editingItemId === item.id}
              editName={editName}
              disabled={actionPending}
              gridPending={gridPendingItemId === item.id}
              onToggle={() => onSelectionToggle(item.id)}
              onTvuGridToggle={() => onTvuGridToggle?.(item)}
              onStartEdit={() => onEditStart(item)}
              onEditNameChange={onEditNameChange}
              onConfirmEdit={onEditConfirm}
              onCancelEdit={onEditCancel}
            />
          ))}
        </div>
      ) : (
        <div className="status note">모든 임대 장비가 활성화되어 있습니다.</div>
      )}
    </section>
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
  const [repairMode, setRepairMode] = useState(false);
  const [repairDraftByItemId, setRepairDraftByItemId] = useState<RepairDraftByItemId>({});
  const [rentalTvuMode, setRentalTvuMode] = useState<RentalTvuMode | null>(null);
  const [rentalTvuSelectionIds, setRentalTvuSelectionIds] = useState<string[]>([]);
  const [rentalTvuEditItemId, setRentalTvuEditItemId] = useState<string | null>(null);
  const [rentalTvuEditName, setRentalTvuEditName] = useState("");
  const [gridPendingItemId, setGridPendingItemId] = useState<string | null>(null);

  const isEngSetPage = category === "eng_set";
  const canMutate = Boolean(session?.approved && !isReadOnlyPortalRole(session.role));
  const canReturnEquipment = Boolean(session?.approved && (!isReadOnlyPortalRole(session.role) || hasDeskAccess(session.actualRole)));
  const canManageRepair = Boolean(session?.approved && hasDeskAccess(session.role));
  const canManageRentalTvu = Boolean(session?.approved && hasRentalTvuManagerRole(session.actualRole));
  const canManageTvuGrid = canManageRentalTvu;
  const canViewRegionalTransmissionItems = Boolean(session?.approved && hasDeskAccess(session.actualRole));
  const showEquipmentStatusLink = canViewEquipmentStatus(session);
  const highlightDateKey = useMemo(() => getTodayDateKey(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [nextCurrent, nextItems, nextProfiles, nextHighlights] = await Promise.all([
        fetchEquipmentLoanItems({ status: "borrowed" }),
        category === "live" ? fetchLiveEquipmentItemsForManagement() : fetchEquipmentItems([category]),
        isEngSetPage ? fetchEquipmentProfiles() : Promise.resolve([]),
        isEngSetPage ? loadEngScheduleHighlights(highlightDateKey) : Promise.resolve(new Map() as EngScheduleHighlightMap),
      ]);
      setCurrentLoanItems(nextCurrent);
      setItems(nextItems);
      setProfiles(isEngSetPage ? nextProfiles.filter((profile) => !isHiddenEngSetProfile(profile)) : nextProfiles);
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
  const selectedTrsValues = useMemo(() => parseSelectedTrs(liveDetails.trs), [liveDetails.trs]);
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
  const visibleItems = useMemo(() => items.filter((item) => !isHiddenEquipmentChoiceItem(item)), [items]);
  const activeVisibleItems = useMemo(() => visibleItems.filter((item) => item.isActive), [visibleItems]);
  const inactiveRentalTvuItems = useMemo(
    () => visibleItems.filter((item) => isRentalTvuItem(item) && !item.isActive),
    [visibleItems],
  );
  const activeRentalTvuItems = useMemo(
    () => activeVisibleItems.filter(isRentalTvuItem),
    [activeVisibleItems],
  );
  const activeRegionalTransmissionItems = useMemo(
    () => activeVisibleItems.filter(isRegionalTransmissionTvuItem),
    [activeVisibleItems],
  );
  const activeLiveBorrowableOrRentalItems = useMemo(
    () => activeVisibleItems.filter((item) => !isRegionalTransmissionTvuItem(item)),
    [activeVisibleItems],
  );
  const borrowableVisibleItems = useMemo(
    () => activeVisibleItems.filter(isBorrowableEquipmentItem),
    [activeVisibleItems],
  );
  const itemSelectionById = useMemo(() => new Map(borrowableVisibleItems.map((item) => [item.id, itemToBorrowSelection(item)] as const)), [borrowableVisibleItems]);
  const itemById = useMemo(() => new Map(activeVisibleItems.map((item) => [item.id, item] as const)), [activeVisibleItems]);
  const profileSelectionById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profileToBorrowSelection(profile)] as const)),
    [profiles],
  );
  const repairChangeEntries = useMemo(() => (
    Object.entries(repairDraftByItemId)
      .map(([itemId, targetRepairStatus]) => {
        const item = itemById.get(itemId);
        if (!item) return null;
        if (currentByItemId.has(itemId)) return null;
        if (item.isUnderRepair === targetRepairStatus) return null;
        return { itemId, targetRepairStatus };
      })
      .filter((entry): entry is { itemId: string; targetRepairStatus: boolean } => Boolean(entry))
  ), [currentByItemId, itemById, repairDraftByItemId]);

  const repairChangeCount = repairChangeEntries.length;
  const rentalTvuSelectableIds = useMemo(() => {
    if (rentalTvuMode === "activate") {
      return new Set(inactiveRentalTvuItems.map((item) => item.id));
    }
    if (rentalTvuMode === "deactivate") {
      return new Set(activeRentalTvuItems.filter((item) => !currentByItemId.has(item.id)).map((item) => item.id));
    }
    return new Set<string>();
  }, [activeRentalTvuItems, currentByItemId, inactiveRentalTvuItems, rentalTvuMode]);

  useEffect(() => {
    if (!rentalTvuMode || rentalTvuSelectionIds.length === 0) return;
    setRentalTvuSelectionIds((current) => current.filter((itemId) => rentalTvuSelectableIds.has(itemId)));
  }, [rentalTvuMode, rentalTvuSelectableIds, rentalTvuSelectionIds.length]);

  useEffect(() => {
    if (loading || selectedEntries.length === 0) return;
    const nextSelections = selectedEntries.filter((selection) => {
      if (selection.kind === "item" && selection.category === category) {
        const item = itemById.get(selection.id);
        if (!item) return false;
        if (item.isUnderRepair) return false;
        if (!isBorrowableEquipmentItem(item)) return false;
        return !(category === "live" && isTvuBatteryItem(item));
      }
      if (selection.kind === "eng_profile" && isEngSetPage) {
        return profileSelectionById.has(selection.id);
      }
      return true;
    });
    if (nextSelections.length === selectedEntries.length) return;
    setSelectedEntries(nextSelections);
    writeBorrowSelections(session?.id, nextSelections);
  }, [category, isEngSetPage, itemById, loading, profileSelectionById, selectedEntries, session?.id]);

  const returnableItems = useMemo(() => {
    return currentLoanItems.filter((loanItem) => canReturnLoanItem(loanItem));
  }, [currentLoanItems]);

  const showLiveFields = useMemo(() => {
    if (confirmMode !== "borrow") return false;
    return hasSelectedTvu;
  }, [confirmMode, hasSelectedTvu]);

  useEffect(() => {
    if (hasSelectedTvu || !liveDetails.trs) return;
    setLiveDetails((current) => ({ ...current, trs: "" }));
  }, [hasSelectedTvu, liveDetails.trs]);

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
  const sharedEngSetItems = useMemo(
    () => visibleItems.filter(isSharedEngSetItem).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko")),
    [visibleItems],
  );

  const updateBorrowSelections = useCallback((updater: (current: BorrowSelection[]) => BorrowSelection[]) => {
    setSelectedEntries((current) => {
      const next = updater(current);
      writeBorrowSelections(session?.id, next);
      return next;
    });
  }, [session?.id]);

  const toggleSelection = (itemId: string) => {
    const selection = itemSelectionById.get(itemId) ?? (isEngSetPage ? profileSelectionById.get(itemId) : undefined);
    if (!selection) return;
    const selectionKey = getBorrowSelectionKey(selection);
    updateBorrowSelections((current) => {
      if (current.some((entry) => getBorrowSelectionKey(entry) === selectionKey)) {
        return current.filter((entry) => getBorrowSelectionKey(entry) !== selectionKey);
      }
      return [...current, selection];
    });
  };

  const toggleTvuGrid = async (item: EquipmentItem) => {
    if (!canManageTvuGrid) {
      setMessage({ tone: "warn", text: "TVU Grid 표시 변경 권한이 없습니다." });
      return;
    }
    if (!isTvuItem(item)) return;

    const nextGridStatus = !isGridTvuItem(item);
    setGridPendingItemId(item.id);
    try {
      await setTvuGridStatus(item.id, nextGridStatus);
      setItems((current) => current.map((entry) => {
        if (entry.id !== item.id) return entry;
        const metadata = { ...entry.metadata };
        if (nextGridStatus) {
          metadata.grid = true;
        } else {
          delete metadata.grid;
        }
        return { ...entry, metadata };
      }));
      setMessage({
        tone: "ok",
        text: `${getEquipmentDisplayName(item)} Grid 표시를 ${nextGridStatus ? "추가" : "삭제"}했습니다.`,
      });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "TVU Grid 표시 변경에 실패했습니다." });
    } finally {
      setGridPendingItemId(null);
    }
  };

  const toggleRepairDraft = (itemId: string) => {
    const item = itemById.get(itemId);
    if (!item) return;
    if (currentByItemId.has(itemId)) {
      setMessage({ tone: "note", text: "대여중인 장비는 수리 상태를 변경할 수 없습니다." });
      return;
    }

    setRepairDraftByItemId((current) => {
      const currentTarget = current[itemId] ?? item.isUnderRepair;
      const nextTarget = !currentTarget;
      const next = { ...current };
      if (nextTarget === item.isUnderRepair) {
        delete next[itemId];
        return next;
      }
      next[itemId] = nextTarget;
      return next;
    });
  };

  const openRepairMode = () => {
    if (!canManageRepair) {
      setMessage({ tone: "warn", text: "장비 수리 처리 권한이 없습니다." });
      return;
    }
    setRepairMode(true);
    setRepairDraftByItemId({});
    setConfirmMode(null);
    setMessage({ tone: "note", text: "수리 상태를 바꿀 장비를 선택한 뒤 확인을 누르세요." });
  };

  const cancelRepairMode = () => {
    setRepairMode(false);
    setRepairDraftByItemId({});
    setMessage(null);
  };

  const openRentalTvuMode = (mode: RentalTvuMode) => {
    if (!canManageRentalTvu) {
      setMessage({ tone: "warn", text: "임대 장비 관리 권한이 없습니다." });
      return;
    }
    setRepairMode(false);
    setRepairDraftByItemId({});
    setConfirmMode(null);
    setRentalTvuEditItemId(null);
    setRentalTvuEditName("");
    setRentalTvuSelectionIds([]);
    setRentalTvuMode(mode);
    updateBorrowSelections(() => []);
    setLiveDetails(liveDetailEmpty);
    setMessage({
      tone: "note",
      text: mode === "activate"
        ? "활성화할 임대 장비를 선택한 뒤 확인을 누르세요."
        : "비활성화할 임대 장비를 TVU 섹션에서 선택한 뒤 확인을 누르세요.",
    });
  };

  const cancelRentalTvuMode = () => {
    setRentalTvuMode(null);
    setRentalTvuSelectionIds([]);
    setMessage(null);
  };

  const toggleRentalTvuSelection = (itemId: string) => {
    if (!rentalTvuSelectableIds.has(itemId)) {
      setMessage({ tone: "note", text: "선택할 수 없는 임대 장비입니다." });
      return;
    }
    setRentalTvuSelectionIds((current) => (
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
    ));
  };

  const confirmRentalTvuMode = async () => {
    if (!canManageRentalTvu) {
      setMessage({ tone: "warn", text: "임대 장비 관리 권한이 없습니다." });
      return;
    }
    if (!rentalTvuMode) return;
    if (rentalTvuSelectionIds.length === 0) {
      setMessage({ tone: "note", text: "변경할 임대 장비를 선택해 주세요." });
      return;
    }

    setActionPending(true);
    try {
      await setRentalTvuItemsActive(rentalTvuSelectionIds, rentalTvuMode === "activate");
      setMessage({ tone: "ok", text: rentalTvuMode === "activate" ? "선택한 임대 장비를 활성화했습니다." : "선택한 임대 장비를 비활성화했습니다." });
      setRentalTvuMode(null);
      setRentalTvuSelectionIds([]);
      await load();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "임대 장비 처리에 실패했습니다." });
    } finally {
      setActionPending(false);
    }
  };

  const startRentalTvuRename = (item: EquipmentItem) => {
    if (!canManageRentalTvu) {
      setMessage({ tone: "warn", text: "임대 장비 관리 권한이 없습니다." });
      return;
    }
    setRentalTvuMode(null);
    setRentalTvuSelectionIds([]);
    setRentalTvuEditItemId(item.id);
    setRentalTvuEditName(item.name);
    setMessage(null);
  };

  const cancelRentalTvuRename = () => {
    setRentalTvuEditItemId(null);
    setRentalTvuEditName("");
  };

  const confirmRentalTvuRename = async () => {
    if (!rentalTvuEditItemId) return;
    if (!canManageRentalTvu) {
      setMessage({ tone: "warn", text: "임대 장비 관리 권한이 없습니다." });
      return;
    }
    setActionPending(true);
    try {
      await renameRentalTvuItem(rentalTvuEditItemId, rentalTvuEditName);
      setMessage({ tone: "ok", text: "임대 장비 이름을 수정했습니다." });
      setRentalTvuEditItemId(null);
      setRentalTvuEditName("");
      await load();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "임대 장비 이름 수정에 실패했습니다." });
    } finally {
      setActionPending(false);
    }
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
    setLiveDetails((current) => ({
      ...liveDetailEmpty,
      trs: hasSelectedTvu ? current.trs : "",
      cameraReporter: hasSelectedTvu ? session?.username ?? "" : "",
    }));
    setConfirmMode("borrow");
  };

  const clearBorrowSelection = () => {
    updateBorrowSelections(() => []);
    setLiveDetails(liveDetailEmpty);
    setReturnIds([]);
    setConfirmMode(null);
    setMessage({ tone: "note", text: "장비 선택을 초기화했습니다." });
  };

  const openReturnDialog = () => {
    if (!canReturnEquipment) {
      setMessage({ tone: "warn", text: "장비 반납 권한이 없습니다." });
      return;
    }
    setReturnIds(returnableItems.map((item) => item.id));
    setConfirmMode("return");
  };

  const confirmRepair = async () => {
    if (!canManageRepair) {
      setMessage({ tone: "warn", text: "장비 수리 처리 권한이 없습니다." });
      return;
    }

    if (repairChangeEntries.length === 0) {
      setMessage({ tone: "note", text: "변경할 수리 상태가 없습니다." });
      return;
    }

    const repairItemIds = repairChangeEntries.filter((entry) => entry.targetRepairStatus).map((entry) => entry.itemId);
    const releaseItemIds = repairChangeEntries.filter((entry) => !entry.targetRepairStatus).map((entry) => entry.itemId);

    setActionPending(true);
    try {
      if (repairItemIds.length > 0) {
        await setEquipmentItemsRepairStatus(repairItemIds, true);
      }
      if (releaseItemIds.length > 0) {
        await setEquipmentItemsRepairStatus(releaseItemIds, false);
      }
      setMessage({ tone: "ok", text: "선택한 장비의 수리 상태를 저장했습니다." });
      setRepairMode(false);
      setRepairDraftByItemId({});
      await load();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "수리 처리에 실패했습니다." });
    } finally {
      setActionPending(false);
    }
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

  const hasBorrowSelectionDraft = selectedIds.length > 0 || selectedTrsValues.length > 0;

  return (
    <section className={styles.page}>
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        activeHref={config.route}
        showStatusLink={showEquipmentStatusLink}
      />

      <article className="panel">
        <div className={`panel-pad ${styles.sectionStack}`}>
          <div className={styles.actionBar}>
            <div className={styles.actionSummary}>
              <strong>
                {repairMode
                  ? `${repairChangeCount}개 변경 예정`
                  : rentalTvuMode
                    ? `${rentalTvuSelectionIds.length}개 임대 장비 선택됨`
                    : `${selectedIds.length}개 선택됨`}
              </strong>
              <span className="muted">
                {repairMode
                  ? "장비를 클릭해 수리중/해제를 선택한 뒤 확인을 누르세요."
                  : rentalTvuMode
                    ? "임대 장비 섹션의 확인/취소 버튼으로 변경을 마무리하세요."
                    : "대여중/수리중 장비는 선택할 수 없습니다."}
              </span>
            </div>
            <div className={styles.actionButtons}>
              {repairMode ? (
                <>
                  <button type="button" className="btn primary" disabled={repairChangeCount === 0 || actionPending} onClick={confirmRepair}>
                    확인
                  </button>
                  <button type="button" className="btn" disabled={actionPending} onClick={cancelRepairMode}>
                    취소
                  </button>
                </>
              ) : rentalTvuMode ? null : (
                <>
                  <button type="button" className="btn primary" disabled={!canMutate || selectedIds.length === 0 || actionPending} onClick={openBorrowDialog}>
                    대여하기
                  </button>
                  {hasBorrowSelectionDraft ? (
                    <button type="button" className="btn" disabled={actionPending} onClick={clearBorrowSelection}>
                      선택 초기화
                    </button>
                  ) : null}
                  {canManageRepair ? (
                    <button type="button" className={`btn ${styles.repairButton}`} disabled={actionPending} onClick={openRepairMode}>
                      수리
                    </button>
                  ) : null}
                  {returnableItems.length > 0 ? (
                    <button type="button" className="btn" disabled={!canReturnEquipment || actionPending} onClick={openReturnDialog}>
                      반납하기
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {loading ? (
            <LoadingBlocks />
          ) : isEngSetPage ? (
            <div className={styles.memberGrid}>
              {sharedEngSetItems.map((item) => {
                const loanItem = currentByItemId.get(item.id);
                const selected = selectedIds.includes(item.id);
                const repairTarget = repairDraftByItemId[item.id] ?? item.isUnderRepair;
                const repairChanged = repairMode && repairTarget !== item.isUnderRepair;
                const repairing = repairMode ? repairTarget : item.isUnderRepair;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={[
                      styles.memberCard,
                      selected && !repairMode ? styles.itemCardSelected : "",
                      loanItem ? styles.itemCardBorrowed : "",
                      repairing ? styles.itemCardRepairing : "",
                      repairChanged ? styles.itemCardRepairPending : "",
                    ].join(" ").trim()}
                    disabled={Boolean(loanItem) || (!repairMode && repairing)}
                    onClick={() => (repairMode ? toggleRepairDraft(item.id) : toggleSelection(item.id))}
                    aria-pressed={repairMode ? repairChanged : selected}
                  >
                    <span className={styles.itemCardTop}>
                      <strong>{getEquipmentDisplayName(item)}</strong>
                      {repairChanged ? (
                        <span className={`${styles.statusPill} ${repairing ? styles.statusRepairing : styles.statusAvailable}`.trim()}>
                          {repairing ? "수리 예정" : "해제 예정"}
                        </span>
                      ) : (
                        <StatusPill borrowed={Boolean(loanItem)} repairing={repairing} />
                      )}
                    </span>
                    {loanItem ? (
                      <span className={styles.borrowedMeta}>{loanItem.loan.borrowerName} · {formatDateTime(loanItem.borrowedAt)}</span>
                    ) : null}
                  </button>
                );
              })}
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
                    disabled={repairMode || Boolean(loanItem)}
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
            <CameraGroups
              items={activeVisibleItems}
              selectedIds={repairMode ? [] : selectedIds}
              currentByItemId={currentByItemId}
              onToggle={repairMode ? toggleRepairDraft : toggleSelection}
              repairMode={repairMode}
              repairDraftByItemId={repairDraftByItemId}
            />
          ) : category === "live" ? (
            <>
              <LiveEquipmentGroups
                items={activeLiveBorrowableOrRentalItems}
                selectedIds={repairMode || rentalTvuMode ? [] : selectedIds}
                currentByItemId={currentByItemId}
                selectedTrsValues={rentalTvuMode ? [] : selectedTrsValues}
                onTrsToggle={(trs) => setLiveDetails((current) => ({ ...current, trs: toggleSelectedTrs(current.trs, trs) }))}
                onToggle={rentalTvuMode ? () => undefined : repairMode ? toggleRepairDraft : toggleSelection}
                repairMode={repairMode}
                repairDraftByItemId={repairDraftByItemId}
                rentalTvuMode={rentalTvuMode}
                rentalTvuSelectedIds={rentalTvuSelectionIds}
                onRentalTvuToggle={toggleRentalTvuSelection}
                canManageTvuGrid={canManageTvuGrid}
                gridPendingItemId={gridPendingItemId}
                onTvuGridToggle={toggleTvuGrid}
              />
              {canViewRegionalTransmissionItems ? (
                <RegionalTransmissionSection
                  items={activeRegionalTransmissionItems}
                  currentByItemId={currentByItemId}
                  onToggle={repairMode ? toggleRepairDraft : () => undefined}
                  repairMode={repairMode}
                  repairDraftByItemId={repairDraftByItemId}
                />
              ) : null}
              {canManageRentalTvu ? (
                <RentalTvuSection
                  inactiveItems={inactiveRentalTvuItems}
                  activeItems={activeRentalTvuItems}
                  mode={rentalTvuMode}
                  selectedIds={rentalTvuSelectionIds}
                  canManage={canManageRentalTvu}
                  canManageTvuGrid={canManageTvuGrid}
                  gridPendingItemId={gridPendingItemId}
                  actionPending={actionPending}
                  editingItemId={rentalTvuEditItemId}
                  editName={rentalTvuEditName}
                  onModeStart={openRentalTvuMode}
                  onModeCancel={cancelRentalTvuMode}
                  onModeConfirm={confirmRentalTvuMode}
                  onSelectionToggle={toggleRentalTvuSelection}
                  onTvuGridToggle={toggleTvuGrid}
                  onEditStart={startRentalTvuRename}
                  onEditNameChange={setRentalTvuEditName}
                  onEditConfirm={confirmRentalTvuRename}
                  onEditCancel={cancelRentalTvuRename}
                />
              ) : null}
            </>
          ) : (
            <div className={styles.sectionStack}>
              {renderGroupedItems({
                items: activeVisibleItems,
                selectedIds: repairMode ? [] : selectedIds,
                currentByItemId,
                onToggle: repairMode ? toggleRepairDraft : toggleSelection,
                repairMode,
                repairDraftByItemId,
              })}
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
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [dateKey, setDateKey] = useState(getTodayDateKey);
  const [currentLoanItems, setCurrentLoanItems] = useState<EquipmentLoanItem[]>([]);
  const [dailyRecords, setDailyRecords] = useState<EquipmentLoanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);
  const showEquipmentStatusLink = canViewEquipmentStatus(session);

  const load = useCallback(async () => {
    if (!showEquipmentStatusLink) {
      setCurrentLoanItems([]);
      setDailyRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextCurrent, nextRecords] = await Promise.all([
        fetchEquipmentLoanItems({ status: "borrowed" }),
        fetchEquipmentLoanItems({ dateKey }),
      ]);
      setCurrentLoanItems(nextCurrent);
      setDailyRecords(nextRecords);
      setMessage(null);
      setSession(getSession());
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "장비대여현황을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, [dateKey, showEquipmentStatusLink]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToAuth(setSession), []);

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
        activeHref="/equipment/status"
        showStatusLink={showEquipmentStatusLink}
      />
      {!showEquipmentStatusLink ? (
        <div className="status warn">장비대여현황은 DESK, 총괄팀장, 관리자만 볼 수 있습니다.</div>
      ) : null}
      {showEquipmentStatusLink ? (
        <>
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
        </>
      ) : null}
    </section>
  );
}

export function LiveEquipmentStatusHomePanel() {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [currentLoanItems, setCurrentLoanItems] = useState<EquipmentLoanItem[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<LiveStatusDraftByItemId>({});
  const [electionOverlays, setElectionOverlays] = useState<ElectionTvuOverlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextItems, nextCurrent, nextStatusEntries, nextElectionOverlays] = await Promise.all([
        fetchEquipmentItems(["live"]),
        fetchEquipmentLoanItems({ categories: ["live"], status: "borrowed" }),
        fetchLiveEquipmentStatusEntries(),
        fetchTodayElectionTvuOverlays(),
      ]);
      setItems(nextItems);
      setCurrentLoanItems(nextCurrent);
      setSavedDrafts(createLiveStatusDraftByItemId(nextStatusEntries));
      setElectionOverlays(nextElectionOverlays);
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
  const electionOverlayByTvuName = useMemo(() => buildElectionTvuOverlayMap(electionOverlays), [electionOverlays]);
  const tvuItems = useMemo(() => items.filter((item) => isTvuItem(item) && !isRegionalTransmissionTvuItem(item)), [items]);

  return (
    <section className={`${styles.page} ${styles.liveStatusPage}`}>
      <article className={`${styles.liveStatusBoard} ${styles.liveStatusHomeBoard}`}>
        <div className={styles.liveStatusTop}>
          <div className={styles.liveStatusHeading}>
            <span className={styles.liveStatusBadge}>라이브장비 상황판</span>
          </div>
        </div>
        {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        {loading ? (
          <LoadingBlocks />
        ) : (
          <div className={styles.liveStatusTableStack}>
            <section className={styles.liveStatusTableSection}>
              <div className={styles.groupHead}>
                <h3>라이브장비</h3>
                <span>{tvuItems.length}개</span>
              </div>
              {tvuItems.length > 0 ? (
                <div className={styles.liveStatusTableWrap}>
                  <table className={styles.liveStatusTable}>
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
                        const electionOverlay = getElectionOverlayForItem(item, electionOverlayByTvuName);
                        const draft = applyElectionOverlayToLiveDraft(resolveLiveStatusDraft(savedDrafts[item.id], loanItem), electionOverlay);
                        return (
                          <tr key={item.id}>
                            <td>
                              <span className={styles.itemNameStack}>
                                <strong>{getEquipmentDisplayName(item)}</strong>
                                {electionOverlay ? (
                                  <>
                                    <span className={styles.globalBadge}>선거</span>
                                    <span className={styles.regionalBadge}>자동연동</span>
                                  </>
                                ) : null}
                                {isGlobalTvuItem(item) ? (
                                  <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                                    Global
                                  </span>
                                ) : null}
                                {isGridTvuItem(item) ? (
                                  <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                                    Grid
                                  </span>
                                ) : null}
                                {isRentalTvuItem(item) ? (
                                  <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                                    임대
                                  </span>
                                ) : null}
                                {electionOverlay?.equipmentType === "rental" && !isRentalTvuItem(item) ? (
                                  <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                                    임대
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td>
                              <span className={styles.liveStatusCellValue}>{draft.trs || "-"}</span>
                            </td>
                            <td>
                              <span className={styles.liveStatusCellValue}>{draft.cameraReporter || "-"}</span>
                            </td>
                            <td>
                              <span className={styles.liveStatusCellValue}>{draft.audioMan || "-"}</span>
                            </td>
                            <td>
                              <span className={styles.liveStatusCellValue}>{draft.location || "-"}</span>
                            </td>
                            <td>
                              <span className={styles.liveStatusCellValue}>{draft.note || "-"}</span>
                            </td>
                            <td>
                              <StatusPill borrowed={Boolean(loanItem || electionOverlay)} repairing={item.isUnderRepair} borrowedLabel={electionOverlay ? "선거중계" : "대여중"} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="status note">라이브장비 표시 대상이 없습니다.</div>
              )}
            </section>
          </div>
        )}
      </article>
    </section>
  );
}

export function LiveEquipmentStatusPage() {
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [currentLoanItems, setCurrentLoanItems] = useState<EquipmentLoanItem[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<LiveStatusDraftByItemId>({});
  const [drafts, setDrafts] = useState<LiveStatusDraftByItemId>({});
  const [editBaselineDrafts, setEditBaselineDrafts] = useState<LiveStatusDraftByItemId>({});
  const [electionOverlays, setElectionOverlays] = useState<ElectionTvuOverlay[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextItems, nextCurrent, nextStatusEntries, nextElectionOverlays] = await Promise.all([
        fetchEquipmentItems(["live"]),
        fetchEquipmentLoanItems({ categories: ["live"], status: "borrowed" }),
        fetchLiveEquipmentStatusEntries(),
        fetchTodayElectionTvuOverlays(),
      ]);
      const nextDrafts = createLiveStatusDraftByItemId(nextStatusEntries);
      setItems(nextItems);
      setCurrentLoanItems(nextCurrent);
      setSavedDrafts(nextDrafts);
      setDrafts(nextDrafts);
      setEditBaselineDrafts({});
      setElectionOverlays(nextElectionOverlays);
      setEditMode(false);
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

  useEffect(() => {
    return subscribeToAuth((nextSession) => {
      setSession(nextSession);
    });
  }, []);

  const currentByItemId = useMemo(
    () => new Map(currentLoanItems.map((loanItem) => [loanItem.equipmentItemId, loanItem] as const)),
    [currentLoanItems],
  );
  const electionOverlayByTvuName = useMemo(() => buildElectionTvuOverlayMap(electionOverlays), [electionOverlays]);
  const regionalTvuItems = useMemo(() => items.filter(isRegionalTransmissionTvuItem), [items]);
  const tvuItems = useMemo(() => items.filter((item) => isTvuItem(item) && !isRegionalTransmissionTvuItem(item)), [items]);
  const statusBoardItems = useMemo(() => [...tvuItems, ...regionalTvuItems], [regionalTvuItems, tvuItems]);
  const canManageLiveStatus = Boolean(session?.approved && hasDeskAccess(session.role));
  const hasDirtyDrafts = useMemo(() => (
    editMode && statusBoardItems.some((item) => !liveStatusDraftsEqual(drafts[item.id], editBaselineDrafts[item.id]))
  ), [drafts, editBaselineDrafts, editMode, statusBoardItems]);
  const buildDisplayDrafts = useCallback(() => (
    statusBoardItems.reduce<LiveStatusDraftByItemId>((map, item) => {
      map[item.id] = resolveLiveStatusDraft(savedDrafts[item.id], currentByItemId.get(item.id));
      return map;
    }, {})
  ), [currentByItemId, savedDrafts, statusBoardItems]);
  const updateDraft = (itemId: string, field: keyof LiveLoanDetails, value: string) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? liveDetailEmpty),
        [field]: value,
      },
    }));
  };
  const startStatusBoardEdit = () => {
    const nextDrafts = buildDisplayDrafts();
    setDrafts(nextDrafts);
    setEditBaselineDrafts(nextDrafts);
    setEditMode(true);
    setMessage(null);
  };
  const confirmStatusBoardEdit = async () => {
    if (!canManageLiveStatus) {
      setMessage({ tone: "warn", text: "라이브장비 현황판 저장 권한이 없습니다." });
      return;
    }
    if (!hasDirtyDrafts) {
      setEditMode(false);
      setDrafts(savedDrafts);
      setEditBaselineDrafts({});
      setMessage(null);
      return;
    }
    const payload = statusBoardItems.map((item): LiveEquipmentStatusSaveEntry => ({
      equipmentItemId: item.id,
      ...stripLinkedLiveStatusDraft(drafts[item.id], currentByItemId.get(item.id)),
    }));
    setSaving(true);
    try {
      await saveLiveEquipmentStatusEntries(payload);
      const nextDrafts = payload.reduce<LiveStatusDraftByItemId>((map, entry) => {
        map[entry.equipmentItemId] = normalizeLiveStatusDraft(entry);
        return map;
      }, {});
      setSavedDrafts(nextDrafts);
      setDrafts(nextDrafts);
      setEditBaselineDrafts({});
      setEditMode(false);
      setMessage({ tone: "ok", text: "라이브장비 현황판을 저장했습니다." });
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "라이브장비 현황판 저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };
  const resetStatusBoard = () => {
    setDrafts(savedDrafts);
    setEditBaselineDrafts({});
    setEditMode(false);
    setMessage({ tone: "note", text: "수정을 취소했습니다." });
  };

  const renderLiveStatusTable = (tableItems: EquipmentItem[], title: string, isRegionalTable = false) => (
    <section className={styles.liveStatusTableSection}>
      <div className={styles.groupHead}>
        <h3>{title}</h3>
        <span>{tableItems.length}개</span>
      </div>
      {tableItems.length > 0 ? (
        <div className={styles.liveStatusTableWrap}>
          <table className={styles.liveStatusTable}>
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
              {tableItems.map((item) => {
                const loanItem = currentByItemId.get(item.id);
                const electionOverlay = getElectionOverlayForItem(item, electionOverlayByTvuName);
                const baseDisplayDraft = resolveLiveStatusDraft(savedDrafts[item.id], loanItem);
                const displayDraft = applyElectionOverlayToLiveDraft(baseDisplayDraft, electionOverlay);
                const draft = editMode ? drafts[item.id] ?? baseDisplayDraft : displayDraft;
                const dirty = editMode && !liveStatusDraftsEqual(draft, editBaselineDrafts[item.id]);
                const noteValue = draft.note || "-";
                return (
                  <tr key={item.id} className={dirty ? styles.liveStatusDirtyRow : ""}>
                    <td>
                      <span className={styles.itemNameStack}>
                        <strong>{getEquipmentDisplayName(item)}</strong>
                        {electionOverlay ? (
                          <>
                            <span className={styles.globalBadge}>선거</span>
                            <span className={styles.regionalBadge}>자동연동</span>
                          </>
                        ) : null}
                        {isGlobalTvuItem(item) ? (
                          <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                            Global
                          </span>
                        ) : null}
                        {isGridTvuItem(item) ? (
                          <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                            Grid
                          </span>
                        ) : null}
                        {isRentalTvuItem(item) ? (
                          <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                            임대
                          </span>
                        ) : null}
                        {electionOverlay?.equipmentType === "rental" && !isRentalTvuItem(item) ? (
                          <span className={styles.globalBadge} style={{ background: vacationStyleTones["대휴"].background }}>
                            임대
                          </span>
                        ) : null}
                        {isRegionalTransmissionTvuItem(item) ? (
                          <span className={styles.regionalBadge}>
                            지역
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          className={styles.liveStatusInput}
                          aria-label={`${getEquipmentDisplayName(item)} TRS`}
                          maxLength={120}
                          value={draft.trs}
                          onChange={(event) => updateDraft(item.id, "trs", event.target.value)}
                          disabled={!canManageLiveStatus || saving}
                          placeholder="-"
                        />
                      ) : (
                        <span className={styles.liveStatusCellValue}>{draft.trs || "-"}</span>
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          className={styles.liveStatusInput}
                          aria-label={`${getEquipmentDisplayName(item)} 촬영기자`}
                          maxLength={120}
                          value={draft.cameraReporter}
                          onChange={(event) => updateDraft(item.id, "cameraReporter", event.target.value)}
                          disabled={!canManageLiveStatus || saving}
                          placeholder="-"
                        />
                      ) : (
                        <span className={styles.liveStatusCellValue}>{draft.cameraReporter || "-"}</span>
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          className={styles.liveStatusInput}
                          aria-label={`${getEquipmentDisplayName(item)} 오디오맨`}
                          maxLength={120}
                          value={draft.audioMan}
                          onChange={(event) => updateDraft(item.id, "audioMan", event.target.value)}
                          disabled={!canManageLiveStatus || saving}
                          placeholder="-"
                        />
                      ) : (
                        <span className={styles.liveStatusCellValue}>{draft.audioMan || "-"}</span>
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          className={styles.liveStatusInput}
                          aria-label={`${getEquipmentDisplayName(item)} 장소`}
                          maxLength={160}
                          value={draft.location}
                          onChange={(event) => updateDraft(item.id, "location", event.target.value)}
                          disabled={!canManageLiveStatus || saving}
                          placeholder="-"
                        />
                      ) : (
                        <span className={styles.liveStatusCellValue}>{draft.location || "-"}</span>
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input
                          className={styles.liveStatusInput}
                          aria-label={`${getEquipmentDisplayName(item)} 비고`}
                          maxLength={240}
                          value={draft.note}
                          onChange={(event) => updateDraft(item.id, "note", event.target.value)}
                          disabled={!canManageLiveStatus || saving}
                          placeholder="-"
                        />
                      ) : (
                        <span className={styles.liveStatusCellValue}>{noteValue}</span>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        borrowed={Boolean(loanItem || electionOverlay)}
                        repairing={item.isUnderRepair}
                        availableLabel={isRegionalTable ? "사용 가능" : "대여가능"}
                        borrowedLabel={electionOverlay ? "선거중계" : "대여중"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="status note">{title} 표시 대상이 없습니다.</div>
      )}
    </section>
  );

  return (
    <section className={`${styles.page} ${styles.liveStatusPage}`}>
      <article className={styles.liveStatusBoard}>
        <div className={styles.liveStatusTop}>
          <div className={styles.liveStatusHeading}>
            <span className={styles.liveStatusBadge}>라이브장비 상황판</span>
          </div>
          <EquipmentNav activeHref="/equipment/live-status" showStatusLink={canViewEquipmentStatus(session)} />
        </div>
        <div className={styles.liveStatusToolbar}>
          {editMode ? <p>{hasDirtyDrafts ? "확인 전 변경사항이 있습니다." : "수정할 값을 입력한 뒤 확인하세요."}</p> : null}
          {canManageLiveStatus ? (
            <div className={styles.liveStatusActions}>
              {editMode ? (
                <>
                  <button type="button" className="btn primary" disabled={saving || loading} onClick={confirmStatusBoardEdit}>
                    {saving ? "확인 중" : "확인"}
                  </button>
                  <button type="button" className="btn" disabled={saving || loading} onClick={resetStatusBoard}>
                    취소
                  </button>
                </>
              ) : (
                <button type="button" className="btn primary" disabled={saving || loading} onClick={startStatusBoardEdit}>
                  수정
                </button>
              )}
            </div>
          ) : null}
        </div>
        {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        {loading ? (
          <LoadingBlocks />
        ) : (
          <div className={styles.liveStatusTableStack}>
            {renderLiveStatusTable(tvuItems, "라이브장비")}
            {renderLiveStatusTable(regionalTvuItems, "지역 전송장비", true)}
          </div>
        )}
      </article>
    </section>
  );
}
