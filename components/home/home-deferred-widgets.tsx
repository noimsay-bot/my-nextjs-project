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
    const newsDelay = isMobileLike ? 900 : 180;

    const popupTimer = window.setTimeout(() => {
      setShowPopup(true);
    }, popupDelay);

    let idleHandle = 0;
    const newsTimer = window.setTimeout(() => {
      setShowNews(true);
    }, newsDelay);

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(() => {
        setShowNews(true);
      }, { timeout: newsDelay + 1200 });
    }

    return () => {
      window.clearTimeout(popupTimer);
      window.clearTimeout(newsTimer);
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
