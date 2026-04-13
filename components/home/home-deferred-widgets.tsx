"use client";

import dynamic from "next/dynamic";

const HomePopupNoticeModal = dynamic(
  () => import("@/components/home/HomePopupNoticeModal").then((module) => module.HomePopupNoticeModal),
  { ssr: false },
);

const HomeNewsPortal = dynamic(
  () => import("@/components/home/HomeNewsPortal").then((module) => module.HomeNewsPortal),
  { ssr: false },
);

export function HomeDeferredWidgets() {
  return (
    <>
      <HomePopupNoticeModal />
      <HomeNewsPortal />
    </>
  );
}
