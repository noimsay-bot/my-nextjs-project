import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import {
  SANGAM_BASE,
  WEATHER_DISPATCH_CANDIDATES,
  type WeatherDispatchCandidate,
  type WeatherDispatchPoint,
} from "@/lib/weather/candidates";
import {
  WEATHER_FORECAST_OFFSETS,
  WEATHER_DISPATCH_RECOMMENDATION_VERSION,
  generateRainDispatchRecommendationsForRanges,
  generateRainDispatchRecommendationsFromForecasts,
  parseRainAmountDetail,
  parseWeatherDispatchRange,
  type RainDispatchRecommendationResponse,
  type RainForecastFrame,
  type WeatherDispatchRangeMinutes,
} from "@/lib/weather/recommendation";
import { requireWeatherAccess } from "@/lib/weather/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
};
const DATA_GO_KR_BASE_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const DATA_GO_KR_ESTIMATION_NOTE = "예보 시간 단위 기반 추정";
const DISPATCH_CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESHING_CACHE_MESSAGE = "refreshing";
const ALL_DISPATCH_RANGES: WeatherDispatchRangeMinutes[] = [10, 20, 30];
// TODO: 초단기예보에는 POP가 없으므로, 단기예보 POP를 함께 받게 되면
// POP 임계값 미만일 때 추천 자체를 스킵하는 상위 가드를 추가한다.

type KmaGrid = {
  nx: number;
  ny: number;
};

type DataGoKrItem = {
  category?: unknown;
  obsrValue?: unknown;
  fcstValue?: unknown;
  baseDate?: unknown;
  baseTime?: unknown;
  fcstDate?: unknown;
  fcstTime?: unknown;
};

type DataGoKrResponse = {
  response?: {
    header?: {
      resultCode?: unknown;
      resultMsg?: unknown;
    };
    body?: {
      items?: {
        item?: DataGoKrItem[] | DataGoKrItem;
      };
    };
  };
};

type DispatchCacheRow = {
  base_time_kst: string;
  range_minutes: number;
  payload: unknown;
  fetched_at: string;
  expires_at: string;
  error_message: string | null;
};

function jsonWithUsageDebug(request: Request, startedAt: number, payload: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  logRouteUsageDebug(request, {
    status,
    startedAt,
    responseBytes: getJsonResponseByteLength(payload),
  });
  return NextResponse.json(payload, init);
}

function createUnavailablePayload(
  rangeMinutes: WeatherDispatchRangeMinutes,
  message: string,
  base: WeatherDispatchPoint = SANGAM_BASE,
): RainDispatchRecommendationResponse {
  const generatedAt = new Date().toISOString();
  return {
    status: "unavailable",
    message,
    algorithmVersion: WEATHER_DISPATCH_RECOMMENDATION_VERSION,
    base,
    rangeMinutes,
    generatedAt,
    dataBasisAt: null,
    note: DATA_GO_KR_ESTIMATION_NOTE,
    items: [],
  };
}

// For unavailable/empty payloads the items are empty regardless of range, so the
// same payload can be cloned across ranges without recomputing anything.
function withClonedAllRanges(
  payload: RainDispatchRecommendationResponse,
  wantAllRanges: boolean,
): RainDispatchRecommendationResponse {
  if (!wantAllRanges) return payload;
  const allRanges: RainDispatchRecommendationResponse["allRanges"] = {};
  for (const range of ALL_DISPATCH_RANGES) {
    allRanges[range] = { ...payload, rangeMinutes: range };
  }
  return { ...payload, allRanges };
}

function parseCoordinate(value: string | null, min: number, max: number) {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

function getRequestDispatchBase(url: URL): WeatherDispatchPoint | null {
  const lat = parseCoordinate(url.searchParams.get("lat"), -90, 90);
  const lon = parseCoordinate(url.searchParams.get("lon"), -180, 180);
  if (lat === null || lon === null) return null;

  return {
    name: "현재 위치",
    lat,
    lon,
  };
}

function getCacheExpiresAt(date = new Date()) {
  return new Date(date.getTime() + DISPATCH_CACHE_TTL_MS).toISOString();
}

function isRecommendationResponse(value: unknown): value is RainDispatchRecommendationResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { items?: unknown }).items) &&
      typeof (value as { rangeMinutes?: unknown }).rangeMinutes === "number" &&
      (value as { algorithmVersion?: unknown }).algorithmVersion === WEATHER_DISPATCH_RECOMMENDATION_VERSION,
  );
}

function normalizeServiceKey(value: string) {
  try {
    return value.includes("%") ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
}

function toKmaGrid(lat: number, lon: number): KmaGrid {
  const re = 6371.00877;
  const grid = 5.0;
  const slat1 = 30.0;
  const slat2 = 60.0;
  const olon = 126.0;
  const olat = 38.0;
  const xo = 43;
  const yo = 136;
  const degrad = Math.PI / 180.0;
  const reGrid = re / grid;
  const slat1Rad = slat1 * degrad;
  const slat2Rad = slat2 * degrad;
  const olonRad = olon * degrad;
  const olatRad = olat * degrad;
  let sn = Math.tan(Math.PI * 0.25 + slat2Rad * 0.5) / Math.tan(Math.PI * 0.25 + slat1Rad * 0.5);
  sn = Math.log(Math.cos(slat1Rad) / Math.cos(slat2Rad)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1Rad * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1Rad)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olatRad * 0.5);
  ro = (reGrid * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * degrad * 0.5);
  ra = (reGrid * sf) / Math.pow(ra, sn);
  let theta = lon * degrad - olonRad;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + xo + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + yo + 0.5),
  };
}

function getKstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function formatKstDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function formatKstTime(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function getUltraShortForecastBase(now = new Date()) {
  const kstDate = getKstDate(new Date(now.getTime() - 45 * 60 * 1000));
  kstDate.setUTCMinutes(30, 0, 0);
  return {
    baseDate: formatKstDate(kstDate),
    baseTime: formatKstTime(kstDate),
  };
}

function getUltraShortForecastBaseCandidates(now = new Date()) {
  return [45, 75, 105].map((delayMinutes) => {
    const kstDate = getKstDate(new Date(now.getTime() - delayMinutes * 60 * 1000));
    kstDate.setUTCMinutes(30, 0, 0);
    return {
      baseDate: formatKstDate(kstDate),
      baseTime: formatKstTime(kstDate),
    };
  });
}

function getDispatchBaseTimeKst(now = new Date()) {
  const base = getUltraShortForecastBase(now);
  return `${base.baseDate}${base.baseTime}`;
}

function getUltraShortNowcastBaseCandidates(now = new Date()) {
  return [40, 70, 100].map((delayMinutes) => {
    const kstDate = getKstDate(new Date(now.getTime() - delayMinutes * 60 * 1000));
    kstDate.setUTCMinutes(0, 0, 0);
    return {
      baseDate: formatKstDate(kstDate),
      baseTime: formatKstTime(kstDate),
    };
  });
}

function kstDateTimeToIso(date: string, time: string) {
  const paddedTime = time.padStart(4, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}:00+09:00`;
}

function readText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function getPrecipitationTypeLabel(value: string) {
  switch (value) {
    case "1":
      return "비";
    case "2":
      return "비/눈";
    case "3":
      return "눈";
    case "4":
      return "소나기";
    case "5":
      return "빗방울";
    case "6":
      return "빗방울/눈날림";
    case "7":
      return "눈날림";
    default:
      return "강수없음";
  }
}

function normalizeRainAmount(rn1: string | number | null | undefined, precipitationType: string) {
  const parsed = parseRainAmountDetail(rn1);
  if (parsed.adjustedRainMmPerHour > 0) return parsed;
  if (precipitationType !== "0" && precipitationType !== "") {
    return {
      rawRainMmPerHour: 0,
      adjustedRainMmPerHour: 0.2,
      adjustment: "pty-only" as const,
    };
  }
  return parsed;
}

async function fetchDataGoKrItems(
  endpoint: "getUltraSrtNcst" | "getUltraSrtFcst",
  serviceKey: string,
  grid: KmaGrid,
  baseDate: string,
  baseTime: string,
) {
  const url = new URL(`${DATA_GO_KR_BASE_URL}/${endpoint}`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", baseDate);
  url.searchParams.set("base_time", baseTime);
  url.searchParams.set("nx", String(grid.nx));
  url.searchParams.set("ny", String(grid.ny));

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`공공데이터포털 응답 오류(${response.status})`);
  }

  const text = await response.text();
  const data = (() => {
    try {
      return JSON.parse(text) as DataGoKrResponse;
    } catch {
      return null;
    }
  })();
  if (!data) {
    throw new Error("공공데이터포털이 JSON이 아닌 응답을 반환했습니다.");
  }
  if (data?.response?.header?.resultCode !== "00") {
    const resultMsg = readText(data?.response?.header?.resultMsg);
    throw new Error(resultMsg || "공공데이터포털 응답 상태가 정상이 아닙니다.");
  }

  const item = data.response.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function fetchDataGoKrItemsWithBaseFallback(
  endpoint: "getUltraSrtNcst" | "getUltraSrtFcst",
  serviceKey: string,
  grid: KmaGrid,
  bases: Array<{ baseDate: string; baseTime: string }>,
) {
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const items = await fetchDataGoKrItems(endpoint, serviceKey, grid, base.baseDate, base.baseTime);
      if (items.length > 0) {
        return {
          items,
          baseDate: base.baseDate,
          baseTime: base.baseTime,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("data-go-kr-empty-items");
}

function buildObservedFrame(items: DataGoKrItem[], now: Date): RainForecastFrame | null {
  let rn1 = "";
  let pty = "";
  let baseDate = "";
  let baseTime = "";

  for (const item of items) {
    const category = readText(item.category);
    if (category === "RN1") rn1 = readText(item.obsrValue);
    if (category === "PTY") pty = readText(item.obsrValue);
    baseDate ||= readText(item.baseDate);
    baseTime ||= readText(item.baseTime);
  }

  if (!rn1 && !pty) return null;
  const rain = normalizeRainAmount(rn1, pty);
  return {
    afterMinutes: 0,
    rainMmPerHour: rain.adjustedRainMmPerHour,
    rawRainMmPerHour: rain.rawRainMmPerHour,
    rainAdjustment: rain.adjustment,
    forecastAt: baseDate && baseTime ? kstDateTimeToIso(baseDate, baseTime) : now.toISOString(),
    precipitationType: getPrecipitationTypeLabel(pty),
  };
}

function buildForecastFrames(items: DataGoKrItem[], now: Date): RainForecastFrame[] {
  const grouped = new Map<string, { rn1?: string; pty?: string; date: string; time: string }>();

  for (const item of items) {
    const category = readText(item.category);
    if (category !== "RN1" && category !== "PTY") continue;
    const date = readText(item.fcstDate);
    const time = readText(item.fcstTime);
    if (!date || !time) continue;
    const key = `${date}${time}`;
    const current = grouped.get(key) ?? { date, time };
    if (category === "RN1") current.rn1 = readText(item.fcstValue);
    if (category === "PTY") current.pty = readText(item.fcstValue);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .map((entry) => {
      const forecastAt = kstDateTimeToIso(entry.date, entry.time);
      const afterMinutes = Math.max(0, Math.round((new Date(forecastAt).getTime() - now.getTime()) / 600000) * 10);
      const pty = entry.pty ?? "";
      const rain = normalizeRainAmount(entry.rn1, pty);
      return {
        afterMinutes,
        rainMmPerHour: rain.adjustedRainMmPerHour,
        rawRainMmPerHour: rain.rawRainMmPerHour,
        rainAdjustment: rain.adjustment,
        forecastAt,
        precipitationType: getPrecipitationTypeLabel(pty),
      };
    })
    .sort((left, right) => left.afterMinutes - right.afterMinutes);
}

function expandNearestForecastFrames(frames: RainForecastFrame[]) {
  if (frames.length === 0) return [];
  return WEATHER_FORECAST_OFFSETS.map((afterMinutes) => {
    const nearest = frames.reduce((best, frame) => {
      const bestDistance = Math.abs(best.afterMinutes - afterMinutes);
      const frameDistance = Math.abs(frame.afterMinutes - afterMinutes);
      return frameDistance < bestDistance ? frame : best;
    }, frames[0]);
    return {
      afterMinutes,
      rainMmPerHour: nearest.rainMmPerHour,
      rawRainMmPerHour: nearest.rawRainMmPerHour,
      rainAdjustment: nearest.rainAdjustment,
      forecastAt: nearest.forecastAt,
      precipitationType: nearest.precipitationType,
    };
  });
}

async function fetchGridForecast(serviceKey: string, grid: KmaGrid, now: Date) {
  const [nowcastResult, forecastResult] = await Promise.all([
    fetchDataGoKrItemsWithBaseFallback(
      "getUltraSrtNcst",
      serviceKey,
      grid,
      getUltraShortNowcastBaseCandidates(now),
    ).catch(() => null),
    fetchDataGoKrItemsWithBaseFallback(
      "getUltraSrtFcst",
      serviceKey,
      grid,
      getUltraShortForecastBaseCandidates(now),
    ),
  ]);
  const observedFrame = nowcastResult ? buildObservedFrame(nowcastResult.items, now) : null;
  const forecastFrames = buildForecastFrames(forecastResult.items, now);
  const rawFrames = observedFrame ? [observedFrame, ...forecastFrames] : forecastFrames;

  return {
    frames: expandNearestForecastFrames(rawFrames),
    dataBasisAt: kstDateTimeToIso(forecastResult.baseDate, forecastResult.baseTime),
  };
}

async function buildForecastMap(serviceKey: string, now: Date) {
  const gridEntries = new Map<string, { grid: KmaGrid; candidates: WeatherDispatchCandidate[] }>();
  for (const candidate of WEATHER_DISPATCH_CANDIDATES) {
    const grid = toKmaGrid(candidate.lat, candidate.lon);
    const key = `${grid.nx}:${grid.ny}`;
    const entry = gridEntries.get(key) ?? { grid, candidates: [] };
    entry.candidates.push(candidate);
    gridEntries.set(key, entry);
  }

  const forecastsByCandidateId = new Map<string, RainForecastFrame[]>();
  const dataBasisTimes: string[] = [];
  let firstErrorMessage = "";

  await Promise.all(
    Array.from(gridEntries.values()).map(async ({ grid, candidates }) => {
      const result = await fetchGridForecast(serviceKey, grid, now).catch((error: unknown) => {
        if (!firstErrorMessage) {
          firstErrorMessage = error instanceof Error ? error.message : "공공데이터 초단기예보를 불러오지 못했습니다.";
        }
        return null;
      });
      if (!result || result.frames.length === 0) return;
      dataBasisTimes.push(result.dataBasisAt);
      for (const candidate of candidates) {
        forecastsByCandidateId.set(candidate.id, result.frames);
      }
    }),
  );

  return {
    forecastsByCandidateId,
    dataBasisAt: dataBasisTimes.sort().at(-1) ?? null,
    errorMessage: firstErrorMessage || null,
  };
}

async function readFreshDispatchCache(baseTimeKst: string, rangeMinutes: WeatherDispatchRangeMinutes) {
  if (!hasSupabaseAdminEnv()) return null;
  const { data, error } = await createAdminClient()
    .from("weather_dispatch_cache")
    .select("base_time_kst, range_minutes, payload, fetched_at, expires_at, error_message")
    .eq("base_time_kst", baseTimeKst)
    .eq("range_minutes", rangeMinutes)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<DispatchCacheRow>();

  if (error || !data || data.error_message || !isRecommendationResponse(data.payload)) return null;
  return data;
}

async function readRefreshingDispatchCache(baseTimeKst: string, rangeMinutes: WeatherDispatchRangeMinutes) {
  if (!hasSupabaseAdminEnv()) return null;
  const { data, error } = await createAdminClient()
    .from("weather_dispatch_cache")
    .select("base_time_kst, range_minutes, payload, fetched_at, expires_at, error_message")
    .eq("base_time_kst", baseTimeKst)
    .eq("range_minutes", rangeMinutes)
    .eq("error_message", REFRESHING_CACHE_MESSAGE)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<DispatchCacheRow>();

  if (error || !data) return null;
  return data;
}

async function writeDispatchCache(input: {
  baseTimeKst: string;
  rangeMinutes: WeatherDispatchRangeMinutes;
  payload: RainDispatchRecommendationResponse;
  errorMessage?: string | null;
}) {
  if (!hasSupabaseAdminEnv()) return;
  const now = new Date().toISOString();
  try {
    const supabase = createAdminClient() as unknown as {
      from: (table: string) => {
        upsert: (values: Record<string, unknown>, options: { onConflict: string }) => Promise<unknown>;
      };
    };
    await supabase
      .from("weather_dispatch_cache")
      .upsert(
        {
          base_time_kst: input.baseTimeKst,
          range_minutes: input.rangeMinutes,
          payload: input.payload,
          fetched_at: now,
          expires_at: getCacheExpiresAt(),
          error_message: input.errorMessage ?? null,
        },
        { onConflict: "base_time_kst,range_minutes" },
      );
  } catch {
    // Cache write failure must not block the fallback API response.
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireWeatherAccess();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const rangeMinutes = parseWeatherDispatchRange(url.searchParams.get("range"));
  const wantAllRanges = url.searchParams.get("all") === "1";
  const requestBase = getRequestDispatchBase(url);
  const dispatchBase = requestBase ?? SANGAM_BASE;
  const useSharedCache = requestBase === null;
  const now = new Date();
  const baseTimeKst = getDispatchBaseTimeKst(now);
  if (useSharedCache) {
    const cached = await readFreshDispatchCache(baseTimeKst, rangeMinutes);
    if (cached) {
      return jsonWithUsageDebug(request, startedAt, cached.payload, { headers: CACHE_HEADERS });
    }

    const refreshing = await readRefreshingDispatchCache(baseTimeKst, rangeMinutes);
    if (refreshing) {
      const payload = createUnavailablePayload(rangeMinutes, "강수 추천 캐시를 갱신하는 중입니다.", dispatchBase);
      return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
    }
  }

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();

  if (!serviceKey) {
    const payload = createUnavailablePayload(rangeMinutes, "공공데이터 초단기예보 서버 설정이 필요합니다.", dispatchBase);
    return jsonWithUsageDebug(request, startedAt, withClonedAllRanges(payload, wantAllRanges), { headers: CACHE_HEADERS });
  }

  try {
    if (useSharedCache) {
      await writeDispatchCache({
        baseTimeKst,
        rangeMinutes,
        payload: createUnavailablePayload(rangeMinutes, "강수 추천 캐시를 갱신하는 중입니다.", dispatchBase),
        errorMessage: REFRESHING_CACHE_MESSAGE,
      });
    }
    const { forecastsByCandidateId, dataBasisAt, errorMessage } = await buildForecastMap(normalizeServiceKey(serviceKey), now);
    if (forecastsByCandidateId.size === 0) {
      const payload: RainDispatchRecommendationResponse = {
        status: "unavailable" as const,
        message: errorMessage
          ? `현재 강수 출동 추천이 없습니다. (${errorMessage})`
          : "현재 강수 출동 추천이 없습니다.",
        algorithmVersion: WEATHER_DISPATCH_RECOMMENDATION_VERSION,
        base: dispatchBase,
        rangeMinutes,
        generatedAt: now.toISOString(),
        dataBasisAt: null,
        note: DATA_GO_KR_ESTIMATION_NOTE,
        items: [],
      };
      if (useSharedCache) {
        await writeDispatchCache({
          baseTimeKst,
          rangeMinutes,
          payload,
          errorMessage: payload.message,
        });
      }
      return jsonWithUsageDebug(request, startedAt, withClonedAllRanges(payload, wantAllRanges), { headers: CACHE_HEADERS });
    }

    const generateOptions = {
      generatedAt: now.toISOString(),
      dataBasisAt,
      note: DATA_GO_KR_ESTIMATION_NOTE,
      status: "available" as const,
      message: null,
      base: dispatchBase,
    };
    const payload = generateRainDispatchRecommendationsFromForecasts(rangeMinutes, forecastsByCandidateId, generateOptions);
    if (useSharedCache) {
      await writeDispatchCache({
        baseTimeKst,
        rangeMinutes,
        payload,
      });
    }
    // Compute every range from the same forecast so the client never refetches
    // data.go.kr just to switch ranges. allRanges is response-only (not cached).
    const responsePayload = wantAllRanges
      ? {
          ...payload,
          allRanges: generateRainDispatchRecommendationsForRanges(ALL_DISPATCH_RANGES, forecastsByCandidateId, generateOptions),
        }
      : payload;
    return jsonWithUsageDebug(request, startedAt, responsePayload, { headers: CACHE_HEADERS });
  } catch {
    const payload = createUnavailablePayload(rangeMinutes, "공공데이터 초단기예보를 처리하지 못했습니다.", dispatchBase);
    if (useSharedCache) {
      await writeDispatchCache({
        baseTimeKst,
        rangeMinutes,
        payload,
        errorMessage: payload.message,
      });
    }
    return jsonWithUsageDebug(request, startedAt, withClonedAllRanges(payload, wantAllRanges), { headers: CACHE_HEADERS });
  }
}
