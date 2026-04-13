"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSession, subscribeToAuth, type SessionUser } from "@/lib/auth/storage";
import { trackPortalPageView, trackPortalVisit } from "@/lib/portal/usage";

export function PortalUsageTracker() {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionUser | null>(() => getSession());

  useEffect(() => {
    return subscribeToAuth((nextSession) => {
      setSession(nextSession);
    });
  }, []);

  useEffect(() => {
    if (!session?.approved) return;
    if (typeof window === "undefined") return;

    const isMobileHome =
      pathname === "/" && (window.matchMedia("(any-pointer: coarse)").matches || window.innerWidth <= 820);
    const delay = isMobileHome ? 2600 : 400;
    let idleHandle = 0;
    let timer = 0;
    let cancelled = false;

    const runTracking = () => {
      if (cancelled) return;
      void trackPortalVisit(session, pathname);
      void trackPortalPageView(session, pathname);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(runTracking, { timeout: delay + 1400 });
    }
    timer = window.setTimeout(runTracking, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, [pathname, session?.approved, session?.id]);

  return null;
}
