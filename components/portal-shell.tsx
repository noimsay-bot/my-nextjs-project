"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppRouteBoundary } from "@/components/app-route-boundary";
import { ScrollToTop } from "@/components/home/ScrollToTop";
import {
  getSession,
  hasAdminAccess,
  logoutUser,
  setRoleExperience,
  subscribeToAuth,
  type UserRole,
} from "@/lib/auth/storage";
import {
  getPortalAccessState,
  subscribeToPortalAccessState,
} from "@/lib/portal/access-state";
import { hasSubmittedReviewLock, REVIEW_SUBMISSION_LOCK_EVENT } from "@/lib/portal/data";

const links = [
  { href: "/community", label: "커뮤니티" },
  { href: "/vacation", label: "휴가 신청" },
  { href: "/submissions", label: "베스트리포트 제출" },
  { href: "/restaurants", label: "내 주변 맛집" },
  { href: "/schedule", label: "DESK" },
  { href: "/review", label: "베스트리포트 평가" },
  { href: "/team-lead", label: "팀장" },
  { href: "/admin", label: "관리자" },
];

type PortalTheme = "dark" | "light" | "pink" | "green";
const PORTAL_THEME_STORAGE_KEY = "jtbc-portal-theme";
const PORTAL_THEMES: PortalTheme[] = ["light", "dark", "pink", "green"];
const ROLE_EXPERIENCE_OPTIONS: UserRole[] = ["member", "reviewer", "desk", "team_lead", "admin"];
const ROLE_EXPERIENCE_LABELS: Record<UserRole, string> = {
  member: "일반",
  reviewer: "평가자",
  desk: "DESK",
  team_lead: "팀장",
  admin: "관리자",
};

function readStoredTheme(): PortalTheme {
  if (typeof window === "undefined") return "dark";
  const storedTheme = window.localStorage.getItem(PORTAL_THEME_STORAGE_KEY);
  return PORTAL_THEMES.includes(storedTheme as PortalTheme) ? (storedTheme as PortalTheme) : "dark";
}

function PortalHeader({ pathname }: { pathname: string }) {
  const router = useRouter();
  const initialSession = getSession();
  const [session, setSession] = useState(initialSession);
  const [theme, setTheme] = useState<PortalTheme>(() => readStoredTheme());
  const [experienceDraftRole, setExperienceDraftRole] = useState<UserRole>(
    () => initialSession?.experienceRole ?? initialSession?.actualRole ?? "admin",
  );
  const [vacationRequestOpen, setVacationRequestOpen] = useState(() => getPortalAccessState().vacationRequestOpen);
  const [submissionAccessOpen, setSubmissionAccessOpen] = useState(() => getPortalAccessState().submissionAccessOpen);
  const [reviewLocked, setReviewLocked] = useState(() => hasSubmittedReviewLock(initialSession?.id));
  const shouldTrackReviewLock = Boolean(session?.canReview);

  useEffect(() => {
    let mounted = true;

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
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(PORTAL_THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    return subscribeToPortalAccessState((accessState) => {
      setVacationRequestOpen(accessState.vacationRequestOpen);
      setSubmissionAccessOpen(accessState.submissionAccessOpen);
    });
  }, []);

  useEffect(() => {
    if (!session?.actualRole) return;
    setExperienceDraftRole(session.experienceRole ?? session.actualRole);
  }, [session?.actualRole, session?.experienceRole]);

  useEffect(() => {
    const syncReviewLocked = () => {
      setReviewLocked(hasSubmittedReviewLock(getSession()?.id));
    };

    if (!shouldTrackReviewLock) {
      setReviewLocked(false);
      return;
    }

    syncReviewLocked();
    window.addEventListener("focus", syncReviewLocked);
    window.addEventListener(REVIEW_SUBMISSION_LOCK_EVENT, syncReviewLocked);
    return () => {
      window.removeEventListener("focus", syncReviewLocked);
      window.removeEventListener(REVIEW_SUBMISSION_LOCK_EVENT, syncReviewLocked);
    };
  }, [shouldTrackReviewLock, session?.id]);

  const visibleLinks = useMemo(() => {
    switch (session?.role) {
      case "member":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/community" ||
            link.href === "/restaurants" ||
            (link.href === "/vacation" && vacationRequestOpen) ||
            (link.href === "/submissions" && submissionAccessOpen) ||
            (link.href === "/review" && session.canReview && !reviewLocked),
        );
      case "reviewer":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/community" ||
            link.href === "/restaurants" ||
            (link.href === "/vacation" && vacationRequestOpen) ||
            (link.href === "/submissions" && submissionAccessOpen) ||
            (link.href === "/review" && session.canReview && !reviewLocked),
        );
      case "desk":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/community" ||
            link.href === "/restaurants" ||
            (link.href === "/vacation" && vacationRequestOpen) ||
            (link.href === "/submissions" && submissionAccessOpen) ||
            link.href === "/schedule" ||
            (link.href === "/review" && session.canReview),
        );
      case "team_lead":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/community" ||
            link.href === "/restaurants" ||
            (link.href === "/vacation" && vacationRequestOpen) ||
            (link.href === "/submissions" && submissionAccessOpen) ||
            (link.href === "/review" && session.canReview && !reviewLocked) ||
            link.href === "/schedule" ||
            link.href === "/team-lead" ||
            link.href === "/admin",
        );
      case "admin":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/community" ||
            link.href === "/restaurants" ||
            (link.href === "/vacation" && vacationRequestOpen) ||
            (link.href === "/submissions" && submissionAccessOpen) ||
            link.href === "/schedule" ||
            (link.href === "/review" && session.canReview && !reviewLocked) ||
            link.href === "/team-lead" ||
            link.href === "/admin",
        );
      default:
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/community" ||
            link.href === "/restaurants" ||
            (link.href === "/vacation" && vacationRequestOpen) ||
            (link.href === "/submissions" && submissionAccessOpen),
        );
    }
  }, [reviewLocked, session?.canReview, session?.role, submissionAccessOpen, vacationRequestOpen]);

  const sessionLabel = useMemo(() => {
    if (!session) return "";
    if (!session.experienceRole) {
      return `${session.username} / ${session.role}`;
    }
    return `${session.username} / ${session.role} 체험중 · 실권한 ${session.actualRole}`;
  }, [session]);

  const adminSession = hasAdminAccess(session?.actualRole) ? session : null;
  const canOpenAdminArea = hasAdminAccess(session?.role);
  const shouldShowLogoutButton = pathname !== "/";

  const cycleExperienceRole = () => {
    setExperienceDraftRole((current) => {
      const currentIndex = ROLE_EXPERIENCE_OPTIONS.indexOf(current);
      if (currentIndex < 0) return ROLE_EXPERIENCE_OPTIONS[0];
      return ROLE_EXPERIENCE_OPTIONS[(currentIndex + 1) % ROLE_EXPERIENCE_OPTIONS.length] ?? ROLE_EXPERIENCE_OPTIONS[0];
    });
  };

  const confirmRoleExperience = () => {
    if (!adminSession) return;

    const nextExperienceRole = experienceDraftRole === adminSession.actualRole ? null : experienceDraftRole;
    const confirmed = window.confirm(
      nextExperienceRole
        ? `${ROLE_EXPERIENCE_LABELS[nextExperienceRole]} 권한으로 전환하시겠습니까?`
        : "관리자 기본 모드로 돌아가시겠습니까?",
    );
    if (!confirmed) return;

    setRoleExperience(nextExperienceRole);
    router.refresh();
  };

  return (
    <section className="panel portal-header-shell">
      <div className="panel-pad" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "stretch" }}>
          <Link href="/" className="brand-logo" aria-label="홈으로 이동">
            <span
              className="brand-logo-text"
              style={{
                fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
                fontWeight: 600,
                letterSpacing: "0.1em",
              }}
            >
              JTBC NEWS CAMERA HUB
            </span>
          </Link>
        </div>
        <div
          className="portal-header-main"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <nav className="nav" aria-label="주요 메뉴" style={{ marginBottom: 0 }}>
            {visibleLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  pathname === link.href ||
                  (link.href === "/community" && pathname.startsWith("/community")) ||
                  (link.href === "/community" && pathname.startsWith("/notices")) ||
                  (link.href === "/restaurants" && pathname.startsWith("/restaurants")) ||
                  (link.href === "/schedule" && pathname.startsWith("/schedule")) ||
                  (link.href === "/team-lead" && pathname.startsWith("/team-lead")) ||
                  (link.href === "/admin" && pathname.startsWith("/admin"))
                    ? "active"
                    : ""
                }
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="portal-header-utility" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="theme-toggle" role="group" aria-label="화면 테마 선택">
              <button
                type="button"
                className={`theme-toggle__button ${theme === "light" ? "theme-toggle__button--active" : ""}`}
                onClick={() => setTheme("light")}
              >
                라이트
              </button>
              <button
                type="button"
                className={`theme-toggle__button ${theme === "dark" ? "theme-toggle__button--active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                다크
              </button>
              <button
                type="button"
                className={`theme-toggle__button ${theme === "pink" ? "theme-toggle__button--active" : ""}`}
                onClick={() => setTheme("pink")}
              >
                핑크
              </button>
              <button
                type="button"
                className={`theme-toggle__button ${theme === "green" ? "theme-toggle__button--active" : ""}`}
                onClick={() => setTheme("green")}
              >
                그린
              </button>
            </div>
            {adminSession ? (
              <>
                <button type="button" className="btn" onClick={cycleExperienceRole}>
                  권한 바꾸기: {ROLE_EXPERIENCE_LABELS[experienceDraftRole]}
                </button>
                <button type="button" className="btn primary" onClick={confirmRoleExperience}>
                  확인
                </button>
              </>
            ) : null}
            {!adminSession && canOpenAdminArea ? (
              <span className="muted">팀장 권한으로 관리자 메뉴 사용 가능</span>
            ) : null}
            <span className="muted">{sessionLabel}</span>
            {shouldShowLogoutButton ? (
              <button
                className="btn portal-header-logout"
                onClick={async () => {
                  await logoutUser();
                  window.location.href = "/login";
                }}
              >
                로그아웃
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldShowGlobalScrollTop = !pathname?.endsWith("/schedule-assignment");

  return (
    <div className="shell">
      <PortalHeader pathname={pathname} />
      <main style={{ marginTop: 20 }}>
        <AppRouteBoundary resetKey={pathname}>
          {children}
        </AppRouteBoundary>
      </main>
      {shouldShowGlobalScrollTop ? <ScrollToTop /> : null}
    </div>
  );
}
