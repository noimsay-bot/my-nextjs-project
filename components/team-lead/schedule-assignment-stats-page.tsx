"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { refreshUsers } from "@/lib/auth/storage";
import { PUBLISHED_SCHEDULES_EVENT, refreshPublishedSchedules } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  getScheduleAssignmentYearStats,
  refreshTeamLeadAssignmentMonths,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  type ScheduleAssignmentPersonStats,
  type ScheduleAssignmentYearStats,
} from "@/lib/team-lead/storage";
import { getTeamLeadEvaluationMonthKeys } from "@/lib/team-lead/evaluation-year";
import { downloadXlsxFile } from "@/lib/team-lead/schedule-assignment-export";
import { buildSimpleXlsx, type SimpleXlsxCell } from "@/lib/xlsx/simple-xlsx";
import { useTeamLeadEvaluationYear } from "@/components/team-lead/use-team-lead-evaluation-year";

const FOCUS_REFRESH_THROTTLE_MS = 60_000;

type SortKey = "name" | "total" | "dayTrip" | "domesticTrip" | "internationalTrip" | `month-${number}`;

function getMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year.slice(2)}.${Number(month)}월`;
}

function getSortValue(person: ScheduleAssignmentPersonStats, key: SortKey) {
  if (key === "total") return person.total;
  if (key === "dayTrip") return person.dayTripCount;
  if (key === "domesticTrip") return person.domesticTripCount;
  if (key === "internationalTrip") return person.internationalTripCount;
  if (key.startsWith("month-")) return person.monthCounts[Number(key.slice(6))] ?? 0;
  return 0;
}

function buildStatsSheetRows(stats: ScheduleAssignmentYearStats, people: ScheduleAssignmentPersonStats[]) {
  const header: SimpleXlsxCell[] = [
    "이름",
    "총 일정",
    ...stats.monthKeys.map(getMonthLabel),
    "당일출장",
    "국내출장",
    "해외출장",
  ];
  const sum = (pick: (person: ScheduleAssignmentPersonStats) => number) =>
    people.reduce((total, person) => total + pick(person), 0);

  return [
    [`${stats.evaluationYear}년 평가 (${stats.evaluationYear - 1}년 12월 ~ ${stats.evaluationYear}년 11월) 일정배정 통계`],
    [],
    header,
    ...people.map((person) => [
      person.name,
      person.total,
      ...person.monthCounts,
      person.dayTripCount,
      person.domesticTripCount,
      person.internationalTripCount,
    ]),
    [
      "합계",
      sum((person) => person.total),
      ...stats.monthKeys.map((_, index) => sum((person) => person.monthCounts[index] ?? 0)),
      sum((person) => person.dayTripCount),
      sum((person) => person.domesticTripCount),
      sum((person) => person.internationalTripCount),
    ],
  ] satisfies SimpleXlsxCell[][];
}

export function ScheduleAssignmentStatsPage() {
  const evaluationYear = useTeamLeadEvaluationYear();
  const [stats, setStats] = useState<ScheduleAssignmentYearStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDesc, setSortDesc] = useState(true);
  const [loadError, setLoadError] = useState("");
  const lastFocusRefreshAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // 12개월 확정 근무표·일정배정을 모두 받은 뒤에만 집계한다.
    // 확정 근무표 없이 집계하면 DESK 초안 근무표로 행을 만들게 되어, 일정배정 행 키가 맞지 않아 건수가 빠진다.
    let ready = false;
    // 확정 근무표는 1일에 딱 맞춰 시작하지 않을 수 있어 월초·월말 며칠은 앞뒤 달 근무표에서 채운다.
    // 일정배정 화면이 앞뒤 달까지 불러오는 것과 같게, 평가연도 앞뒤 한 달씩을 함께 불러온다.
    const monthKeys = [
      `${evaluationYear - 1}-11`,
      ...getTeamLeadEvaluationMonthKeys(evaluationYear),
      `${evaluationYear}-12`,
    ];
    const sync = () => {
      if (!cancelled && ready) setStats(getScheduleAssignmentYearStats(evaluationYear));
    };
    const refresh = async () => {
      try {
        await Promise.all([
          refreshUsers(),
          refreshScheduleState(),
          refreshPublishedSchedules({ monthKeys, repair: false }),
          refreshTeamLeadAssignmentMonths(monthKeys),
        ]);
        if (cancelled) return;
        ready = true;
        setLoadError("");
        sync();
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "일정배정 통계를 불러오지 못했습니다.");
        }
      }
    };
    const onFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      void refresh();
    };

    setLoading(true);
    setStats(null);
    void refresh().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
      if (!cancelled) setLoading(false);
    });
    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, sync);
    window.addEventListener(SCHEDULE_STATE_EVENT, sync);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, sync);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, sync);
      window.removeEventListener(SCHEDULE_STATE_EVENT, sync);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, sync);
    };
  }, [evaluationYear]);

  const sortedPeople = useMemo(() => {
    if (!stats) return [];
    return [...stats.people].sort((left, right) => {
      const diff =
        sortKey === "name"
          ? left.name.localeCompare(right.name, "ko")
          : getSortValue(left, sortKey) - getSortValue(right, sortKey);
      if (diff !== 0) return sortDesc ? -diff : diff;
      return left.name.localeCompare(right.name, "ko");
    });
  }, [sortDesc, sortKey, stats]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((current) => !current);
      return;
    }
    setSortKey(key);
    setSortDesc(key !== "name");
  };

  const sortMark = (key: SortKey) => (key === sortKey ? (sortDesc ? " ▼" : " ▲") : "");

  const downloadStats = () => {
    if (!stats) return;
    const rows = buildStatsSheetRows(stats, sortedPeople);
    const bytes = buildSimpleXlsx({
      name: `${stats.evaluationYear}년 평가`,
      rows,
      columnWidths: [12, 10, ...stats.monthKeys.map(() => 8), 10, 10, 10],
    });
    downloadXlsxFile(bytes, `일정배정_통계_${stats.evaluationYear}년평가.xlsx`);
  };

  const headerCell = (key: SortKey, label: string) => (
    <th key={key} style={{ padding: "8px 6px", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => toggleSort(key)}>
      {label}
      {sortMark(key)}
    </th>
  );

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">통계</div>
          <strong style={{ fontSize: 24 }}>일정배정 통계</strong>
          <div className="status note">
            {evaluationYear - 1}년 12월 ~ {evaluationYear}년 11월 동안 사람별로 일정배정을 받은 건수입니다. 일정 칸에 적힌
            일정 하나가 1건이고, 출장은 출장 하나(여러 날이어도)가 1건입니다. 팀장·데스크·파트너·출입처 등급은 제외합니다.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn" disabled={!stats || stats.people.length === 0} onClick={downloadStats}>
              엑셀 저장
            </button>
            {loading ? <span className="muted" style={{ fontSize: 13 }}>최신 일정배정을 불러오는 중입니다.</span> : null}
          </div>
          {loadError ? <div className="status warn">통계를 불러오지 못했습니다: {loadError}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ overflowX: "auto" }}>
          {!stats || sortedPeople.length === 0 ? (
            <div className="status note">{loading ? "불러오는 중입니다." : "해당 기간에 입력된 일정배정이 없습니다."}</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, textAlign: "center" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(148,163,184,.4)" }}>
                  {headerCell("name", "이름")}
                  {headerCell("total", "총 일정")}
                  {stats.monthKeys.map((monthKey, index) => headerCell(`month-${index}`, getMonthLabel(monthKey)))}
                  {headerCell("dayTrip", "당일출장")}
                  {headerCell("domesticTrip", "국내출장")}
                  {headerCell("internationalTrip", "해외출장")}
                </tr>
              </thead>
              <tbody>
                {sortedPeople.map((person) => (
                  <tr key={person.name} style={{ borderBottom: "1px solid rgba(148,163,184,.18)" }}>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap", fontWeight: 600 }}>{person.name}</td>
                    <td style={{ padding: "8px 6px", fontWeight: 700 }}>{person.total}</td>
                    {person.monthCounts.map((count, index) => (
                      <td key={stats.monthKeys[index]} className={count === 0 ? "muted" : undefined} style={{ padding: "8px 6px" }}>
                        {count}
                      </td>
                    ))}
                    <td style={{ padding: "8px 6px" }}>{person.dayTripCount}</td>
                    <td style={{ padding: "8px 6px" }}>{person.domesticTripCount}</td>
                    <td style={{ padding: "8px 6px" }}>{person.internationalTripCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </section>
  );
}
