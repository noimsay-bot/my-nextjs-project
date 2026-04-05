"use client";

import { useEffect, useState } from "react";
import { refreshUsers } from "@/lib/auth/storage";
import { refreshTeamLeadState } from "@/lib/team-lead/storage";
import {
  getPressSupportPeriods,
  getPressSupportRows,
  PressSupportCategory,
  PressSupportPeriod,
  PressSupportRow,
} from "@/lib/schedule/press-support";

const columns: Array<{ key: PressSupportCategory; label: string }> = [
  { key: "assembly", label: "국회" },
  { key: "prosecution", label: "검찰" },
];

export function PressSupportPage() {
  const [rows, setRows] = useState<PressSupportRow[]>([]);
  const [periods, setPeriods] = useState<PressSupportPeriod[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      setLoading(true);
      await Promise.all([refreshUsers(), refreshTeamLeadState()]);
      if (!active) return;
      const nextPeriods = getPressSupportPeriods();
      setPeriods(nextPeriods);
      setSelectedYear((current) =>
        nextPeriods.some((period) => period.year === current)
          ? current
          : (nextPeriods[0]?.year ?? new Date().getFullYear()),
      );
      setLoading(false);
    };

    void refresh();
    window.addEventListener("focus", refresh);

    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (selectedYear === null) return;
    setRows(getPressSupportRows(selectedYear));
  }, [selectedYear]);

  const selectedPeriod =
    periods.find((period) => period.year === selectedYear) ??
    periods[0] ??
    null;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK 출입처 지원</div>
          <strong style={{ fontSize: 24 }}>출입처 지원</strong>
          <div className="status note">일정배정의 일정 내용 중 `국회 지원`, `검찰 지원` 문구를 연도별로 자동 집계해 보여줍니다.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="chip">집계 기간</span>
            <select
              className="field-select"
              value={selectedYear ?? ""}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              disabled={periods.length === 0}
              style={{ minWidth: 220 }}
            >
              {periods.map((period) => (
                <option key={period.year} value={period.year}>
                  {period.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="chip">지원 표</div>
            {selectedPeriod ? <div className="muted">{selectedPeriod.label}</div> : null}
          </div>
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
                      const count = row[column.key];
                      return (
                        <td key={`${row.name}-${column.key}`} style={{ textAlign: "center" }}>
                          <span
                            className="btn"
                            style={{
                              minWidth: 104,
                              display: "inline-flex",
                              justifyContent: "center",
                              borderColor: count > 0 ? "rgba(250,204,21,.58)" : "rgba(148,163,184,.24)",
                              background: count > 0 ? "rgba(250,204,21,.22)" : undefined,
                              color: count > 0 ? "#facc15" : undefined,
                            }}
                          >
                            {count}건
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1}>
                      <div className="status note">{loading ? "불러오는 중입니다." : "집계된 출입처 지원 일정이 없습니다."}</div>
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
