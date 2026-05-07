"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchPartnerScheduleAssignments,
  savePartnerScheduleEntry,
  type PartnerScheduleAssignment,
} from "@/lib/corporate-card/storage";
import { formatDateLabel } from "@/lib/corporate-card/schedule";
import styles from "./CorporateCard.module.css";

function getTodayDateKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

const AUTO_SAVE_DELAY_MS = 500;

export function PartnerAssignmentsPage() {
  const [dateKey, setDateKey] = useState(getTodayDateKey);
  const [items, setItems] = useState<PartnerScheduleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const itemsRef = useRef<PartnerScheduleAssignment[]>([]);
  const autoSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = async (targetDateKey = dateKey) => {
    setLoading(true);
    setMessage("");
    try {
      const nextItems = await fetchPartnerScheduleAssignments(targetDateKey);
      itemsRef.current = nextItems;
      setItems(nextItems);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파트너 일정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(dateKey);
  }, [dateKey]);

  useEffect(() => {
    return () => {
      Object.values(autoSaveTimersRef.current).forEach((timer) => clearTimeout(timer));
      autoSaveTimersRef.current = {};
    };
  }, []);

  const persistItem = async (item: PartnerScheduleAssignment) => {
    const existingTimer = autoSaveTimersRef.current[item.scheduleItemId];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete autoSaveTimersRef.current[item.scheduleItemId];
    }

    setSavingId(item.scheduleItemId);
    setMessage("");
    try {
      await savePartnerScheduleEntry(item);
      setMessage("파트너 정보를 자동 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파트너 정보를 자동 저장하지 못했습니다.");
    } finally {
      setSavingId((current) => (current === item.scheduleItemId ? null : current));
    }
  };

  const queueAutoSave = (item: PartnerScheduleAssignment) => {
    const existingTimer = autoSaveTimersRef.current[item.scheduleItemId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    autoSaveTimersRef.current[item.scheduleItemId] = setTimeout(() => {
      void persistItem(item);
    }, AUTO_SAVE_DELAY_MS);
  };

  const updateItem = (scheduleItemId: string, patch: Partial<PartnerScheduleAssignment>) => {
    const nextItems = itemsRef.current.map((item) =>
      item.scheduleItemId === scheduleItemId ? { ...item, ...patch } : item,
    );
    const nextItem = nextItems.find((item) => item.scheduleItemId === scheduleItemId);

    itemsRef.current = nextItems;
    setItems(nextItems);

    if (nextItem) {
      queueAutoSave(nextItem);
    }
  };

  const saveImmediately = (scheduleItemId: string) => {
    const item = itemsRef.current.find((currentItem) => currentItem.scheduleItemId === scheduleItemId);
    if (!item) return;
    void persistItem(item);
  };

  return (
    <section className={styles.page}>
      <article className="panel">
        <div className="panel-pad">
          <div className={styles.toolbar}>
            <div className={styles.header}>
              <span className="chip">일정</span>
              <h1 className={styles.title}>{formatDateLabel(dateKey)} 일정</h1>
              <p className={styles.description}>선택한 날짜의 일정에 오디오맨과 형님 이름을 입력합니다.</p>
            </div>
            <label className={styles.field}>
              <span>날짜</span>
              <input className="field-input" type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
            </label>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad">
          {message ? <div className="status note">{message}</div> : null}
          {loading ? <div className="status note">일정을 불러오는 중입니다.</div> : null}
          {!loading && !items.length ? <div className="status note">선택한 날짜에 입력할 일정이 없습니다.</div> : null}
          <div className={styles.list}>
            {items.map((item) => (
              <article key={item.scheduleItemId} className={styles.itemCard}>
                <div className={styles.partnerItemBody}>
                  <div className={styles.partnerScheduleSummary}>
                    <span className="muted">{formatDateLabel(item.scheduleDate)}</span>
                    <div className={styles.photographerLine}>
                      <span>촬영기자</span>
                      <strong>{item.photographerName || "미지정"}</strong>
                    </div>
                    <strong className={styles.itemTitle}>{item.scheduleContent}</strong>
                  </div>
                  <div className={styles.partnerInputPanel}>
                    <div className={styles.inputGrid}>
                      <label className={styles.field}>
                        <span>오디오맨</span>
                        <input
                          className="field-input"
                          value={item.audioManName}
                          onChange={(event) => updateItem(item.scheduleItemId, { audioManName: event.target.value })}
                          onBlur={() => saveImmediately(item.scheduleItemId)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>형님</span>
                        <input
                          className="field-input"
                          value={item.seniorName}
                          onChange={(event) => updateItem(item.scheduleItemId, { seniorName: event.target.value })}
                          onBlur={() => saveImmediately(item.scheduleItemId)}
                        />
                      </label>
                    </div>
                    {savingId === item.scheduleItemId ? (
                      <span className={styles.autoSaveStatus}>자동 저장 중</span>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}
