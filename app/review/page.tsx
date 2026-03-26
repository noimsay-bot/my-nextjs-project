"use client";

import { useEffect, useMemo, useState } from "react";
import { reportTemplates, reviewStorageKey, SubmissionEntry, submissionStorageKey } from "@/lib/portal/data";

export default function ReviewPage() {
  const [submissions, setSubmissions] = useState<SubmissionEntry[]>([]);
  const [selectedSubmitter, setSelectedSubmitter] = useState("");
  const [reviewState, setReviewState] = useState<Record<string, { checked: string[]; bonus: number; bonusComment: string; done: boolean }>>({});

  useEffect(() => {
    const rawSubmissions = window.localStorage.getItem(submissionStorageKey);
    const rawReviews = window.localStorage.getItem(reviewStorageKey);
    if (rawSubmissions) {
      const parsed = JSON.parse(rawSubmissions) as SubmissionEntry[];
      setSubmissions(parsed);
      setSelectedSubmitter(parsed[0]?.submitter ?? "");
    }
    if (rawReviews) setReviewState(JSON.parse(rawReviews));
  }, []);

  const current = submissions.find((entry) => entry.submitter === selectedSubmitter);
  const currentState = reviewState[selectedSubmitter] ?? { checked: [], bonus: 0, bonusComment: "", done: false };
  const score = useMemo(() => {
    if (!current) return 0;
    const baseScore = current.cards.reduce((total, card) => {
      const base = reportTemplates[card.type].flatMap((section) => section.criteria);
      return total + base.filter((criterion) => currentState.checked.includes(criterion.id)).reduce((sum, criterion) => sum + criterion.score, 0);
    }, 0);
    return baseScore + currentState.bonus;
  }, [current, currentState]);

  return (
    <section className="subgrid-2">
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">평가 대상</div>
          {submissions.map((entry) => (
            <button key={entry.submitter} className={`btn ${selectedSubmitter === entry.submitter ? "white" : ""}`} onClick={() => setSelectedSubmitter(entry.submitter)}>
              {entry.submitter}
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="chip">평가표</div>
          {current ? (
            <>
              <div className="kpi">
                <div className="kpi-label">현재 점수</div>
                <div className="kpi-value">{score}점</div>
              </div>
              {current.cards.map((card) => (
                <article key={card.id} style={{ border: "1px solid var(--line)", borderRadius: 16, padding: 16, display: "grid", gap: 10 }}>
                  <strong>{card.type} | {card.title}</strong>
                  {reportTemplates[card.type].map((section) => (
                    <div key={section.title} style={{ display: "grid", gap: 8 }}>
                      <div className="muted">{section.title}</div>
                      {section.criteria.map((criterion) => {
                        const checked = currentState.checked.includes(criterion.id);
                        return (
                          <button
                            key={criterion.id}
                            className={`btn ${checked ? "white" : ""}`}
                            onClick={() => {
                              const nextChecked = checked
                                ? currentState.checked.filter((item) => item !== criterion.id)
                                : [...currentState.checked, criterion.id];
                              const next = { ...reviewState, [selectedSubmitter]: { ...currentState, checked: nextChecked } };
                              setReviewState(next);
                              window.localStorage.setItem(reviewStorageKey, JSON.stringify(next));
                            }}
                          >
                            {checked ? "충족 해제" : "충족"} | {criterion.label} ({criterion.score})
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </article>
              ))}
              <label>
                <div style={{ marginBottom: 8 }}>추가 가점 (0~5)</div>
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  max={5}
                  value={currentState.bonus}
                  onChange={(e) => {
                    const next = { ...reviewState, [selectedSubmitter]: { ...currentState, bonus: Number(e.target.value) } };
                    setReviewState(next);
                    window.localStorage.setItem(reviewStorageKey, JSON.stringify(next));
                  }}
                />
              </label>
              <label>
                <div style={{ marginBottom: 8 }}>추가 가점 의견</div>
                <textarea
                  className="field-textarea"
                  value={currentState.bonusComment}
                  onChange={(e) => {
                    const next = { ...reviewState, [selectedSubmitter]: { ...currentState, bonusComment: e.target.value } };
                    setReviewState(next);
                    window.localStorage.setItem(reviewStorageKey, JSON.stringify(next));
                  }}
                />
              </label>
              <button className="btn primary" onClick={() => {
                if (currentState.bonus > 0 && !currentState.bonusComment.trim()) return;
                const next = { ...reviewState, [selectedSubmitter]: { ...currentState, done: true } };
                setReviewState(next);
                window.localStorage.setItem(reviewStorageKey, JSON.stringify(next));
              }}>
                평가 완료 처리
              </button>
              {currentState.bonus > 0 && !currentState.bonusComment.trim() ? <div className="status warn">가점이 1점 이상이면 의견이 필요합니다.</div> : null}
            </>
          ) : (
            <div className="status note">제출 데이터가 없습니다.</div>
          )}
        </div>
      </article>
    </section>
  );
}
