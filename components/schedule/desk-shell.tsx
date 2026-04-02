"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScheduleManagementLinks } from "@/components/schedule/schedule-management-links";

const items = [
  { href: "/schedule/schedule-assignment", label: "일정배정" },
  { href: "/schedule/write", label: "근무 관리" },
  { href: "/schedule/final-cut", label: "정제본" },
  { href: "/schedule/domestic-trip", label: "국내출장" },
  { href: "/schedule/international-trip", label: "해외출장" },
];

export function DeskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showManagementLinks =
    pathname.startsWith("/schedule/write") ||
    pathname === "/schedule/vacations" ||
    pathname === "/schedule/long-service-leave" ||
    pathname === "/schedule/health-checks";

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href === "/schedule/write" &&
                  (pathname.startsWith("/schedule/write") ||
                    pathname === "/schedule/vacations" ||
                    pathname === "/schedule/long-service-leave" ||
                    pathname === "/schedule/health-checks"));
              return (
                <Link key={item.href} href={item.href} className={`btn ${active ? "white" : ""}`}>
                  {item.label}
                </Link>
              );
            })}
          </div>
          {showManagementLinks ? <ScheduleManagementLinks /> : null}
        </div>
      </article>
      {children}
    </section>
  );
}
