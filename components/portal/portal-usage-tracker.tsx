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
    void trackPortalVisit(session, pathname);
  }, [pathname, session?.approved, session?.id]);

  useEffect(() => {
    if (!session?.approved) return;
    void trackPortalPageView(session, pathname);
  }, [pathname, session?.approved, session?.id]);

  return null;
}
