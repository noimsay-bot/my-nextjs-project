"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMyScheduleAssignmentsWithPartnerInfo, type MyScheduleAssignmentItem } from "@/lib/corporate-card/storage";
import { formatDateLabel, getCurrentMonthKey } from "@/lib/corporate-card/schedule";
import styles from "./CorporateCard.module.css";

function groupByDate(items: MyScheduleAssignmentItem[]) {
  return items.reduce((map, item) => {
    const existing = map.get(item.scheduleDate) ?? [];
    existing.push(item);
    map.set(item.scheduleDate, existing);
    return map;
  }, new Map<string, MyScheduleAssignmentItem[]>());
}

export function MyAssignmentsPage() {
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey);
  const [items, setItems] = useState<MyScheduleAssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    fetchMyScheduleAssignmentsWithPartnerInfo(monthKey)
      .then((nextItems) => {
        if (cancelled) return;
        setItems(nextItems);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "내 일정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  const grouped = useMemo(() => groupByDate(items), [items]);
  const [year, month] = monthKey.split("-");

  const copyMemo = async (item: MyScheduleAssignmentItem) => {
    await navigator.clipboard.writeText(item.generatedText);
    setCopiedId(item.scheduleItemId);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <section className={styles.page}>
      <article className="panel">
        <div className="panel-pad">
          <div className={styles.toolbar}>
            <div className={styles.header}>
              <span className="chip">내 일정</span>
              <h1 className={styles.title}>{year}년 {Number(month)}월 내 일정</h1>
              <p className={styles.description}>내 일정과 파트너 입력 정보를 확인하고 법인카드 자동문구를 바로 복사합니다.</p>
            </div>
            <label className={styles.field}>
              <span>월 선택</span>
              <input className="field-input" type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value)} />
            </label>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad">
          {message ? <div className="status warn">{message}</div> : null}
          {loading ? <div className="status note">내 일정을 불러오는 중입니다.</div> : null}
          {!loading && !items.length ? <div className="status note">이 달에 배정된 내 일정이 없습니다.</div> : null}
          <div className={styles.list}>
            {Array.from(grouped.entries()).map(([dateKey, dayItems]) => (
              <section key={dateKey} className={styles.dayBlock}>
                <h2 className={styles.dayTitle}>{formatDateLabel(dateKey)}</h2>
                {dayItems.map((item) => (
                  <article key={item.scheduleItemId} className={styles.itemCard}>
                    <div className={styles.itemHead}>
                      <strong className={styles.itemTitle}>{item.scheduleContent}</strong>
                    </div>
                    <div className={styles.metaGrid}>
                      <div className={styles.metaItem}>
                        <span>오디오맨</span>
                        <strong>{item.audioManName || "파트너 입력 대기"}</strong>
                      </div>
                      <div className={styles.metaItem}>
                        <span>형님</span>
                        <strong>{item.seniorName || "파트너 입력 대기"}</strong>
                      </div>
                    </div>
                    {item.missingFields.length > 0 ? (
                      <span className={styles.pending}>누락: {item.missingFields.join(", ")}</span>
                    ) : null}
                    <div className={styles.memoBox}>
                      <strong>자동문구</strong>
                      <p className={styles.memoText}>{item.generatedText}</p>
                    </div>
                    <div className={styles.actions}>
                      <button type="button" className="btn primary" onClick={() => copyMemo(item)} disabled={!item.generatedText}>
                        {copiedId === item.scheduleItemId ? "복사됨" : "복사"}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}
