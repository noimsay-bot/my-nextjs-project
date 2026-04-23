"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const HomePopupNoticeModal = dynamic(
  () => import("@/components/home/HomePopupNoticeModal").then((module) => module.HomePopupNoticeModal),
  { ssr: false },
);

const HomeNewsPortal = dynamic(
  () => import("@/components/home/HomeNewsPortal").then((module) => module.HomeNewsPortal),
  { ssr: false },
);

const PublishedSchedulesPanel = dynamic(
  () => import("@/components/schedule/published-schedules-panel").then((module) => module.PublishedSchedulesPanel),
  { ssr: false },
);

export function HomeDeferredWidgets() {
  const [showSchedules, setShowSchedules] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [showNews, setShowNews] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobileLike = window.matchMedia("(any-pointer: coarse)").matches || window.innerWidth <= 820;
    const scheduleDelay = isMobileLike ? 420 : 120;
    const popupDelay = isMobileLike ? 280 : 80;
    const newsDelay = isMobileLike ? 1400 : 180;
    const newsIdleTimeout = isMobileLike ? 2600 : newsDelay + 1200;
    let newsScheduled = false;

    const scheduleTimer = window.setTimeout(() => {
      setShowSchedules(true);
    }, scheduleDelay);

    const popupTimer = window.setTimeout(() => {
      setShowPopup(true);
    }, popupDelay);

    let idleHandle = 0;
    let newsTimer = 0;
    let loadFallbackTimer = 0;

    const revealNews = () => {
      if (newsScheduled) return;
      newsScheduled = true;
      setShowNews(true);
    };

    const scheduleNews = () => {
      if (newsScheduled) return;

      newsTimer = window.setTimeout(() => {
        revealNews();
      }, newsDelay);

      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(() => {
          revealNews();
        }, { timeout: newsIdleTimeout });
      }
    };

    if (isMobileLike && document.readyState !== "complete") {
      const handleLoad = () => {
        window.removeEventListener("load", handleLoad);
        window.clearTimeout(loadFallbackTimer);
        scheduleNews();
      };

      window.addEventListener("load", handleLoad, { once: true });
      loadFallbackTimer = window.setTimeout(() => {
        window.removeEventListener("load", handleLoad);
        scheduleNews();
      }, newsDelay + 1200);
    } else {
      scheduleNews();
    }

    return () => {
      window.clearTimeout(scheduleTimer);
      window.clearTimeout(popupTimer);
      window.clearTimeout(newsTimer);
      window.clearTimeout(loadFallbackTimer);
      if (idleHandle) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, []);

  return (
    <>
      {showSchedules ? <PublishedSchedulesPanel /> : null}
      {showPopup ? <HomePopupNoticeModal /> : null}
      {showNews ? <HomeNewsPortal /> : null}
    </>
  );
}
