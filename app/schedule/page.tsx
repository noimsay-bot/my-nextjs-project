import Link from "next/link";

export default function SchedulePage() {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK HOME</div>
          <strong style={{ fontSize: 24 }}>DESK 빠른 이동</strong>
          <div className="status note">
            진입 속도를 줄이기 위해 DESK 첫 화면은 가볍게 유지하고, 필요한 작업 화면으로 바로 이동할 수 있게 구성했습니다.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/schedule/schedule-assignment" className="btn white">일정배정</Link>
            <Link href="/schedule/write" className="btn">근무 관리</Link>
            <Link href="/schedule/final-cut" className="btn">정제본</Link>
            <Link href="/schedule/domestic-trip" className="btn">국내출장</Link>
            <Link href="/schedule/international-trip" className="btn">해외출장</Link>
          </div>
        </div>
      </article>
    </section>
  );
}
