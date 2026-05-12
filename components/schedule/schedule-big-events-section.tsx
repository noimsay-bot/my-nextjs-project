"use client";

import type { ScheduleBigEvent } from "@/lib/schedule/types";

export interface BigEventValidationMessage {
  id: string;
  tone: "warn" | "error";
  text: string;
}

interface ScheduleBigEventsSectionProps {
  monthKey: string;
  year: number;
  month: number;
  events: ScheduleBigEvent[];
  people: string[];
  disabled?: boolean;
  validationMessages: BigEventValidationMessage[];
  onChange: (events: ScheduleBigEvent[]) => void;
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getDefaultMonthStart(monthKey: string) {
  return `${monthKey}-01`;
}

function getDefaultMonthEnd(year: number, month: number, monthKey: string) {
  return `${monthKey}-${String(getLastDayOfMonth(year, month)).padStart(2, "0")}`;
}

function updateEvent(events: ScheduleBigEvent[], eventId: string, recipe: (event: ScheduleBigEvent) => ScheduleBigEvent) {
  return events.map((event) => (event.id === eventId ? recipe(event) : event));
}

export function ScheduleBigEventsSection({
  monthKey,
  year,
  month,
  events,
  people,
  disabled = false,
  validationMessages,
  onChange,
}: ScheduleBigEventsSectionProps) {
  const peopleListId = `schedule-big-event-people-${monthKey}`;
  const defaultStart = getDefaultMonthStart(monthKey);
  const defaultEnd = getDefaultMonthEnd(year, month, monthKey);
  const sortedPeople = Array.from(new Set(people.map((name) => name.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "ko"),
  );

  const addEvent = () => {
    onChange([
      ...events,
      {
        id: createClientId("big-event"),
        name: "새 빅이벤트",
        assignments: [
          {
            id: createClientId("big-event-assignment"),
            name: sortedPeople[0] ?? "",
            profile_id: null,
            start_date: defaultStart,
            end_date: defaultEnd,
          },
        ],
      },
    ]);
  };

  const addAssignment = (eventId: string) => {
    onChange(
      updateEvent(events, eventId, (event) => ({
        ...event,
        assignments: [
          ...event.assignments,
          {
            id: createClientId("big-event-assignment"),
            name: sortedPeople[0] ?? "",
            profile_id: null,
            start_date: defaultStart,
            end_date: defaultEnd,
          },
        ],
      })),
    );
  };

  const removeEvent = (eventId: string) => {
    onChange(events.filter((event) => event.id !== eventId));
  };

  const updateEventName = (eventId: string, name: string) => {
    onChange(updateEvent(events, eventId, (event) => ({ ...event, name })));
  };

  const updateAssignment = (
    eventId: string,
    assignmentId: string,
    key: "name" | "start_date" | "end_date",
    value: string,
  ) => {
    onChange(
      updateEvent(events, eventId, (event) => ({
        ...event,
        assignments: event.assignments.map((assignment) =>
          assignment.id === assignmentId
            ? {
                ...assignment,
                [key]: value,
                profile_id: key === "name" ? null : assignment.profile_id,
              }
            : assignment,
        ),
      })),
    );
  };

  const removeAssignment = (eventId: string, assignmentId: string) => {
    onChange(
      updateEvent(events, eventId, (event) => ({
        ...event,
        assignments: event.assignments.filter((assignment) => assignment.id !== assignmentId),
      })),
    );
  };

  return (
    <section className="panel schedule-big-events-section">
      <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
        <div className="schedule-big-events-header">
          <div style={{ display: "grid", gap: 6 }}>
            <div className="chip">빅이벤트</div>
            <span className="muted">이벤트명은 근무표의 새 근무유형 칸으로 표시됩니다.</span>
          </div>
          <button className="btn primary" type="button" disabled={disabled} onClick={addEvent}>
            빅이벤트 추가
          </button>
        </div>

        {validationMessages.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {validationMessages.map((message) => (
              <div key={message.id} className={`status ${message.tone === "error" ? "warn" : "note"}`}>
                {message.text}
              </div>
            ))}
          </div>
        ) : null}

        <datalist id={peopleListId}>
          {sortedPeople.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {events.length === 0 ? (
          <div className="status note">등록된 빅이벤트가 없습니다.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {events.map((event) => (
              <div key={event.id} className="schedule-big-event-card">
                <div className="schedule-big-event-card__header">
                  <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span className="muted" style={{ fontWeight: 800 }}>
                      빅이벤트명
                    </span>
                    <input
                      className="field-input"
                      disabled={disabled}
                      value={event.name}
                      onChange={(inputEvent) => updateEventName(event.id, inputEvent.target.value)}
                      placeholder="월드컵"
                    />
                  </label>
                  <button className="btn" type="button" disabled={disabled} onClick={() => removeEvent(event.id)}>
                    삭제
                  </button>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {event.assignments.map((assignment) => (
                    <div key={assignment.id} className="schedule-big-event-assignment-row">
                      <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                        <span className="muted" style={{ fontWeight: 800 }}>
                          이름
                        </span>
                        <input
                          className="field-input"
                          list={peopleListId}
                          disabled={disabled}
                          value={assignment.name}
                          onChange={(inputEvent) =>
                            updateAssignment(event.id, assignment.id, "name", inputEvent.target.value)
                          }
                          placeholder="이름 선택 또는 입력"
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                        <span className="muted" style={{ fontWeight: 800 }}>
                          시작일
                        </span>
                        <input
                          className="field-input"
                          type="date"
                          disabled={disabled}
                          value={assignment.start_date}
                          onChange={(inputEvent) =>
                            updateAssignment(event.id, assignment.id, "start_date", inputEvent.target.value)
                          }
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                        <span className="muted" style={{ fontWeight: 800 }}>
                          종료일
                        </span>
                        <input
                          className="field-input"
                          type="date"
                          disabled={disabled}
                          value={assignment.end_date}
                          onChange={(inputEvent) =>
                            updateAssignment(event.id, assignment.id, "end_date", inputEvent.target.value)
                          }
                        />
                      </label>
                      <button
                        className="btn"
                        type="button"
                        disabled={disabled}
                        onClick={() => removeAssignment(event.id, assignment.id)}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>

                <div>
                  <button className="btn" type="button" disabled={disabled} onClick={() => addAssignment(event.id)}>
                    사람별 배정 행 추가
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
