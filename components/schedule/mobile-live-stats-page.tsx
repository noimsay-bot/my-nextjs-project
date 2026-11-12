"use client";

import { useEffect, useState } from "react";
import { MobileLiveTabs } from "@/components/schedule/mobile-live-tabs";
import { buildSimpleXlsx, XLSX_MIME_TYPE } from "@/lib/xlsx/simple-xlsx";
import {
  buildLivePeriodStats,
  getLivePeriods,
  type LivePeriodStats,
} from "@/lib/youtube-lives/periods";
import { listCheckedLiveStartTimes } from "@/lib/youtube-lives/storage";

// 화면에 보이는 stats 객체를 그대로 써서 화면 건수와 엑셀 건수가 항상 일치한다.
function downloadStatsXlsx(stats: LivePeriodStats) {
  const bytes = buildSimpleXlsx({
    name: `${stats.period.year}년`,
    columnWidths: [14, 34],
    rows: [
      ["구간", stats.period.label],
      ["합계", stats.total],
      [],
      ["월", "건수"],
      ...stats.months.map((month) => [month.label, month.count]),
    ],
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME_TYPE }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `모바일라이브_통계_${stats.period.year}년.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function MobileLiveStatsPage() {
  const [periods] = useState(() => getLivePeriods());
  const [selectedYear, setSelectedYear] = useState(() => periods[0].year);
  const [stats, setStats] = useState<LivePeriodStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const period = periods.find((item) => item.year === selectedYear) ?? periods[0];

    const load = async () => {
      setLoading(true);
      setMessage("");
      setStats(null);
      try {
        const startedAtList = await listCheckedLiveStartTimes(period);
        if (!active) return;
        setStats(buildLivePeriodStats(period, startedAtList));
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "통계를 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [periods, selectedYear]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK 모바일 라이브</div>
          <strong style={{ fontSize: 24 }}>모바일 라이브 통계</strong>
          <MobileLiveTabs />
          <div className="status note">체크된 라이브만 집계합니다. 구간은 12월 1일부터 다음 해 11월 30일까지입니다.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="chip">집계 구간</span>
            <select
              className="field-select"
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              style={{ minWidth: 220 }}
            >
              {periods.map((period) => (
                <option key={period.year} value={period.year}>
                  {period.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!stats} onClick={() => stats && downloadStatsXlsx(stats)}>
              엑셀 내보내기
            </button>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          {message ? <div className="status note">{message}</div> : null}
          {stats ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <div className="chip">구간 합계</div>
                <strong style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{stats.total}건</strong>
                <span className="muted">{stats.period.label}</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="table-like" style={{ minWidth: 280, maxWidth: 420 }}>
                  <thead>
                    <tr>
                      <th>월</th>
                      <th style={{ textAlign: "right" }}>건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.months.map((month) => (
                      <tr key={month.month}>
                        <td>{month.label}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{month.count}건</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>합계</strong>
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        <strong>{stats.total}건</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            !message && <div className="status note">{loading ? "불러오는 중입니다." : "집계할 내역이 없습니다."}</div>
          )}
        </div>
      </article>
    </section>
  );
}
