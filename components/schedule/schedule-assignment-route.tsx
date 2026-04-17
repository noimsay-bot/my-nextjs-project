"use client";

import dynamic from "next/dynamic";

const ScheduleAssignmentPage = dynamic(
  () => import("@/components/team-lead/schedule-assignment-page").then((module) => module.ScheduleAssignmentPage),
  {
    ssr: false,
    loading: () => <ScheduleAssignmentRouteLoading />,
  },
);

function ScheduleAssignmentRouteLoading() {
  return (
    <section className="panel" aria-busy="true" aria-live="polite">
      <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="chip">일정배정</div>
          <strong style={{ fontSize: 24 }}>월별 일정배정 불러오는 중</strong>
          <div className="status note">페이지 본문을 준비하고 있습니다.</div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              height: 56,
              borderRadius: 16,
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          />
          <div
            style={{
              height: 420,
              borderRadius: 20,
              background: "rgba(255, 255, 255, 0.035)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          />
        </div>
      </div>
    </section>
  );
}

export function ScheduleAssignmentRoute() {
  return <ScheduleAssignmentPage />;
}
