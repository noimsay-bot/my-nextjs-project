type UsageDebugInput = {
  status: number;
  startedAt: number;
  responseBytes?: number;
};

const LARGE_RESPONSE_WARNING_BYTES = 200 * 1024;
const HIGH_RISK_RESPONSE_WARNING_BYTES = 1024 * 1024;

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
  const approximateBytes = input.responseBytes;
  const logPayload = {
    path: pathname,
    status: input.status,
    elapsedMs,
    approximateBytes,
  };

  if (typeof approximateBytes === "number" && approximateBytes >= HIGH_RISK_RESPONSE_WARNING_BYTES) {
    console.warn("[usage-debug:high-risk-response]", logPayload);
    return;
  }

  if (typeof approximateBytes === "number" && approximateBytes >= LARGE_RESPONSE_WARNING_BYTES) {
    console.warn("[usage-debug:large-response]", logPayload);
    return;
  }

  console.info("[usage-debug]", logPayload);
}
