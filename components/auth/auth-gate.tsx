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
  if (pathname.startsWith("/schedule/vacations")) {
    return session.role === "desk" || session.role === "admin";
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
        pathname.startsWith("/schedule")
      );
    case "team_lead":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/review") ||
        pathname.startsWith("/schedule") ||
        pathname.startsWith("/team-lead")
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
  const [session, setSession] = useState<SessionUser | null | undefined>(() =>
    isPublicPath ? getSession() : undefined,
  );
  const [checkingSession, setCheckingSession] = useState(!isPublicPath);

  useEffect(() => {
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
    if (isPublicPath) {
      setSession(getSession());
      setCheckingSession(false);
      return undefined;
    }

    if (session !== undefined) {
      setCheckingSession(false);

      let cancelled = false;
      void initializeAuth().then((nextSession) => {
        if (cancelled) return;
        setSession(nextSession);
      });

      return () => {
        cancelled = true;
      };
    }

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
  if (checkingSession || session === undefined) return <div className="status note">인증 상태를 확인하는 중입니다.</div>;
  if (!session || !session.approved || !hasAccess(pathname, session)) return null;
  return <>{children}</>;
}
