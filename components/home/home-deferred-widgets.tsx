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

const HomeElectionCard = dynamic(
  () => import("@/components/election/home-election-card").then((module) => module.HomeElectionCard),
  { ssr: false },
);

const PublishedSchedulesPanel = dynamic(
  () => import("@/components/schedule/published-schedules-panel").then((module) => module.PublishedSchedulesPanel),
  { ssr: false },
);

const LiveEquipmentStatusHomePanel = dynamic(
  () => import("@/components/equipment/equipment-pages").then((module) => module.LiveEquipmentStatusHomePanel),
  { ssr: false },
);

export function HomeDeferredWidgets() {
  const [showSchedules, setShowSchedules] = useState(false);
  const [showLiveEquipmentStatus, setShowLiveEquipmentStatus] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobileLike = window.matchMedia("(any-pointer: coarse)").matches || window.innerWidth <= 820;
    const scheduleDelay = isMobileLike ? 420 : 120;
    const liveEquipmentDelay = isMobileLike ? 760 : 260;
    const popupDelay = isMobileLike ? 280 : 80;
    const scheduleTimer = window.setTimeout(() => {
      setShowSchedules(true);
    }, scheduleDelay);

    const liveEquipmentTimer = window.setTimeout(() => {
      setShowLiveEquipmentStatus(true);
    }, liveEquipmentDelay);

    const popupTimer = window.setTimeout(() => {
      setShowPopup(true);
    }, popupDelay);

    return () => {
      window.clearTimeout(scheduleTimer);
      window.clearTimeout(liveEquipmentTimer);
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
      <HomeElectionCard />
      {showSchedules ? <PublishedSchedulesPanel mode="home" /> : null}
      {showLiveEquipmentStatus ? <LiveEquipmentStatusHomePanel /> : null}
      {showPopup ? <HomePopupNoticeModal /> : null}
    </>
  );
}
