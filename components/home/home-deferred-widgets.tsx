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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobileLike = window.matchMedia("(any-pointer: coarse)").matches || window.innerWidth <= 820;
    const scheduleDelay = isMobileLike ? 420 : 120;
    const popupDelay = isMobileLike ? 280 : 80;
    const scheduleTimer = window.setTimeout(() => {
      setShowSchedules(true);
    }, scheduleDelay);

    const popupTimer = window.setTimeout(() => {
      setShowPopup(true);
    }, popupDelay);

    return () => {
      window.clearTimeout(scheduleTimer);
      window.clearTimeout(popupTimer);
    };
  }, []);

  return (
    <>
      <div
        data-home-news-slot="true"
        data-home-news-fallback="true"
        style={{ width: "100%", marginTop: 16, padding: 0 }}
      />
      <HomeNewsPortal />
      {showSchedules ? <PublishedSchedulesPanel mode="home" /> : null}
      {showPopup ? <HomePopupNoticeModal /> : null}
    </>
  );
}
