"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HomeNewsSection } from "@/components/home/HomeNewsSection";
import { HomeNewsCardItem, HomeNewsCardsByCategory, HomeNewsDataset } from "@/components/home/home-news.types";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";
import { fetchHomeNewsDataset } from "@/lib/home-news/queries";
import { toggleHomeNewsBriefingLike } from "@/lib/home-news/like-actions";
import { fetchHomeNewsLikeWorkspace } from "@/lib/home-news/like-queries";
import { toHomeNewsLikePreferenceRecord } from "@/lib/home-news/like-types";
import { applyHomeNewsPersonalization } from "@/lib/home-news/personalization";
import { generateTimedLivePreview } from "@/lib/home-news/timed-live-preview-actions";

const HOST_SELECTOR = '[data-home-news-slot="true"]';

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

export function HomeNewsPortal() {
  const isDev = process.env.NODE_ENV === "development";
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [baseData, setBaseData] = useState<HomeNewsDataset>(emptyHomeNewsDataset);
  const [livePreviewData, setLivePreviewData] = useState<HomeNewsDataset | null>(null);
  const [likeWorkspace, setLikeWorkspace] = useState<Awaited<ReturnType<typeof fetchHomeNewsLikeWorkspace>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingLikeId, setTogglingLikeId] = useState<string | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const personalizedBaseData = useMemo(
    () => applyHomeNewsPersonalization(baseData, likeWorkspace),
    [baseData, likeWorkspace],
  );
  const activeData = livePreviewData ?? personalizedBaseData;
  const previewActive = Boolean(livePreviewData);
  const section = useMemo(
    () => (
      <HomeNewsSection
        data={activeData}
        loading={loading}
        togglingLikeId={togglingLikeId}
        onToggleLike={
          previewActive
            ? undefined
            : (itemId, nextLiked) => {
                const allItems = Object.values(activeData.cardsByCategory).flatMap((items) => items ?? []);
                const targetItem = allItems.find((item) => item.id === itemId) ?? null;
                if (!targetItem) return;

                setTogglingLikeId(itemId);
                void (async () => {
                  const result = await toggleHomeNewsBriefingLike(itemId, nextLiked);
                  if (!result.ok) {
                    console.warn(result.message);
                    setTogglingLikeId(null);
                    return;
                  }

                  setBaseData((current) => ({
                    ...current,
                    cardsByCategory: Object.fromEntries(
                      Object.entries(current.cardsByCategory).map(([category, items]) => [
                        category,
                        (items ?? []).map((item) =>
                          item.id === itemId
                            ? {
                                ...item,
                                viewerHasLiked: nextLiked,
                                likesCount: result.likesCount ?? item.likesCount ?? 0,
                              }
                            : item,
                        ),
                      ]),
                    ) as Partial<HomeNewsCardsByCategory>,
                  }));

                  setLikeWorkspace((current) => {
                    const previous = current ?? { likedBriefingIds: [], preferences: [] };
                    const likedBriefingIds = nextLiked
                      ? Array.from(new Set([...previous.likedBriefingIds, itemId]))
                      : previous.likedBriefingIds.filter((id) => id !== itemId);
                    const preferences = nextLiked
                      ? [
                          toHomeNewsLikePreferenceRecord(targetItem as HomeNewsCardItem),
                          ...previous.preferences.filter((item) => item.briefingId !== itemId),
                        ]
                      : previous.preferences.filter((item) => item.briefingId !== itemId);

                    return {
                      likedBriefingIds,
                      preferences,
                    };
                  });

                  setTogglingLikeId(null);
                })();
              }
        }
      />
    ),
    [activeData, loading, previewActive, togglingLikeId],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    let frameId = 0;
    let observer: MutationObserver | null = null;
    let cancelled = false;

    const syncHost = () => {
      const nextHost = ensurePortalHost();
      hostRef.current = nextHost;
      setHost((current) => (current === nextHost ? current : nextHost));
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncHost);
    };

    void (async () => {
      setLoading(true);
      const result = await fetchHomeNewsDataset();
      if (cancelled) return;
      setBaseData(result.data);
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
      if (isDev) {
        try {
          const previewResult = await generateTimedLivePreview();
          if (!cancelled && previewResult.ok && previewResult.data) {
            setLivePreviewData(previewResult.data);
          }
          if (!cancelled && !previewResult.ok) {
            console.warn(previewResult.message);
            setLivePreviewData(null);
          }
        } catch (error) {
          if (!cancelled) {
            console.warn(error instanceof Error ? error.message : "현재 시각 기준 뉴스 미리보기를 불러오지 못했습니다.");
            setLivePreviewData(null);
          }
        }
      } else if (!cancelled) {
        setLivePreviewData(null);
      }
      setLoading(false);
      if (result.errorMessage) {
        console.warn(result.errorMessage);
      }
    })();

    syncHost();
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);

    return () => {
      cancelled = true;
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
  }, [isDev]);

  if (!host) return null;
  return createPortal(section, host);
}
