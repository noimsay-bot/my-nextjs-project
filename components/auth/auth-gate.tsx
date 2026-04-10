"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getSession,
  hasAdminAccess,
  initializeAuth,
  subscribeToAuth,
  type SessionUser,
} from "@/lib/auth/storage";
import {
  getPortalAccessState,
  subscribeToPortalAccessState,
} from "@/lib/portal/access-state";
import { hasSubmittedReviewLock } from "@/lib/portal/data";

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
    return hasAdminAccess(session.role);
  }

  if (pathname.startsWith("/review")) {
    return session.canReview && !hasSubmittedReviewLock(session.id);
  }

  if (pathname.startsWith("/schedule/vacations")) {
    return session.role === "desk" || session.role === "admin" || session.role === "team_lead";
  }

  switch (session.role) {
    case "member":
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
        pathname.startsWith("/submissions") ||
        pathname.startsWith("/schedule")
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
      return true;
    default:
      return false;
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const needsVacationAccessCheck = pathname === "/vacation";
  const needsSubmissionAccessCheck = pathname.startsWith("/submissions");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [vacationRequestOpen, setVacationRequestOpen] = useState<boolean | null>(() => {
    const accessState = getPortalAccessState();
    return needsVacationAccessCheck ? null : accessState.vacationRequestOpen;
  });
  const [submissionAccessOpen, setSubmissionAccessOpen] = useState<boolean | null>(() => {
    const accessState = getPortalAccessState();
    return needsSubmissionAccessCheck ? null : accessState.submissionAccessOpen;
  });

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
    return subscribeToPortalAccessState((accessState) => {
      setVacationRequestOpen(accessState.vacationRequestOpen);
      setSubmissionAccessOpen(accessState.submissionAccessOpen);
    });
  }, []);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (checkingSession) {
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

    if ((session.role === "member" || session.role === "reviewer") && needsVacationAccessCheck && vacationRequestOpen === null) {
      return;
    }

    if (session.role === "member" && needsSubmissionAccessCheck && submissionAccessOpen === null) {
      return;
    }

    if (!hasAccess(pathname, session, vacationRequestOpen, submissionAccessOpen)) {
      router.replace("/");
      return;
    }
  }, [
    checkingSession,
    needsSubmissionAccessCheck,
    needsVacationAccessCheck,
    pathname,
    router,
    session,
    submissionAccessOpen,
    vacationRequestOpen,
  ]);

  if (
    checkingSession ||
    ((session?.role === "member" || session?.role === "reviewer") && needsVacationAccessCheck && vacationRequestOpen === null) ||
    (session?.role === "member" && needsSubmissionAccessCheck && submissionAccessOpen === null)
  ) {
    return <div className="status note">인증 상태를 확인하는 중입니다.</div>;
  }
  if (!session || !session.approved || !hasAccess(pathname, session, vacationRequestOpen, submissionAccessOpen)) return null;
  return <>{children}</>;
}
