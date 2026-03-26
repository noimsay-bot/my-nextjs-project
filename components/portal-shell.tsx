"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSession, logoutUser } from "@/lib/auth/storage";

const links = [
  { href: "/", label: "홈" },
  { href: "/schedule", label: "근무표" },
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
        <div className="panel-pad">
          <div className="chip">J SPECIAL FORCE PORTAL</div>
          <h1 className="page-title">근무표를 기준 파일로 옮긴 React/Next 포털</h1>
          <p className="muted" style={{ marginBottom: 0, maxWidth: 980, lineHeight: 1.7 }}>
            <code>schedule-integrated-v10.html</code>의 근무표 기능을 우선 모듈화했고, 이후 화면을 같은 앱 안으로 연결했습니다.
          </p>
          {!isLogin ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <nav className="nav" aria-label="주요 메뉴" style={{ marginBottom: 0 }}>
                  {links.map((link) => (
                    <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}>
                      {link.label}
                    </Link>
                  ))}
                </nav>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="muted">{session?.username} / {session?.role}</span>
                  <button className="btn" onClick={() => { logoutUser(); window.location.href = "/login"; }}>
                    로그아웃
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>
      <main style={{ marginTop: 20 }}>{children}</main>
    </div>
  );
}
