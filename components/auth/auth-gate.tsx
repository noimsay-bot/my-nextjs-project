"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getSession,
  initializeAuth,
  subscribeToAuth,
  type UserRole,
} from "@/lib/auth/storage";

const publicPaths = new Set(["/login"]);

function hasAccess(pathname: string, role: UserRole) {
  if (pathname.startsWith("/schedule/vacations")) {
    return role === "desk" || role === "admin";
  }

  switch (role) {
    case "member":
      return pathname === "/" || pathname === "/vacation" || pathname.startsWith("/submissions");
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
        pathname.startsWith("/review") ||
        pathname.startsWith("/schedule")
      );
    case "team_lead":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/review") ||
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
  const [ready, setReady] = useState(publicPaths.has(pathname));
  const [session, setSession] = useState(() => getSession());
  const [checkingSession, setCheckingSession] = useState(!publicPaths.has(pathname));

  useEffect(() => {
    let mounted = true;

    void initializeAuth().then((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!publicPaths.has(pathname)) {
      setReady(false);
      setCheckingSession(true);
      return;
    }

    setReady(true);
    setCheckingSession(false);
  }, [pathname]);

  useEffect(() => {
    if (publicPaths.has(pathname) || session) {
      return;
    }

    let cancelled = false;

    void initializeAuth().then((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    return () => {
      cancelled = true;
    };
  }, [pathname, session]);

  useEffect(() => {
    if (publicPaths.has(pathname)) {
      setReady(true);
      return;
    }

    if (checkingSession || session === undefined) {
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

    if (!hasAccess(pathname, session.role)) {
      router.replace("/");
      return;
    }

    setReady(true);
  }, [checkingSession, pathname, router, session]);

  if (publicPaths.has(pathname)) return <>{children}</>;
  if (!ready) return <div className="status note">인증 상태를 확인하는 중입니다.</div>;
  return <>{children}</>;
}
