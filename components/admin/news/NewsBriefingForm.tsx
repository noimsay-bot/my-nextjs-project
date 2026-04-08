"use client";

import { type CSSProperties, type FormEvent } from "react";
import { HOME_NEWS_CATEGORIES } from "@/components/home/home-news.types";
import {
  getNewsBriefingCategoryLabel,
  NEWS_BRIEFING_EVENT_STAGE_OPTIONS,
  NEWS_BRIEFING_PRIORITY_LABELS,
  NEWS_BRIEFING_PRIORITIES,
  NEWS_BRIEFING_SLOT_LABELS,
  NEWS_BRIEFING_SLOTS,
  NewsBriefingAdminRecord,
  NewsBriefingFormValues,
} from "@/lib/home-news/admin-types";

type NewsBriefingFormProps = {
  selectedItem: NewsBriefingAdminRecord | null;
  values: NewsBriefingFormValues;
  onChange: (values: NewsBriefingFormValues) => void;
  submitting: boolean;
  onSubmit: (values: NewsBriefingFormValues, itemId?: string) => void;
  onResetSelection: () => void;
  onResetValues: () => void;
};

type FieldErrors = Partial<Record<keyof NewsBriefingFormValues, string>>;

function validateForm(values: NewsBriefingFormValues) {
  const errors: FieldErrors = {};
  const occurredAtInvalid = values.occurredAt.trim().length > 0 && Number.isNaN(new Date(values.occurredAt).getTime());

  if (!values.title.trim()) {
    errors.title = "제목은 필수입니다.";
  }
  if (!values.summary.trim()) {
    errors.summary = "요약은 필수입니다.";
  }
  if (!values.whyItMatters.trim()) {
    errors.whyItMatters = "왜 중요한지 입력해 주세요.";
  }
  if (!values.checkPoints.trim()) {
    errors.checkPoints = "체크 포인트를 입력해 주세요.";
  }
  if (!values.publishedAt.trim()) {
    errors.publishedAt = "발행 시각을 입력해 주세요.";
  }
  if (occurredAtInvalid) {
    errors.occurredAt = "실제 발생 시각 형식을 확인해 주세요.";
  }

  return errors;
}

export function NewsBriefingForm({
  selectedItem,
  values,
  onChange,
  submitting,
  onSubmit,
  onResetSelection,
  onResetValues,
}: NewsBriefingFormProps) {
  const errors = validateForm(values);

  const isEditMode = Boolean(selectedItem);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0) {
      return;
    }
    onSubmit(values, selectedItem?.id);
  };

  const helperTextStyle: CSSProperties = {
    fontSize: 12,
    lineHeight: 1.5,
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="chip">{isEditMode ? "기존 뉴스 수정" : "새 뉴스 작성"}</div>
          <strong style={{ fontSize: 20 }}>{isEditMode ? "뉴스 브리핑 수정" : "뉴스 브리핑 등록"}</strong>
        </div>
        {isEditMode ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              onResetSelection();
            }}
          >
            신규 작성으로 전환
          </button>
        ) : null}
      </div>

      <div className="subgrid-2">
        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">카테고리</span>
          <select
            className="field-select"
            value={values.category}
            onChange={(event) =>
              onChange({ ...values, category: event.target.value as NewsBriefingFormValues["category"] })
            }
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
            value={values.briefingSlot}
            onChange={(event) =>
              onChange({ ...values, briefingSlot: event.target.value as NewsBriefingFormValues["briefingSlot"] })
            }
          >
            {NEWS_BRIEFING_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {NEWS_BRIEFING_SLOT_LABELS[slot]}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">우선순위</span>
          <select
            className="field-select"
            value={values.priority}
            onChange={(event) =>
              onChange({ ...values, priority: event.target.value as NewsBriefingFormValues["priority"] })
            }
          >
            {NEWS_BRIEFING_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {NEWS_BRIEFING_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">발행 시각</span>
          <input
            type="datetime-local"
            className="field-input"
            value={values.publishedAt}
            onChange={(event) => onChange({ ...values, publishedAt: event.target.value })}
          />
          {errors.publishedAt ? <span className="muted" style={helperTextStyle}>{errors.publishedAt}</span> : null}
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">실제 발생 시각</span>
          <input
            type="datetime-local"
            className="field-input"
            value={values.occurredAt}
            onChange={(event) => onChange({ ...values, occurredAt: event.target.value })}
          />
          <span className="muted" style={helperTextStyle}>사건 발생, 출석, 조사 시작, 영장심사 예정 시각 등을 기록합니다.</span>
          {errors.occurredAt ? <span className="muted" style={helperTextStyle}>{errors.occurredAt}</span> : null}
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">수사 진행 단계</span>
          <select
            className="field-select"
            value={values.eventStage}
            onChange={(event) =>
              onChange({ ...values, eventStage: event.target.value as NewsBriefingFormValues["eventStage"] })
            }
          >
            {NEWS_BRIEFING_EVENT_STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">활성 상태</span>
          <select
            className="field-select"
            value={values.isActive ? "true" : "false"}
            onChange={(event) => onChange({ ...values, isActive: event.target.value === "true" })}
          >
            <option value="true">활성</option>
            <option value="false">비활성</option>
          </select>
        </label>
      </div>

      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">제목</span>
        <input
          className="field-input"
          value={values.title}
          onChange={(event) => onChange({ ...values, title: event.target.value })}
          placeholder="홈 뉴스 카드 제목"
        />
        {errors.title ? <span className="muted" style={helperTextStyle}>{errors.title}</span> : null}
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">요약</span>
        <textarea
          className="field-textarea"
          value={values.summary}
          onChange={(event) => onChange({ ...values, summary: event.target.value })}
          placeholder="줄바꿈으로 여러 요약 문장을 입력하면 홈 카드의 요약 줄로 저장됩니다."
          style={{ minHeight: 120 }}
        />
        <span className="muted" style={helperTextStyle}>줄바꿈 기준으로 여러 줄을 저장합니다.</span>
        {errors.summary ? <span className="muted" style={helperTextStyle}>{errors.summary}</span> : null}
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">왜 중요한가</span>
        <textarea
          className="field-textarea"
          value={values.whyItMatters}
          onChange={(event) => onChange({ ...values, whyItMatters: event.target.value })}
          placeholder="운영자가 중요도를 판단하는 설명"
          style={{ minHeight: 96 }}
        />
        {errors.whyItMatters ? <span className="muted" style={helperTextStyle}>{errors.whyItMatters}</span> : null}
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">체크 포인트</span>
        <textarea
          className="field-textarea"
          value={values.checkPoints}
          onChange={(event) => onChange({ ...values, checkPoints: event.target.value })}
          placeholder="줄바꿈으로 여러 체크 포인트를 입력해 주세요."
          style={{ minHeight: 120 }}
        />
        <span className="muted" style={helperTextStyle}>여러 줄 입력 시 각 줄이 별도 항목으로 저장됩니다.</span>
        {errors.checkPoints ? <span className="muted" style={helperTextStyle}>{errors.checkPoints}</span> : null}
      </label>

      <div className="subgrid-2">
        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">전광판 브리핑 문구</span>
          <input
            className="field-input"
            value={values.briefingText}
            onChange={(event) => onChange({ ...values, briefingText: event.target.value })}
            placeholder="짧고 강한 전광판용 문구"
          />
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">출처 라벨</span>
          <input
            className="field-input"
            value={values.sourceLabel}
            onChange={(event) => onChange({ ...values, sourceLabel: event.target.value })}
            placeholder="예: JTBC 취재, 법원 공지, 통계청"
          />
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span className="muted">태그</span>
          <input
            className="field-input"
            value={values.tags}
            onChange={(event) => onChange({ ...values, tags: event.target.value })}
            placeholder="쉼표로 구분해 입력"
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="submit" className="btn primary" disabled={submitting}>
          {isEditMode ? "수정 저장" : "새 뉴스 저장"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={submitting}
          onClick={onResetValues}
        >
          입력값 되돌리기
        </button>
      </div>
    </form>
  );
}
