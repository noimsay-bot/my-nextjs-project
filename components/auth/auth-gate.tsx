"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getLastAuthCheckStatus,
  getSession,
  hasAdminAccess,
  hasMemberPortalAccess,
  hasTeamLeadAccess,
  hasSupabaseSessionCookie,
  initializeAuth,
  primeSession,
  subscribeToAuth,
  type SessionUser,
} from "@/lib/auth/storage";
import {
  getPortalAccessState,
  subscribeToPortalAccessState,
} from "@/lib/portal/access-state";
import { hasSubmittedReviewLock } from "@/lib/portal/data";

function authLog(stage: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  console.info(`[auth] ${stage}`, details);
}

const AUTH_GATE_PENDING_TIMEOUT_MS = 6_000;

function hasEquipmentAccess(session: SessionUser) {
  return (
    (session.role === "desk" || session.role === "team_lead" || session.role === "admin") &&
    (session.actualRole === "desk" || session.actualRole === "team_lead" || session.actualRole === "admin")
  );
}

function hasAccess(
  pathname: string,
  session: SessionUser,
  vacationRequestOpen: boolean | null,
  submissionAccessOpen: boolean | null,
) {
  if (pathname.startsWith("/admin")) {
    return hasAdminAccess(session.role);
  }

  if (pathname.startsWith("/team-lead")) {
    return hasTeamLeadAccess(session.role);
  }

  if (pathname.startsWith("/review")) {
    return session.canReview && !hasSubmittedReviewLock(session.id);
  }

  if (pathname.startsWith("/restaurants")) {
    return true;
  }

  if (pathname.startsWith("/equipment")) {
    return hasEquipmentAccess(session);
  }

  if (pathname.startsWith("/community") || pathname.startsWith("/notices")) {
    return true;
  }

  if (pathname.startsWith("/work-schedule")) {
    return true;
  }

  if (pathname === "/vacation") {
    return Boolean(vacationRequestOpen);
  }

  if (pathname.startsWith("/schedule/vacations")) {
    return session.role === "desk" || session.role === "team_lead";
  }

  if (pathname.startsWith("/schedule")) {
    if (session.role === "admin") {
      return pathname.startsWith("/schedule/write");
    }
    return session.role === "desk" || session.role === "team_lead";
  }

  switch (session.role) {
    case "member":
    case "outlet":
    case "observer":
      return (
        pathname === "/" ||
        (pathname === "/vacation" && Boolean(vacationRequestOpen)) ||
        (pathname.startsWith("/submissions") && Boolean(submissionAccessOpen))
      );
    case "reviewer":
      return (
        pathname === "/" ||
        (pathname === "/vacation" && Boolean(vacationRequestOpen)) ||
        pathname.startsWith("/submissions")
      );
    case "desk":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions")
      );
    case "team_lead":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/schedule") ||
        pathname.startsWith("/admin")
      );
    case "admin":
      return (
        pathname === "/" ||
        pathname === "/vacation" ||
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/admin")
      );
    default:
      return hasMemberPortalAccess(session.role);
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const needsVacationAccessCheck = pathname === "/vacation";
  const needsSubmissionAccessCheck = pathname.startsWith("/submissions");
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [checkingSession, setCheckingSession] = useState(() => !getSession());
  const [hadSessionCookie, setHadSessionCookie] = useState(false);
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
  const [vacationRequestOpen, setVacationRequestOpen] = useState<boolean | null>(() => {
    const accessState = getPortalAccessState();
    return accessState.vacationRequestOpen;
  });
  const [submissionAccessOpen, setSubmissionAccessOpen] = useState<boolean | null>(() => {
    const accessState = getPortalAccessState();
    return accessState.submissionAccessOpen;
  });

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeToAuth((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    const cachedSession = getSession();
    const cookieHint = hasSupabaseSessionCookie();
    setHadSessionCookie(cookieHint);

    if (cachedSession) {
      primeSession(cachedSession);
      setSession(cachedSession);
      setCheckingSession(false);
      setRecoveryAttempted(false);
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    if (!cookieHint) {
      setSession(null);
      setCheckingSession(false);
      setRecoveryAttempted(false);
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    setCheckingSession(true);
    setRecoveryAttempted(true);
    authLog("session.check.start", {
      source: "auth-gate",
      pathname,
      hasSessionCookie: cookieHint,
    });

    const latestSession = getSession();
    if (latestSession) {
      setSession(latestSession);
      setCheckingSession(false);
    }

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!needsVacationAccessCheck && !needsSubmissionAccessCheck) {
      return;
    }

    const accessState = getPortalAccessState();
    setVacationRequestOpen(accessState.vacationRequestOpen);
    setSubmissionAccessOpen(accessState.submissionAccessOpen);

    return subscribeToPortalAccessState((nextAccessState) => {
      setVacationRequestOpen(nextAccessState.vacationRequestOpen);
      setSubmissionAccessOpen(nextAccessState.submissionAccessOpen);
    });
  }, [needsSubmissionAccessCheck, needsVacationAccessCheck]);

  useEffect(() => {
    let cancelled = false;

    void initializeAuth()
      .then((nextSession) => {
        if (cancelled) return;
        const resolvedSession = nextSession ?? getSession();
        setSession(resolvedSession);
        setCheckingSession(false);
        authLog("session.check.complete", {
          source: "auth-gate",
          pathname,
          status: resolvedSession ? "ok" : getLastAuthCheckStatus(),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("인증 게이트 초기화에 실패했습니다.", error);
        setSession(getSession());
        setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const authPending = checkingSession && !session;

  useEffect(() => {
    if (!authPending) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const latestSession = getSession();
      setSession(latestSession);
      setCheckingSession(false);
      authLog("session.check.fallback", {
        source: "auth-gate",
        pathname,
        status: latestSession ? "ok" : getLastAuthCheckStatus(),
      });
    }, AUTH_GATE_PENDING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authPending, pathname]);

  useEffect(() => {
    if (authPending) {
      return;
    }

    if (!session) {
      const authStatus = getLastAuthCheckStatus();
      const reason =
        hadSessionCookie && recoveryAttempted && (authStatus === "timeout" || authStatus === "error")
          ? "supabase-unavailable"
          : null;

      authLog("redirect", {
        pathname,
        reason: reason ?? "missing-session",
      });

      const loginUrl = reason
        ? `/login?reason=${reason}&next=${encodeURIComponent(pathname)}`
        : `/login?next=${encodeURIComponent(pathname)}`;
      router.replace(loginUrl);
      return;
    }

    if (!session.approved) {
      authLog("redirect", {
        pathname,
        reason: "approval",
      });
      router.replace("/login?reason=approval");
      return;
    }

    if (session.mustChangePassword) {
      authLog("redirect", {
        pathname,
        reason: "reset-password",
      });
      router.replace(`/login?mode=reset-password&next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (
      needsVacationAccessCheck &&
      vacationRequestOpen === null
    ) {
      return;
    }

    if ((session.role === "member" || session.role === "outlet") && needsSubmissionAccessCheck && submissionAccessOpen === null) {
      return;
    }

    if (!hasAccess(pathname, session, vacationRequestOpen, submissionAccessOpen)) {
      authLog("redirect", {
        pathname,
        reason: "forbidden",
      });
      router.replace("/");
    }
  }, [
    authPending,
    hadSessionCookie,
    needsSubmissionAccessCheck,
    needsVacationAccessCheck,
    pathname,
    recoveryAttempted,
    router,
    session,
    submissionAccessOpen,
    vacationRequestOpen,
  ]);

  if (
    authPending ||
    (needsVacationAccessCheck && vacationRequestOpen === null) ||
    ((session?.role === "member" || session?.role === "outlet") &&
      needsSubmissionAccessCheck &&
      submissionAccessOpen === null)
  ) {
    return <div className="status note">인증 상태를 확인하는 중입니다.</div>;
  }

  if (
    !session ||
    !session.approved ||
    session.mustChangePassword ||
    !hasAccess(pathname, session, vacationRequestOpen, submissionAccessOpen)
  ) {
    return null;
  }

  return <>{children}</>;
}
