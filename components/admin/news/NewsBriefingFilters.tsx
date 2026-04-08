"use client";

import { HOME_NEWS_CATEGORIES } from "@/components/home/home-news.types";
import {
  DEFAULT_NEWS_BRIEFING_FILTERS,
  getNewsBriefingCategoryLabel,
  NEWS_BRIEFING_SLOT_LABELS,
  NEWS_BRIEFING_SLOTS,
  NewsBriefingAdminFilters,
} from "@/lib/home-news/admin-types";

type NewsBriefingFiltersProps = {
  filters: NewsBriefingAdminFilters;
  onChange: (filters: NewsBriefingAdminFilters) => void;
};

export function NewsBriefingFilters({ filters, onChange }: NewsBriefingFiltersProps) {
  return (
    <div className="subgrid-3">
      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">브리핑 슬롯</span>
        <select
          className="field-select"
          value={filters.slot}
          onChange={(event) => onChange({ ...filters, slot: event.target.value as NewsBriefingAdminFilters["slot"] })}
        >
          <option value="all">전체 슬롯</option>
          {NEWS_BRIEFING_SLOTS.map((slot) => (
            <option key={slot} value={slot}>
              {NEWS_BRIEFING_SLOT_LABELS[slot]}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">카테고리</span>
        <select
          className="field-select"
          value={filters.category}
          onChange={(event) =>
            onChange({ ...filters, category: event.target.value as NewsBriefingAdminFilters["category"] })
          }
        >
          <option value="all">전체 카테고리</option>
          {HOME_NEWS_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {getNewsBriefingCategoryLabel(category)}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 8 }}>
        <span className="muted">상태</span>
        <select
          className="field-select"
          value={filters.status}
          onChange={(event) =>
            onChange({ ...filters, status: event.target.value as NewsBriefingAdminFilters["status"] })
          }
        >
          <option value="all">전체 상태</option>
          <option value="active">활성만</option>
          <option value="inactive">비활성만</option>
        </select>
      </label>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "end" }}>
        <button type="button" className="btn" onClick={() => onChange(DEFAULT_NEWS_BRIEFING_FILTERS)}>
          필터 초기화
        </button>
      </div>
    </div>
  );
}
