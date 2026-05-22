type UsageDebugInput = {
  status: number;
  startedAt: number;
  responseBytes?: number;
};

export function getJsonResponseByteLength(payload: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return undefined;
  }
}

export function logRouteUsageDebug(request: Request, input: UsageDebugInput) {
  if (process.env.VERCEL_USAGE_DEBUG !== "true") return;

  const pathname = new URL(request.url).pathname;
  const elapsedMs = Math.max(0, Date.now() - input.startedAt);
  console.info("[usage-debug]", {
    path: pathname,
    status: input.status,
    elapsedMs,
    responseBytes: input.responseBytes,
  });
}
