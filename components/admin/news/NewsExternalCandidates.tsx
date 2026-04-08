"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  formatNewsBriefingDateTime,
  getNewsBriefingCategoryLabel,
  NEWS_BRIEFING_EVENT_STAGE_LABELS,
  NEWS_BRIEFING_SLOT_LABELS,
} from "@/lib/home-news/admin-types";
import { loadExternalNewsWorkspace } from "@/lib/home-news/external-source-actions";
import { ExternalNewsCandidate, ExternalNewsWorkspace } from "@/lib/home-news/external-source-types";
import { NewsBriefingAdminRecord } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";

type NewsExternalCandidatesProps = {
  records: NewsBriefingAdminRecord[];
  onUseCandidate: (candidate: ExternalNewsCandidate, slot: HomeNewsBriefingSlot) => void;
  onStatus: (tone: "ok" | "warn" | "note", text: string) => void;
};

export function NewsExternalCandidates({
  records,
  onUseCandidate,
  onStatus,
}: NewsExternalCandidatesProps) {
  const [workspace, setWorkspace] = useState<ExternalNewsWorkspace | null>(null);
  const [activeSlot, setActiveSlot] = useState<HomeNewsBriefingSlot>("morning_6");
  const [isLoading, startLoadingTransition] = useTransition();

  const loadCandidates = () => {
    startLoadingTransition(() => {
      void (async () => {
        const result = await loadExternalNewsWorkspace(records);
        if (!result.ok || !result.workspace) {
          onStatus("warn", result.message);
          setWorkspace(null);
          return;
        }

        setWorkspace(result.workspace);
        onStatus("note", result.message);
      })();
    });
  };

  useEffect(() => {
    loadCandidates();
  }, [records]);

  const activeBatch = useMemo(
    () => workspace?.batches[activeSlot] ?? null,
    [activeSlot, workspace],
  );

  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="chip">외부 뉴스 후보</div>
            <strong style={{ fontSize: 20 }}>수집 뉴스와 배치 후보</strong>
            <span className="muted">외부 후보는 임시 참고용이며, 저장이나 게시로 바로 이어지지 않습니다.</span>
          </div>
          <button type="button" className="btn" disabled={isLoading} onClick={loadCandidates}>
            {isLoading ? "후보 갱신 중" : "후보 새로고침"}
          </button>
        </div>

        {workspace?.trendHints?.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {workspace.trendHints.map((hint) => (
              <span key={hint} className="chip">{hint}</span>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["morning_6", "afternoon_3"] as const).map((slot) => (
            <button
              key={slot}
              type="button"
              className={`btn ${activeSlot === slot ? "primary" : ""}`}
              onClick={() => setActiveSlot(slot)}
            >
              {NEWS_BRIEFING_SLOT_LABELS[slot]}
            </button>
          ))}
        </div>

        {workspace ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="muted">
              {activeBatch?.headline ?? "후보를 불러오는 중입니다."}
            </div>

            {activeBatch && activeBatch.items.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {activeBatch.items.map((candidate) => (
                  <article
                    key={`${activeSlot}-${candidate.id}`}
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
                        {candidate.eventStage ? (
                          <span className="chip">{NEWS_BRIEFING_EVENT_STAGE_LABELS[candidate.eventStage]}</span>
                        ) : null}
                        <span className="chip">{candidate.source}</span>
                      </div>
                      <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="btn">
                        원문 열기
                      </a>
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <strong style={{ fontSize: 18, lineHeight: 1.4 }}>{candidate.title}</strong>
                      <div className="muted" style={{ lineHeight: 1.6 }}>
                        {candidate.recommendationReason}
                      </div>
                      {candidate.excerpt ? (
                        <div className="muted" style={{ lineHeight: 1.6 }}>
                          {candidate.excerpt}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted">게시 시각: {formatNewsBriefingDateTime(candidate.publishedAt)}</span>
                      <span className="muted">실제 시각: {formatNewsBriefingDateTime(candidate.occurredAt)}</span>
                      <span className="muted">태그: {candidate.tags.length ? candidate.tags.join(", ") : "-"}</span>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => onUseCandidate(candidate, activeSlot)}>
                        AI 입력에 반영
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="status note">이 슬롯에 표시할 외부 후보가 아직 없습니다.</div>
            )}
          </div>
        ) : (
          <div className="status note">외부 뉴스 후보를 불러오면 이 영역에 오전 6시 / 오후 3시 배치 후보가 나옵니다.</div>
        )}
      </div>
    </article>
  );
}
