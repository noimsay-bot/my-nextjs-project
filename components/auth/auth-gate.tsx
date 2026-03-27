"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession, hasDeskAccess } from "@/lib/auth/storage";

const publicPaths = new Set(["/login"]);

function hasAccess(pathname: string, role: "member" | "reviewer" | "team_lead" | "admin" | "desk") {
  if (role === "member") return pathname === "/" || pathname === "/vacation";
  if (pathname.startsWith("/schedule/vacations")) return hasDeskAccess(role);
  if (pathname.startsWith("/admin")) return role === "admin";
  if (pathname.startsWith("/team-lead")) return role === "team_lead";
  if (pathname.startsWith("/review")) return ["reviewer", "team_lead", "admin"].includes(role);
  return true;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const session = useMemo(() => getSession(), [pathname]);

  useEffect(() => {
    if (publicPaths.has(pathname)) {
      setReady(true);
      return;
    }

    if (!session) {
      router.replace("/login");
      return;
    }

    if (session.mustChangePassword && pathname !== "/login") {
      router.replace(`/login?mode=change`);
      return;
    }

    if (!hasAccess(pathname, session.role)) {
      router.replace("/");
      return;
    }

    setReady(true);
  }, [pathname, router, session]);

  if (publicPaths.has(pathname)) return <>{children}</>;
  if (!ready) return <div className="status note">로그인 상태를 확인하는 중입니다.</div>;
  return <>{children}</>;
}
