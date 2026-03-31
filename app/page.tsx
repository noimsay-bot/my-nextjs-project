import { PublishedSchedulesPanel } from "@/components/schedule/published-schedules-panel";

const cards = [
  {
    title: "근무표",
    body: "주 단위 편성, 휴일/주말/공휴일 분기, 스왑과 수동 편집, 자동 재배치까지 한 화면에서 운영할 수 있습니다.",
  },
  {
    title: "베스트리포트 제출",
    body: "최대 3개 카드까지 제출하고, 같은 제출자의 최신 제출본을 기준으로 저장합니다.",
  },
  {
    title: "베스트리포트 평가",
    body: "배정된 제출만 열람하고 점수와 코멘트를 저장하며, 완료 상태까지 이어서 관리할 수 있습니다.",
  },
  {
    title: "팀장 / 관리자",
    body: "배정 관리, 권한 관리, 승인 상태 변경, 운영 현황 확인을 같은 포털 안에서 처리할 수 있습니다.",
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
