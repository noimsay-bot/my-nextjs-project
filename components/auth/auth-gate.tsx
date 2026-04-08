"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getSession,
  initializeAuth,
  subscribeToAuth,
  type SessionUser,
} from "@/lib/auth/storage";

const publicPaths = new Set(["/login"]);

function hasAccess(pathname: string, session: SessionUser) {
  if (pathname.startsWith("/team-lead")) {
    return session.role === "team_lead" || session.role === "admin";
  }

  if (pathname.startsWith("/schedule/vacations")) {
    return session.role === "desk" || session.role === "admin" || session.role === "team_lead";
  }

  switch (session.role) {
    case "member":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        (session.canReview && pathname.startsWith("/review"))
      );
    case "reviewer":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/review")
      );
    case "desk":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/schedule") ||
        (session.canReview && pathname.startsWith("/review"))
      );
    case "team_lead":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/review") ||
        pathname.startsWith("/schedule")
      );
    case "admin":
      return true;
    default:
      return false;
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = publicPaths.has(pathname);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(!isPublicPath);

  useEffect(() => {
    if (isPublicPath) {
      setSession(getSession());
      setCheckingSession(false);
      return undefined;
    }

    let mounted = true;

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isPublicPath) return undefined;

    let cancelled = false;
    setCheckingSession(true);

    void initializeAuth().then((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isPublicPath]);

  useEffect(() => {
    if (isPublicPath || checkingSession) {
      return;
    }

    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (!session.approved) {
      router.replace("/login?reason=approval");
      return;
    }

    if (!hasAccess(pathname, session)) {
      router.replace("/");
      return;
    }
  }, [checkingSession, isPublicPath, pathname, router, session]);

  if (isPublicPath) return <>{children}</>;
  if (checkingSession) return <div className="status note">인증 상태를 확인하는 중입니다.</div>;
  if (!session || !session.approved || !hasAccess(pathname, session)) return null;
  return <>{children}</>;
}
