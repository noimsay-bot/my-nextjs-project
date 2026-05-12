"use client";

import { useEffect, useMemo, useState } from "react";
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

function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeEventsForSave(events: ScheduleBigEvent[]) {
  return events.map((event) => ({
    ...event,
    name: event.name.trim(),
    assignments: event.assignments.map((assignment) => ({
      ...assignment,
      name: assignment.name.trim(),
      profile_id: assignment.profile_id ?? null,
      start_date: assignment.start_date,
      end_date: assignment.end_date,
    })),
  }));
}

function getDraftValidationMessages(events: ScheduleBigEvent[]): BigEventValidationMessage[] {
  const messages: BigEventValidationMessage[] = [];

  events.forEach((event, eventIndex) => {
    const eventName = event.name.trim();
    const eventLabel = eventName || `빅이벤트 ${eventIndex + 1}`;

    if (!eventName) {
      messages.push({
        id: `${event.id || eventIndex}-empty-name`,
        tone: "error",
        text: "빅이벤트명이 비어 있으면 최종 저장할 수 없습니다.",
      });
    }

    event.assignments.forEach((assignment, assignmentIndex) => {
      const assignmentName = assignment.name.trim();
      const messageId = `${event.id || eventIndex}-${assignment.id || assignmentIndex}`;

      if (!assignmentName) {
        messages.push({
          id: `${messageId}-empty-person`,
          tone: "error",
          text: `${eventLabel}: 이름이 비어 있으면 최종 저장할 수 없습니다.`,
        });
      }
      if (!isValidDateInput(assignment.start_date) || !isValidDateInput(assignment.end_date)) {
        messages.push({
          id: `${messageId}-invalid-date`,
          tone: "error",
          text: `${eventLabel}: 시작일과 종료일을 모두 입력해 주세요.`,
        });
      } else if (assignment.start_date > assignment.end_date) {
        messages.push({
          id: `${messageId}-date-order`,
          tone: "error",
          text: `${eventLabel}: 시작일이 종료일보다 늦을 수 없습니다.`,
        });
      }
    });
  });

  return messages;
}

function updateEvent(events: ScheduleBigEvent[], eventId: string, recipe: (event: ScheduleBigEvent) => ScheduleBigEvent) {
  return events.map((event) => (event.id === eventId ? recipe(event) : event));
}

function describeCollapsedEvent(event: ScheduleBigEvent) {
  const count = event.assignments.length;
  if (count === 0) return "배정 없음";

  const preview = event.assignments
    .slice(0, 2)
    .map((assignment) => {
      const name = assignment.name.trim() || "이름 없음";
      const startDate = assignment.start_date || "-";
      const endDate = assignment.end_date || "-";
      return `${name} ${startDate}~${endDate}`;
    })
    .join(", ");

  return `배정 ${count}건 · ${preview}${count > 2 ? " 외" : ""}`;
}

export function ScheduleBigEventsSection({
  monthKey,
  year,
  month,
  events,
  people,
  disabled = false,
  onChange,
}: ScheduleBigEventsSectionProps) {
  const peopleListId = `schedule-big-event-people-${monthKey}`;
  const defaultStart = getDefaultMonthStart(monthKey);
  const defaultEnd = getDefaultMonthEnd(year, month, monthKey);
  const sortedPeople = Array.from(new Set(people.map((name) => name.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "ko"),
  );
  const eventsSignature = useMemo(() => JSON.stringify(events), [events]);
  const [draftEvents, setDraftEvents] = useState(events);
  const [dirty, setDirty] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [collapsedEventIds, setCollapsedEventIds] = useState<Set<string>>(() => new Set(events.map((event) => event.id)));
  const validationMessages = useMemo(() => getDraftValidationMessages(draftEvents), [draftEvents]);
  const displayedValidationMessages = saveAttempted ? validationMessages : [];

  useEffect(() => {
    setDraftEvents(events);
    setDirty(false);
    setSaveAttempted(false);
    setCollapsedEventIds(new Set(events.map((event) => event.id)));
  }, [events, eventsSignature]);

  const commitDraftEvents = (nextEvents: ScheduleBigEvent[]) => {
    setDraftEvents(nextEvents);
    setDirty(true);
    setSaveAttempted(false);
  };

  const addEvent = () => {
    const eventId = createClientId("big-event");
    commitDraftEvents([
      ...draftEvents,
      {
        id: eventId,
        name: "",
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
    setCollapsedEventIds((current) => {
      const next = new Set(current);
      next.delete(eventId);
      return next;
    });
  };

  const addAssignment = (eventId: string) => {
    commitDraftEvents(
      updateEvent(draftEvents, eventId, (event) => ({
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
    commitDraftEvents(draftEvents.filter((event) => event.id !== eventId));
    setCollapsedEventIds((current) => {
      const next = new Set(current);
      next.delete(eventId);
      return next;
    });
  };

  const toggleEventCollapsed = (eventId: string) => {
    setCollapsedEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const updateEventName = (eventId: string, name: string) => {
    commitDraftEvents(updateEvent(draftEvents, eventId, (event) => ({ ...event, name })));
  };

  const updateAssignment = (
    eventId: string,
    assignmentId: string,
    key: "name" | "start_date" | "end_date",
    value: string,
  ) => {
    commitDraftEvents(
      updateEvent(draftEvents, eventId, (event) => ({
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
    commitDraftEvents(
      updateEvent(draftEvents, eventId, (event) => ({
        ...event,
        assignments: event.assignments.filter((assignment) => assignment.id !== assignmentId),
      })),
    );
  };

  const saveDraftEvents = () => {
    const normalizedEvents = normalizeEventsForSave(draftEvents);
    const nextValidationMessages = getDraftValidationMessages(normalizedEvents);
    if (nextValidationMessages.length > 0) {
      setDraftEvents(normalizedEvents);
      setSaveAttempted(true);
      setDirty(true);
      return;
    }

    onChange(normalizedEvents);
    setDraftEvents(normalizedEvents);
    setDirty(false);
    setSaveAttempted(false);
    setCollapsedEventIds(new Set(normalizedEvents.map((event) => event.id)));
  };

  return (
    <section className="panel schedule-big-events-section">
      <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
        <div className="schedule-big-events-header">
          <div style={{ display: "grid", gap: 6 }}>
            <div className="chip">빅이벤트</div>
            <span className="muted">최종 저장 후 근무표의 새 근무유형 칸으로 반영됩니다.</span>
          </div>
          <div className="schedule-big-events-actions">
            <button className="btn" type="button" disabled={disabled} onClick={addEvent}>
              빅이벤트 추가
            </button>
            <button className="btn primary" type="button" disabled={disabled || !dirty} onClick={saveDraftEvents}>
              최종 저장
            </button>
          </div>
        </div>

        {dirty ? <div className="status note">최종 저장 전에는 입력 내용이 근무표에 반영되지 않습니다.</div> : null}

        {displayedValidationMessages.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {displayedValidationMessages.map((message) => (
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

        {draftEvents.length === 0 ? (
          <div className="status note">등록된 빅이벤트가 없습니다.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {draftEvents.map((event) => {
              const collapsed = collapsedEventIds.has(event.id);
              return (
                <div key={event.id} className={`schedule-big-event-card${collapsed ? " is-hidden" : ""}`}>
                  <div className="schedule-big-event-card__header">
                    {collapsed ? (
                      <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
                        <strong>{event.name.trim() || "이름 없는 빅이벤트"}</strong>
                        <span className="muted">{describeCollapsedEvent(event)}</span>
                      </div>
                    ) : (
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
                    )}
                    <div className="schedule-big-event-card__actions">
                      <button className="btn" type="button" onClick={() => toggleEventCollapsed(event.id)}>
                        {collapsed ? "펼치기" : "숨김"}
                      </button>
                      <button className="btn" type="button" disabled={disabled} onClick={() => removeEvent(event.id)}>
                        삭제
                      </button>
                    </div>
                  </div>

                  {collapsed ? null : (
                    <>
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
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
