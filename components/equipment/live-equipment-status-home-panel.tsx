"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchEquipmentItems, fetchEquipmentLoanItems, fetchLiveEquipmentStatusEntries } from "@/lib/equipment/storage";
import { fetchTodayElectionTvuOverlays } from "@/lib/election/storage";
import type { ElectionTvuOverlay } from "@/lib/election/types";
import type { EquipmentItem, EquipmentLoanItem, LiveLoanDetails } from "@/lib/equipment/types";
import { vacationStyleTones } from "@/lib/schedule/vacation-styles";
import {
  applyElectionOverlayToLiveDraft,
  buildElectionTvuOverlayMap,
  createLiveStatusDraftByItemId,
  getElectionOverlayForItem,
  getEquipmentDisplayName,
  hasLiveStatusDraftContent,
  isGlobalTvuItem,
  isGridTvuItem,
  isRegionalTransmissionTvuItem,
  isRentalTvuItem,
  isTvuItem,
  LoadingBlocks,
  resolveLiveStatusDraft,
  StatusPill,
} from "./live-status-shared";
import styles from "./Equipment.module.css";

type Message = { tone: "ok" | "warn" | "note"; text: string };
type LiveStatusDraftByItemId = Record<string, LiveLoanDetails>;

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
                        const hasStatusDraft = hasLiveStatusDraftContent(draft);
                        const borrowedLabel = electionOverlay ? "선거중계" : loanItem ? "대여중" : "사용중";
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
                              <StatusPill borrowed={Boolean(loanItem || electionOverlay || hasStatusDraft)} repairing={item.isUnderRepair} borrowedLabel={borrowedLabel} />
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
