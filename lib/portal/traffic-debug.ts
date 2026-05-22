"use client";

type PortalTrafficDebugInput = {
  route: string;
  source: "rpc" | "storage" | "direct-supabase" | "fallback-api" | "fallback-direct";
  status: "success" | "error" | "skipped";
  startedAt: number;
};

export function logPortalTrafficDebug(input: PortalTrafficDebugInput) {
  if (process.env.NEXT_PUBLIC_PORTAL_DEBUG_TRAFFIC !== "true") return;

  console.info("[portal-traffic-debug]", {
    route: input.route,
    source: input.source,
    status: input.status,
    elapsedMs: Math.max(0, Date.now() - input.startedAt),
  });
}
