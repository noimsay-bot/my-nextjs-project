"use client";

import { normalizeTvuEquipmentName } from "@/lib/election/storage";
import type { ElectionTvuOverlay } from "@/lib/election/types";
import type { EquipmentItem, EquipmentLoanItem, LiveEquipmentStatusEntry, LiveLoanDetails } from "@/lib/equipment/types";
import styles from "./Equipment.module.css";

type LiveStatusDraftByItemId = Record<string, LiveLoanDetails>;

export function isTvuItem(item: EquipmentItem) {
  return item.category === "live" && item.groupName.trim().toUpperCase() === "TVU";
}

export function getTvuNumber(item: EquipmentItem) {
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

export function formatTvuDisplayName(name: string) {
  const matched = /^TVU\s*-?\s*(\d+)$/i.exec(name.trim());
  if (!matched) return name;
  return `TVU-${Number(matched[1])}`;
}

export function getEquipmentDisplayName(item: EquipmentItem) {
  return isTvuItem(item) ? formatTvuDisplayName(item.name) : item.name;
}

export function isGlobalTvuItem(item: EquipmentItem) {
  const metadataNetwork = typeof item.metadata.network === "string" ? item.metadata.network.trim().toLowerCase() : "";
  if (metadataNetwork === "global") return true;
  const tvuNumber = getTvuNumber(item);
  return tvuNumber !== null && tvuNumber >= 15 && tvuNumber <= 19;
}

export function isGridTvuItem(item: EquipmentItem) {
  return isTvuItem(item) && (item.metadata.grid === true || item.metadata.grid === "true");
}

export function isRentalTvuItem(item: EquipmentItem) {
  if (!isTvuItem(item)) return false;
  if (item.metadata.rental === true || item.metadata.rental === "true") return true;
  return /^live-rental-tvu-\d+$/i.test(item.code.trim());
}

export function isRegionalTransmissionTvuItem(item: EquipmentItem) {
  if (!isTvuItem(item)) return false;
  if (item.metadata.regional_transmission === true || item.metadata.regional_transmission === "true") return true;
  return /^live-regional-tvu-\d+$/i.test(item.code.trim());
}

export function normalizeLiveStatusDraft(value?: Partial<LiveLoanDetails> | null): LiveLoanDetails {
  return {
    trs: value?.trs?.trim() ?? "",
    cameraReporter: value?.cameraReporter?.trim() ?? "",
    audioMan: value?.audioMan?.trim() ?? "",
    location: value?.location?.trim() ?? "",
    note: value?.note?.trim() ?? "",
  };
}

export function liveStatusDraftsEqual(left?: LiveLoanDetails, right?: LiveLoanDetails) {
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

export function hasLiveStatusDraftContent(value?: LiveLoanDetails) {
  const normalized = normalizeLiveStatusDraft(value);
  return Boolean(normalized.trs || normalized.cameraReporter || normalized.audioMan || normalized.location || normalized.note);
}

export function createLiveStatusDraftByItemId(entries: LiveEquipmentStatusEntry[]) {
  return entries.reduce<LiveStatusDraftByItemId>((map, entry) => {
    map[entry.equipmentItemId] = normalizeLiveStatusDraft(entry);
    return map;
  }, {});
}

export function getLoanLiveStatusDraft(loanItem?: EquipmentLoanItem): LiveLoanDetails {
  return {
    trs: loanItem?.loan.liveTrs?.trim() ?? "",
    cameraReporter: loanItem?.loan.liveCameraReporter?.trim() ?? "",
    audioMan: loanItem?.loan.liveAudioMan?.trim() ?? "",
    location: loanItem?.loan.liveLocation?.trim() ?? "",
    note: loanItem?.loan.liveNote?.trim() ?? "",
  };
}

export function resolveLiveStatusDraft(manualDraft: LiveLoanDetails | undefined, loanItem?: EquipmentLoanItem): LiveLoanDetails {
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

export function mergeElectionOverlayText(left: string, right: string) {
  const values = new Set(
    [left, right]
      .flatMap((value) => value.split("/"))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return Array.from(values).join(" / ");
}

export function buildElectionTvuOverlayMap(overlays: ElectionTvuOverlay[]) {
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

export function getElectionOverlayForItem(item: EquipmentItem, overlaysByTvuName: Map<string, ElectionTvuOverlay>) {
  return overlaysByTvuName.get(normalizeTvuEquipmentName(getEquipmentDisplayName(item))) ?? null;
}

export function applyElectionOverlayToLiveDraft(draft: LiveLoanDetails, overlay: ElectionTvuOverlay | null): LiveLoanDetails {
  if (!overlay) return draft;
  return {
    ...draft,
    cameraReporter: overlay.cameraStaffName || draft.cameraReporter,
    location: overlay.place || draft.location,
  };
}

export function LoadingBlocks() {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} className={styles.skeletonCard} />
      ))}
    </div>
  );
}

export function StatusPill({
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
