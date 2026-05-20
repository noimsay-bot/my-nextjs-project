"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingScheduleChangeRequestCount } from "@/components/schedule/use-pending-schedule-change-request-count";

const items = [
  { href: "/schedule/write", label: "근무표 관리" },
  { href: "/schedule/vacations", label: "휴가 관리" },
  { href: "/schedule/long-service-leave", label: "근속휴가" },
  { href: "/schedule/health-checks", label: "검진" },
  { href: "/schedule/press-support", label: "출입처 지원" },
];

export function ScheduleManagementLinks({ inline = false }: { inline?: boolean }) {
  const pathname = usePathname();
  const pendingChangeRequestCount = usePendingScheduleChangeRequestCount();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: inline ? "nowrap" : "wrap",
        gap: 10,
        alignItems: "center",
      }}
    >
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
            <span>{item.label}</span>
            {item.href === "/schedule/write" && pendingChangeRequestCount > 0 ? (
              <span className="schedule-change-request-count-badge" aria-label={`대기 중인 근무 변경 요청 ${pendingChangeRequestCount}건`}>
                {pendingChangeRequestCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
