"use client";

import { useEffect, useId, useState } from "react";
import { HomeNewsCard } from "@/components/home/HomeNewsCard";
import styles from "@/components/home/HomeNews.module.css";
import {
  HOME_NEWS_CATEGORIES,
  HOME_NEWS_CATEGORY_LABELS,
  HomeNewsCardsByCategory,
  HomeNewsCategory,
} from "@/components/home/home-news.types";

function getInitialCategory(cardsByCategory: Partial<HomeNewsCardsByCategory>) {
  return HOME_NEWS_CATEGORIES.find((category) => (cardsByCategory[category] ?? []).length > 0) ?? HOME_NEWS_CATEGORIES[0];
}

type HomeNewsTabsProps = {
  cardsByCategory: Partial<HomeNewsCardsByCategory>;
  recommendedCategory?: HomeNewsCategory;
  loading?: boolean;
  togglingPreferenceId?: string | null;
  onSetPreference?: (itemId: string, nextPreference: "like" | "dislike" | null) => void;
};

export function HomeNewsTabs({
  cardsByCategory,
  recommendedCategory,
  loading = false,
  togglingPreferenceId = null,
  onSetPreference,
}: HomeNewsTabsProps) {
  const groupId = useId();
  const [activeCategory, setActiveCategory] = useState<HomeNewsCategory>(() => recommendedCategory ?? getInitialCategory(cardsByCategory));
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = useState(false);
  const items = cardsByCategory[activeCategory] ?? [];

  useEffect(() => {
    const nextCategory = recommendedCategory ?? getInitialCategory(cardsByCategory);
    const currentItems = cardsByCategory[activeCategory] ?? [];
    if (currentItems.length === 0 && (cardsByCategory[nextCategory] ?? []).length > 0) {
      setActiveCategory(nextCategory);
    }
  }, [activeCategory, cardsByCategory, recommendedCategory]);

  useEffect(() => {
    setExpandedCardId(null);
  }, [activeCategory]);

  useEffect(() => {
    if (!recommendedCategory || hasUserSelectedCategory) return;
    if ((cardsByCategory[recommendedCategory] ?? []).length === 0) return;
    setActiveCategory(recommendedCategory);
  }, [cardsByCategory, hasUserSelectedCategory, recommendedCategory]);

  return (
    <div className={styles.tabs}>
      <div className={styles.tabList} role="tablist" aria-label="뉴스 카테고리">
        {HOME_NEWS_CATEGORIES.map((category) => {
          const isActive = category === activeCategory;
          return (
            <button
              key={category}
              id={`${groupId}-${category}-tab`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${groupId}-${category}-panel`}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ""}`}
              onClick={() => {
                setHasUserSelectedCategory(true);
                setActiveCategory(category);
              }}
            >
              <span>{HOME_NEWS_CATEGORY_LABELS[category]}</span>
              <span className={styles.tabCount}>{(cardsByCategory[category] ?? []).length}</span>
            </button>
          );
        })}
      </div>
      <div
        id={`${groupId}-${activeCategory}-panel`}
        role="tabpanel"
        aria-labelledby={`${groupId}-${activeCategory}-tab`}
        className={styles.panel}
      >
        {loading ? (
          <div className={styles.grid}>
            {[0, 1].map((item) => (
              <div key={item} className={styles.cardSkeleton} aria-hidden="true" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className={styles.grid}>
            {items.map((item) => (
              <HomeNewsCard
                key={item.id}
                item={item}
                expanded={expandedCardId === item.id}
                onToggle={() => setExpandedCardId((current) => (current === item.id ? null : item.id))}
                togglingPreference={togglingPreferenceId === item.id}
                onSetPreference={
                  onSetPreference
                    ? (nextPreference) => onSetPreference(item.id, nextPreference)
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty} role="status" aria-live="polite">
            <strong>아직 들어온 브리핑이 없습니다.</strong>
            <p>실제 뉴스 데이터가 연결되면 이 자리에서 카테고리별 핵심 카드가 바로 보입니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
