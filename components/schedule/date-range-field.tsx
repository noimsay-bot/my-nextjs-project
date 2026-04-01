"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DESK_RECORD_YEAR, formatDeskRecordDateKeys } from "@/lib/schedule/desk-records";

interface DateRangeFieldProps {
  value: string;
  dateKeys: string[];
  onChange: (next: { date: string; dateKeys: string[] }) => void;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildCalendarCells(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDate = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0);
  const leading = firstDate.getDay() === 0 ? 6 : firstDate.getDay() - 1;
  const cells: Array<{ dateKey: string | null; label: string }> = [];

  for (let index = 0; index < leading; index += 1) {
    cells.push({ dateKey: null, label: "" });
  }

  for (const cursor = new Date(firstDate); cursor <= lastDate; cursor.setDate(cursor.getDate() + 1)) {
    cells.push({ dateKey: toDateKey(cursor), label: String(cursor.getDate()) });
  }

  const trailing = (7 - (cells.length % 7)) % 7;
  for (let index = 0; index < trailing; index += 1) {
    cells.push({ dateKey: null, label: "" });
  }

  return cells;
}

function buildDateRange(startDateKey: string, endDateKey: string) {
  const start = new Date(`${startDateKey}T00:00:00`);
  const end = new Date(`${endDateKey}T00:00:00`);
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const dateKeys: string[] = [];
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    dateKeys.push(toDateKey(cursor));
  }
  return dateKeys;
}

export function DateRangeField({ value, dateKeys, onChange }: DateRangeFieldProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [draftDateKeys, setDraftDateKeys] = useState<string[]>(dateKeys);
  const [viewDate, setViewDate] = useState(() => {
    const current = dateKeys[0];
    return current ? new Date(`${current}T00:00:00`) : new Date(DESK_RECORD_YEAR, 0, 1);
  });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setRangeStart(null);
        setDraftDateKeys(dateKeys);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [dateKeys, open]);

  useEffect(() => {
    if (open) return;
    setDraftDateKeys(dateKeys);
  }, [dateKeys, open]);

  const selectedSet = useMemo(() => new Set(draftDateKeys), [draftDateKeys]);
  const calendarCells = useMemo(() => buildCalendarCells(viewDate), [viewDate]);

  const handlePickDate = (dateKey: string) => {
    if (!rangeStart) {
      setRangeStart(dateKey);
      setDraftDateKeys([dateKey]);
      return;
    }

    setDraftDateKeys(buildDateRange(rangeStart, dateKey));
    setRangeStart(null);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="field-input"
        style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
        onClick={() => {
          if (open) {
            setRangeStart(null);
            setDraftDateKeys(dateKeys);
            setOpen(false);
            return;
          }

          setDraftDateKeys(dateKeys);
          setRangeStart(null);
          const current = dateKeys[0];
          if (current) {
            setViewDate(new Date(`${current}T00:00:00`));
          }
          setOpen(true);
        }}
      >
        {value || "날짜 선택"}
      </button>
      {open ? (
        <div
          className="panel"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 80,
            width: 320,
            maxWidth: "calc(100vw - 48px)",
            background: "#0b1628",
            border: "1px solid rgba(255,255,255,.14)",
            boxShadow: "0 20px 40px rgba(0,0,0,.28)",
            backdropFilter: "none",
            opacity: 1,
          }}
        >
          <div className="panel-pad" style={{ display: "grid", gap: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="btn"
                style={{ padding: "6px 10px" }}
                onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              >
                이전
              </button>
              <strong>{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</strong>
              <button
                type="button"
                className="btn"
                style={{ padding: "6px 10px" }}
                onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              >
                다음
              </button>
            </div>

            <div className="muted" style={{ fontSize: 13 }}>
              첫째 날짜와 마지막 날짜를 누른 뒤 확인을 누르면 사이 날짜까지 모두 입력됩니다.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
              {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
                <div key={label} style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#9bb0c7" }}>
                  {label}
                </div>
              ))}
              {calendarCells.map((cell, index) =>
                cell.dateKey ? (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className="btn"
                    style={{
                      minHeight: 38,
                      padding: 0,
                      justifyContent: "center",
                      borderColor:
                        selectedSet.has(cell.dateKey) || rangeStart === cell.dateKey
                          ? "rgba(59,130,246,.55)"
                          : undefined,
                      background:
                        selectedSet.has(cell.dateKey)
                          ? "rgba(59,130,246,.18)"
                          : rangeStart === cell.dateKey
                            ? "rgba(59,130,246,.1)"
                            : undefined,
                      boxShadow: rangeStart === cell.dateKey ? "0 0 0 1px rgba(125,211,252,.35) inset" : undefined,
                      color:
                        selectedSet.has(cell.dateKey) || rangeStart === cell.dateKey
                          ? "#dbeafe"
                          : undefined,
                    }}
                    onClick={() => handlePickDate(cell.dateKey as string)}
                  >
                    {cell.label}
                  </button>
                ) : (
                  <div key={`blank-${index}`} style={{ minHeight: 38 }} />
                ),
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraftDateKeys([]);
                  setRangeStart(null);
                }}
              >
                초기화
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onChange({
                    date: formatDeskRecordDateKeys(draftDateKeys),
                    dateKeys: draftDateKeys,
                  });
                  setRangeStart(null);
                  setOpen(false);
                }}
              >
                확인
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraftDateKeys(dateKeys);
                  setRangeStart(null);
                  setOpen(false);
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
