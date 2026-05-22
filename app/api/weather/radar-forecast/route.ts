import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { requireWeatherAdmin } from "@/lib/weather/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RADAR_FRAME_OFFSETS = [0, 10, 20, 30, 40, 50, 60] as const;
const RADAR_BASE_DELAY_MINUTES = [10, 20, 30] as const;
const RADAR_QPF_MODES = ["M", "B"] as const;
const RADAR_CACHE_PROVIDER = "kma_apihub_radar_1h";
const RADAR_CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESHING_CACHE_MESSAGE = "refreshing";
const KMA_APIHUB_ORIGIN = "https://apihub.kma.go.kr";
const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
};
const RADAR_UNAVAILABLE_MESSAGE = "기상청 API 활용신청 승인 후 레이더 영상이 표시됩니다.";

type RadarFrameOffset = (typeof RADAR_FRAME_OFFSETS)[number];
type RadarQpfMode = (typeof RADAR_QPF_MODES)[number];
type RadarForecastFrame = {
  offsetMinutes: RadarFrameOffset;
  imageUrl: string | null;
  legendUrl: string | null;
  dateTime: string | null;
  ef: string | null;
  imageCoverageStartProjX: number | null;
  imageCoverageStartProjY: number | null;
  imageCoverageEndProjX: number | null;
  imageCoverageEndProjY: number | null;
  layerCoverageStartProjX: number | null;
  layerCoverageStartProjY: number | null;
  layerCoverageEndProjX: number | null;
  layerCoverageEndProjY: number | null;
  zoomLvl: number | null;
  nodata: boolean;
};

type KmaRadarForecastResponse = {
  meta?: {
    errCd?: unknown;
    errMsg?: unknown;
    msg?: unknown;
  };
  data?: {
    result?: unknown;
  };
  result?: unknown;
};

type RadarCacheRow = {
  base_time_kst: string;
  ef_minutes: number;
  qpf: string;
  image_url: string | null;
  legend_url: string | null;
  date_time_text: string | null;
  zoom_lvl: string | null;
  coverage: unknown;
  nodata: boolean;
  fetched_at: string;
  expires_at: string;
  error_message: string | null;
};

function normalizeRadarOffset(value: string | null): RadarFrameOffset {
  const numeric = Number(value);
  return RADAR_FRAME_OFFSETS.includes(numeric as RadarFrameOffset)
    ? (numeric as RadarFrameOffset)
    : 0;
}

function createUnavailableResponse(offsetMinutes: RadarFrameOffset, detail?: string) {
  return {
    status: "unavailable" as const,
    message: RADAR_UNAVAILABLE_MESSAGE,
    detail: detail ?? null,
    generatedAt: new Date().toISOString(),
    frame: createEmptyRadarFrame(offsetMinutes),
  };
}

function createEmptyRadarFrame(offsetMinutes: RadarFrameOffset): RadarForecastFrame {
  return {
    offsetMinutes,
    imageUrl: null,
    legendUrl: null,
    dateTime: null,
    ef: null,
    imageCoverageStartProjX: null,
    imageCoverageStartProjY: null,
    imageCoverageEndProjX: null,
    imageCoverageEndProjY: null,
    layerCoverageStartProjX: null,
    layerCoverageStartProjY: null,
    layerCoverageEndProjX: null,
    layerCoverageEndProjY: null,
    zoomLvl: null,
    nodata: true,
  };
}

function getCacheExpiresAt(date = new Date()) {
  return new Date(date.getTime() + RADAR_CACHE_TTL_MS).toISOString();
}

function getKstRadarBaseTime(delayMinutes: number, date = new Date()) {
  const kstDate = new Date(date.getTime() + (9 * 60 - delayMinutes) * 60 * 1000);
  kstDate.setUTCMinutes(Math.floor(kstDate.getUTCMinutes() / 10) * 10, 0, 0);
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getUTCDate()).padStart(2, "0");
  const hour = String(kstDate.getUTCHours()).padStart(2, "0");
  const minute = String(kstDate.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

function buildKmaRadarForecastUrl(
  authKey: string,
  baseTime: string,
  offsetMinutes: RadarFrameOffset,
  qpf: RadarQpfMode,
) {
  const params = new URLSearchParams({
    PROJ: "LCC",
    cmp: "HSR",
    obs: "qpf",
    qcd: "EXT",
    grid: "2",
    itv: "10",
    tm_mode: "m10",
    data0: "RCM",
    level: "C",
    map: "R",
    dtm: "m0",
    zoom_level: "0",
    zoom_rate: "2",
    zoom_x: "0000000",
    zoom_y: "0000000",
    auto_man: "1",
    mode: "H",
    umove: "10",
    fmove: "2",
    dmove: "180",
    bmove: "10",
    winnum: "0",
    rand: "10",
    size: "640",
    an_frn: "1",
    an_itv: "1",
    river: "on",
    road: "on",
    city: "on",
    gis_auto: "on",
    stnname: "on",
    ctrl: "0",
    dataDtlCd: "rdr_rdr_qpf_ana1_0",
    data1: "r01",
    data2: "rdr_qpf_ana1",
    data3: "0",
    overlay: "spr",
    color: "C4",
    effect: "N",
    height: "420",
    qpf,
    ef: String(offsetMinutes),
    eva: "1",
    option: "1",
    STARTX: "-384032.28285233676",
    STARTY: "4878817.500765007",
    ENDX: "758967.7171476632",
    ENDY: "3778150.834098339",
    ZOOMLVL: "11",
    selWs: "kh",
    tm: baseTime,
    tm_st: baseTime,
    tm_ed: baseTime,
    tm2: baseTime,
    authKey,
  });

  return `https://apihub.kma.go.kr/api/typ03/cgi/rdr/nph-qpf_ana_imgp?${params.toString()}`;
}

function jsonWithUsageDebug(request: Request, startedAt: number, payload: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  logRouteUsageDebug(request, {
    status,
    startedAt,
    responseBytes: getJsonResponseByteLength(payload),
  });
  return NextResponse.json(payload, init);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "y") return true;
      if (normalized === "false" || normalized === "0" || normalized === "n") return false;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  }
  return false;
}

function toKmaAssetUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, KMA_APIHUB_ORIGIN);
    if (url.origin !== KMA_APIHUB_ORIGIN) return null;
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase() === "authkey") {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function readCoverageNumber(
  result: Record<string, unknown>,
  coverageKey: string,
  directKeys: string[],
  nestedKeys: string[],
) {
  const directValue = readNumber(result, directKeys);
  if (directValue !== null) return directValue;
  return readNumber(getRecord(result[coverageKey]), nestedKeys);
}

function readCoverageRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function radarFrameFromCacheRow(row: RadarCacheRow): RadarForecastFrame {
  const coverage = readCoverageRecord(row.coverage);
  return {
    offsetMinutes: normalizeRadarOffset(String(row.ef_minutes)),
    imageUrl: row.image_url,
    legendUrl: row.legend_url,
    dateTime: row.date_time_text ?? row.base_time_kst,
    ef: String(row.ef_minutes),
    imageCoverageStartProjX: readNumber(coverage, ["imageCoverageStartProjX"]),
    imageCoverageStartProjY: readNumber(coverage, ["imageCoverageStartProjY"]),
    imageCoverageEndProjX: readNumber(coverage, ["imageCoverageEndProjX"]),
    imageCoverageEndProjY: readNumber(coverage, ["imageCoverageEndProjY"]),
    layerCoverageStartProjX: readNumber(coverage, ["layerCoverageStartProjX"]),
    layerCoverageStartProjY: readNumber(coverage, ["layerCoverageStartProjY"]),
    layerCoverageEndProjX: readNumber(coverage, ["layerCoverageEndProjX"]),
    layerCoverageEndProjY: readNumber(coverage, ["layerCoverageEndProjY"]),
    zoomLvl: row.zoom_lvl ? Number(row.zoom_lvl) : null,
    nodata: row.nodata,
  };
}

function radarCoveragePayload(frame: RadarForecastFrame) {
  return {
    imageCoverageStartProjX: frame.imageCoverageStartProjX,
    imageCoverageStartProjY: frame.imageCoverageStartProjY,
    imageCoverageEndProjX: frame.imageCoverageEndProjX,
    imageCoverageEndProjY: frame.imageCoverageEndProjY,
    layerCoverageStartProjX: frame.layerCoverageStartProjX,
    layerCoverageStartProjY: frame.layerCoverageStartProjY,
    layerCoverageEndProjX: frame.layerCoverageEndProjX,
    layerCoverageEndProjY: frame.layerCoverageEndProjY,
  };
}

async function readFreshRadarCache(offsetMinutes: RadarFrameOffset) {
  if (!hasSupabaseAdminEnv()) return null;
  const { data, error } = await createAdminClient()
    .from("weather_radar_frames")
    .select(
      "base_time_kst, ef_minutes, qpf, image_url, legend_url, date_time_text, zoom_lvl, coverage, nodata, fetched_at, expires_at, error_message",
    )
    .eq("provider", RADAR_CACHE_PROVIDER)
    .eq("ef_minutes", offsetMinutes)
    .gt("expires_at", new Date().toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle<RadarCacheRow>();

  if (error || !data || data.nodata || !data.image_url) return null;
  return data;
}

async function readRefreshingRadarCache(offsetMinutes: RadarFrameOffset) {
  if (!hasSupabaseAdminEnv()) return null;
  const { data, error } = await createAdminClient()
    .from("weather_radar_frames")
    .select(
      "base_time_kst, ef_minutes, qpf, image_url, legend_url, date_time_text, zoom_lvl, coverage, nodata, fetched_at, expires_at, error_message",
    )
    .eq("provider", RADAR_CACHE_PROVIDER)
    .eq("ef_minutes", offsetMinutes)
    .eq("error_message", REFRESHING_CACHE_MESSAGE)
    .gt("expires_at", new Date().toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle<RadarCacheRow>();

  if (error || !data) return null;
  return data;
}

async function writeRadarCache(input: {
  baseTime: string;
  qpf: RadarQpfMode;
  frame: RadarForecastFrame;
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
      .from("weather_radar_frames")
      .upsert(
        {
          provider: RADAR_CACHE_PROVIDER,
          base_time_kst: input.baseTime,
          ef_minutes: input.frame.offsetMinutes,
          qpf: input.qpf,
          image_url: input.frame.imageUrl,
          legend_url: input.frame.legendUrl,
          date_time_text: input.frame.dateTime,
          zoom_lvl: input.frame.zoomLvl === null ? null : String(input.frame.zoomLvl),
          coverage: radarCoveragePayload(input.frame),
          nodata: input.frame.nodata,
          fetched_at: now,
          expires_at: getCacheExpiresAt(),
          error_message: input.errorMessage ?? null,
        },
        { onConflict: "provider,base_time_kst,ef_minutes,qpf" },
      );
  } catch {
    // Cache write failure must not break the weather screen.
  }
}

function normalizeKmaRadarFrame(result: unknown, offsetMinutes: RadarFrameOffset): RadarForecastFrame {
  const record = getRecord(result);
  const emptyFrame = createEmptyRadarFrame(offsetMinutes);
  if (!record) return emptyFrame;

  const nodata = readBoolean(record, ["nodata", "noData", "no_data"]);
  return {
    offsetMinutes,
    imageUrl: toKmaAssetUrl(readString(record, ["url", "imageUrl", "imageURL"])),
    legendUrl: toKmaAssetUrl(readString(record, ["bar", "legendUrl", "legendURL"])),
    dateTime: readString(record, ["dateTime", "datetime", "tm", "time", "date_time"]),
    ef: readString(record, ["ef"]),
    imageCoverageStartProjX: readCoverageNumber(record, "imageCoverage", ["imageCoverageStartProjX"], ["startProjX", "startX"]),
    imageCoverageStartProjY: readCoverageNumber(record, "imageCoverage", ["imageCoverageStartProjY"], ["startProjY", "startY"]),
    imageCoverageEndProjX: readCoverageNumber(record, "imageCoverage", ["imageCoverageEndProjX"], ["endProjX", "endX"]),
    imageCoverageEndProjY: readCoverageNumber(record, "imageCoverage", ["imageCoverageEndProjY"], ["endProjY", "endY"]),
    layerCoverageStartProjX: readCoverageNumber(record, "layerCoverage", ["layerCoverageStartProjX"], ["startProjX", "startX"]),
    layerCoverageStartProjY: readCoverageNumber(record, "layerCoverage", ["layerCoverageStartProjY"], ["startProjY", "startY"]),
    layerCoverageEndProjX: readCoverageNumber(record, "layerCoverage", ["layerCoverageEndProjX"], ["endProjX", "endX"]),
    layerCoverageEndProjY: readCoverageNumber(record, "layerCoverage", ["layerCoverageEndProjY"], ["endProjY", "endY"]),
    zoomLvl: readNumber(record, ["zoomLvl", "zoomLVL", "ZOOMLVL"]),
    nodata,
  };
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireWeatherAdmin();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const offsetMinutes = normalizeRadarOffset(url.searchParams.get("offset"));
  const authKey = process.env.KMA_APIHUB_AUTH_KEY?.trim();

  const cachedFrame = await readFreshRadarCache(offsetMinutes);
  if (cachedFrame) {
    const frame = radarFrameFromCacheRow(cachedFrame);
    const payload = frame.imageUrl && !frame.nodata
      ? {
          status: "available" as const,
          message: null,
          generatedAt: cachedFrame.fetched_at,
          frame,
        }
      : {
          ...createUnavailableResponse(offsetMinutes, cachedFrame.error_message ?? "캐시된 레이더 데이터가 아직 제공되지 않았습니다."),
          generatedAt: cachedFrame.fetched_at,
          frame,
        };
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  }

  const refreshingFrame = await readRefreshingRadarCache(offsetMinutes);
  if (refreshingFrame) {
    const payload = createUnavailableResponse(offsetMinutes, "레이더 캐시를 갱신하는 중입니다.");
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  }

  if (!authKey) {
    const payload = createUnavailableResponse(offsetMinutes, "기상청 레이더 API 서버 설정이 필요합니다.");
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  }

  try {
    let lastDetail = "KMA APIHub 레이더 예측 데이터가 아직 제공되지 않았습니다.";
    await writeRadarCache({
      baseTime: getKstRadarBaseTime(RADAR_BASE_DELAY_MINUTES[0]),
      qpf: RADAR_QPF_MODES[0],
      frame: createEmptyRadarFrame(offsetMinutes),
      errorMessage: REFRESHING_CACHE_MESSAGE,
    });

    for (const delayMinutes of RADAR_BASE_DELAY_MINUTES) {
      const baseTime = getKstRadarBaseTime(delayMinutes);
      for (const qpf of RADAR_QPF_MODES) {
        const radarUrl = buildKmaRadarForecastUrl(authKey, baseTime, offsetMinutes, qpf);
        const response = await fetch(radarUrl, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        if (response.status === 401 || response.status === 403) {
          lastDetail = "KMA APIHub 인증 또는 활용신청 상태를 확인해 주세요.";
          continue;
        }

        if (!response.ok) {
          lastDetail = "KMA APIHub 레이더 응답을 불러오지 못했습니다.";
          continue;
        }

        const data = await response.json().catch(() => null) as KmaRadarForecastResponse | null;
        if (!data || data.meta?.errCd !== "000") {
          lastDetail = "KMA APIHub 레이더 응답 상태를 확인하지 못했습니다.";
          continue;
        }

        const frame = normalizeKmaRadarFrame(data.data?.result ?? data.result, offsetMinutes);
        if (frame.nodata || !frame.imageUrl) {
          lastDetail = "KMA APIHub 레이더 예측 데이터가 아직 제공되지 않았습니다.";
          await writeRadarCache({
            baseTime,
            qpf,
            frame: {
              ...frame,
              dateTime: frame.dateTime ?? baseTime,
              ef: frame.ef ?? String(offsetMinutes),
            },
            errorMessage: lastDetail,
          });
          continue;
        }

        const cachedFramePayload = {
          ...frame,
          dateTime: frame.dateTime ?? baseTime,
          ef: frame.ef ?? String(offsetMinutes),
        };
        await writeRadarCache({
          baseTime,
          qpf,
          frame: cachedFramePayload,
        });
        const payload = {
          status: "available" as const,
          message: null,
          generatedAt: new Date().toISOString(),
          frame: cachedFramePayload,
        };
        return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
      }
    }

    await writeRadarCache({
      baseTime: getKstRadarBaseTime(RADAR_BASE_DELAY_MINUTES[0]),
      qpf: RADAR_QPF_MODES[0],
      frame: createEmptyRadarFrame(offsetMinutes),
      errorMessage: lastDetail,
    });
    const payload = createUnavailableResponse(offsetMinutes, lastDetail);
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  } catch {
    const payload = createUnavailableResponse(offsetMinutes, "KMA APIHub 레이더 예측 정보를 처리하지 못했습니다.");
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  }
}
