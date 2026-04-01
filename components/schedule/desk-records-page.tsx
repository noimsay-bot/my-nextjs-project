"use client";

import { useEffect, useState } from "react";
import { DateRangeField } from "@/components/schedule/date-range-field";
import {
  DeskRecordEntry,
  DeskRecordKind,
  formatDeskRecordDateKeys,
  getDeskRecordConfig,
  getDeskRecordEntries,
  resetDeskRecordEntries,
  saveDeskRecordEntries,
} from "@/lib/schedule/desk-records";

function createEmptyEntry(kind: DeskRecordKind) {
  return {
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    date: "",
    note: "",
    dateKeys: [],
  } satisfies DeskRecordEntry;
}

export function DeskRecordsPage({ kind }: { kind: DeskRecordKind }) {
  const config = getDeskRecordConfig(kind);
  const [entries, setEntries] = useState<DeskRecordEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "note"; text: string } | null>(null);

  useEffect(() => {
    setEntries(getDeskRecordEntries(kind));
    setLoaded(true);
  }, [kind]);

  const updateEntries = (nextEntries: DeskRecordEntry[], nextMessage?: { tone: "ok" | "note"; text: string } | null) => {
    setEntries(nextEntries);
    saveDeskRecordEntries(kind, nextEntries);
    setMessage(nextMessage ?? null);
  };

  if (!loaded) {
    return <div className="status note">기록을 불러오는 중입니다.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">{config.chip}</div>
              <strong style={{ fontSize: 22 }}>{config.title}</strong>
              <span className="muted">{config.description}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                updateEntries([...entries, createEmptyEntry(kind)], {
                  tone: "note",
                  text: "빈 행을 추가했습니다.",
                })
              }
            >
              행 추가
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                updateEntries(resetDeskRecordEntries(kind), {
                  tone: "ok",
                  text: "첨부 파일 기준 초기값으로 복원했습니다.",
                })
              }
            >
              초기값 복원
            </button>
          </div>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div className="chip">기록 목록</div>
          <div style={{ overflowX: "auto" }}>
            <table className="table-like" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={{ width: 72 }}>번호</th>
                  <th style={{ width: 180 }}>이름</th>
                  <th style={{ width: 220 }}>날짜</th>
                  <th>비고</th>
                  <th style={{ width: 96 }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id}>
                    <td>{index + 1}</td>
                    <td>
                      <input
                        className="field-input"
                        value={entry.name}
                        onChange={(event) =>
                          updateEntries(
                            entries.map((item) =>
                              item.id === entry.id ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <DateRangeField
                        value={entry.date}
                        dateKeys={entry.dateKeys}
                        onChange={({ date, dateKeys }) =>
                          updateEntries(
                            entries.map((item) =>
                              item.id === entry.id
                                ? {
                                    ...item,
                                    date: date || formatDeskRecordDateKeys(dateKeys),
                                    dateKeys,
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="field-input"
                        value={entry.note}
                        onChange={(event) =>
                          updateEntries(
                            entries.map((item) =>
                              item.id === entry.id ? { ...item, note: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "8px 12px" }}
                        onClick={() =>
                          updateEntries(
                            entries.filter((item) => item.id !== entry.id),
                            { tone: "note", text: "선택한 행을 삭제했습니다." },
                          )
                        }
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="status note">등록된 항목이 없습니다.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
