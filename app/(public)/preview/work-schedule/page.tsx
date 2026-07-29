import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublishedSchedulesPanel } from "@/components/schedule/published-schedules-panel";
import {
  createPreviewReadonlyScheduleProps,
  isPreviewScheduleDemoEnabled,
} from "@/lib/schedule/preview-readonly";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "월간 근무표 읽기 전용 프리뷰",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PreviewWorkSchedulePage() {
  if (!isPreviewScheduleDemoEnabled()) {
    notFound();
  }

  return <PublishedSchedulesPanel mode="page" readOnlyPreview={createPreviewReadonlyScheduleProps()} />;
}
