"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { NewsAIDraftPanel } from "@/components/admin/news/NewsAIDraftPanel";
import { NewsBriefingRecommendations } from "@/components/admin/news/NewsBriefingRecommendations";
import { NewsExternalCandidates } from "@/components/admin/news/NewsExternalCandidates";
import { NewsIssueSetManager } from "@/components/admin/news/NewsIssueSetManager";
import { NewsBriefingFilters } from "@/components/admin/news/NewsBriefingFilters";
import { NewsBriefingForm } from "@/components/admin/news/NewsBriefingForm";
import { NewsBriefingList } from "@/components/admin/news/NewsBriefingList";
import { createDefaultNewsAIDraftRequest, NewsAIDraftRequestInput } from "@/lib/home-news/ai-draft-types";
import { saveNewsBriefing, toggleNewsBriefingActive } from "@/lib/home-news/admin-actions";
import {
  createDefaultNewsBriefingFormValues,
  DEFAULT_NEWS_BRIEFING_FILTERS,
  NewsBriefingAdminRecord,
  NewsBriefingFormValues,
  toLocalDateTimeInputValue,
  toNewsBriefingFormValues,
} from "@/lib/home-news/admin-types";
import { getNewsBriefingAdminWorkspace } from "@/lib/home-news/admin-queries";
import { getNewsBriefingRecommendationWorkspace } from "@/lib/home-news/recommendation-queries";

type StatusMessage = {
  tone: "ok" | "warn" | "note";
  text: string;
};

export function NewsBriefingAdminPage() {
  const [items, setItems] = useState<NewsBriefingAdminRecord[]>([]);
  const [filters, setFilters] = useState(DEFAULT_NEWS_BRIEFING_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<NewsBriefingFormValues>(createDefaultNewsBriefingFormValues);
  const [draftRequest, setDraftRequest] = useState<NewsAIDraftRequestInput>(createDefaultNewsAIDraftRequest);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isSaving, startSavingTransition] = useTransition();

  const refresh = async (nextSelectedId?: string | null) => {
    setLoading(true);
    try {
      const workspace = await getNewsBriefingAdminWorkspace();
      setItems(workspace.items);
      setSelectedId((current) => {
        if (typeof nextSelectedId !== "undefined") {
          return nextSelectedId;
        }
        if (!current) return null;
        return workspace.items.some((item) => item.id === current) ? current : null;
      });
    } catch (error) {
      setStatus({
        tone: "warn",
        text: error instanceof Error ? error.message : "뉴스 브리핑 목록을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    setFormValues(selectedItem ? toNewsBriefingFormValues(selectedItem) : createDefaultNewsBriefingFormValues());
    setDraftRequest(
      createDefaultNewsAIDraftRequest(
        selectedItem ? toNewsBriefingFormValues(selectedItem) : createDefaultNewsBriefingFormValues(),
      ),
    );
  }, [selectedItem]);

  useEffect(() => {
    setDraftRequest((current) => ({
      ...current,
      category: formValues.category,
      briefingSlot: formValues.briefingSlot,
      eventStage: formValues.eventStage,
      eventTime: formValues.occurredAt,
      sourceLabel: formValues.sourceLabel,
      priorityHint: formValues.priority,
    }));
  }, [
    formValues.briefingSlot,
    formValues.category,
    formValues.eventStage,
    formValues.occurredAt,
    formValues.priority,
    formValues.sourceLabel,
  ]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filters.slot !== "all" && item.briefing_slot !== filters.slot) {
        return false;
      }
      if (filters.category !== "all" && item.category !== filters.category) {
        return false;
      }
      if (filters.status === "active" && !item.is_active) {
        return false;
      }
      if (filters.status === "inactive" && item.is_active) {
        return false;
      }
      return true;
    });
  }, [filters, items]);

  const activeCount = useMemo(() => items.filter((item) => item.is_active).length, [items]);
  const recommendationWorkspace = useMemo(
    () => getNewsBriefingRecommendationWorkspace(items),
    [items],
  );

  const handleSubmit = (values: NewsBriefingFormValues, itemId?: string) => {
    startSavingTransition(() => {
      void (async () => {
        const result = await saveNewsBriefing({ id: itemId, values });
        setStatus({
          tone: result.ok ? "ok" : "warn",
          text: result.message,
        });

        if (result.ok) {
          await refresh(result.item?.id ?? itemId ?? null);
        }
      })();
    });
  };

  const handleToggleActive = async (item: NewsBriefingAdminRecord) => {
    const nextIsActive = !(item.is_active ?? true);
    setTogglingId(item.id);
    const result = await toggleNewsBriefingActive(item.id, nextIsActive);
    setStatus({
      tone: result.ok ? "ok" : "warn",
      text: result.message,
    });
    if (result.ok) {
      await refresh(selectedId);
    }
    setTogglingId(null);
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div className="chip">ADMIN NEWS DESK</div>
              <h1 className="page-title" style={{ margin: 0, fontSize: 34 }}>뉴스 브리핑 관리자 입력</h1>
              <div className="muted" style={{ lineHeight: 1.6 }}>
                홈 뉴스 브리핑은 기존 Supabase 데이터를 그대로 읽고, 이 화면은 관리자 입력과 비활성화만 담당합니다.
              </div>
            </div>
            <Link href="/admin" className="btn">
              관리자 메인
            </Link>
          </div>

          <div className="subgrid-3">
            <article className="kpi">
              <div className="kpi-label">전체 기사</div>
              <div className="kpi-value">{items.length}</div>
            </article>
            <article className="kpi">
              <div className="kpi-label">활성 기사</div>
              <div className="kpi-value">{activeCount}</div>
            </article>
            <article className="kpi">
              <div className="kpi-label">현재 목록</div>
              <div className="kpi-value">{filteredItems.length}</div>
            </article>
          </div>

          {status ? <div className={`status ${status.tone}`}>{status.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">목록 필터</div>
              <span className="muted">슬롯·카테고리·활성 상태 기준으로 빠르게 정리할 수 있습니다.</span>
            </div>
            <button type="button" className="btn" onClick={() => void refresh(selectedId)}>
              목록 새로고침
            </button>
          </div>
          <NewsBriefingFilters filters={filters} onChange={setFilters} />
        </div>
      </article>

      <div className="subgrid-2" style={{ alignItems: "start" }}>
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">뉴스 목록</div>
              <span className="muted">최신순 정렬, 수정 진입, 활성/비활성 전환</span>
            </div>
            {loading ? (
              <div className="status note">뉴스 브리핑 목록을 불러오는 중입니다.</div>
            ) : (
              <NewsBriefingList
                items={filteredItems}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggleActive={handleToggleActive}
                togglingId={togglingId}
              />
            )}
          </div>
        </article>

        <div style={{ display: "grid", gap: 16 }}>
          <NewsIssueSetManager
            items={items}
            onStatus={(tone, text) => setStatus({ tone, text })}
          />

          <NewsExternalCandidates
            records={items}
            onUseCandidate={(candidate, slot) => {
              setDraftRequest((current) => ({
                ...current,
                category: candidate.category,
                briefingSlot: slot,
                referenceText: candidate.referenceText,
                relatedKeywords: candidate.tags.join(", "),
                eventStage: candidate.eventStage ?? "",
                eventTime: toLocalDateTimeInputValue(candidate.occurredAt),
                sourceLabel: candidate.source,
                priorityHint: candidate.priority,
                recommendationReason: candidate.recommendationReason,
                importanceHints: candidate.importanceHints,
                personalizationHints: candidate.personalizationHints,
              }));
              setStatus({
                tone: "note",
                text: `${slot === "morning_6" ? "오전 6시" : "오후 3시"} 외부 후보를 AI 초안 입력값에 반영했습니다.`,
              });
            }}
            onStatus={(tone, text) => setStatus({ tone, text })}
          />

          <NewsBriefingRecommendations
            workspace={recommendationWorkspace}
            onUseCandidate={(candidateId) => {
              const candidate = recommendationWorkspace.candidates.find((item) => item.id === candidateId);
              if (!candidate) return;

              setDraftRequest((current) => ({
                ...current,
                category: candidate.category,
                briefingSlot: formValues.briefingSlot,
                referenceText: candidate.referenceText,
                relatedKeywords: candidate.relatedKeywords,
                eventStage: candidate.eventStage ?? "",
                eventTime: candidate.occurredAt
                  ? toNewsBriefingFormValues(candidate.record).occurredAt
                  : "",
                sourceLabel: candidate.sourceLabel,
                priorityHint: candidate.priority,
                recommendationReason: candidate.recommendationReason,
                importanceHints: candidate.importanceHints,
                personalizationHints: candidate.personalizationHints,
              }));
              setStatus({
                tone: "note",
                text: "추천 후보 정보를 AI 초안 입력값에 반영했습니다.",
              });
            }}
          />

          <NewsAIDraftPanel
            formValues={formValues}
            request={draftRequest}
            onRequestChange={setDraftRequest}
            onApplyDraft={setFormValues}
            onStatus={(tone, text) => setStatus({ tone, text })}
          />

          <article className="panel">
            <div className="panel-pad">
              <NewsBriefingForm
                selectedItem={selectedItem}
                values={formValues}
                onChange={setFormValues}
                submitting={isSaving}
                onSubmit={handleSubmit}
                onResetSelection={() => setSelectedId(null)}
                onResetValues={() =>
                  setFormValues(selectedItem ? toNewsBriefingFormValues(selectedItem) : createDefaultNewsBriefingFormValues())
                }
              />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
