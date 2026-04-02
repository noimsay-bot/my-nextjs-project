import Link from "next/link";

export default function TeamLeadPage() {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">TEAM LEAD HOME</div>
          <strong style={{ fontSize: 24 }}>팀장 빠른 이동</strong>
          <div className="status note">
            팀장 첫 진입은 가볍게 열고, 필요한 관리 화면으로 바로 이동할 수 있게 했습니다.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/team-lead/reviewer-management" className="btn white">평가자 지정</Link>
            <Link href="/team-lead/contribution" className="btn">기여도</Link>
            <Link href="/team-lead/broadcast-accident" className="btn">방송 사고</Link>
            <Link href="/team-lead/live-safety" className="btn">LIVE무사고</Link>
            <Link href="/team-lead/overall-score" className="btn">종합 점수</Link>
          </div>
        </div>
      </article>
    </section>
  );
}
