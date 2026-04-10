"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DeskPopupNoticeManager } from "@/components/schedule/desk-popup-notice-manager";

const items = [
  { href: "/schedule/schedule-assignment", label: "일정배정" },
  { href: "/schedule/write", label: "근무 관리" },
  { href: "/schedule/final-cut", label: "정제본" },
  { href: "/schedule/domestic-trip", label: "국내출장" },
  { href: "/schedule/international-trip", label: "해외출장" },
];

export function DeskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const updateDeskOffset = () => {
      const height = headerRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty("--desk-header-offset", `${Math.ceil(height) + 8}px`);
    };

    updateDeskOffset();

    if (typeof ResizeObserver === "undefined" || !headerRef.current) {
      window.addEventListener("resize", updateDeskOffset);
      return () => {
        window.removeEventListener("resize", updateDeskOffset);
        root.style.removeProperty("--desk-header-offset");
      };
    }

    const observer = new ResizeObserver(() => {
      updateDeskOffset();
    });
    observer.observe(headerRef.current);
    window.addEventListener("resize", updateDeskOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDeskOffset);
      root.style.removeProperty("--desk-header-offset");
    };
  }, []);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article
        ref={headerRef}
        className="panel desk-shell-sticky"
        style={{
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">DESK</div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "nowrap",
              overflowX: "auto",
              alignItems: "center",
              paddingBottom: 2,
            }}
          >
            {items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href === "/schedule/write" &&
                  (pathname.startsWith("/schedule/write") ||
                    pathname === "/schedule/vacations" ||
                    pathname === "/schedule/long-service-leave" ||
                    pathname === "/schedule/health-checks" ||
                    pathname === "/schedule/press-support"));
              return (
                <Link key={item.href} href={item.href} className={`btn ${active ? "white" : ""}`}>
                  {item.label}
                </Link>
              );
            })}
            <DeskPopupNoticeManager inline showMeta={false} />
          </div>
        </div>
      </article>
      {children}
    </section>
  );
}
