import { defaultScheduleState, STORAGE_KEY } from "@/lib/schedule/constants";
import { sanitizeScheduleState } from "@/lib/schedule/engine";
import { ScheduleState } from "@/lib/schedule/types";

export const SCHEDULE_STATE_EVENT = "j-special-force-schedule-state-updated";

export function emitScheduleStateEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SCHEDULE_STATE_EVENT));
}

export function readStoredScheduleState() {
  if (typeof window === "undefined") return sanitizeScheduleState(defaultScheduleState);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  try {
    return sanitizeScheduleState(raw ? (JSON.parse(raw) as Partial<ScheduleState>) : defaultScheduleState);
  } catch {
    return sanitizeScheduleState(defaultScheduleState);
  }
}

export function saveScheduleState(state: ScheduleState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emitScheduleStateEvent();
}
