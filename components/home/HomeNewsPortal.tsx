"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HomeNewsSection } from "@/components/home/HomeNewsSection";
import { HomeNewsCardItem, HomeNewsCardsByCategory, HomeNewsDataset } from "@/components/home/home-news.types";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";
import { getHomeNotices, HOME_POPUP_NOTICE_EVENT, refreshHomePopupNoticeWorkspace, type HomeNotice } from "@/lib/home-popup/storage";
import { fetchHomeNewsDataset } from "@/lib/home-news/queries";
import { setHomeNewsBriefingPreference } from "@/lib/home-news/like-actions";
import { fetchHomeNewsLikeWorkspace } from "@/lib/home-news/like-queries";
import { toHomeNewsPreferenceRecord } from "@/lib/home-news/like-types";
import { applyHomeNewsPersonalization } from "@/lib/home-news/personalization";
import { generateTimedLivePreview } from "@/lib/home-news/timed-live-preview-actions";

const HOST_SELECTOR = '[data-home-news-slot="true"]';
const DEFERRED_NEWS_TASK_DELAY_MS = 120;

function ensurePortalHost() {
  const panel = document.querySelector<HTMLElement>(".schedule-published-panel > .panel-pad");
  const hero = panel?.querySelector<HTMLElement>(".schedule-published-hero");
  if (!panel || !hero) return null;

  const duplicatedHosts = panel.querySelectorAll<HTMLElement>(HOST_SELECTOR);
  if (duplicatedHosts.length > 1) {
    duplicatedHosts.forEach((node, index) => {
      if (index > 0) node.remove();
    });
  }

  let host = panel.querySelector<HTMLElement>(HOST_SELECTOR);
  if (!host) {
    host = document.createElement("div");
    host.dataset.homeNewsSlot = "true";
    host.dataset.homeNewsOwner = "HomeNewsPortal";
    host.style.width = "100%";
    host.style.margin = "0";
    host.style.padding = "0";
  }

  if (hero.previousSibling !== host) {
    hero.insertAdjacentElement("beforebegin", host);
  }

  return host;
}

function toNoticeCardItem(notice: HomeNotice): HomeNewsCardItem {
  return {
    id: `notice-${notice.id}`,
    category: "politics",
    title: notice.title,
    summary: notice.body.split(/\r?\n/).filter((line) => line.trim().length > 0),
    whyItMatters: "",
    checkPoints: [],
    publishedAt: notice.updatedAt,
    badgeLabel: "공지",
    tagLabel: notice.kind === "popup" ? "팝업" : "일반",
    noticeTone: notice.tone,
    disablePreferenceActions: true,
  };
}

function scheduleDeferredTask(callback: () => void) {
  if (typeof globalThis === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(callback, { timeout: 1000 });
    return () => globalThis.cancelIdleCallback(handle);
  }

  const handle = globalThis.setTimeout(callback, DEFERRED_NEWS_TASK_DELAY_MS);
  return () => globalThis.clearTimeout(handle);
}

export function HomeNewsPortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [baseData, setBaseData] = useState<HomeNewsDataset>(emptyHomeNewsDataset);
  const [livePreviewData, setLivePreviewData] = useState<HomeNewsDataset | null>(null);
  const [likeWorkspace, setLikeWorkspace] = useState<Awaited<ReturnType<typeof fetchHomeNewsLikeWorkspace>> | null>(null);
  const [noticeItems, setNoticeItems] = useState<HomeNewsCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingPreferenceId, setTogglingPreferenceId] = useState<string | null>(null);
  const [requestedOpen, setRequestedOpen] = useState<{ id: string; token: number } | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const personalizedBaseData = useMemo(() => applyHomeNewsPersonalization(baseData, likeWorkspace), [baseData, likeWorkspace]);
  const personalizedPreviewData = useMemo(
    () => (livePreviewData ? applyHomeNewsPersonalization(livePreviewData, likeWorkspace) : null),
    [likeWorkspace, livePreviewData],
  );
  const activeData = personalizedPreviewData ?? personalizedBaseData;
  const activeDataWithNotices = useMemo<HomeNewsDataset>(() => ({
    ...activeData,
    temporarySections: [
      {
        id: "notice",
        label: "공지",
        items: noticeItems,
      },
      ...(activeData.temporarySections ?? []).filter((section) => section.id !== "notice"),
    ],
  }), [activeData, noticeItems]);

  function updateDatasetPreferenceState(
    dataset: HomeNewsDataset | null,
    itemId: string,
    nextPreference: "like" | "dislike" | null,
  ) {
    if (!dataset) return dataset;

    return {
      ...dataset,
      cardsByCategory: Object.fromEntries(
        Object.entries(dataset.cardsByCategory).map(([category, items]) => [
          category,
          (items ?? []).map((item) => {
            if (item.id !== itemId) return item;
            const likesCount = item.likesCount ?? 0;
            const nextLikesCount =
              nextPreference === "like"
                ? item.viewerHasLiked
                  ? likesCount
                  : likesCount + 1
                : item.viewerHasLiked
                  ? Math.max(0, likesCount - 1)
                  : likesCount;

            return {
              ...item,
              viewerHasLiked: nextPreference === "like",
              viewerHasDisliked: nextPreference === "dislike",
              likesCount: nextLikesCount,
            };
          }),
        ]),
      ) as Partial<HomeNewsCardsByCategory>,
      temporarySections: (dataset.temporarySections ?? []).map((section) => ({
        ...section,
        items: section.items.map((item) => {
          if (item.id !== itemId) return item;
          const likesCount = item.likesCount ?? 0;
          const nextLikesCount =
            nextPreference === "like"
              ? item.viewerHasLiked
                ? likesCount
                : likesCount + 1
              : item.viewerHasLiked
                ? Math.max(0, likesCount - 1)
                : likesCount;

          return {
            ...item,
            viewerHasLiked: nextPreference === "like",
            viewerHasDisliked: nextPreference === "dislike",
            likesCount: nextLikesCount,
          };
        }),
      })),
    };
  }

  const section = useMemo(
    () => (
      <HomeNewsSection
        data={activeDataWithNotices}
        loading={loading}
        requestedOpenItemId={requestedOpen?.id ?? null}
        requestedOpenToken={requestedOpen?.token ?? 0}
        togglingPreferenceId={togglingPreferenceId}
        onSelectTickerItem={(itemId) => setRequestedOpen({ id: itemId, token: Date.now() })}
        onSetPreference={(itemId, nextPreference) => {
          const allItems = [
            ...Object.values(activeDataWithNotices.cardsByCategory).flatMap((items) => items ?? []),
            ...(activeDataWithNotices.temporarySections ?? []).flatMap((section) => section.items ?? []),
          ];
          const targetItem = allItems.find((item) => item.id === itemId) ?? null;
          if (!targetItem) return;

          setTogglingPreferenceId(itemId);
          void (async () => {
            const isPreviewItem = itemId.startsWith("live-preview-");

            if (!isPreviewItem) {
              const result = await setHomeNewsBriefingPreference(itemId, nextPreference);
              if (!result.ok) {
                console.warn(result.message);
                setTogglingPreferenceId(null);
                return;
              }

              setBaseData((current) => updateDatasetPreferenceState(current, itemId, nextPreference) ?? current);
            } else {
              setLivePreviewData((current) => updateDatasetPreferenceState(current, itemId, nextPreference));
            }

            setLikeWorkspace((current) => {
              const previous = current ?? { likedBriefingIds: [], dislikedBriefingIds: [], preferences: [] };
              const likedBriefingIds = nextPreference === "like"
                ? Array.from(new Set([...previous.likedBriefingIds, itemId]))
                : previous.likedBriefingIds.filter((id) => id !== itemId);
              const dislikedBriefingIds = nextPreference === "dislike"
                ? Array.from(new Set([...previous.dislikedBriefingIds, itemId]))
                : previous.dislikedBriefingIds.filter((id) => id !== itemId);
              const preferences = nextPreference
                ? [
                    toHomeNewsPreferenceRecord(targetItem as HomeNewsCardItem, nextPreference),
                    ...previous.preferences.filter((item) => item.briefingId !== itemId),
                  ]
                : previous.preferences.filter((item) => item.briefingId !== itemId);

              return {
                likedBriefingIds,
                dislikedBriefingIds,
                preferences,
              };
            });

            setTogglingPreferenceId(null);
          })();
        }}
      />
    ),
    [activeDataWithNotices, loading, togglingPreferenceId],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    let cancelled = false;
    let cancelDeferredTasks = () => {};

    const syncNotices = () => {
      setNoticeItems(getHomeNotices().map(toNoticeCardItem));
    };

    void (async () => {
      setLoading(true);
      syncNotices();

      const [noticeResult, datasetResult] = await Promise.allSettled([
        refreshHomePopupNoticeWorkspace(),
        fetchHomeNewsDataset(),
      ]);
      if (cancelled) return;

      if (noticeResult.status === "fulfilled") {
        syncNotices();
      } else {
        console.warn(
          noticeResult.reason instanceof Error
            ? noticeResult.reason.message
            : "공지 정보를 불러오지 못했습니다.",
        );
      }

      const resolvedDataset = datasetResult.status === "fulfilled" ? datasetResult.value : null;
      if (resolvedDataset) {
        setBaseData(resolvedDataset.data);
        if (resolvedDataset.errorMessage) {
          console.warn(resolvedDataset.errorMessage);
        }
      } else {
        const datasetError = datasetResult.status === "rejected" ? datasetResult.reason : null;
        setBaseData(emptyHomeNewsDataset);
        console.warn(
          datasetError instanceof Error
            ? datasetError.message
            : "뉴스 데이터를 불러오지 못했습니다.",
        );
      }

      setLoading(false);

      cancelDeferredTasks = scheduleDeferredTask(() => {
        void (async () => {
          try {
            const nextLikeWorkspace = await fetchHomeNewsLikeWorkspace();
            if (!cancelled) {
              setLikeWorkspace(nextLikeWorkspace);
            }
          } catch (error) {
            if (!cancelled) {
              console.warn(error instanceof Error ? error.message : "좋아요 상태를 불러오지 못했습니다.");
              setLikeWorkspace(null);
            }
          }

          if (!resolvedDataset || resolvedDataset.source === "issue_set") {
            if (!cancelled) {
              setLivePreviewData(null);
            }
            return;
          }

          try {
            const previewResult = await generateTimedLivePreview();
            if (cancelled) return;
            if (previewResult.ok && previewResult.data) {
              setLivePreviewData(previewResult.data);
              return;
            }

            console.warn(previewResult.message);
            setLivePreviewData(null);
          } catch (error) {
            if (!cancelled) {
              console.warn(error instanceof Error ? error.message : "현재 시각 기준 뉴스 미리보기를 불러오지 못했습니다.");
              setLivePreviewData(null);
            }
          }
        })();
      });
    })();

    window.addEventListener(HOME_POPUP_NOTICE_EVENT, syncNotices);
    return () => {
      cancelled = true;
      cancelDeferredTasks();
      window.removeEventListener(HOME_POPUP_NOTICE_EVENT, syncNotices);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let frameId = 0;
    let observer: MutationObserver | null = null;

    const syncHost = () => {
      const nextHost = ensurePortalHost();
      hostRef.current = nextHost;
      setHost((current) => (current === nextHost ? current : nextHost));
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncHost);
    };

    syncHost();
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);

    return () => {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      const currentHost = hostRef.current;
      if (currentHost?.dataset.homeNewsOwner === "HomeNewsPortal") {
        currentHost.remove();
      }
    };
  }, []);

  if (!host) return null;
  return createPortal(section, host);
}
