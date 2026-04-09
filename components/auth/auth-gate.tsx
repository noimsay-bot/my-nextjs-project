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
  isVacationRequestOpen,
  refreshVacationStore,
  VACATION_EVENT,
} from "@/lib/vacation/storage";
import {
  isTeamLeadSubmissionAccessOpen,
  refreshTeamLeadSubmissionAccessState,
  TEAM_LEAD_SUBMISSION_ACCESS_EVENT,
} from "@/lib/team-lead/storage";

const publicPaths = new Set(["/login"]);

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

  if (pathname.startsWith("/schedule/vacations")) {
    return session.role === "desk" || session.role === "admin" || session.role === "team_lead";
  }

  switch (session.role) {
    case "member":
      return (
        pathname === "/" ||
        (pathname === "/vacation" && Boolean(vacationRequestOpen)) ||
        (pathname.startsWith("/submissions") && Boolean(submissionAccessOpen)) ||
        (session.canReview && pathname.startsWith("/review"))
      );
    case "reviewer":
      return (
        pathname === "/" ||
        (pathname === "/vacation" && Boolean(vacationRequestOpen)) ||
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
  const isPublicPath = publicPaths.has(pathname);
  const needsVacationAccessCheck = pathname === "/vacation";
  const needsSubmissionAccessCheck = pathname.startsWith("/submissions");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(!isPublicPath);
  const [vacationRequestOpen, setVacationRequestOpen] = useState<boolean | null>(() =>
    needsVacationAccessCheck ? null : isVacationRequestOpen(),
  );
  const [submissionAccessOpen, setSubmissionAccessOpen] = useState<boolean | null>(() =>
    needsSubmissionAccessCheck ? null : isTeamLeadSubmissionAccessOpen(),
  );

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

    const syncVacationOpen = () => {
      setVacationRequestOpen(isVacationRequestOpen());
    };

    void refreshVacationStore().then(syncVacationOpen);
    window.addEventListener("focus", syncVacationOpen);
    window.addEventListener(VACATION_EVENT, syncVacationOpen);
    return () => {
      window.removeEventListener("focus", syncVacationOpen);
      window.removeEventListener(VACATION_EVENT, syncVacationOpen);
    };
  }, [isPublicPath]);

  useEffect(() => {
    if (isPublicPath) return undefined;

    const syncSubmissionOpen = () => {
      setSubmissionAccessOpen(isTeamLeadSubmissionAccessOpen());
    };

    void refreshTeamLeadSubmissionAccessState().then(syncSubmissionOpen);
    window.addEventListener("focus", syncSubmissionOpen);
    window.addEventListener(TEAM_LEAD_SUBMISSION_ACCESS_EVENT, syncSubmissionOpen);
    return () => {
      window.removeEventListener("focus", syncSubmissionOpen);
      window.removeEventListener(TEAM_LEAD_SUBMISSION_ACCESS_EVENT, syncSubmissionOpen);
    };
  }, [isPublicPath]);

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
    isPublicPath,
    needsSubmissionAccessCheck,
    needsVacationAccessCheck,
    pathname,
    router,
    session,
    submissionAccessOpen,
    vacationRequestOpen,
  ]);

  if (isPublicPath) return <>{children}</>;
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
