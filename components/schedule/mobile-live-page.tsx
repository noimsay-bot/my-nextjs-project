"use client";

import { useEffect, useState } from "react";
import { MobileLiveTabs } from "@/components/schedule/mobile-live-tabs";
import { getSession } from "@/lib/auth/storage";
import {
  addDaysToDateKey,
  getKstTimeLabel,
  getYesterdayKstDateKey,
  isDateKey,
} from "@/lib/youtube-lives/periods";
import {
  canCheckLiveParticipation,
  listYoutubeLivesByDate,
  setLiveParticipation,
  setLiveReportSelected,
  type YoutubeLiveItem,
} from "@/lib/youtube-lives/storage";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function getDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}

export function MobileLivePage() {
  const [dateKey, setDateKey] = useState(() => getYesterdayKstDateKey());
  const [items, setItems] = useState<YoutubeLiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const canCheck = canCheckLiveParticipation(getSession()?.role);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const nextItems = await listYoutubeLivesByDate(dateKey);
        if (!active) return;
        setItems(nextItems);
      } catch (error) {
        if (!active) return;
        setItems([]);
        setMessage(error instanceof Error ? error.message : "라이브 목록을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [dateKey]);

  const setItemState = (videoId: string, checked: boolean, reportSelected: boolean) => {
    setItems((current) =>
      current.map((item) => (item.videoId === videoId ? { ...item, checked, reportSelected } : item)),
    );
  };

  const setItemPending = (videoId: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(videoId);
      else next.delete(videoId);
      return next;
    });
  };

  // 미체크 → 참여(노랑) → 보고서 포함(연한 레드) → 미체크
  const toggle = async (item: YoutubeLiveItem) => {
    if (!canCheck || pendingIds.has(item.videoId)) return;
    setMessage("");
    setItemPending(item.videoId, true);
    try {
      if (!item.checked) {
        setItemState(item.videoId, true, false);
        await setLiveParticipation(item.videoId, true);
      } else if (!item.reportSelected) {
        setItemState(item.videoId, true, true);
        await setLiveReportSelected(item.videoId, true);
      } else {
        setItemState(item.videoId, false, false);
        await setLiveParticipation(item.videoId, false);
      }
    } catch (error) {
      setItemState(item.videoId, item.checked, item.reportSelected);
      setMessage(error instanceof Error ? error.message : "체크를 저장하지 못했습니다.");
    } finally {
      setItemPending(item.videoId, false);
    }
  };

  const checkedCount = items.filter((item) => item.checked).length;
  const reportCount = items.filter((item) => item.checked && item.reportSelected).length;
  const yesterdayKey = getYesterdayKstDateKey();

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <strong style={{ fontSize: 24 }}>모바일 라이브</strong>
          <MobileLiveTabs />
          <div className="status note">
            JTBC News 유튜브 라이브 중 영상취재팀이 참여한 건의 제목을 눌러 체크합니다(노랑). 한 번 더 누르면 주간업무보고서
            포함(빨강), 다시 누르면 해제됩니다. 조회수는 매일
            06:00 수집 시점 기준이며 라이브 후 3일까지 갱신됩니다.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn"
              onClick={() => setDateKey((current) => addDaysToDateKey(current, -1))}
              aria-label="이전 날짜"
            >
              ◀
            </button>
            <input
              type="date"
              className="field-input"
              value={dateKey}
              onChange={(event) => {
                if (isDateKey(event.target.value)) setDateKey(event.target.value);
              }}
              aria-label="날짜 선택"
              style={{ width: "auto", minWidth: 160 }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => setDateKey((current) => addDaysToDateKey(current, 1))}
              aria-label="다음 날짜"
            >
              ▶
            </button>
            <button
              type="button"
              className={`btn ${dateKey === yesterdayKey ? "white" : ""}`}
              onClick={() => setDateKey(yesterdayKey)}
            >
              전날
            </button>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">{getDateLabel(dateKey)}</div>
            <span className="muted">
              라이브 {items.length}건 · 참여 {checkedCount}건 · 보고서 {reportCount}건
            </span>
          </div>
          {message ? <div className="status note">{message}</div> : null}
          {items.length === 0 ? (
            <div className="status note">
              {loading ? "불러오는 중입니다." : message ? "목록을 표시할 수 없습니다." : "이 날짜에 수집된 라이브가 없습니다."}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {items.map((item) => {
                const isReport = item.checked && item.reportSelected;
                const accent = isReport ? "#fca5a5" : "#facc15";
                return (
                <li key={item.videoId} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={item.checked}
                    disabled={!canCheck}
                    onClick={() => void toggle(item)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      gap: "4px 12px",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      justifyContent: "flex-start",
                      textAlign: "left",
                      whiteSpace: "normal",
                      height: "auto",
                      padding: "10px 14px",
                      borderColor: isReport
                        ? "rgba(248,113,113,.62)"
                        : item.checked
                          ? "rgba(250,204,21,.58)"
                          : "rgba(148,163,184,.24)",
                      background: isReport
                        ? "rgba(248,113,113,.22)"
                        : item.checked
                          ? "rgba(250,204,21,.22)"
                          : undefined,
                      color: item.checked ? accent : undefined,
                      opacity: pendingIds.has(item.videoId) ? 0.7 : 1,
                      cursor: canCheck ? "pointer" : "default",
                    }}
                  >
                    <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {getKstTimeLabel(item.startedAt)}
                    </span>
                    <span
                      style={{
                        flex: "1 1 180px",
                        minWidth: 0,
                        overflowWrap: "anywhere",
                        fontWeight: item.checked ? 700 : 400,
                      }}
                    >
                      {isReport ? "★ " : item.checked ? "✓ " : ""}
                      {item.title || "(제목 없음)"}
                    </span>
                    {item.viewCount !== null ? (
                      <span
                        className={item.checked ? undefined : "muted"}
                        style={{ flexShrink: 0, fontSize: 13, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
                      >
                        조회수 {item.viewCount.toLocaleString("ko-KR")}
                      </span>
                    ) : null}
                  </button>
                  <a
                    className="btn"
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${item.title} 유튜브에서 열기`}
                    title="유튜브에서 열기"
                    style={{ flexShrink: 0, height: "auto" }}
                  >
                    ↗
                  </a>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </article>
    </section>
  );
}
