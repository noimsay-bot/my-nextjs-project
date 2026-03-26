"use client";

import { useEffect, useState } from "react";
import { reviewStorageKey, SubmissionEntry, submissionStorageKey } from "@/lib/portal/data";

const defaultAssignments = [
  { reviewer: "reviewer-a", target: "정철원" },
  { reviewer: "reviewer-b", target: "박재현" },
];

export default function TeamLeadPage() {
  const [submissions, setSubmissions] = useState<SubmissionEntry[]>([]);
  const [reviews, setReviews] = useState<Record<string, { checked: string[]; bonus: number; bonusComment: string; done: boolean }>>({});
  const [assignments, setAssignments] = useState(defaultAssignments);

  useEffect(() => {
    const rawSubmissions = window.localStorage.getItem(submissionStorageKey);
    const rawReviews = window.localStorage.getItem(reviewStorageKey);
    if (rawSubmissions) setSubmissions(JSON.parse(rawSubmissions) as SubmissionEntry[]);
    if (rawReviews) setReviews(JSON.parse(rawReviews));
  }, []);

  return (
    <section className="subgrid-2">
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">평가자 지정</div>
          {assignments.map((assignment, index) => (
            <div key={`${assignment.reviewer}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input className="field-input" value={assignment.reviewer} onChange={(e) => setAssignments(assignments.map((item, itemIndex) => itemIndex === index ? { ...item, reviewer: e.target.value } : item))} />
              <input className="field-input" value={assignment.target} onChange={(e) => setAssignments(assignments.map((item, itemIndex) => itemIndex === index ? { ...item, target: e.target.value } : item))} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={() => setAssignments([...assignments, { reviewer: "", target: "" }])}>평가자 추가</button>
            <button className="btn" onClick={() => setAssignments([])}>초기화</button>
          </div>
        </div>
      </article>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">분기 요약</div>
          <table className="table-like">
            <thead>
              <tr>
                <th>이름</th>
                <th>제출 카드 수</th>
                <th>평가 완료</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((entry) => (
                <tr key={entry.submitter}>
                  <td>{entry.submitter}</td>
                  <td>{entry.cards.length}</td>
                  <td>{reviews[entry.submitter]?.done ? "완료" : "대기"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
