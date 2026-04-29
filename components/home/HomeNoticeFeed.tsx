"use client";

import { useEffect, useRef, useState } from "react";
import { HomeNewsCard } from "@/components/home/HomeNewsCard";
import { HomeNewsCardItem } from "@/components/home/home-news.types";
import styles from "@/components/home/HomeNews.module.css";

type HomeNoticeFeedProps = {
  items: HomeNewsCardItem[];
  loading?: boolean;
  requestedOpenItemId?: string | null;
  requestedOpenToken?: number;
  canDeleteNotice?: boolean;
  deletingNoticeId?: string | null;
  onDeleteNotice?: (itemId: string) => void;
};

export function HomeNoticeFeed({
  items,
  loading = false,
  requestedOpenItemId = null,
  requestedOpenToken = 0,
  canDeleteNotice = false,
  deletingNoticeId = null,
  onDeleteNotice,
}: HomeNoticeFeedProps) {
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!requestedOpenItemId) return;
    if (!items.some((item) => item.id === requestedOpenItemId)) return;
    setExpandedCardId(requestedOpenItemId);
  }, [items, requestedOpenItemId, requestedOpenToken]);

  useEffect(() => {
    if (!requestedOpenItemId) return;
    if (expandedCardId !== requestedOpenItemId) return;

    const handle = window.requestAnimationFrame(() => {
      cardRefs.current.get(requestedOpenItemId)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [expandedCardId, requestedOpenItemId, requestedOpenToken]);

  if (loading) {
    return (
      <div className={styles.grid} aria-hidden="true">
        {[0, 1].map((item) => (
          <div key={item} className={styles.cardSkeleton} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty} role="status" aria-live="polite">
        <strong>등록된 공지가 없습니다.</strong>
        <p>새 공지가 등록되면 제목과 본문이 이 영역에 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        {items.map((item) => (
          <div
            key={item.id}
            ref={(node) => {
              if (node) {
                cardRefs.current.set(item.id, node);
                return;
              }
              cardRefs.current.delete(item.id);
            }}
          >
            <HomeNewsCard
              item={item}
              expanded={expandedCardId === item.id}
              onToggle={() => setExpandedCardId((current) => (current === item.id ? null : item.id))}
              canDeleteNotice={canDeleteNotice && Boolean(item.noticeId)}
              deletingNotice={deletingNoticeId === item.id}
              onDeleteNotice={onDeleteNotice ? () => onDeleteNotice(item.id) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
