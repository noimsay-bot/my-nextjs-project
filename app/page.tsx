import { HomeNewsPortal } from "@/components/home/HomeNewsPortal";
import { PublishedSchedulesPanel } from "@/components/schedule/published-schedules-panel";

export default function HomePage() {
  return (
    <>
      <PublishedSchedulesPanel />
      <HomeNewsPortal />
    </>
  );
}
