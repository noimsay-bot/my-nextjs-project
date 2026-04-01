"use client";

import { useEffect, useRef, useState } from "react";
import {
  createEmptySubmissionCard,
  getMySubmissionEntry,
  saveMySubmissionEntry,
  submissionReportTypes,
  SubmissionCard,
  SubmissionEntry,
} from "@/lib/portal/data";
import {
  getSession,
  subscribeToAuth,
  type SessionUser,
} from "@/lib/auth/storage";

export default function SubmissionsPage() {
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [submitter, setSubmitter] = useState("");
  const [cards, setCards] = useState<SubmissionCard[]>([createEmptySubmissionCard()]);
  const [entries, setEntries] = useState<SubmissionEntry[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const hasLocalDraftRef = useRef(false);
  const loadedSessionIdRef = useRef<string | null>(session?.id ?? null);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadEntry() {
      if (!session) {
        if (!mounted) return;
        hasLocalDraftRef.current = false;
        loadedSessionIdRef.current = null;
        setSubmitter("");
        setEntries([]);
        setCards([createEmptySubmissionCard()]);
        setLoading(false);
        return;
      }

      if (loadedSessionIdRef.current !== session.id) {
        hasLocalDraftRef.current = false;
        loadedSessionIdRef.current = session.id;
      }

      setLoading(true);
      setSubmitter(session.username);

      try {
        const entry = await getMySubmissionEntry();
        if (!mounted) return;

        if (entry) {
          setEntries([entry]);
          if (!hasLocalDraftRef.current) {
            setCards(entry.cards.length > 0 ? entry.cards : [createEmptySubmissionCard()]);
          }
        } else {
          setEntries([]);
          if (!hasLocalDraftRef.current) {
            setCards([createEmptySubmissionCard()]);
          }
        }
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "제출 데이터를 불러오지 못했습니다.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadEntry();

    return () => {
      mounted = false;
    };
  }, [session]);

  const updateCard = (cardId: string, patch: Partial<SubmissionCard>) => {
    hasLocalDraftRef.current = true;
    setCards((current) => current.map((item) => (item.id === cardId ? { ...item, ...patch } : item)));
  };

  async function handleSave() {
    if (!session) {
      setMessage("로그인 후 이용해 주세요.");
      return;
    }

    setSaving(true);
    const result = await saveMySubmissionEntry(cards);
    setSaving(false);
    setMessage(result.message);

    if (result.ok && result.entry) {
      hasLocalDraftRef.current = false;
      setEntries([result.entry]);
      setCards(result.entry.cards.length > 0 ? result.entry.cards : [createEmptySubmissionCard()]);
    }
  }

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className="chip">베스트리포트 제출</div>
        <label>
          <div style={{ marginBottom: 8 }}>제출자</div>
          <input className="field-input" value={submitter} disabled onChange={(event) => setSubmitter(event.target.value)} />
        </label>

        {cards.map((card, index) => (
          <article
            key={card.id}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 18,
              padding: 16,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <strong>{index + 1}번 리포트</strong>
              {cards.length > 1 ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    hasLocalDraftRef.current = true;
                    setCards((current) => current.filter((item) => item.id !== card.id));
                  }}
                >
                  삭제
                </button>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div className="muted" style={{ fontSize: 13 }}>
                리포트 종류
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {submissionReportTypes.map((type) => {
                  const selected = card.type === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`btn ${selected ? "white" : ""}`}
                      style={{ padding: "10px 14px", fontSize: 14, minWidth: 96 }}
                      onClick={() => updateCard(card.id, { type })}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>

            <input
              className="field-input"
              placeholder="제목"
              value={card.title}
              onChange={(event) => updateCard(card.id, { title: event.target.value })}
            />
            <input
              className="field-input"
              placeholder="링크"
              value={card.link}
              onChange={(event) => updateCard(card.id, { link: event.target.value })}
            />

            <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="btn white"
                style={{ padding: "12px 16px", minWidth: 68 }}
                onClick={() => {
                  const input = dateInputRefs.current[card.id];
                  if (!input) return;
                  input.showPicker?.();
                  input.focus();
                  input.click();
                }}
              >
                달력
              </button>
              <input
                ref={(element) => {
                  dateInputRefs.current[card.id] = element;
                }}
                className="field-input date-input-no-icon"
                type="date"
                value={card.date}
                onChange={(event) => updateCard(card.id, { date: event.target.value })}
              />
            </div>

            <textarea
              className="field-textarea"
              placeholder="코멘트"
              value={card.comment}
              onChange={(event) => updateCard(card.id, { comment: event.target.value })}
            />
          </article>
        ))}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            disabled={cards.length >= 3 || loading || saving}
            onClick={() => {
              hasLocalDraftRef.current = true;
              setCards((current) => [...current, createEmptySubmissionCard()]);
            }}
          >
            리포트 추가
          </button>
          <button className="btn primary" disabled={loading || saving} onClick={handleSave}>
            {saving ? "저장 중..." : "제출 저장"}
          </button>
        </div>

        {message ? <div className="status ok">{message}</div> : null}

        <table className="table-like">
          <thead>
            <tr>
              <th>제출자</th>
              <th>카드 수</th>
              <th>최종 갱신</th>
            </tr>
          </thead>
          <tbody>
            {entries.length > 0 ? (
              entries.map((entry) => (
                <tr key={entry.submitter}>
                  <td>{entry.submitter}</td>
                  <td>{entry.cards.length}</td>
                  <td>{entry.updatedAt}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>{loading ? "불러오는 중입니다." : "저장된 제출 내역이 없습니다."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
