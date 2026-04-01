"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getSession,
  initializeAuth,
  subscribeToAuth,
  type UserRole,
  type SessionUser,
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
  }, [isPublicPath, pathname]);

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

    if (!hasAccess(pathname, session.role)) {
      router.replace("/");
      return;
    }
  }, [checkingSession, isPublicPath, pathname, router, session]);

  const content = (
    <div key={pathname} style={{ display: "contents" }}>
      {children}
    </div>
  );

  if (isPublicPath) return content;
  if (checkingSession || session === undefined) return <div className="status note">인증 상태를 확인하는 중입니다.</div>;
  if (!session || !session.approved || !hasAccess(pathname, session.role)) return null;
  return content;
}
