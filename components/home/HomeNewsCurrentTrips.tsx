"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getTeamLeadTripCards,
  refreshTeamLeadState,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  TeamLeadTripPersonCard,
} from "@/lib/team-lead/storage";

const FOCUS_REFRESH_THROTTLE_MS = 60_000;

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDateKey() {
  return toDateKey(new Date());
}

function travelTypeLabel(value: string) {
  if (value === "국내출장") return "국내출장";
  if (value === "해외출장") return "해외출장";
  if (value === "당일출장") return "당일출장";
  return "";
}

function formatTripRange(startDateKey: string, endDateKey: string) {
  if (!startDateKey) return "";
  if (startDateKey === endDateKey) return startDateKey;
  return `${startDateKey} ~ ${endDateKey}`;
}

type HomeNewsCurrentTripsProps = {
  className?: string;
};

export function HomeNewsCurrentTrips({ className = "" }: HomeNewsCurrentTripsProps) {
  const [tripCards, setTripCards] = useState<TeamLeadTripPersonCard[]>(() => getTeamLeadTripCards(["국내출장", "해외출장"]));
  const [isExpanded, setIsExpanded] = useState(false);
  const lastFocusRefreshAtRef = useRef(0);
  const todayKey = useMemo(() => getTodayDateKey(), []);

  const syncTripCards = () => {
    setTripCards(getTeamLeadTripCards(["국내출장", "해외출장"]));
  };

  const loadTripCards = async () => {
    await refreshTeamLeadState();
    syncTripCards();
  };

  useEffect(() => {
    void loadTripCards().finally(() => {
      lastFocusRefreshAtRef.current = Date.now();
    });
  }, []);

  useEffect(() => {
    const onFocusRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshAtRef.current = now;
      void loadTripCards();
    };
    const onTripRefresh = () => {
      syncTripCards();
    };
    const onStorageRefresh = () => {
      void loadTripCards();
    };
    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener("storage", onStorageRefresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, onTripRefresh);
    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener("storage", onStorageRefresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, onTripRefresh);
    };
  }, []);

  const currentTripCards = useMemo(
    () => tripCards
      .map((card) => ({
        ...card,
        items: card.items.filter((item) => item.startDateKey <= todayKey && item.endDateKey >= todayKey),
      }))
      .filter((card) => card.items.length > 0),
    [todayKey, tripCards],
  );

  return (
    <div className={["schedule-current-trips-card", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="schedule-current-trips-card__toggle"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <strong>현재 출장자</strong>
        <span
          aria-hidden="true"
          className={`schedule-current-trips-card__chevron ${isExpanded ? "schedule-current-trips-card__chevron--expanded" : ""}`}
        >
          ˅
        </span>
      </button>
      {isExpanded ? (
        <div className="schedule-current-trips-card__body">
          {currentTripCards.length > 0 ? (
            currentTripCards.map((card) => (
              <div key={card.name} className="schedule-current-trips-card__person">
                <strong className="schedule-current-trips-card__name">{card.name}</strong>
                <div className="schedule-current-trips-card__items">
                  {card.items.map((item) => (
                    <div key={`${card.name}-${item.tripTagId}`} className="schedule-current-trips-card__item">
                      <div className="schedule-current-trips-card__item-head">
                        <strong>{item.tripTagLabel || "출장명 없음"}</strong>
                        <span className="schedule-current-trips-card__type">{travelTypeLabel(item.travelType)}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {formatTripRange(item.startDateKey, item.endDateKey)}
                      </div>
                      <div className="schedule-current-trips-card__schedules">
                        {item.schedules.length > 0 ? (
                          item.schedules.map((schedule, index) => (
                            <div key={`${item.tripTagId}-schedule-${index}`}>{schedule}</div>
                          ))
                        ) : (
                          <div className="muted" style={{ fontSize: 12 }}>일정 내용 없음</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="schedule-current-trips-card__empty muted">현재 출장자가 없습니다.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
