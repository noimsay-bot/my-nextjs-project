"use client";

import { useEffect, useState } from "react";
import { getUsers } from "@/lib/auth/storage";
import { refreshScheduleState } from "@/lib/schedule/storage";
import {
  AssignmentTravelType,
  getTeamLeadTripCards,
  TEAM_LEAD_CONTRIBUTION_EVENT,
  TEAM_LEAD_FINAL_CUT_EVENT,
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
  const [cards, setCards] = useState<TeamLeadTripPersonCard[]>([]);

  useEffect(() => {
    const refresh = async () => {
      await Promise.all([refreshScheduleState(), refreshTeamLeadState()]);
      const tripCards = getTeamLeadTripCards(travelTypes);
      if (!showAllUsers) {
        setCards(tripCards);
        return;
      }

      const cardMap = new Map(tripCards.map((card) => [card.name, card] as const));
      const merged = getUsers()
        .map((user) => user.username)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "ko"))
        .map((name) => cardMap.get(name) ?? { name, items: [] });

      setCards(merged);
    };

    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, refresh);
    window.addEventListener(TEAM_LEAD_FINAL_CUT_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_CONTRIBUTION_EVENT, refresh);
      window.removeEventListener(TEAM_LEAD_FINAL_CUT_EVENT, refresh);
    };
  }, [showAllUsers, travelTypes]);

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
            <article key={card.name} className="panel">
              <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 20 }}>{card.name}</strong>
                  <span className="muted">{card.items.length}건</span>
                </div>

                {card.items.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {card.items.map((item) => (
                      <div
                        key={`${card.name}-${item.dateKey}-${item.duty}-${item.travelType}`}
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
                          <strong>{item.dateKey}</strong>
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
                        <div className="muted">{item.duty || "근무유형 미입력"}</div>
                        <div style={{ display: "grid", gap: 4 }}>
                          {item.schedules.length > 0 ? (
                            item.schedules.map((schedule, index) => (
                              <div key={`${item.dateKey}-schedule-${index}`}>{schedule}</div>
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
                )}
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
