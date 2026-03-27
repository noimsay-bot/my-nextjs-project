"use client";

import { useEffect, useRef, useState } from "react";
import { ReportType, SubmissionCard, SubmissionEntry, submissionStorageKey } from "@/lib/portal/data";

const reportTypes: ReportType[] = ["일반리포트", "기획리포트", "인터뷰리포트", "LIVE"];

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyCard(): SubmissionCard {
  return { id: crypto.randomUUID(), type: "일반리포트", title: "", link: "", date: toDateInputValue(new Date()), comment: "" };
}

export default function SubmissionsPage() {
  const [submitter, setSubmitter] = useState("정철원");
  const [cards, setCards] = useState<SubmissionCard[]>([emptyCard()]);
  const [entries, setEntries] = useState<SubmissionEntry[]>([]);
  const [message, setMessage] = useState("");
  const dateInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const raw = window.localStorage.getItem(submissionStorageKey);
    if (raw) setEntries(JSON.parse(raw) as SubmissionEntry[]);
  }, []);

  const saveEntries = (next: SubmissionEntry[]) => {
    setEntries(next);
    window.localStorage.setItem(submissionStorageKey, JSON.stringify(next));
  };

  const updateCard = (cardId: string, patch: Partial<SubmissionCard>) => {
    setCards(cards.map((item) => (item.id === cardId ? { ...item, ...patch } : item)));
  };

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className="chip">영상평가 제출</div>
        <label>
          <div style={{ marginBottom: 8 }}>제출자</div>
          <input className="field-input" value={submitter} onChange={(e) => setSubmitter(e.target.value)} />
        </label>
        {cards.map((card, index) => (
          <article key={card.id} style={{ border: "1px solid var(--line)", borderRadius: 18, padding: 16, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{index + 1}번 제출 카드</strong>
              {cards.length > 1 ? <button className="btn" onClick={() => setCards(cards.filter((item) => item.id !== card.id))}>삭제</button> : null}
            </div>
            <select className="field-select" value={card.type} onChange={(e) => updateCard(card.id, { type: e.target.value as ReportType })}>
              {reportTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
            <input className="field-input" placeholder="제목" value={card.title} onChange={(e) => updateCard(card.id, { title: e.target.value })} />
            <input className="field-input" placeholder="링크" value={card.link} onChange={(e) => updateCard(card.id, { link: e.target.value })} />
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
                onChange={(e) => updateCard(card.id, { date: e.target.value })}
              />
            </div>
            <textarea className="field-textarea" placeholder="코멘트" value={card.comment} onChange={(e) => updateCard(card.id, { comment: e.target.value })} />
          </article>
        ))}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" disabled={cards.length >= 3} onClick={() => setCards([...cards, emptyCard()])}>폼 추가</button>
          <button className="btn primary" onClick={() => {
            if (!submitter.trim()) {
              setMessage("제출자 이름이 필요합니다.");
              return;
            }
            const nextEntry: SubmissionEntry = { submitter: submitter.trim(), cards, updatedAt: new Date().toLocaleString("ko-KR") };
            const next = [...entries.filter((entry) => entry.submitter !== nextEntry.submitter), nextEntry];
            saveEntries(next);
            setMessage("제출 내용을 저장했습니다. 같은 제출자가 다시 제출하면 최신본으로 갱신됩니다.");
          }}>제출 저장</button>
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
            {entries.map((entry) => (
              <tr key={entry.submitter}>
                <td>{entry.submitter}</td>
                <td>{entry.cards.length}</td>
                <td>{entry.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
