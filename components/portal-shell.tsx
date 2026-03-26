"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSession, logoutUser } from "@/lib/auth/storage";

const links = [
  { href: "/", label: "홈" },
  { href: "/schedule", label: "DESK" },
  { href: "/submissions", label: "영상평가 제출" },
  { href: "/review", label: "평가페이지" },
  { href: "/team-lead", label: "팀장페이지" },
  { href: "/admin", label: "관리자페이지" },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = getSession();
  const isLogin = pathname === "/login";

  return (
    <div className="shell">
      <section className="panel">
        <div className="top-accent" />
        <div className="panel-pad" style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Link href="/" className="brand-logo" aria-label="홈으로 이동">
              <span className="brand-logo-mark">J</span>
              <span className="brand-logo-text">J 특공대</span>
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
                {links.map((link) => (
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
