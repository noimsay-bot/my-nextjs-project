export default function ScheduleLoading() {
  return (
    <section className="panel" aria-busy="true" aria-live="polite">
      <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="chip">DESK</div>
          <strong style={{ fontSize: 24 }}>일정배정 불러오는 중</strong>
          <div className="status note">페이지와 데이터가 준비되면 바로 표시됩니다.</div>
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
