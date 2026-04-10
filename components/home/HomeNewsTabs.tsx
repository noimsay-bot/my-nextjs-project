"use client";

import { useEffect, useId, useState } from "react";
import { HomeNewsCard } from "@/components/home/HomeNewsCard";
import styles from "@/components/home/HomeNews.module.css";
import {
  HOME_NEWS_CATEGORIES,
  HOME_NEWS_CATEGORY_LABELS,
  HomeNewsCardsByCategory,
  HomeNewsCategory,
  HomeNewsTemporarySection,
  HomeNewsTemporarySectionId,
} from "@/components/home/home-news.types";

function getInitialCategory(cardsByCategory: Partial<HomeNewsCardsByCategory>) {
  return HOME_NEWS_CATEGORIES.find((category) => (cardsByCategory[category] ?? []).length > 0) ?? HOME_NEWS_CATEGORIES[0];
}

type HomeNewsTabKey = HomeNewsCategory | HomeNewsTemporarySectionId;

function getInitialTab(
  cardsByCategory: Partial<HomeNewsCardsByCategory>,
  temporarySections: HomeNewsTemporarySection[],
) {
  if (temporarySections.some((section) => section.id === "notice")) {
    return "notice" as HomeNewsTabKey;
  }

  const baseCategory = getInitialCategory(cardsByCategory);
  if ((cardsByCategory[baseCategory] ?? []).length > 0) {
    return baseCategory;
  }

  return temporarySections.find((section) => section.items.length > 0)?.id ?? baseCategory;
}

type HomeNewsTabsProps = {
  cardsByCategory: Partial<HomeNewsCardsByCategory>;
  temporarySections?: HomeNewsTemporarySection[];
  recommendedCategory?: HomeNewsCategory;
  loading?: boolean;
  requestedOpenItemId?: string | null;
  requestedOpenToken?: number;
  togglingPreferenceId?: string | null;
  onSetPreference?: (itemId: string, nextPreference: "like" | "dislike" | null) => void;
};

export function HomeNewsTabs({
  cardsByCategory,
  temporarySections = [],
  recommendedCategory,
  loading = false,
  requestedOpenItemId = null,
  requestedOpenToken = 0,
  togglingPreferenceId = null,
  onSetPreference,
}: HomeNewsTabsProps) {
  const groupId = useId();
  const categoryTabs = HOME_NEWS_CATEGORIES.map((category) => ({
    key: category as HomeNewsTabKey,
    label: HOME_NEWS_CATEGORY_LABELS[category],
    items: cardsByCategory[category] ?? [],
  }));
  const tabs = [
    ...temporarySections.map((section) => ({
      key: section.id as HomeNewsTabKey,
      label: section.label,
      items: section.items,
    })),
    ...categoryTabs,
  ];
  const hasNoticeTab = tabs.some((tab) => tab.key === "notice");
  const [activeCategory, setActiveCategory] = useState<HomeNewsTabKey>(() => getInitialTab(cardsByCategory, temporarySections));
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = useState(false);
  const items = tabs.find((tab) => tab.key === activeCategory)?.items ?? [];
  const isNoticeActive = activeCategory === "notice";

  useEffect(() => {
    const nextCategory = getInitialTab(cardsByCategory, temporarySections);
    const currentItems = tabs.find((tab) => tab.key === activeCategory)?.items ?? [];
    const nextItems = tabs.find((tab) => tab.key === nextCategory)?.items ?? [];
    if (currentItems.length === 0 && nextItems.length > 0) {
      setActiveCategory(nextCategory);
    }
  }, [activeCategory, cardsByCategory, recommendedCategory, tabs, temporarySections]);

  useEffect(() => {
    if (!requestedOpenItemId) return;

    const matchedTab = tabs.find((tab) => tab.items.some((item) => item.id === requestedOpenItemId));
    if (!matchedTab) return;

    setHasUserSelectedCategory(true);
    setActiveCategory(matchedTab.key);
    setExpandedCardId(requestedOpenItemId);
  }, [requestedOpenItemId, requestedOpenToken, tabs]);

  useEffect(() => {
    if (!recommendedCategory || hasUserSelectedCategory || hasNoticeTab) return;
    if ((cardsByCategory[recommendedCategory] ?? []).length === 0) return;
    setActiveCategory(recommendedCategory);
  }, [cardsByCategory, hasNoticeTab, hasUserSelectedCategory, recommendedCategory]);

  return (
    <div className={styles.tabs}>
      <div className={styles.tabList} role="tablist" aria-label="뉴스 카테고리">
        {tabs.map((tab) => {
          const isActive = tab.key === activeCategory;
          return (
            <button
              key={tab.key}
              id={`${groupId}-${tab.key}-tab`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${groupId}-${tab.key}-panel`}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tabButton} ${tab.key === "notice" ? styles.tabButtonNotice : ""} ${isActive ? styles.tabButtonActive : ""} ${tab.key === "notice" && isActive ? styles.tabButtonNoticeActive : ""}`}
              onClick={() => {
                setHasUserSelectedCategory(true);
                setActiveCategory(tab.key);
                setExpandedCardId(null);
              }}
            >
              <span>{tab.label}</span>
              <span className={styles.tabCount}>{tab.items.length}</span>
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
        {loading && !(isNoticeActive && items.length > 0) ? (
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
