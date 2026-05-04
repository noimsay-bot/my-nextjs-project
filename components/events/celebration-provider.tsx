"use client";

import { useEffect, useState } from "react";
import { CelebrationOverlay } from "@/components/events/celebration-overlay";
import {
  CELEBRATION_EVENT_CHANGED_EVENT,
  getActiveCelebrationEvent,
  type CelebrationEvent,
} from "@/lib/celebrations/storage";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";

const CELEBRATION_POLL_INTERVAL_MS = 30_000;

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

    const syncActiveEvent = async () => {
      const activeEvent = await getActiveCelebrationEvent();
      if (cancelled) {
        return;
      }

      if (!activeEvent) {
        setEvent(null);
        return;
      }

      if (isEventDismissed(activeEvent.id)) {
        setEvent((current) => (current?.id === activeEvent.id ? null : current));
        return;
      }

      setEvent(activeEvent);
    };

    void syncActiveEvent();
    window.addEventListener(CELEBRATION_EVENT_CHANGED_EVENT, syncActiveEvent);
    window.addEventListener("focus", syncActiveEvent);
    document.addEventListener("visibilitychange", syncActiveEvent);
    const pollIntervalId = window.setInterval(syncActiveEvent, CELEBRATION_POLL_INTERVAL_MS);

    if (!hasSupabaseEnv()) {
      return () => {
        cancelled = true;
        window.removeEventListener(CELEBRATION_EVENT_CHANGED_EVENT, syncActiveEvent);
        window.removeEventListener("focus", syncActiveEvent);
        document.removeEventListener("visibilitychange", syncActiveEvent);
        window.clearInterval(pollIntervalId);
      };
    }

    const supabase = createClient();
    const channel = supabase
      .channel(`portal-celebration-events:${Date.now()}:${Math.random().toString(16).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "portal_celebration_events",
        },
        () => {
          void syncActiveEvent();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener(CELEBRATION_EVENT_CHANGED_EVENT, syncActiveEvent);
      window.removeEventListener("focus", syncActiveEvent);
      document.removeEventListener("visibilitychange", syncActiveEvent);
      window.clearInterval(pollIntervalId);
      void supabase.removeChannel(channel);
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
