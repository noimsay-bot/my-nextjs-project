"use client";

import {
  formatNewsBriefingDateTime,
  formatNewsBriefingSummaryPreview,
  getNewsBriefingCategoryLabel,
  NEWS_BRIEFING_EVENT_STAGE_LABELS,
  NEWS_BRIEFING_PRIORITY_LABELS,
  NEWS_BRIEFING_SLOT_LABELS,
  NewsBriefingAdminRecord,
} from "@/lib/home-news/admin-types";

type NewsBriefingListProps = {
  items: NewsBriefingAdminRecord[];
  selectedId: string | null;
  onSelect: (itemId: string) => void;
  onToggleActive: (item: NewsBriefingAdminRecord) => void;
  togglingId: string | null;
};

export function NewsBriefingList({
  items,
  selectedId,
  onSelect,
  onToggleActive,
  togglingId,
}: NewsBriefingListProps) {
  if (items.length === 0) {
    return <div className="status note">조건에 맞는 뉴스 브리핑이 없습니다.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {items.map((item) => {
        const active = item.is_active ?? true;
        const priority = item.priority ?? "medium";
        const selected = selectedId === item.id;
        const eventStageLabel = item.event_stage ? NEWS_BRIEFING_EVENT_STAGE_LABELS[item.event_stage] : null;

        return (
          <article
            key={item.id}
            style={{
              display: "grid",
              gap: 10,
              padding: 16,
              borderRadius: 18,
              border: selected ? "1px solid rgba(96,165,250,.58)" : "1px solid var(--line)",
              background: selected ? "rgba(59,130,246,.14)" : "rgba(255,255,255,.03)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span className="chip">{NEWS_BRIEFING_SLOT_LABELS[item.briefing_slot ?? "morning_6"]}</span>
                <span className="chip">{getNewsBriefingCategoryLabel(item.category)}</span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,.12)",
                    background: "rgba(255,255,255,.06)",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  우선순위 {NEWS_BRIEFING_PRIORITY_LABELS[priority]}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: active ? "1px solid rgba(16,185,129,.32)" : "1px solid rgba(239,68,68,.3)",
                    background: active ? "rgba(16,185,129,.14)" : "rgba(239,68,68,.14)",
                    fontSize: 12,
                    fontWeight: 800,
                    color: active ? "var(--status-ok-text)" : "var(--status-warn-text)",
                  }}
                >
                  {active ? "활성" : "비활성"}
                </span>
                {eventStageLabel ? <span className="chip">{eventStageLabel}</span> : null}
              </div>
              <span className="muted">{formatNewsBriefingDateTime(item.published_at)}</span>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 18, lineHeight: 1.4 }}>{item.title}</strong>
              <div className="muted" style={{ lineHeight: 1.6 }}>
                {formatNewsBriefingSummaryPreview(item)}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="muted">출처: {item.source_label?.trim() || "-"}</span>
                <span className="muted">실제 시각: {item.occurred_at ? formatNewsBriefingDateTime(item.occurred_at) : "-"}</span>
                <span className="muted">태그: {item.tags?.length ? item.tags.join(", ") : "-"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={() => onSelect(item.id)}>
                  수정
                </button>
                <button
                  type="button"
                  className={active ? "btn" : "btn primary"}
                  disabled={togglingId === item.id}
                  onClick={() => onToggleActive(item)}
                >
                  {active ? "비활성화" : "재활성화"}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
