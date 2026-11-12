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

  const setItemChecked = (videoId: string, checked: boolean) => {
    setItems((current) => current.map((item) => (item.videoId === videoId ? { ...item, checked } : item)));
  };

  const setItemPending = (videoId: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(videoId);
      else next.delete(videoId);
      return next;
    });
  };

  const toggle = async (item: YoutubeLiveItem) => {
    if (!canCheck || pendingIds.has(item.videoId)) return;
    const nextChecked = !item.checked;
    setMessage("");
    setItemPending(item.videoId, true);
    setItemChecked(item.videoId, nextChecked);
    try {
      await setLiveParticipation(item.videoId, nextChecked);
    } catch (error) {
      setItemChecked(item.videoId, item.checked);
      setMessage(error instanceof Error ? error.message : "체크를 저장하지 못했습니다.");
    } finally {
      setItemPending(item.videoId, false);
    }
  };

  const checkedCount = items.filter((item) => item.checked).length;
  const yesterdayKey = getYesterdayKstDateKey();

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK 모바일 라이브</div>
          <strong style={{ fontSize: 24 }}>모바일 라이브</strong>
          <MobileLiveTabs />
          <div className="status note">
            JTBC News 유튜브 라이브 중 영상취재팀이 참여한 건의 제목을 눌러 체크합니다. 다시 누르면 해제됩니다. 조회수는 매일
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
              라이브 {items.length}건 · 참여 {checkedCount}건
            </span>
          </div>
          {message ? <div className="status note">{message}</div> : null}
          {items.length === 0 ? (
            <div className="status note">
              {loading ? "불러오는 중입니다." : message ? "목록을 표시할 수 없습니다." : "이 날짜에 수집된 라이브가 없습니다."}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {items.map((item) => (
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
                      gap: 12,
                      alignItems: "baseline",
                      justifyContent: "flex-start",
                      textAlign: "left",
                      whiteSpace: "normal",
                      height: "auto",
                      padding: "10px 14px",
                      borderColor: item.checked ? "rgba(250,204,21,.58)" : "rgba(148,163,184,.24)",
                      background: item.checked ? "rgba(250,204,21,.22)" : undefined,
                      color: item.checked ? "#facc15" : undefined,
                      opacity: pendingIds.has(item.videoId) ? 0.7 : 1,
                      cursor: canCheck ? "pointer" : "default",
                    }}
                  >
                    <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {getKstTimeLabel(item.startedAt)}
                    </span>
                    <span
                      style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontWeight: item.checked ? 700 : 400 }}
                    >
                      {item.checked ? "✓ " : ""}
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
              ))}
            </ul>
          )}
        </div>
      </article>
    </section>
  );
}
