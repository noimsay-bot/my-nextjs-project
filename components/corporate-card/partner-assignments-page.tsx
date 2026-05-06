"use client";

import { useEffect, useState } from "react";
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

export function PartnerAssignmentsPage() {
  const [dateKey, setDateKey] = useState(getTodayDateKey);
  const [items, setItems] = useState<PartnerScheduleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = async (targetDateKey = dateKey) => {
    setLoading(true);
    setMessage("");
    try {
      setItems(await fetchPartnerScheduleAssignments(targetDateKey));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파트너 일정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(dateKey);
  }, [dateKey]);

  const updateItem = (scheduleItemId: string, patch: Partial<PartnerScheduleAssignment>) => {
    setItems((current) =>
      current.map((item) => (item.scheduleItemId === scheduleItemId ? { ...item, ...patch } : item)),
    );
  };

  const saveItem = async (item: PartnerScheduleAssignment) => {
    setSavingId(item.scheduleItemId);
    setMessage("");
    try {
      await savePartnerScheduleEntry(item);
      setMessage("파트너 정보를 저장했습니다.");
      await load(dateKey);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파트너 정보를 저장하지 못했습니다.");
    } finally {
      setSavingId(null);
    }
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
                <div className={styles.itemHead}>
                  <span className="muted">{formatDateLabel(item.scheduleDate)}</span>
                  <strong className={styles.itemTitle}>{item.scheduleContent}</strong>
                </div>
                <div className={styles.inputGrid}>
                  <label className={styles.field}>
                    <span>오디오맨</span>
                    <input
                      className="field-input"
                      value={item.audioManName}
                      onChange={(event) => updateItem(item.scheduleItemId, { audioManName: event.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>형님</span>
                    <input
                      className="field-input"
                      value={item.seniorName}
                      onChange={(event) => updateItem(item.scheduleItemId, { seniorName: event.target.value })}
                    />
                  </label>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={savingId === item.scheduleItemId}
                    onClick={() => saveItem(item)}
                  >
                    저장
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}
