"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/team-lead/contribution", label: "기여도" },
  { href: "/team-lead/domestic-trip", label: "국내출장" },
  { href: "/team-lead/international-trip", label: "해외출장" },
  { href: "/team-lead/final-cut", label: "최종보도" },
  { href: "/team-lead/special-report", label: "기획취재" },
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
