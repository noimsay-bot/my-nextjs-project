"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  canDeleteNotice?: boolean;
  deletingNoticeId?: string | null;
  onDeleteNotice?: (itemId: string) => void;
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
  canDeleteNotice = false,
  deletingNoticeId = null,
  onDeleteNotice,
}: HomeNewsTabsProps) {
  const groupId = useId();
  const [activeCategory, setActiveCategory] = useState<HomeNewsTabKey>(() => getInitialTab(cardsByCategory, temporarySections));
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isMobileNewsMenuOpen, setIsMobileNewsMenuOpen] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const categoryTabs = HOME_NEWS_CATEGORIES.map((category) => ({
    key: category as HomeNewsTabKey,
    label: HOME_NEWS_CATEGORY_LABELS[category],
    items: cardsByCategory[category] ?? [],
  }));
  const temporaryTabs = temporarySections.map((section) => ({
    key: section.id as HomeNewsTabKey,
    label: section.label,
    items: section.items,
  }));
  const noticeTab = temporaryTabs.find((tab) => tab.key === "notice");
  const otherTemporaryTabs = temporaryTabs.filter((tab) => tab.key !== "notice");
  const tabs = [
    ...(noticeTab ? [noticeTab] : []),
    ...otherTemporaryTabs,
    ...categoryTabs,
  ];
  const mobileNewsTabs = [
    ...(noticeTab ? [noticeTab] : []),
    ...otherTemporaryTabs,
    ...categoryTabs,
  ];
  const mobileNewsItemCount = mobileNewsTabs.reduce((sum, tab) => sum + tab.items.length, 0);
  const hasNoticeTab = tabs.some((tab) => tab.key === "notice");
  const items = tabs.find((tab) => tab.key === activeCategory)?.items ?? [];
  const isNoticeActive = activeCategory === "notice";
  const isMobileNewsActive = mobileNewsTabs.some((tab) => tab.key === activeCategory);

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeCategory)) {
      setActiveCategory(getInitialTab(cardsByCategory, temporarySections));
      return;
    }

    const nextCategory = getInitialTab(cardsByCategory, temporarySections);
    const currentItems = tabs.find((tab) => tab.key === activeCategory)?.items ?? [];
    const nextItems = tabs.find((tab) => tab.key === nextCategory)?.items ?? [];
    if (currentItems.length === 0 && nextItems.length > 0) {
      setActiveCategory(nextCategory);
      setIsPanelOpen(true);
    }
  }, [activeCategory, cardsByCategory, recommendedCategory, tabs, temporarySections]);

  useEffect(() => {
    if (!requestedOpenItemId) return;

    const matchedTab = tabs.find((tab) => tab.items.some((item) => item.id === requestedOpenItemId));
    if (!matchedTab) return;

    setHasUserSelectedCategory(true);
    setActiveCategory(matchedTab.key);
    setIsPanelOpen(true);
    setExpandedCardId(requestedOpenItemId);
  }, [requestedOpenItemId, requestedOpenToken, tabs]);

  useEffect(() => {
    if (!requestedOpenItemId) return;
    if (!isPanelOpen) return;
    if (expandedCardId !== requestedOpenItemId) return;

    const handle = window.requestAnimationFrame(() => {
      cardRefs.current.get(requestedOpenItemId)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [expandedCardId, isPanelOpen, requestedOpenItemId, requestedOpenToken]);

  useEffect(() => {
    if (!recommendedCategory || hasUserSelectedCategory || hasNoticeTab) return;
    if ((cardsByCategory[recommendedCategory] ?? []).length === 0) return;
    setActiveCategory(recommendedCategory);
    setIsPanelOpen(true);
  }, [cardsByCategory, hasNoticeTab, hasUserSelectedCategory, recommendedCategory]);

  useEffect(() => {
    if (!isMobileNewsMenuOpen) return;
    if (isMobileNewsActive) return;
    setIsMobileNewsMenuOpen(false);
  }, [isMobileNewsActive, isMobileNewsMenuOpen]);

  const renderCardGrid = (
    cards: typeof items,
    categoryKey: HomeNewsTabKey,
  ) => (
    <div className={styles.grid}>
      {cards.map((item) => (
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
            togglingPreference={togglingPreferenceId === item.id}
            canDeleteNotice={canDeleteNotice && categoryKey === "notice" && Boolean(item.noticeId)}
            deletingNotice={deletingNoticeId === item.id}
            onDeleteNotice={onDeleteNotice ? () => onDeleteNotice(item.id) : undefined}
            onSetPreference={
              onSetPreference
                ? (nextPreference) => onSetPreference(item.id, nextPreference)
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.tabs}>
      <div className={styles.desktopTabList} role="tablist" aria-label="뉴스 카테고리">
        {tabs.map((tab) => {
          const isActive = tab.key === activeCategory;
          const isSelected = isActive && isPanelOpen;
          return (
            <button
              key={tab.key}
              id={`${groupId}-${tab.key}-tab`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={isSelected ? `${groupId}-${tab.key}-panel` : undefined}
              tabIndex={isSelected ? 0 : -1}
              className={`${styles.tabButton} ${tab.key === "notice" ? styles.tabButtonNotice : ""} ${isSelected ? styles.tabButtonActive : ""} ${tab.key === "notice" && isSelected ? styles.tabButtonNoticeActive : ""}`}
              onClick={() => {
                setHasUserSelectedCategory(true);
                if (isActive && isPanelOpen) {
                  setIsPanelOpen(false);
                  setExpandedCardId(null);
                  return;
                }
                setActiveCategory(tab.key);
                setIsPanelOpen(true);
                setExpandedCardId(null);
              }}
            >
              <span>{tab.label}</span>
              <span className={styles.tabCount}>{tab.items.length}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.mobileTabList} aria-label="뉴스 카테고리">
        <button
          type="button"
          className={`${styles.tabButton} ${styles.mobileNewsToggle} ${isMobileNewsActive ? styles.tabButtonActive : ""}`}
          aria-expanded={isMobileNewsMenuOpen}
          aria-controls={`${groupId}-mobile-news-menu`}
          onClick={() => setIsMobileNewsMenuOpen((current) => !current)}
        >
          <span>뉴스</span>
          <span className={styles.tabCount}>{mobileNewsItemCount}</span>
          <span className={styles.mobileNewsChevron} aria-hidden="true">
            ˅
          </span>
        </button>
        {isMobileNewsMenuOpen ? (
          <div id={`${groupId}-mobile-news-menu`} className={styles.mobileNewsMenu}>
            {mobileNewsTabs.map((tab) => {
              const isActive = tab.key === activeCategory;
              const isSelected = isActive && isPanelOpen;
              return (
                <button
                  key={tab.key}
                  id={`${groupId}-mobile-${tab.key}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls={isSelected ? `${groupId}-panel` : undefined}
                  tabIndex={isSelected ? 0 : -1}
                  className={`${styles.tabButton} ${tab.key === "notice" ? styles.tabButtonNotice : ""} ${isSelected ? styles.tabButtonActive : ""} ${tab.key === "notice" && isSelected ? styles.tabButtonNoticeActive : ""}`}
                  onClick={() => {
                    setHasUserSelectedCategory(true);
                    setActiveCategory(tab.key);
                    setIsPanelOpen(true);
                    setExpandedCardId(null);
                    setIsMobileNewsMenuOpen(false);
                  }}
                >
                  <span>{tab.label}</span>
                  <span className={styles.tabCount}>{tab.items.length}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {isPanelOpen ? (
        <div
          id={`${groupId}-panel`}
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
            renderCardGrid(items, activeCategory)
          ) : (
            <div className={styles.empty} role="status" aria-live="polite">
              <strong>아직 들어온 브리핑이 없습니다.</strong>
              <p>실제 뉴스 데이터가 연결되면 이 자리에서 카테고리별 핵심 카드가 바로 보입니다.</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
