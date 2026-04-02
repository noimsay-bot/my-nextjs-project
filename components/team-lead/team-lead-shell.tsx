"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/team-lead/contribution", label: "기여도" },
  { href: "/team-lead/broadcast-accident", label: "방송 사고" },
  { href: "/team-lead/live-safety", label: "LIVE무사고" },
  { href: "/team-lead/overall-score", label: "종합 점수" },
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
