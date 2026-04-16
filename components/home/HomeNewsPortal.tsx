"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HomeNewsSection } from "@/components/home/HomeNewsSection";
import { HomeNewsCardItem, HomeNewsCardsByCategory, HomeNewsDataset } from "@/components/home/home-news.types";
import { getSession, getSessionAsync, hasDeskAccess, subscribeToAuth } from "@/lib/auth/storage";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";
import {
  deleteHomeNotice,
  getHomeNotices,
  HOME_POPUP_NOTICE_EVENT,
  refreshHomePopupNoticeWorkspace,
  type HomeNotice,
} from "@/lib/home-popup/storage";
import { fetchHomeNewsDataset } from "@/lib/home-news/queries";
import { setHomeNewsBriefingPreference } from "@/lib/home-news/like-actions";
import { fetchHomeNewsLikeWorkspace } from "@/lib/home-news/like-queries";
import { toHomeNewsPreferenceRecord } from "@/lib/home-news/like-types";
import { applyHomeNewsPersonalization } from "@/lib/home-news/personalization";
import { generateTimedLivePreview, type TimedLivePreviewResult } from "@/lib/home-news/timed-live-preview-actions";
import { getCurrentHomeIssueSetDate, getCurrentHomeIssueSetSlot } from "@/lib/home-news/current-issue-set";

const HOST_SELECTOR = '[data-home-news-slot="true"]';
const DEFERRED_NEWS_TASK_DELAY_MS = 120;
const LIVE_PREVIEW_CACHE_KEY = "jtbc-home-news-live-preview-v1";

function findPortalTargets() {
  const panel = document.querySelector<HTMLElement>(".schedule-published-panel > .panel-pad");
  const hero = panel?.querySelector<HTMLElement>(".schedule-published-hero");
  if (!panel || !hero) return null;
  return { panel, hero };
}

function ensurePortalHost(targets: ReturnType<typeof findPortalTargets>) {
  if (!targets) return null;

  const { panel, hero } = targets;

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
    noticeId: notice.id,
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

function clearCachedLivePreview() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(LIVE_PREVIEW_CACHE_KEY);
}

function isCacheableLivePreviewDataset(dataset: HomeNewsDataset | null | undefined): dataset is HomeNewsDataset & {
  runtimeBriefing: NonNullable<HomeNewsDataset["runtimeBriefing"]>;
} {
  return Boolean(dataset?.sourceKind === "timed_live_preview" && dataset.runtimeBriefing?.generatedAt);
}

function readCachedLivePreview(now = new Date()) {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(LIVE_PREVIEW_CACHE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as HomeNewsDataset;
    if (!isCacheableLivePreviewDataset(parsed)) {
      clearCachedLivePreview();
      return null;
    }

    const cachedDate = getCurrentHomeIssueSetDate(new Date(parsed.runtimeBriefing.generatedAt));
    const currentDate = getCurrentHomeIssueSetDate(now);
    const currentSlot = getCurrentHomeIssueSetSlot(now);

    if (cachedDate !== currentDate || parsed.runtimeBriefing.briefingSlot !== currentSlot) {
      clearCachedLivePreview();
      return null;
    }

    return parsed;
  } catch {
    clearCachedLivePreview();
    return null;
  }
}

function writeCachedLivePreview(dataset: HomeNewsDataset | null | undefined) {
  if (typeof window === "undefined") return;
  if (!isCacheableLivePreviewDataset(dataset)) {
    clearCachedLivePreview();
    return;
  }

  window.sessionStorage.setItem(LIVE_PREVIEW_CACHE_KEY, JSON.stringify(dataset));
}

export function HomeNewsPortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [baseData, setBaseData] = useState<HomeNewsDataset>(emptyHomeNewsDataset);
  const [livePreviewData, setLivePreviewData] = useState<HomeNewsDataset | null>(null);
  const [likeWorkspace, setLikeWorkspace] = useState<Awaited<ReturnType<typeof fetchHomeNewsLikeWorkspace>> | null>(null);
  const [noticeItems, setNoticeItems] = useState<HomeNewsCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingPreferenceId, setTogglingPreferenceId] = useState<string | null>(null);
  const [deletingNoticeId, setDeletingNoticeId] = useState<string | null>(null);
  const [canDeleteNotice, setCanDeleteNotice] = useState(false);
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
  const syncNotices = () => {
    setNoticeItems(getHomeNotices().slice(0, 6).map(toNoticeCardItem));
  };

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
        canDeleteNotice={canDeleteNotice}
        deletingNoticeId={deletingNoticeId}
        onDeleteNotice={(itemId) => {
          const targetNotice = noticeItems.find((item) => item.id === itemId);
          const noticeId = targetNotice?.noticeId;
          if (!noticeId) return;

          const ok = window.confirm("이 공지를 삭제하시겠습니까?");
          if (!ok) return;

          setDeletingNoticeId(itemId);
          void (async () => {
            try {
              await deleteHomeNotice(noticeId);
              await refreshHomePopupNoticeWorkspace();
              syncNotices();
            } catch (error) {
              const message = error instanceof Error ? error.message : "공지를 삭제하지 못했습니다.";
              console.warn(message);
              window.alert(message);
            } finally {
              setDeletingNoticeId(null);
            }
          })();
        }}
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
    [activeDataWithNotices, canDeleteNotice, deletingNoticeId, loading, noticeItems, togglingPreferenceId],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    let cancelled = false;
    let cancelDeferredTasks = () => {};
    const cachedPreview = readCachedLivePreview();

    setLivePreviewData(cachedPreview);
    setLoading(!cachedPreview);
    syncNotices();

    void (async () => {
      try {
        const resolvedDataset = await fetchHomeNewsDataset();
        if (cancelled) return;

        setBaseData(resolvedDataset.data);
        if (resolvedDataset.errorMessage) {
          console.warn(resolvedDataset.errorMessage);
        }

        if (resolvedDataset.source === "issue_set") {
          setLivePreviewData(null);
          clearCachedLivePreview();
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
            })();
          });
          return;
        }

        const shouldHoldLoadingForLivePreview = !cachedPreview && resolvedDataset.source === "supabase";
        if (!shouldHoldLoadingForLivePreview) {
          setLoading(false);
        }

        cancelDeferredTasks = scheduleDeferredTask(() => {
          void (async () => {
            const [nextLikeWorkspace, previewResult] = await Promise.all([
              fetchHomeNewsLikeWorkspace()
                .then((workspace) => workspace)
                .catch((error) => {
                  if (!cancelled) {
                    console.warn(error instanceof Error ? error.message : "좋아요 상태를 불러오지 못했습니다.");
                  }
                  return null;
                }),
              generateTimedLivePreview()
                .then((result) => result)
                .catch((error): TimedLivePreviewResult => ({
                  ok: false,
                  message: error instanceof Error ? error.message : "현재 시각 기준 뉴스 미리보기를 불러오지 못했습니다.",
                })),
            ]);

            if (cancelled) return;

            setLikeWorkspace(nextLikeWorkspace);

            if (previewResult.ok && previewResult.data) {
              setLivePreviewData(previewResult.data);
              writeCachedLivePreview(previewResult.data);
            } else {
              console.warn(previewResult.message);
              if (!cachedPreview) {
                setLivePreviewData(null);
              }
            }

            if (shouldHoldLoadingForLivePreview) {
              setLoading(false);
            }
          })();
        });
      } catch (error) {
        if (cancelled) return;
        setBaseData(emptyHomeNewsDataset);
        setLoading(false);
        console.warn(error instanceof Error ? error.message : "뉴스 데이터를 불러오지 못했습니다.");
      }
    })();

    void refreshHomePopupNoticeWorkspace()
      .then(() => {
        if (!cancelled) {
          syncNotices();
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn(error instanceof Error ? error.message : "공지 정보를 불러오지 못했습니다.");
        }
      });

    window.addEventListener(HOME_POPUP_NOTICE_EVENT, syncNotices);
    return () => {
      cancelled = true;
      cancelDeferredTasks();
      window.removeEventListener(HOME_POPUP_NOTICE_EVENT, syncNotices);
    };
  }, []);

  useEffect(() => {
    const syncManagePermission = async () => {
      const session = getSession() ?? (await getSessionAsync());
      setCanDeleteNotice(Boolean(session?.approved && hasDeskAccess(session.role)));
    };

    void syncManagePermission();
    return subscribeToAuth((session) => {
      setCanDeleteNotice(Boolean(session?.approved && hasDeskAccess(session.role)));
    });
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let frameId = 0;
    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let observedRoot: HTMLElement | null = null;

    const syncHost = () => {
      const targets = findPortalTargets();
      const nextHost = ensurePortalHost(targets);
      hostRef.current = nextHost;
      setHost((current) => (current === nextHost ? current : nextHost));

      const nextObservedRoot = targets?.panel ?? document.body;
      if (observer && observedRoot === nextObservedRoot) {
        return;
      }

      observer?.disconnect();
      resizeObserver?.disconnect();

      observer = new MutationObserver(scheduleSync);
      observer.observe(nextObservedRoot, { childList: true, subtree: true });
      observedRoot = nextObservedRoot;

      if (typeof ResizeObserver !== "undefined" && targets) {
        resizeObserver = new ResizeObserver(scheduleSync);
        resizeObserver.observe(targets.panel);
        resizeObserver.observe(targets.hero);
      } else {
        resizeObserver = null;
      }
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncHost);
    };

    syncHost();
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);

    return () => {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      const currentHost = hostRef.current;
      if (currentHost?.dataset.homeNewsOwner === "HomeNewsPortal") {
        currentHost.remove();
      }
    };
  }, []);

  if (!host) return null;
  return createPortal(section, host);
}
