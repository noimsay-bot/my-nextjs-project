import { HomeNewsPortal } from "@/components/home/HomeNewsPortal";
import { HomePopupNoticeModal } from "@/components/home/HomePopupNoticeModal";
import { PublishedSchedulesPanel } from "@/components/schedule/published-schedules-panel";

export default function HomePage() {
  return (
    <>
      <HomePopupNoticeModal />
      <PublishedSchedulesPanel />
      <HomeNewsPortal />
    </>
  );
}
