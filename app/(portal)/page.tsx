import { HomeDeferredWidgets } from "@/components/home/home-deferred-widgets";
import { PublishedSchedulesPanel } from "@/components/schedule/published-schedules-panel";

export default function HomePage() {
  return (
    <>
      <PublishedSchedulesPanel />
      <HomeDeferredWidgets />
    </>
  );
}
