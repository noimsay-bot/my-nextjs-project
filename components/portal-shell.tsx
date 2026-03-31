"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSession, logoutUser } from "@/lib/auth/storage";

const links = [
  { href: "/", label: "홈" },
  { href: "/vacation", label: "휴가 신청" },
  { href: "/schedule", label: "DESK" },
  { href: "/submissions", label: "영상평가심사 제출" },
  { href: "/review", label: "영상평가심사" },
  { href: "/team-lead", label: "팀장" },
  { href: "/admin", label: "관리자" },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = getSession();
  const isLogin = pathname === "/login";
  const visibleLinks = (() => {
    switch (session?.role) {
      case "member":
        return links.filter((link) => link.href === "/" || link.href === "/vacation" || link.href === "/submissions");
      case "reviewer":
        return links.filter((link) => link.href === "/" || link.href === "/vacation" || link.href === "/submissions" || link.href === "/review");
      case "desk":
        return links.filter((link) => link.href === "/" || link.href === "/vacation" || link.href === "/submissions" || link.href === "/schedule");
      case "team_lead":
        return links.filter((link) => link.href === "/" || link.href === "/vacation" || link.href === "/submissions" || link.href === "/team-lead");
      case "admin":
        return links;
      default:
        return links.filter((link) => link.href === "/" || link.href === "/vacation" || link.href === "/submissions");
    }
  })();

  return (
    <div className="shell">
      <section className="panel">
        <div className="top-accent" />
        <div className="panel-pad" style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "stretch" }}>
            <Link href="/" className="brand-logo" aria-label="홈으로 이동">
              <span className="brand-logo-text">JTBC 영상취재팀</span>
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
                  <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}>
                    {link.label}
                  </Link>
                ))}
              </nav>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="muted">
                  {session?.username} / {session?.role}
                </span>
                <button
                  className="btn"
                  onClick={() => {
                    logoutUser();
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
      <main style={{ marginTop: 20 }}>{children}</main>
    </div>
  );
}
