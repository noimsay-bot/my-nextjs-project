"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HomeNewsSection } from "@/components/home/HomeNewsSection";
import { HomeNewsCardItem } from "@/components/home/home-news.types";
import { getSession, getSessionAsync, hasDeskAccess, subscribeToAuth } from "@/lib/auth/storage";
import {
  deleteHomeDday,
  deleteHomeNotice,
  getHomeDdays,
  getHomeNotices,
  HOME_POPUP_NOTICE_EVENT,
  refreshHomePopupNoticeWorkspace,
  updateHomeDday,
  type HomeDdayItem,
  type HomeNotice,
} from "@/lib/home-popup/storage";

const HOST_SELECTOR = '[data-home-news-slot="true"]';

function findPortalTargets() {
  if (typeof window !== "undefined" && window.location.pathname === "/") {
    return null;
  }

  const panel = document.querySelector<HTMLElement>(".schedule-published-panel > .panel-pad");
  const hero = panel?.querySelector<HTMLElement>(".schedule-published-hero");
  if (!panel || !hero) return null;
  return { panel, hero };
}

function ensurePortalHost(targets: ReturnType<typeof findPortalTargets>) {
  if (!targets) {
    return document.querySelector<HTMLElement>(HOST_SELECTOR);
  }

  const { panel, hero } = targets;
  const allHosts = Array.from(document.querySelectorAll<HTMLElement>(HOST_SELECTOR));

  if (allHosts.length > 1) {
    allHosts.forEach((node, index) => {
      if (index > 0 && node.dataset.homeNewsOwner === "HomeNewsPortal") {
        node.remove();
      }
    });
  }

  let host = panel.querySelector<HTMLElement>(HOST_SELECTOR) ?? allHosts[0] ?? null;
  if (!host) {
    host = document.createElement("div");
    host.dataset.homeNewsSlot = "true";
    host.dataset.homeNewsOwner = "HomeNewsPortal";
    host.style.width = "100%";
    host.style.margin = "0";
    host.style.padding = "0";
  }

  host.dataset.homeNewsOwner = "HomeNewsPortal";
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

export function HomeNewsPortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [noticeItems, setNoticeItems] = useState<HomeNewsCardItem[]>([]);
  const [ddayItems, setDdayItems] = useState<HomeDdayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingNoticeId, setDeletingNoticeId] = useState<string | null>(null);
  const [canDeleteNotice, setCanDeleteNotice] = useState(false);
  const [canManageDdays, setCanManageDdays] = useState(false);
  const hostRef = useRef<HTMLElement | null>(null);

  const syncNotices = () => {
    setNoticeItems(getHomeNotices().map(toNoticeCardItem));
    setDdayItems(getHomeDdays());
  };

  useEffect(() => {
    if (typeof document === "undefined") return;

    let cancelled = false;
    syncNotices();

    void (async () => {
      try {
        await refreshHomePopupNoticeWorkspace({ includeTrips: false });
        if (!cancelled) {
          syncNotices();
        }
      } catch (error) {
        if (!cancelled) {
          console.warn(error instanceof Error ? error.message : "공지 정보를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    window.addEventListener(HOME_POPUP_NOTICE_EVENT, syncNotices);
    return () => {
      cancelled = true;
      window.removeEventListener(HOME_POPUP_NOTICE_EVENT, syncNotices);
    };
  }, []);

  useEffect(() => {
    const syncSessionWorkspace = async (nextSessionParam?: Awaited<ReturnType<typeof getSessionAsync>> | null) => {
      const nextSession = nextSessionParam ?? getSession() ?? (await getSessionAsync());
      setCanDeleteNotice(Boolean(nextSession?.approved && hasDeskAccess(nextSession.role)));
      setCanManageDdays(Boolean(nextSession?.approved && hasDeskAccess(nextSession.role)));

      if (!nextSession?.approved) return;

      try {
        await refreshHomePopupNoticeWorkspace({ includeTrips: false });
        syncNotices();
      } catch (error) {
        console.warn(error instanceof Error ? error.message : "공지 정보를 불러오지 못했습니다.");
      }
    };

    void syncSessionWorkspace();
    return subscribeToAuth((nextSession) => {
      void syncSessionWorkspace(nextSession);
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

  return createPortal(
    <HomeNewsSection
      noticeItems={noticeItems}
      ddayItems={ddayItems}
      canManageDdays={canManageDdays}
      onManageDday={(item) => {
        if (!canManageDdays) return;

        const action = window.prompt(
          `디데이 관리\n수정은 'edit', 삭제는 'delete'를 입력하세요.`,
          "edit",
        );
        if (!action) return;

        const normalizedAction = action.trim().toLowerCase();
        if (normalizedAction === "delete") {
          const ok = window.confirm(`'${item.title}' 디데이를 삭제하시겠습니까?`);
          if (!ok) return;

          void (async () => {
            try {
              await deleteHomeDday(item.id);
              await refreshHomePopupNoticeWorkspace({ includeTrips: false });
              syncNotices();
            } catch (error) {
              const message = error instanceof Error ? error.message : "디데이를 삭제하지 못했습니다.";
              console.warn(message);
              window.alert(message);
            }
          })();
          return;
        }

        if (normalizedAction !== "edit") {
          return;
        }

        const nextTitle = window.prompt("디데이 이름을 입력하세요.", item.title);
        if (nextTitle === null) return;
        const nextTargetDate = window.prompt("목표 날짜를 YYYY-MM-DD 형식으로 입력하세요.", item.targetDate);
        if (nextTargetDate === null) return;

        void (async () => {
          try {
            await updateHomeDday({ ddayId: item.id, title: nextTitle, targetDate: nextTargetDate });
            await refreshHomePopupNoticeWorkspace({ includeTrips: false });
            syncNotices();
          } catch (error) {
            const message = error instanceof Error ? error.message : "디데이를 수정하지 못했습니다.";
            console.warn(message);
            window.alert(message);
          }
        })();
      }}
      loading={loading}
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
            await refreshHomePopupNoticeWorkspace({ includeTrips: false });
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
    />,
    host,
  );
}
