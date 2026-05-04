"use client";

import { useEffect, useState } from "react";
import { CelebrationOverlay } from "@/components/events/celebration-overlay";
import {
  getActiveCelebrationEvent,
  type CelebrationEvent,
} from "@/lib/celebrations/storage";

function getDismissedKey(eventId: string) {
  return `celebration-dismissed:${eventId}`;
}

function isEventDismissed(eventId: string) {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(getDismissedKey(eventId)) === "true";
}

function markEventDismissed(eventId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getDismissedKey(eventId), "true");
}

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const [event, setEvent] = useState<CelebrationEvent | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getActiveCelebrationEvent().then((activeEvent) => {
      if (cancelled || !activeEvent || isEventDismissed(activeEvent.id)) {
        return;
      }

      setEvent(activeEvent);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = () => {
    if (!event) return;
    markEventDismissed(event.id);
    setEvent(null);
  };

  return (
    <>
      {children}
      {event ? <CelebrationOverlay event={event} onDismiss={handleDismiss} /> : null}
    </>
  );
}
