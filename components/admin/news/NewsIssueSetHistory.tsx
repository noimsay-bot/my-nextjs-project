"use client";

import { formatNewsBriefingDateTime, NEWS_BRIEFING_SLOT_LABELS } from "@/lib/home-news/admin-types";
import { getNewsIssueSetStatusLabel, NewsIssueSetRecord } from "@/lib/home-news/issue-set-types";

type NewsIssueSetHistoryProps = {
  items: NewsIssueSetRecord[];
};

export function NewsIssueSetHistory({ items }: NewsIssueSetHistoryProps) {
  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="chip">발행 이력</div>
          <strong style={{ fontSize: 20 }}>이전 세트 기록</strong>
          <span className="muted">어떤 날짜와 슬롯에 어떤 공식 세트가 반영됐는지 최근 이력을 확인합니다.</span>
        </div>

        {items.length > 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((item) => (
              <article
                key={item.id}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 16,
                  borderRadius: 18,
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,.03)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="chip">{item.issue_date}</span>
                    <span className="chip">{NEWS_BRIEFING_SLOT_LABELS[item.briefing_slot]}</span>
                    <span className="chip">{getNewsIssueSetStatusLabel(item.status)}</span>
                  </div>
                  <span className="muted">포함 뉴스 {item.items.length}개</span>
                </div>

                <div style={{ display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 17 }}>{item.title}</strong>
                  <div className="muted">발행 시각: {formatNewsBriefingDateTime(item.published_at)}</div>
                </div>

                <div className="muted" style={{ lineHeight: 1.6 }}>
                  {item.items.length > 0
                    ? item.items.map((entry) => `${entry.display_order}. ${entry.briefing?.title ?? "연결된 뉴스 없음"}`).join(" / ")
                    : "아직 연결된 뉴스가 없습니다."}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="status note">아직 발행 세트 이력이 없습니다.</div>
        )}
      </div>
    </article>
  );
}
