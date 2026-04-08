"use client";

import {
  formatNewsBriefingDateTime,
  getNewsBriefingCategoryLabel,
  NEWS_BRIEFING_EVENT_STAGE_LABELS,
  NEWS_BRIEFING_PRIORITY_LABELS,
} from "@/lib/home-news/admin-types";
import { NewsBriefingRecommendationWorkspace } from "@/lib/home-news/recommendation-types";

type NewsBriefingRecommendationsProps = {
  workspace: NewsBriefingRecommendationWorkspace;
  onUseCandidate: (candidateId: string) => void;
};

export function NewsBriefingRecommendations({
  workspace,
  onUseCandidate,
}: NewsBriefingRecommendationsProps) {
  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="chip">오늘 주목 후보</div>
          <strong style={{ fontSize: 20 }}>추천 후보와 관심 힌트</strong>
          <span className="muted">자동 게시가 아니라, 운영자가 AI 초안 시작점으로 쓰기 위한 참고 영역입니다.</span>
        </div>

        {workspace.trendHints.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {workspace.trendHints.map((hint) => (
              <span key={hint} className="chip">{hint}</span>
            ))}
          </div>
        ) : null}

        {workspace.candidates.length > 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            {workspace.candidates.map((candidate) => (
              <article
                key={candidate.id}
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 16,
                  borderRadius: 18,
                  border: "1px solid var(--line)",
                  background: "rgba(255,255,255,.03)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="chip">{getNewsBriefingCategoryLabel(candidate.category)}</span>
                    <span className="chip">우선순위 {NEWS_BRIEFING_PRIORITY_LABELS[candidate.priority]}</span>
                    {candidate.eventStage ? (
                      <span className="chip">{NEWS_BRIEFING_EVENT_STAGE_LABELS[candidate.eventStage]}</span>
                    ) : null}
                  </div>
                  <span className="muted">관심수 {candidate.likesCount}</span>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <strong style={{ fontSize: 18, lineHeight: 1.4 }}>{candidate.title}</strong>
                  <div className="muted" style={{ lineHeight: 1.6 }}>{candidate.recommendationReason}</div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="muted">실제 시각: {formatNewsBriefingDateTime(candidate.occurredAt)}</span>
                  <span className="muted">게시 시각: {formatNewsBriefingDateTime(candidate.publishedAt)}</span>
                  <span className="muted">태그: {candidate.tags.length ? candidate.tags.join(", ") : "-"}</span>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => onUseCandidate(candidate.id)}>
                    AI 입력에 반영
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="status note">아직 추천 후보를 만들 만큼 유효한 브리핑 데이터가 없습니다.</div>
        )}
      </div>
    </article>
  );
}
