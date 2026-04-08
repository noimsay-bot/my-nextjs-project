"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppRouteBoundary } from "@/components/app-route-boundary";
import {
  setRoleExperience,
  getSession,
  logoutUser,
  subscribeToAuth,
  type UserRole,
} from "@/lib/auth/storage";

const links = [
  { href: "/", label: "홈" },
  { href: "/vacation", label: "휴가 신청" },
  { href: "/submissions", label: "베스트리포트 제출" },
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

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [session, setSession] = useState(() => getSession());
  const [theme, setTheme] = useState<PortalTheme>(() => readStoredTheme());
  const [experienceDraftRole, setExperienceDraftRole] = useState<UserRole>(() => getSession()?.experienceRole ?? getSession()?.actualRole ?? "admin");

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
    if (!session?.actualRole) return;
    setExperienceDraftRole(session.experienceRole ?? session.actualRole);
  }, [session?.actualRole, session?.experienceRole]);

  const visibleLinks = useMemo(() => {
    switch (session?.role) {
      case "member":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/vacation" ||
            link.href === "/submissions" ||
            (link.href === "/review" && session.canReview),
        );
      case "reviewer":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/vacation" ||
            link.href === "/submissions" ||
            link.href === "/review",
        );
      case "desk":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/vacation" ||
            link.href === "/submissions" ||
            link.href === "/schedule" ||
            (link.href === "/review" && session.canReview),
        );
      case "team_lead":
        return links.filter(
          (link) =>
            link.href === "/" ||
            link.href === "/vacation" ||
            link.href === "/submissions" ||
            link.href === "/review" ||
            link.href === "/schedule" ||
            link.href === "/team-lead",
        );
      case "admin":
        return links;
      default:
        return links.filter((link) => link.href === "/" || link.href === "/vacation" || link.href === "/submissions");
    }
  }, [session?.canReview, session?.role]);

  const sessionLabel = useMemo(() => {
    if (!session) return "";
    if (!session.experienceRole) {
      return `${session.username} / ${session.role}`;
    }
    return `${session.username} / ${session.role} 체험중 · 실권한 ${session.actualRole}`;
  }, [session]);

  const adminSession = session?.actualRole === "admin" ? session : null;

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
    <div className="shell">
      <section className="panel portal-header-shell">
        <div className="panel-pad" style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "stretch" }}>
            <Link href="/" className="brand-logo" aria-label="홈으로 이동">
              <span className="brand-logo-text">JTBC News Camera Hub</span>
            </Link>
          </div>
          {!isLogin ? (
            <div
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
                      (link.href === "/schedule" && pathname.startsWith("/schedule")) ||
                      (link.href === "/team-lead" && pathname.startsWith("/team-lead"))
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
                <span className="muted">
                  {sessionLabel}
                </span>
                <button
                  className="btn portal-header-logout"
                  onClick={async () => {
                    await logoutUser();
                    window.location.href = "/login";
                  }}
                >
                  로그아웃
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <main style={{ marginTop: 20 }}>
        <AppRouteBoundary resetKey={pathname}>
          {children}
        </AppRouteBoundary>
      </main>
    </div>
  );
}
