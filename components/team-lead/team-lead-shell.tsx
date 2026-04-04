"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/team-lead/special-report", label: "영상평가 결과" },
  { href: "/team-lead/contribution", label: "팀 기여도" },
  { href: "/team-lead/broadcast-accident", label: "장비/인적 사고" },
  { href: "/team-lead/live-safety", label: "라이브 무사고" },
  { href: "/team-lead/overall-score", label: "개인별 점수" },
  { href: "/team-lead/overall-score-summary", label: "종합점수" },
  { href: "/team-lead/reference-notes", label: "참고사항" },
];

const utilityItems = [
  { href: "/team-lead/reviewer-management", label: "평가자 지정" },
];

export function TeamLeadShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">팀장</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`btn ${pathname === item.href ? "white" : ""} ${
                  item.href === "/team-lead/overall-score"
                    ? "btn-team-lead-personal"
                    : item.href === "/team-lead/overall-score-summary"
                      ? "btn-team-lead-summary"
                      : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {utilityItems.map((item) => (
              <Link key={item.href} href={item.href} className={`btn ${pathname === item.href ? "white" : ""}`}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </article>
      {children}
    </section>
  );
}
