"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { AppRouteBoundary } from "@/components/app-route-boundary";
import {
  getSession,
  logoutUser,
  subscribeToAuth,
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

type PortalTheme = "dark" | "light";
const PORTAL_THEME_STORAGE_KEY = "jtbc-portal-theme";

function readStoredTheme(): PortalTheme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(PORTAL_THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const [session, setSession] = useState(() => getSession());
  const [theme, setTheme] = useState<PortalTheme>(() => readStoredTheme());

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

  return (
    <div className="shell">
      <section className="panel portal-header-shell">
        <div className="top-accent" />
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                </div>
                <span className="muted">
                  {session?.username} / {session?.role}
                </span>
                <button
                  className="btn"
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
