"use client";

import { useState, useTransition } from "react";
import { HOME_NEWS_CATEGORIES } from "@/components/home/home-news.types";
import { generateNewsAIDraft } from "@/lib/home-news/ai-draft-actions";
import {
  applyDraftToNewsFormValues,
  NewsAIDraftRequestInput,
  NewsAIDraftResult,
} from "@/lib/home-news/ai-draft-types";
import {
  getNewsBriefingCategoryLabel,
  isNewsBriefingFormEmpty,
  NEWS_BRIEFING_EVENT_STAGE_OPTIONS,
  NEWS_BRIEFING_PRIORITY_LABELS,
  NEWS_BRIEFING_SLOT_LABELS,
  NEWS_BRIEFING_SLOTS,
  NewsBriefingFormValues,
} from "@/lib/home-news/admin-types";

type NewsAIDraftPanelProps = {
  formValues: NewsBriefingFormValues;
  request: NewsAIDraftRequestInput;
  onRequestChange: (request: NewsAIDraftRequestInput) => void;
  onApplyDraft: (values: NewsBriefingFormValues) => void;
  onStatus: (tone: "ok" | "warn" | "note", text: string) => void;
};

export function NewsAIDraftPanel({
  formValues,
  request,
  onRequestChange,
  onApplyDraft,
  onStatus,
}: NewsAIDraftPanelProps) {
  const [draft, setDraft] = useState<NewsAIDraftResult | null>(null);
  const [isGenerating, startGeneratingTransition] = useTransition();

  const applyDraft = (mode: "overwrite" | "fill_empty") => {
    if (!draft) return;
    const baseValues: NewsBriefingFormValues = {
      ...formValues,
      category: request.category,
      briefingSlot: request.briefingSlot,
      eventStage: request.eventStage,
      occurredAt: request.eventTime,
      sourceLabel: request.sourceLabel,
    };

    if (mode === "overwrite" && !isNewsBriefingFormEmpty(formValues)) {
      const confirmed = window.confirm("현재 입력한 폼 값을 AI 초안으로 덮어쓸까요?");
      if (!confirmed) {
        return;
      }
    }

    onApplyDraft(applyDraftToNewsFormValues(baseValues, draft, mode));
    onStatus("ok", mode === "overwrite" ? "AI 초안을 폼에 반영했습니다." : "비어 있는 필드에 AI 초안을 채웠습니다.");
  };

  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="chip">AI 초안 생성</div>
          <strong style={{ fontSize: 20 }}>기사 메모를 바탕으로 초안 만들기</strong>
          <span className="muted">AI는 초안만 생성하고, 실제 저장은 아래 관리자 저장 버튼을 눌렀을 때만 반영됩니다.</span>
        </div>

        <div className="subgrid-2">
          <label style={{ display: "grid", gap: 8 }}>
            <span className="muted">카테고리</span>
            <select
              className="field-select"
              value={request.category}
              onChange={(event) => onRequestChange({ ...request, category: event.target.value as NewsAIDraftRequestInput["category"] })}
            >
              {HOME_NEWS_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {getNewsBriefingCategoryLabel(category)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="muted">브리핑 슬롯</span>
            <select
              className="field-select"
              value={request.briefingSlot}
              onChange={(event) => onRequestChange({ ...request, briefingSlot: event.target.value as NewsAIDraftRequestInput["briefingSlot"] })}
            >
              {NEWS_BRIEFING_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {NEWS_BRIEFING_SLOT_LABELS[slot]}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="muted">수사 진행 단계</span>
            <select
              className="field-select"
              value={request.eventStage}
              onChange={(event) => onRequestChange({ ...request, eventStage: event.target.value as NewsAIDraftRequestInput["eventStage"] })}
            >
              {NEWS_BRIEFING_EVENT_STAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="muted">실제 발생 시각</span>
            <input
              type="datetime-local"
              className="field-input"
              value={request.eventTime}
              onChange={(event) => onRequestChange({ ...request, eventTime: event.target.value })}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="muted">관련 인물/기관 키워드</span>
            <input
              className="field-input"
              value={request.relatedKeywords}
              onChange={(event) => onRequestChange({ ...request, relatedKeywords: event.target.value })}
              placeholder="예: 검찰, 경찰, 법원, 홍길동"
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="muted">출처 라벨</span>
            <input
              className="field-input"
              value={request.sourceLabel}
              onChange={(event) => onRequestChange({ ...request, sourceLabel: event.target.value })}
              placeholder="예: JTBC 취재, 법원 공지"
            />
          </label>
        </div>

        {(request.recommendationReason || request.importanceHints.length > 0 || request.personalizationHints.length > 0) ? (
          <div style={{ display: "grid", gap: 8, padding: 14, borderRadius: 16, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)" }}>
            {request.recommendationReason ? (
              <div className="muted" style={{ lineHeight: 1.6 }}>
                추천 근거: {request.recommendationReason}
              </div>
            ) : null}
            {request.importanceHints.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {request.importanceHints.map((hint) => (
                  <span key={hint} className="chip">{hint}</span>
                ))}
              </div>
            ) : null}
            {request.personalizationHints.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {request.personalizationHints.map((hint) => (
                  <span key={hint} className="chip">{hint}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">참고 원문 또는 기사 메모</span>
          <textarea
            className="field-textarea"
            value={request.referenceText}
            onChange={(event) => onRequestChange({ ...request, referenceText: event.target.value })}
            placeholder="기사 원문, 속보 메모, 취재 노트 등을 붙여 넣어 주세요."
            style={{ minHeight: 160 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            disabled={isGenerating}
            onClick={() =>
              startGeneratingTransition(() => {
                void (async () => {
                  const result = await generateNewsAIDraft(request);
                  if (!result.ok || !result.draft) {
                    onStatus("warn", result.message);
                    return;
                  }

                  setDraft(result.draft);
                  onStatus("ok", result.message);
                })();
              })
            }
          >
            {draft ? "AI 초안 재생성" : "AI 초안 생성"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!draft}
            onClick={() => applyDraft("overwrite")}
          >
            폼 전체 덮어쓰기
          </button>
          <button
            type="button"
            className="btn"
            disabled={!draft}
            onClick={() => applyDraft("fill_empty")}
          >
            빈칸만 채우기
          </button>
        </div>

        {draft ? (
          <div style={{ display: "grid", gap: 12, padding: 16, borderRadius: 18, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong style={{ fontSize: 18 }}>{draft.title}</strong>
              <span className="chip">우선순위 제안 {NEWS_BRIEFING_PRIORITY_LABELS[draft.priority]}</span>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              {draft.summaryLines.map((line, index) => (
                <div key={`summary-${index}`} className="muted" style={{ lineHeight: 1.6 }}>
                  {line}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <strong>왜 중요한지</strong>
              <div className="muted" style={{ lineHeight: 1.6 }}>{draft.whyItMatters}</div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <strong>체크 포인트</strong>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {draft.checkPoints.map((point, index) => (
                  <li key={`checkpoint-${index}`}>{point}</li>
                ))}
              </ul>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong>전광판 문구</strong>
              <span className="muted">{draft.briefingText}</span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {draft.tags.map((tag) => (
                <span key={tag} className="chip">{tag}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="status note">AI 초안을 생성하면 여기서 먼저 검토한 뒤 폼에 반영할 수 있습니다.</div>
        )}
      </div>
    </article>
  );
}
