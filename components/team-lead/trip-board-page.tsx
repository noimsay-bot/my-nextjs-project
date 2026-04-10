"use client";

import { useEffect, useState } from "react";
import { getUsers, refreshUsers } from "@/lib/auth/storage";
import { PUBLISHED_SCHEDULES_EVENT } from "@/lib/schedule/published";
import { refreshScheduleState, SCHEDULE_STATE_EVENT } from "@/lib/schedule/storage";
import {
  AssignmentTravelType,
  getTeamLeadTripCards,
  TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT,
  refreshTeamLeadState,
  TeamLeadTripPersonCard,
} from "@/lib/team-lead/storage";

function travelTypeLabel(value: AssignmentTravelType) {
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

export function TripBoardPage({
  title,
  travelTypes,
  emptyMessage,
  showAllUsers = false,
}: {
  title: string;
  travelTypes: AssignmentTravelType[];
  emptyMessage: string;
  showAllUsers?: boolean;
}) {
  const [cards, setCards] = useState<Array<TeamLeadTripPersonCard & { cardKey: string }>>([]);
  const [expandedCardKeys, setExpandedCardKeys] = useState<string[]>([]);

  useEffect(() => {
    const syncCards = () => {
      const tripCards = getTeamLeadTripCards(travelTypes);
      if (!showAllUsers) {
        setCards(tripCards.map((card) => ({ ...card, cardKey: card.name })));
        return;
      }

      const users = getUsers();
      if (users.length === 0) {
        setCards(tripCards.map((card) => ({ ...card, cardKey: card.name })));
        return;
      }

      const cardMap = new Map(tripCards.map((card) => [card.name, card] as const));
      const merged = Array.from(
        new Set(
          users
            .map((user) => user.username.trim())
            .filter(Boolean),
        ),
      )
        .sort((left, right) => left.localeCompare(right, "ko"))
        .map((name) => {
          const card = cardMap.get(name) ?? { name, items: [] };
          return {
            ...card,
            cardKey: name,
          };
        });

      setCards(merged);
    };
    const refresh = async () => {
      await Promise.all([refreshUsers(), refreshScheduleState(), refreshTeamLeadState()]);
      syncCards();
    };

    syncCards();
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncCards);
    window.addEventListener(SCHEDULE_STATE_EVENT, syncCards);
    window.addEventListener(PUBLISHED_SCHEDULES_EVENT, syncCards);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, syncCards);
      window.removeEventListener(SCHEDULE_STATE_EVENT, syncCards);
      window.removeEventListener(PUBLISHED_SCHEDULES_EVENT, syncCards);
    };
  }, [showAllUsers, travelTypes]);

  useEffect(() => {
    setExpandedCardKeys((current) => current.filter((cardKey) => cards.some((card) => card.cardKey === cardKey)));
  }, [cards]);

  const toggleCard = (cardKey: string) => {
    setExpandedCardKeys((current) =>
      current.includes(cardKey) ? current.filter((item) => item !== cardKey) : [...current, cardKey],
    );
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
          <div className="chip">{title}</div>
          <strong style={{ fontSize: 24 }}>{title}</strong>
          <div className="status note">
            일정배정에서 입력한 출장 유형과 일정 내용을 사람별 카드로 자동 정리합니다.
          </div>
        </div>
      </article>

      {cards.length > 0 ? (
        <section
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          {cards.map((card) => (
            <article key={card.cardKey} className="panel">
              <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => toggleCard(card.cardKey)}
                  aria-expanded={expandedCardKeys.includes(card.cardKey)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "12px 14px",
                    textAlign: "left",
                    borderRadius: 18,
                  }}
                >
                  <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                    <strong style={{ fontSize: 20 }}>{card.name}</strong>
                    <span className="muted">
                      {card.items.length}건 / {card.items.reduce((sum, item) => sum + item.dayCount, 0)}일
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      border: "1px solid rgba(148,163,184,.22)",
                      background: "rgba(255,255,255,.05)",
                      fontSize: 16,
                      transform: expandedCardKeys.includes(card.cardKey) ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 160ms ease",
                    }}
                  >
                    ˅
                  </span>
                </button>

                {expandedCardKeys.includes(card.cardKey) ? card.items.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {card.items.map((item) => (
                      <div
                        key={`${card.name}-${item.tripTagId}`}
                        style={{
                          display: "grid",
                          gap: 6,
                          padding: "12px 14px",
                          borderRadius: 16,
                          border: "1px solid rgba(148,163,184,.2)",
                          background: "rgba(15,23,42,.18)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <strong>{item.tripTagLabel || "출장명 없음"}</strong>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              background:
                                item.travelType === "해외출장"
                                  ? "rgba(125,211,252,.18)"
                                  : item.travelType === "당일출장"
                                    ? "rgba(251,191,36,.18)"
                                    : "rgba(134,239,172,.16)",
                              color:
                                item.travelType === "해외출장"
                                  ? "#bae6fd"
                                  : item.travelType === "당일출장"
                                    ? "#fde68a"
                                    : "#bbf7d0",
                              border: "1px solid rgba(255,255,255,.08)",
                            }}
                          >
                            {travelTypeLabel(item.travelType)}
                          </span>
                        </div>
                        <div className="muted">
                          {formatTripRange(item.startDateKey, item.endDateKey)} / {item.dayCount}일
                        </div>
                        <div className="muted">
                          {item.duties.length > 0 ? item.duties.join(", ") : "근무유형 미입력"}
                        </div>
                        <div style={{ display: "grid", gap: 4 }}>
                          {item.schedules.length > 0 ? (
                            item.schedules.map((schedule, index) => (
                              <div key={`${item.tripTagId}-schedule-${index}`}>{schedule}</div>
                            ))
                          ) : (
                            <div className="muted">일정 내용 없음</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: 16,
                      border: "1px dashed rgba(148,163,184,.24)",
                      background: "rgba(15,23,42,.12)",
                    }}
                  >
                    <span className="muted">등록된 출장 일정이 없습니다.</span>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-pad">
            <div className="status note">{emptyMessage}</div>
          </div>
        </section>
      )}
    </section>
  );
}
