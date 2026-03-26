import { PublishedSchedulesPanel } from "@/components/schedule/published-schedules-panel";

const cards = [
  {
    title: "근무표",
    body: "주 단위 연장, 평일/주말/휴일 분기, 오프, 자동 재배치, 스냅샷, 수정 모드, 드래그 이동을 분리된 모듈로 옮겼습니다.",
  },
  {
    title: "영상평가 제출",
    body: "최대 3개 카드 제출, 같은 제출자 최신본 갱신, 로컬 저장 구조를 추가했습니다.",
  },
  {
    title: "평가페이지",
    body: "폼 종류별 채점표, 추가 가점, 완료 조건 검증, 상태 표시를 붙였습니다.",
  },
  {
    title: "팀장/관리자",
    body: "평가자 지정, 분기 요약, 사용자 승인/권한 관리용 화면 골격을 넣었습니다.",
  },
];

export default function HomePage() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PublishedSchedulesPanel />
      <section className="subgrid-2">
        {cards.map((card) => (
          <article key={card.title} className="panel">
            <div className="panel-pad">
              <div className="chip">{card.title}</div>
              <h2 style={{ margin: "14px 0 10px", fontSize: 26 }}>{card.title}</h2>
              <p className="muted" style={{ lineHeight: 1.7, margin: 0 }}>
                {card.body}
              </p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
