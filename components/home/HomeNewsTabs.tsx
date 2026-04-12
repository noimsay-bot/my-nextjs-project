"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { HomeNewsCard } from "@/components/home/HomeNewsCard";
import { HomeNewsCurrentTrips } from "@/components/home/HomeNewsCurrentTrips";
import styles from "@/components/home/HomeNews.module.css";
import {
  HOME_NEWS_CATEGORIES,
  HOME_NEWS_CATEGORY_LABELS,
  HomeNewsCardsByCategory,
  HomeNewsCategory,
  HomeNewsTemporarySection,
  HomeNewsTemporarySectionId,
} from "@/components/home/home-news.types";
import {
  getTeamLeadTripCards,
  refreshTeamLeadState,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
} from "@/lib/team-lead/storage";

const CURRENT_TRIPS_TAB_KEY = "current_trips";

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getCurrentTripCount() {
  const todayKey = toDateKey(new Date());
  return getTeamLeadTripCards(["국내출장", "해외출장"])
    .map((card) => ({
      ...card,
      items: card.items.filter((item) => item.startDateKey <= todayKey && item.endDateKey >= todayKey),
    }))
    .filter((card) => card.items.length > 0).length;
}

function getInitialCategory(cardsByCategory: Partial<HomeNewsCardsByCategory>) {
  return HOME_NEWS_CATEGORIES.find((category) => (cardsByCategory[category] ?? []).length > 0) ?? HOME_NEWS_CATEGORIES[0];
}

type HomeNewsTabKey = HomeNewsCategory | HomeNewsTemporarySectionId | typeof CURRENT_TRIPS_TAB_KEY;

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
  const [currentTripCount, setCurrentTripCount] = useState(0);
  const [activeCategory, setActiveCategory] = useState<HomeNewsTabKey>(() => getInitialTab(cardsByCategory, temporarySections));
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = useState(false);
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
  const currentTripsTab =
    currentTripCount > 0
      ? [{
          key: CURRENT_TRIPS_TAB_KEY as HomeNewsTabKey,
          label: "현재 출장자",
          items: [],
        }]
      : [];
  const tabs = [
    ...(noticeTab ? [noticeTab] : []),
    ...currentTripsTab,
    ...otherTemporaryTabs,
    ...categoryTabs,
  ];
  const hasNoticeTab = tabs.some((tab) => tab.key === "notice");
  const items = tabs.find((tab) => tab.key === activeCategory)?.items ?? [];
  const isNoticeActive = activeCategory === "notice";
  const isCurrentTripsActive = activeCategory === CURRENT_TRIPS_TAB_KEY;

  const handleCurrentTripCountChange = useCallback((count: number) => {
    setCurrentTripCount(count);
  }, []);

  useEffect(() => {
    const syncCurrentTripCount = () => {
      setCurrentTripCount(getCurrentTripCount());
    };

    void refreshTeamLeadState().then(syncCurrentTripCount);
    window.addEventListener("storage", syncCurrentTripCount);
    window.addEventListener("focus", syncCurrentTripCount);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncCurrentTripCount);
    return () => {
      window.removeEventListener("storage", syncCurrentTripCount);
      window.removeEventListener("focus", syncCurrentTripCount);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncCurrentTripCount);
    };
  }, []);

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeCategory)) {
      setActiveCategory(getInitialTab(cardsByCategory, temporarySections));
      return;
    }

    if (activeCategory === CURRENT_TRIPS_TAB_KEY) {
      return;
    }

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
              <span className={styles.tabCount}>{tab.key === CURRENT_TRIPS_TAB_KEY ? currentTripCount : tab.items.length}</span>
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
        {isCurrentTripsActive ? (
          <HomeNewsCurrentTrips
            className={styles.currentTripsTabCard}
            defaultExpanded
            hideToggle
            onCountChange={handleCurrentTripCountChange}
          />
        ) : loading && !(isNoticeActive && items.length > 0) ? (
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
                canDeleteNotice={canDeleteNotice && activeCategory === "notice" && Boolean(item.noticeId)}
                deletingNotice={deletingNoticeId === item.id}
                onDeleteNotice={onDeleteNotice ? () => onDeleteNotice(item.id) : undefined}
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
