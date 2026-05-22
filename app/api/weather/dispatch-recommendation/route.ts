import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import {
  generateRainDispatchRecommendations,
  parseWeatherDispatchRange,
} from "@/lib/weather/recommendation";
import { requireWeatherAdmin } from "@/lib/weather/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireWeatherAdmin();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const rangeMinutes = parseWeatherDispatchRange(url.searchParams.get("range"));
  const payload = generateRainDispatchRecommendations(rangeMinutes);

  logRouteUsageDebug(request, {
    status: 200,
    startedAt,
    responseBytes: getJsonResponseByteLength(payload),
  });

  return NextResponse.json(payload, {
    headers: CACHE_HEADERS,
  });
}
