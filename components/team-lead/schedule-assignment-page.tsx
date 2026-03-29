"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AssignmentTimeColor,
  AssignmentTravelType,
  createDefaultScheduleAssignmentDayRows,
  createDefaultScheduleAssignmentEntry,
  getScheduleAssignmentRows,
  getScheduleAssignmentStore,
  getTeamLeadSchedules,
  saveScheduleAssignmentStore,
  ScheduleAssignmentDataStore,
  ScheduleAssignmentDayRows,
  ScheduleAssignmentEntry,
  ScheduleAssignmentRow,
} from "@/lib/team-lead/storage";

const travelOptions: Array<{ value: AssignmentTravelType; label: string }> = [
  { value: "", label: "선택" },
  { value: "국내출장", label: "국내출장" },
  { value: "해외출장", label: "해외출장" },
  { value: "당일출장", label: "당일출장" },
];

function timeColorStyle(color: AssignmentTimeColor) {
  if (color === "red") return { borderColor: "rgba(248,113,113,.45)", background: "rgba(254,226,226,.95)", color: "#991b1b" };
  if (color === "blue") return { borderColor: "rgba(125,211,252,.6)", background: "rgba(224,242,254,.95)", color: "#075985" };
  if (color === "yellow") return { borderColor: "rgba(250,204,21,.55)", background: "rgba(254,249,195,.95)", color: "#854d0e" };
  return undefined;
}

const cycleClockInColor = (color: AssignmentTimeColor): AssignmentTimeColor => (color === "" ? "blue" : color === "blue" ? "red" : "");
const cycleClockOutColor = (color: AssignmentTimeColor): AssignmentTimeColor => (color === "" ? "yellow" : "");
const getSafeSchedules = (schedules: string[]) => (schedules.length > 0 ? schedules : [""]);
const removeScheduleAt = (schedules: string[], index: number) => getSafeSchedules(schedules.filter((_, i) => i !== index));
const getSafeExclusiveVideo = (values: boolean[], count: number) => Array.from({ length: Math.max(count, 1) }, (_, i) => values[i] ?? false);
const removeExclusiveVideoAt = (values: boolean[], index: number, nextCount: number) => getSafeExclusiveVideo(values.filter((_, i) => i !== index), nextCount);
const createCustomRowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function formatManualTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":")) {
    const [h = "", m = ""] = trimmed.split(":");
    const hh = Number(h.replace(/\D/g, ""));
    const mm = Number(m.replace(/\D/g, ""));
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 3) {
    const hh = Number(digits.slice(0, 1));
    const mm = Number(digits.slice(1));
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  if (digits.length === 4) {
    const hh = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2));
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return null;
}

export function ScheduleAssignmentPage() {
  const [schedules, setSchedules] = useState(() => getTeamLeadSchedules());
  const [store, setStore] = useState<ScheduleAssignmentDataStore>({ entries: {}, rows: {} });
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [activeTimeField, setActiveTimeField] = useState<string | null>(null);
  const [selectedDeleteRowKey, setSelectedDeleteRowKey] = useState<string | null>(null);

  useEffect(() => {
    const nextSchedules = getTeamLeadSchedules();
    setSchedules(nextSchedules);
    setStore(getScheduleAssignmentStore());
    setSelectedMonthKey((current) => current || nextSchedules[0]?.monthKey || "");
  }, []);

  const selectedMonth = useMemo(() => schedules.find((schedule) => schedule.monthKey === selectedMonthKey) ?? null, [schedules, selectedMonthKey]);
  const monthEntries = store.entries[selectedMonthKey] ?? {};
  const monthRows = store.rows[selectedMonthKey] ?? {};
  const monthDays = useMemo(() => selectedMonth?.days.filter((day) => day.month === selectedMonth.month) ?? [], [selectedMonth]);

  const dutyOptions = useMemo(() => {
    const set = new Set<string>();
    schedules.forEach((schedule) => schedule.days.forEach((day) => getScheduleAssignmentRows(day).forEach((row) => row.duty && set.add(row.duty))));
    Object.values(store.rows).forEach((month) => Object.values(month).forEach((dayRows) => {
      dayRows.addedRows.forEach((row) => row.duty && set.add(row.duty));
      Object.values(dayRows.rowOverrides).forEach((row) => row.duty && set.add(row.duty));
    }));
    return Array.from(set);
  }, [schedules, store.rows]);

  const updateStore = (recipe: (current: ScheduleAssignmentDataStore) => ScheduleAssignmentDataStore) => {
    setStore((current) => {
      const next = recipe(current);
      saveScheduleAssignmentStore(next);
      return next;
    });
  };

  const updateMonthEntry = (rowKey: string, recipe: (entry: ScheduleAssignmentEntry) => ScheduleAssignmentEntry) => {
    updateStore((current) => {
      const currentMonth = current.entries[selectedMonthKey] ?? {};
      const currentEntry = currentMonth[rowKey] ?? createDefaultScheduleAssignmentEntry();
      return {
        ...current,
        entries: {
          ...current.entries,
          [selectedMonthKey]: {
            ...currentMonth,
            [rowKey]: recipe(currentEntry),
          },
        },
      };
    });
  };

  const updateDayRows = (dateKey: string, recipe: (dayRows: ScheduleAssignmentDayRows) => ScheduleAssignmentDayRows) => {
    updateStore((current) => {
      const currentMonthRows = current.rows[selectedMonthKey] ?? {};
      const currentDayRows = currentMonthRows[dateKey] ?? createDefaultScheduleAssignmentDayRows();
      return {
        ...current,
        rows: {
          ...current.rows,
          [selectedMonthKey]: {
            ...currentMonthRows,
            [dateKey]: recipe(currentDayRows),
          },
        },
      };
    });
  };

  const updateRowDuty = (dateKey: string, row: ScheduleAssignmentRow, duty: string) => {
    updateDayRows(dateKey, (dayRows) => {
      if (row.isCustom) {
        const customId = row.key.split("::custom::")[1];
        return {
          ...dayRows,
          addedRows: dayRows.addedRows.map((item) => (item.id === customId ? { ...item, duty } : item)),
        };
      }
      const currentOverride = dayRows.rowOverrides[row.key] ?? { name: row.name, duty: row.duty };
      return {
        ...dayRows,
        rowOverrides: {
          ...dayRows.rowOverrides,
          [row.key]: { name: currentOverride.name, duty },
        },
      };
    });
  };

  const deleteRow = (dateKey: string, row: ScheduleAssignmentRow) => {
    updateDayRows(dateKey, (dayRows) => {
      if (row.isCustom) {
        const customId = row.key.split("::custom::")[1];
        return { ...dayRows, addedRows: dayRows.addedRows.filter((item) => item.id !== customId) };
      }
      return {
        ...dayRows,
        deletedRowKeys: dayRows.deletedRowKeys.includes(row.key) ? dayRows.deletedRowKeys : [...dayRows.deletedRowKeys, row.key],
      };
    });
  };

  const addRow = (dateKey: string) => {
    const name = window.prompt("추가할 사람 이름을 입력하세요.");
    const trimmedName = name?.trim() ?? "";
    if (!trimmedName) return;
    updateDayRows(dateKey, (dayRows) => ({
      ...dayRows,
      addedRows: [...dayRows.addedRows, { id: createCustomRowId(), name: trimmedName, duty: dutyOptions[0] ?? "" }],
    }));
  };

  if (schedules.length === 0) {
    return <section className="panel"><div className="panel-pad"><div className="status note">게시되었거나 작성된 근무표가 없어 일정배정표를 만들 수 없습니다.</div></div></section>;
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="chip">일정배정</div>
              <strong style={{ fontSize: 24 }}>월별 일정배정</strong>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {schedules.map((schedule) => (
                <button key={schedule.monthKey} type="button" className={`btn ${selectedMonthKey === schedule.monthKey ? "white" : ""}`} onClick={() => setSelectedMonthKey(schedule.monthKey)}>
                  {schedule.year}년 {schedule.month}월
                </button>
              ))}
            </div>
          </div>
          <div className="status note">근무표의 해당 날짜 근무자를 자동으로 불러오고, 사람 추가와 삭제, 근무유형 변경까지 이 페이지에서 직접 관리합니다.</div>
        </div>
      </article>

      {monthDays.map((day) => {
        const dayRows = monthRows[day.dateKey] ?? createDefaultScheduleAssignmentDayRows();
        const rows = getScheduleAssignmentRows(day, dayRows);
        const selectedRow = rows.find((row) => row.key === selectedDeleteRowKey) ?? null;

        return (
          <article key={day.dateKey} className="panel">
            <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="chip">{day.dateKey}</div>
                  <strong style={{ fontSize: 22 }}>{day.month}월 {day.day}일 일정배정</strong>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="muted">{rows.length}명</span>
                  <button type="button" className="btn" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => addRow(day.dateKey)}>
                    사람 추가
                  </button>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="table-like" style={{ minWidth: 1140 }}>
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>근무유형</th>
                      <th>출근</th>
                      <th>퇴근</th>
                      <th>일정 / 단독</th>
                      <th>일정갯수</th>
                      <th>출장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length > 0 ? rows.map((row) => {
                      const entry = monthEntries[row.key] ?? createDefaultScheduleAssignmentEntry();
                      const safeSchedules = getSafeSchedules(entry.schedules);
                      const safeExclusiveVideo = getSafeExclusiveVideo(entry.exclusiveVideo, safeSchedules.length);
                      const scheduleCount = safeSchedules.filter((item) => item.trim()).length;
                      const clockInFieldKey = `${row.key}:clockIn`;
                      const clockOutFieldKey = `${row.key}:clockOut`;
                      const showClockInActions = activeTimeField === clockInFieldKey || entry.clockInConfirmed;
                      const showClockOutActions = activeTimeField === clockOutFieldKey || entry.clockOutConfirmed;
                      const rowDutyOptions = row.duty && !dutyOptions.includes(row.duty) ? [row.duty, ...dutyOptions] : dutyOptions;

                      return (
                        <tr key={row.key}>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <button
                              type="button"
                              className="field-input"
                              style={{
                                width: "100%",
                                textAlign: "left",
                                cursor: "pointer",
                                borderColor: selectedDeleteRowKey === row.key ? "rgba(248,113,113,.52)" : undefined,
                                background: selectedDeleteRowKey === row.key ? "rgba(127,29,29,.18)" : undefined,
                                color: selectedDeleteRowKey === row.key ? "#fee2e2" : undefined,
                              }}
                              onClick={() => setSelectedDeleteRowKey((current) => (current === row.key ? null : row.key))}
                            >
                              {row.name || "이름 없음"}
                            </button>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <select className="field-select" value={row.duty} onChange={(event) => updateRowDuty(day.dateKey, row, event.target.value)}>
                              <option value="">근무 선택</option>
                              {rowDutyOptions.map((option) => <option key={`${row.key}-${option}`} value={option}>{option}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              {entry.clockInConfirmed ? (
                                <button type="button" className="field-input" style={{ width: 84, minWidth: 84, textAlign: "center", cursor: "pointer", ...(timeColorStyle(entry.clockInColor) ?? {}) }} onClick={() => updateMonthEntry(row.key, (current) => ({ ...current, clockInColor: cycleClockInColor(current.clockInColor) }))}>{entry.clockIn}</button>
                              ) : (
                                <input className="field-input" type="text" inputMode="numeric" maxLength={5} placeholder="00:00" value={entry.clockIn} style={{ width: 84, minWidth: 84, textAlign: "center" }} onFocus={() => setActiveTimeField(clockInFieldKey)} onClick={() => setActiveTimeField(clockInFieldKey)} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, clockIn: event.target.value, clockInConfirmed: false, clockInColor: "" }))} />
                              )}
                              {showClockInActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockInConfirmed ? <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockIn); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockIn: formatted, clockInConfirmed: Boolean(formatted), clockInColor: "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockIn: "", clockInColor: "", clockInConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              {entry.clockOutConfirmed ? (
                                <button type="button" className="field-input" style={{ width: 84, minWidth: 84, textAlign: "center", cursor: "pointer", ...(timeColorStyle(entry.clockOutColor) ?? {}) }} onClick={() => updateMonthEntry(row.key, (current) => ({ ...current, clockOutColor: cycleClockOutColor(current.clockOutColor) }))}>{entry.clockOut}</button>
                              ) : (
                                <input className="field-input" type="text" inputMode="numeric" maxLength={5} placeholder="00:00" value={entry.clockOut} style={{ width: 84, minWidth: 84, textAlign: "center" }} onFocus={() => setActiveTimeField(clockOutFieldKey)} onClick={() => setActiveTimeField(clockOutFieldKey)} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, clockOut: event.target.value, clockOutConfirmed: false, clockOutColor: "" }))} />
                              )}
                              {showClockOutActions ? <div style={{ display: "flex", gap: 2 }}>
                                {!entry.clockOutConfirmed ? <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { const formatted = formatManualTime(entry.clockOut); if (formatted === null) return; updateMonthEntry(row.key, (current) => ({ ...current, clockOut: formatted, clockOutConfirmed: Boolean(formatted), clockOutColor: formatted ? "yellow" : "" })); setActiveTimeField(null); }}>확인</button> : null}
                                <button type="button" className="btn" style={{ padding: "2px 5px", fontSize: 11 }} onClick={() => { setActiveTimeField(null); updateMonthEntry(row.key, (current) => ({ ...current, clockOut: "", clockOutColor: "", clockOutConfirmed: false })); }}>초기화</button>
                              </div> : null}
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <div style={{ display: "grid", gap: 3, minWidth: 460 }}>
                              {safeSchedules.map((schedule, index) => (
                                <div key={`${row.key}-schedule-${index}`} style={{ display: "flex", gap: 3, alignItems: "center", minHeight: 32 }}>
                                  <input className="field-input" value={schedule} style={{ flex: 1 }} placeholder="일정 내용 입력" onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, schedules: getSafeSchedules(current.schedules).map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} />
                                  <span style={{ minWidth: 30, textAlign: "center", fontSize: 11, color: "#94a3b8", letterSpacing: "-0.02em" }}>단독</span>
                                  <label style={{ display: "flex", justifyContent: "center", alignItems: "center", width: 32, minWidth: 32, height: 32, borderRadius: 10, border: safeExclusiveVideo[index] ? "1px solid rgba(132,204,22,.72)" : "1px solid rgba(203,213,225,.95)", background: safeExclusiveVideo[index] ? "rgba(217,249,157,.95)" : "#ffffff", transition: "background .18s ease, border-color .18s ease", cursor: "pointer", overflow: "hidden" }}>
                                    <input type="checkbox" checked={safeExclusiveVideo[index]} style={{ appearance: "none", WebkitAppearance: "none", width: "100%", height: "100%", margin: 0, background: "transparent", border: "none", cursor: "pointer" }} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, exclusiveVideo: getSafeExclusiveVideo(current.exclusiveVideo, getSafeSchedules(current.schedules).length).map((item, itemIndex) => itemIndex === index ? event.target.checked : item) }))} />
                                  </label>
                                  <button type="button" className="btn" style={{ padding: "3px 6px", fontSize: 11 }} onClick={() => updateMonthEntry(row.key, (current) => { const currentSchedules = getSafeSchedules(current.schedules); const nextSchedules = removeScheduleAt(currentSchedules, index); return { ...current, schedules: nextSchedules, exclusiveVideo: removeExclusiveVideoAt(getSafeExclusiveVideo(current.exclusiveVideo, currentSchedules.length), index, nextSchedules.length) }; })}>삭제</button>
                                </div>
                              ))}
                              <button type="button" className="btn" style={{ width: "fit-content", padding: "2px 6px", fontSize: 11, lineHeight: 1.1 }} onClick={() => updateMonthEntry(row.key, (current) => { const currentSchedules = getSafeSchedules(current.schedules); return { ...current, schedules: [...currentSchedules, ""], exclusiveVideo: [...getSafeExclusiveVideo(current.exclusiveVideo, currentSchedules.length), false] }; })}>+</button>
                            </div>
                          </td>
                          <td style={{ padding: "4px 5px", textAlign: "center", verticalAlign: "middle" }}>{scheduleCount}</td>
                          <td style={{ padding: "4px 5px", verticalAlign: "top" }}>
                            <select className="field-select" value={entry.travelType} style={{ minWidth: 118 }} onChange={(event) => updateMonthEntry(row.key, (current) => ({ ...current, travelType: event.target.value as AssignmentTravelType }))}>
                              {travelOptions.map((option) => <option key={`${row.key}-${option.value || "default"}`} value={option.value}>{option.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7}><div className="status note">해당 날짜에는 근무자가 없습니다.</div></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "5px 10px", fontSize: 12, opacity: selectedRow ? 1 : 0.45 }}
                  disabled={!selectedRow}
                  onClick={() => {
                    if (!selectedRow) return;
                    deleteRow(day.dateKey, selectedRow);
                    setSelectedDeleteRowKey(null);
                  }}
                >
                  사람 삭제
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
