"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/schedule/write", label: "근무표 관리" },
  { href: "/schedule/vacations", label: "휴가 관리" },
  { href: "/schedule/long-service-leave", label: "근속휴가" },
  { href: "/schedule/health-checks", label: "검진" },
  { href: "/schedule/domestic-trip", label: "국내출장" },
  { href: "/schedule/international-trip", label: "해외출장" },
];

export function ScheduleManagementLinks() {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="btn"
            style={{
              background: active ? "rgba(14,116,144,.9)" : "rgba(15,23,42,.78)",
              border: active ? "1px solid rgba(103,232,249,.5)" : "1px solid rgba(148,163,184,.22)",
              color: active ? "#ecfeff" : "#dbeafe",
              boxShadow: active ? "0 10px 24px rgba(8,145,178,.24)" : "none",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
