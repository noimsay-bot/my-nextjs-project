"use client";

import { useEffect, useState } from "react";
import { refreshUsers } from "@/lib/auth/storage";
import {
  getPressSupportRows,
  savePressSupportRows,
  togglePressSupportCell,
  PressSupportCategory,
  PressSupportRow,
} from "@/lib/schedule/press-support";

const columns: Array<{ key: PressSupportCategory; label: string }> = [
  { key: "assembly", label: "국회" },
  { key: "prosecution", label: "검찰" },
];

export function PressSupportPage() {
  const [rows, setRows] = useState<PressSupportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "ok" | "note"; text: string } | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      setLoading(true);
      await refreshUsers();
      if (!active) return;
      setRows(getPressSupportRows());
      setLoading(false);
    };

    void refresh();
    window.addEventListener("focus", refresh);

    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const handleToggle = (name: string, category: PressSupportCategory) => {
    setRows((current) => {
      const next = togglePressSupportCell(current, name, category);
      savePressSupportRows(next);
      return next;
    });
    setMessage({ tone: "ok", text: `${name} ${columns.find((column) => column.key === category)?.label ?? ""} 지원 여부를 저장했습니다.` });
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK 출입처 지원</div>
          <strong style={{ fontSize: 24 }}>출입처 지원</strong>
          <div className="status note">세로열은 사람 이름, 가로열은 출입처입니다. 각 칸을 눌러 지원 여부를 바로 저장할 수 있습니다.</div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">지원 표</div>
          <div style={{ overflowX: "auto" }}>
            <table className="table-like" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>이름</th>
                  {columns.map((column) => (
                    <th key={column.key} style={{ minWidth: 180, textAlign: "center" }}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    {columns.map((column) => {
                      const active = row[column.key];
                      return (
                        <td key={`${row.name}-${column.key}`} style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleToggle(row.name, column.key)}
                            style={{
                              minWidth: 104,
                              borderColor: active ? "rgba(250,204,21,.58)" : "rgba(148,163,184,.24)",
                              background: active ? "rgba(250,204,21,.22)" : undefined,
                              color: active ? "#facc15" : undefined,
                            }}
                          >
                            {active ? "지원" : "-"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1}>
                      <div className="status note">{loading ? "불러오는 중입니다." : "표시할 인원이 없습니다."}</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </section>
  );
}
