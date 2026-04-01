"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  additionalBonusOptions,
  cardNeedsBonusComment,
  createEmptyReviewCardState,
  getCardSections,
  getReviewCardScore,
  getReviewEntryScore,
  getReviewWorkspace,
  getSubmissionEntryKey,
  normalizeReviewStateEntry,
  ReviewCardState,
  ReviewStateStore,
  saveReviewEntry,
  subscribeToReviewWorkspaceChanges,
  SubmissionCard,
  SubmissionEntry,
} from "@/lib/portal/data";

function getPreviewSource(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(parsed.pathname)) {
      return { kind: "video" as const, src: trimmed };
    }

    if (host.includes("youtu.be")) {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      if (videoId) return { kind: "iframe" as const, src: `https://www.youtube.com/embed/${videoId}` };
    }

    if (host.includes("youtube.com")) {
      const videoId = parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).at(-1);
      if (videoId) return { kind: "iframe" as const, src: `https://www.youtube.com/embed/${videoId}` };
    }

    if (host.includes("vimeo.com")) {
      const videoId = parsed.pathname.split("/").filter(Boolean).at(-1);
      if (videoId) return { kind: "iframe" as const, src: `https://player.vimeo.com/video/${videoId}` };
    }

    if (host.includes("drive.google.com")) {
      const parts = parsed.pathname.split("/");
      const fileIndex = parts.findIndex((part) => part === "d");
      const fileId = fileIndex >= 0 ? parts[fileIndex + 1] : parsed.searchParams.get("id");
      if (fileId) return { kind: "iframe" as const, src: `https://drive.google.com/file/d/${fileId}/preview` };
    }

    return { kind: "iframe" as const, src: trimmed };
  } catch {
    return null;
  }
}

function getCardLabel(card: SubmissionCard, index: number) {
  return card.title?.trim() ? `${index + 1}. ${card.title}` : `${index + 1}. ${card.type}`;
}

function getCardSummaryLabel(card: SubmissionCard) {
  return card.title?.trim() || card.type;
}

export default function ReviewPage() {
  const [submissions, setSubmissions] = useState<SubmissionEntry[]>([]);
  const [selectedEntryKey, setSelectedEntryKey] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [reviewState, setReviewState] = useState<ReviewStateStore>({});
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const saveTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    async function loadWorkspace() {
      setLoading(true);
      try {
        const workspace = await getReviewWorkspace();
        if (!active) return;

        setSubmissions(workspace.entries);
        setReviewState(workspace.reviewState);
        setSelectedEntryKey((currentKey) => {
          if (workspace.entries.some((entry) => getSubmissionEntryKey(entry) === currentKey)) {
            return currentKey;
          }

          return workspace.entries[0] ? getSubmissionEntryKey(workspace.entries[0]) : "";
        });
        setCanEdit(workspace.canEdit);
        setReadOnlyReason(workspace.readOnlyReason);
      } catch (error) {
        if (!active) return;
        setSaveMessage(error instanceof Error ? error.message : "평가 작업 영역을 불러오지 못했습니다.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadWorkspace();
    void subscribeToReviewWorkspaceChanges(() => {
      if (!active) return;
      void loadWorkspace();
    }).then((nextUnsubscribe) => {
      if (!active) {
        nextUnsubscribe();
        return;
      }

      unsubscribe = nextUnsubscribe;
    });

    const handleVisibilityOrFocus = () => {
      if (!active) return;
      if (document.visibilityState === "hidden") return;
      void loadWorkspace();
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      Object.values(saveTimerRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const current = submissions.find((entry) => getSubmissionEntryKey(entry) === selectedEntryKey);
  const currentKey = current ? getSubmissionEntryKey(current) : "";
  const currentState = normalizeReviewStateEntry(current ? reviewState[currentKey] : null, current);

  useEffect(() => {
    if (!current?.cards.length) {
      setSelectedCardId("");
      return;
    }

    setSelectedCardId((previous) => {
      if (current.cards.some((card) => card.id === previous)) return previous;
      return current.cards[0].id;
    });
  }, [current]);

  const activeCard = current?.cards.find((card) => card.id === selectedCardId) ?? current?.cards[0];
  const activeCardState = activeCard ? (currentState.cards[activeCard.id] ?? createEmptyReviewCardState()) : createEmptyReviewCardState();

  useEffect(() => {
    if (!activeCard?.link.trim()) {
      setPreview(null);
      return;
    }

    setPreview({
      url: activeCard.link,
      title: activeCard.title || activeCard.type,
    });
  }, [activeCard]);

  const previewSource = useMemo(() => {
    if (!preview?.url) return null;
    return getPreviewSource(preview.url);
  }, [preview]);

  const totalScore = useMemo(() => {
    if (!current) return 0;
    return getReviewEntryScore(current, currentState);
  }, [current, currentState]);

  const missingBonusCommentCards = current
    ? current.cards.filter((card) => {
        const cardState = currentState.cards[card.id] ?? createEmptyReviewCardState();
        return cardNeedsBonusComment(card, cardState) && !cardState.bonusComment.trim();
      })
    : [];

  function queuePersist(entry: SubmissionEntry, nextEntryState: typeof currentState) {
    if (!canEdit) return;

    const entryKey = getSubmissionEntryKey(entry);
    const existingTimer = saveTimerRef.current[entryKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    saveTimerRef.current[entryKey] = setTimeout(async () => {
      const result = await saveReviewEntry(entry, nextEntryState);
      setSaveMessage(result.message);
    }, 300);
  }

  const updateCurrentState = (updater: (state: typeof currentState) => typeof currentState) => {
    if (!current) return;
    const nextEntryState = updater(currentState);
    const entryKey = getSubmissionEntryKey(current);
    const nextState = {
      ...reviewState,
      [entryKey]: nextEntryState,
    };
    setReviewState(nextState);
    queuePersist(current, nextEntryState);
  };

  const updateActiveCardState = (updater: (state: ReviewCardState) => ReviewCardState) => {
    if (!activeCard || !canEdit) return;
    updateCurrentState((state) => ({
      ...state,
      done: false,
      cards: {
        ...state.cards,
        [activeCard.id]: updater(state.cards[activeCard.id] ?? createEmptyReviewCardState()),
      },
    }));
  };

  const updateEntryDone = (done: boolean) => {
    if (!canEdit) return;
    updateCurrentState((state) => ({
      ...state,
      done,
    }));
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="chip">Review queue</div>
            <div className="muted" style={{ lineHeight: 1.6 }}>
              {canEdit
                ? "제출된 베스트리포트가 자동으로 이 화면에 표시됩니다. 아래 사람 목록을 선택한 뒤 카드별로 평가해 주세요."
                : "현재 계정은 조회 전용입니다. 제출된 평가 결과를 확인할 수 있지만 수정은 할 수 없습니다."}
            </div>
            {readOnlyReason ? <div className="status note">{readOnlyReason}</div> : null}
            {submissions.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignContent: "flex-start" }}>
                {submissions.map((entry) => {
                  const entryKey = getSubmissionEntryKey(entry);
                  const selected = selectedEntryKey === entryKey;
                  const done = reviewState[entryKey]?.done;
                  return (
                    <button
                      key={entryKey}
                      type="button"
                      className={`btn ${selected ? "white" : ""}`}
                      style={{
                        display: "grid",
                        gap: 4,
                        padding: "9px 12px",
                        minWidth: 140,
                        justifyContent: "flex-start",
                        textAlign: "left",
                        borderColor: done && !selected ? "rgba(16,185,129,.35)" : undefined,
                        background: done && !selected ? "rgba(16,185,129,.12)" : undefined,
                      }}
                      onClick={() => setSelectedEntryKey(entryKey)}
                    >
                      <span style={{ fontWeight: 800 }}>{entry.submitter}</span>
                      {!canEdit && entry.reviewerName ? (
                        <span style={{ fontSize: 12, opacity: 0.8 }}>reviewer: {entry.reviewerName}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="status note">
                {loading ? "평가 대상을 불러오는 중입니다." : "표시할 제출 데이터가 없습니다."}
              </div>
            )}
          </div>

          <div className="chip">영상 평가</div>
          {saveMessage ? <div className="status note">{saveMessage}</div> : null}
          {current && activeCard ? (
            <>
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <strong style={{ fontSize: 24 }}>{current.submitter}</strong>
                    {!canEdit && current.reviewerName ? <span className="muted">reviewer {current.reviewerName}</span> : null}
                  </div>
                  <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                    <span className="muted">마지막 제출 업데이트: {current.updatedAt}</span>
                    {canEdit ? (
                      <button
                        className="btn primary"
                        disabled={missingBonusCommentCards.length > 0}
                        onClick={() => {
                          if (missingBonusCommentCards.length > 0) return;
                          const confirmed = window.confirm("평가를 종료하시겠습니까?");
                          if (!confirmed) return;
                          updateEntryDone(true);
                        }}
                      >
                        모든 평가 제출
                      </button>
                    ) : null}
                    {currentState.done ? <div className="status ok">현재 제출자의 평가가 완료 상태로 저장되었습니다.</div> : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {current.cards.map((card, index) => {
                    const selected = activeCard.id === card.id;
                    const cardScore = getReviewCardScore(card, currentState.cards[card.id]);
                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={`btn ${selected ? "white" : ""}`}
                        style={{ display: "grid", gap: 4, textAlign: "left", minWidth: 160, maxWidth: 260 }}
                        onClick={() => setSelectedCardId(card.id)}
                      >
                        <span style={{ fontSize: 12, color: selected ? "#0b1628" : "#9bb0c7" }}>{card.type}</span>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {getCardLabel(card, index)}
                        </span>
                        <span style={{ fontSize: 12, color: selected ? "#0b1628" : "#9bb0c7" }}>{cardScore}점</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="review-main-grid">
                <div style={{ display: "grid", gap: 16 }}>
                  <section
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 20,
                      padding: 16,
                      display: "grid",
                      gap: 14,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <strong style={{ fontSize: 22 }}>평가 기준</strong>
                        <span className="muted">기본 항목을 체크하고, 필요하면 추가 가점을 선택한 뒤 사유를 적어 주세요.</span>
                      </div>
                    </div>

                    {getCardSections(activeCard).map((section) => (
                      <article
                        key={section.title}
                        style={{
                          display: "grid",
                          gap: 10,
                          padding: 14,
                          borderRadius: 18,
                          border: section.isBonus ? "1px solid rgba(248,113,113,.28)" : "1px solid rgba(255,255,255,.08)",
                          background: section.isBonus ? "rgba(127,29,29,.16)" : "rgba(255,255,255,.03)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <strong style={{ fontSize: 18 }}>{section.title}</strong>
                          <span
                            className="muted"
                            style={{
                              fontSize: 12,
                              color: section.isBonus ? "#fda4af" : "#9bb0c7",
                            }}
                          >
                            {section.isBonus ? "가점 항목" : "기본 항목"}
                          </span>
                        </div>
                        <div style={{ display: "grid", gap: 10 }}>
                          {section.criteria.map((criterion) => {
                            const checked = activeCardState.checked.includes(criterion.id);
                            return (
                              <button
                                key={criterion.id}
                                type="button"
                                disabled={!canEdit}
                                onClick={() => {
                                  updateActiveCardState((state) => {
                                    const nextChecked = checked
                                      ? state.checked.filter((item) => item !== criterion.id)
                                      : [...state.checked, criterion.id];

                                    return {
                                      ...state,
                                      checked: nextChecked,
                                    };
                                  });
                                }}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  alignItems: "center",
                                  width: "100%",
                                  padding: "11px 14px",
                                  borderRadius: 16,
                                  border: checked
                                    ? "1px solid rgba(34,197,94,.55)"
                                    : section.isBonus
                                      ? "1px solid rgba(248,113,113,.28)"
                                      : "1px solid rgba(255,255,255,.1)",
                                  background: checked
                                    ? "rgba(34,197,94,.22)"
                                    : section.isBonus
                                      ? "rgba(153,27,27,.18)"
                                      : "rgba(255,255,255,.04)",
                                  color: checked ? "#dcfce7" : "#f8fbff",
                                  cursor: canEdit ? "pointer" : "default",
                                  textAlign: "left",
                                  opacity: canEdit ? 1 : 0.92,
                                }}
                              >
                                <span style={{ lineHeight: 1.6 }}>{criterion.label}</span>
                                <strong style={{ whiteSpace: "nowrap", color: checked ? "#bbf7d0" : section.isBonus ? "#fecaca" : "#dbeafe" }}>
                                  {criterion.score}점
                                </strong>
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    ))}

                    <article
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 14,
                        borderRadius: 18,
                        border: "1px solid rgba(248,113,113,.28)",
                        background: "rgba(127,29,29,.14)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <strong style={{ fontSize: 18 }}>추가 가점</strong>
                        <span className="muted" style={{ fontSize: 12, color: "#fda4af" }}>
                          별도 가점은 1점부터 5점까지 선택할 수 있습니다.
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {additionalBonusOptions.map((point) => {
                          const selected = activeCardState.bonusScore === point;
                          return (
                            <button
                              key={point}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => {
                                updateActiveCardState((state) => ({
                                  ...state,
                                  bonusScore: state.bonusScore === point ? 0 : point,
                                }));
                              }}
                              style={{
                                padding: "10px 14px",
                                minWidth: 74,
                                borderRadius: 14,
                                border: selected ? "1px solid rgba(34,197,94,.55)" : "1px solid rgba(248,113,113,.32)",
                                background: selected ? "rgba(34,197,94,.22)" : "rgba(153,27,27,.18)",
                                color: selected ? "#dcfce7" : "#ffe4e6",
                                cursor: canEdit ? "pointer" : "default",
                                fontWeight: 800,
                                opacity: canEdit ? 1 : 0.92,
                              }}
                            >
                              {point}점
                            </button>
                          );
                        })}
                      </div>
                      <label>
                        <div style={{ marginBottom: 8 }}>가점 사유 / 보완 코멘트</div>
                        <textarea
                          className="field-textarea"
                          disabled={!canEdit}
                          placeholder="가점이나 보완 의견이 있다면 구체적으로 적어 주세요."
                          value={activeCardState.bonusComment}
                          onChange={(event) => {
                            updateActiveCardState((state) => ({
                              ...state,
                              bonusComment: event.target.value,
                            }));
                          }}
                        />
                      </label>
                      {cardNeedsBonusComment(activeCard, activeCardState) && !activeCardState.bonusComment.trim() ? (
                        <div className="status warn">가점 항목을 선택했거나 추가 가점을 준 경우에는 사유를 반드시 적어야 합니다.</div>
                      ) : null}
                    </article>

                    {!canEdit ? (
                      <div className="status note">현재 화면은 조회 전용입니다. 평가 결과를 확인할 수 있지만 수정할 수는 없습니다.</div>
                    ) : null}

                    {missingBonusCommentCards.length > 0 ? (
                      <div className="status warn">
                        다음 카드에는 가점 사유가 필요합니다: {missingBonusCommentCards.map((card) => getCardSummaryLabel(card)).join(", ")}
                      </div>
                    ) : null}
                  </section>
                </div>

                    <aside
                      style={{
                        display: "grid",
                        gap: 12,
                        alignContent: "start",
                      }}
                    >
                      <div style={{ display: "grid", gap: 12, marginTop: 0 }}>
                        <section
                          style={{
                            border: "1px solid var(--line)",
                            borderRadius: 20,
                            padding: 18,
                            display: "grid",
                            gap: 12,
                            background: "rgba(255,255,255,.03)",
                          }}
                        >
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="chip" style={{ letterSpacing: "normal" }}>{activeCard.type}</span>
                            <span className="muted">{activeCard.date || "-"}</span>
                          </div>
                          <strong style={{ fontSize: 24, lineHeight: 1.35 }}>{activeCard.title || "(제목 없음)"}</strong>
                          <div style={{ display: "grid", gap: 6 }}>
                            <div className="muted" style={{ fontSize: 12, letterSpacing: ".08em" }}>설명</div>
                            <div style={{ lineHeight: 1.7 }}>{activeCard.comment?.trim() || "제출자가 남긴 설명이 없습니다."}</div>
                          </div>
                          <div style={{ display: "grid", gap: 6 }}>
                            <div className="muted" style={{ fontSize: 12, letterSpacing: ".08em" }}>링크</div>
                            {activeCard.link.trim() ? (
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => setPreview({ url: activeCard.link, title: activeCard.title || activeCard.type })}
                                  style={{
                                    padding: 0,
                                    border: "none",
                                    background: "transparent",
                                    color: "#8fe7ff",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    textDecoration: "underline",
                                    wordBreak: "break-all",
                                  }}
                                >
                                  {activeCard.link}
                                </button>
                                <a href={activeCard.link} target="_blank" rel="noreferrer" className="muted">
                                  새 창 열기
                                </a>
                              </div>
                            ) : (
                              <div className="muted">미리보기를 열 수 있는 링크가 없습니다. 제출자가 링크를 입력했는지 확인해 주세요.</div>
                            )}
                          </div>
                        </section>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <strong style={{ fontSize: 20 }}>Preview</strong>
                          {preview ? <span className="muted">{preview.title}</span> : null}
                        </div>
                        <div
                          style={{
                            border: "1px solid var(--line)",
                            borderRadius: 20,
                            overflow: "hidden",
                            background: "rgba(0,0,0,.24)",
                            minHeight: 520,
                          }}
                        >
                          {preview && previewSource ? (
                            previewSource.kind === "video" ? (
                              <video
                                controls
                                src={previewSource.src}
                                style={{ width: "100%", height: "100%", minHeight: 520, background: "#000" }}
                              />
                            ) : (
                              <iframe
                                title={preview.title || "Preview"}
                                src={previewSource.src}
                                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                                allowFullScreen
                                style={{ width: "100%", height: 680, border: "none", background: "#000" }}
                              />
                            )
                          ) : (
                            <div
                              className="muted"
                              style={{
                                minHeight: 520,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                textAlign: "center",
                                padding: 24,
                                lineHeight: 1.7,
                              }}
                            >
                              링크를 선택하면 이 영역에서 미리보기를 확인할 수 있습니다. 지원하지 않는 링크는 새 창에서 확인해 주세요.
                            </div>
                          )}
                        </div>
                        {preview && !previewSource ? <div className="status warn">이 링크는 내부 미리보기를 지원하지 않습니다. 새 창 열기로 직접 확인해 주세요.</div> : null}
                        {previewSource?.kind === "iframe" ? (
                          <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                            일부 서비스는 보안 정책 때문에 내부 미리보기 대신 새 창에서만 정상 재생될 수 있습니다.
                          </div>
                        ) : null}
                        <div className="kpi" style={{ minWidth: 160 }}>
                          <div className="kpi-label">총점</div>
                          <div className="kpi-value" style={{ fontSize: 26 }}>{totalScore}점</div>
                        </div>
                      </div>
                </aside>
              </div>
            </>
          ) : (
            <div className="status note">
              {loading ? "review 화면을 불러오는 중입니다." : "review 대상이 없습니다."}
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
