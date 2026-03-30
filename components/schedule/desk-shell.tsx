"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/schedule/schedule-assignment", label: "일정배정" },
  { href: "/schedule/write", label: "근무표 작성" },
];

export function DeskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href === "/schedule/write" && (pathname.startsWith("/schedule/write") || pathname === "/schedule/vacations"));
              return (
                <Link key={item.href} href={item.href} className={`btn ${active ? "white" : ""}`}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </article>
      {children}
    </section>
  );
}
