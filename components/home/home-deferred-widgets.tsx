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
export function HomeDeferredWidgets() {
  const [showPopup, setShowPopup] = useState(false);
  const [showNews, setShowNews] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobileLike = window.matchMedia("(any-pointer: coarse)").matches || window.innerWidth <= 820;
    const popupDelay = isMobileLike ? 280 : 80;
    const newsDelay = isMobileLike ? 1400 : 180;
    const newsIdleTimeout = isMobileLike ? 2600 : newsDelay + 1200;
    let newsScheduled = false;

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
      {showPopup ? <HomePopupNoticeModal /> : null}
      {showNews ? <HomeNewsPortal /> : null}
    </>
  );
}
