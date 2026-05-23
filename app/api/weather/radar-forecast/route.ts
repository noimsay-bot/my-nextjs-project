import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { requireWeatherAdmin } from "@/lib/weather/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RADAR_FRAME_OFFSETS = [0, 10, 20, 30, 40, 50, 60] as const;
const SUPPORTED_FORECAST_EF_MINUTES = [10, 20, 30, 40, 50, 60] as const;
const RADAR_BASE_DELAY_MINUTES = [10, 20, 30, 40] as const;
const RADAR_QPF_MODES = ["M", "B"] as const satisfies readonly RadarQpfMode[];
const RADAR_CACHE_PROVIDER = "kma_apihub_radar_1h";
const RADAR_CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESHING_CACHE_MESSAGE = "refreshing";
const KMA_APIHUB_ORIGIN = "https://apihub.kma.go.kr";
const HSR_ENDPOINT = "nph-rdr_cmp1_imgp";
const FORECAST_ENDPOINT = "nph-qpf_ana_imgp";
const HSR_PERMISSION_MESSAGE = "현재 실황 프레임을 위해 APIHub 4.1 레이더-HSR API 활용신청이 필요합니다.";
const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
};

type RadarFrameOffset = (typeof RADAR_FRAME_OFFSETS)[number];
type RadarForecastOffset = (typeof SUPPORTED_FORECAST_EF_MINUTES)[number];
type RadarQpfMode = "M" | "B";
type RadarFrameKind = "observed" | "forecast";
type RadarSourceEndpoint = typeof HSR_ENDPOINT | typeof FORECAST_ENDPOINT;
type RadarFrameStatus = "available" | "nodata" | "error";
type RadarResponseStatus =
  | "available"
  | "stale_available"
  | "refreshing"
  | "hsr_permission_required"
  | "unavailable";

type RadarForecastFrame = {
  offsetMinutes: RadarFrameOffset;
  frameKind: RadarFrameKind;
  sourceEndpoint: RadarSourceEndpoint;
  status: RadarFrameStatus;
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
  errorMessage: string | null;
};

type RadarFrameSetPayload = {
  id: string | null;
  provider: string;
  baseTimeKst: string;
  qpf: RadarQpfMode;
  fetchedAt: string;
  expiresAt: string;
  isComplete: boolean;
  isActive: boolean;
  missingFrames: RadarFrameOffset[];
  frames: RadarForecastFrame[];
};

type RadarAttemptPayload = {
  baseTimeKst: string | null;
  qpf: RadarQpfMode | null;
  missingFrames: RadarFrameOffset[];
  availableFrames: number;
  errorMessage: string | null;
  debug: Record<string, unknown>;
};

type RadarRoutePayload = {
  status: RadarResponseStatus;
  message: string;
  generatedAt: string;
  set: RadarFrameSetPayload | null;
  latestAttempt: RadarAttemptPayload | null;
};

type KmaRadarResponse = {
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

type RadarFrameSetRow = {
  id: string;
  provider: string;
  base_time_kst: string;
  qpf: string;
  expected_frames: number;
  available_frames: number;
  missing_frames: number[] | null;
  is_complete: boolean;
  is_active: boolean;
  fetched_at: string;
  expires_at: string;
  error_message: string | null;
  debug: unknown;
};

type RadarCacheRow = {
  id?: string;
  provider: string;
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
  frame_kind?: string | null;
  frame_set_id?: string | null;
  source_endpoint?: string | null;
  status?: string | null;
  debug?: unknown;
};

type FetchRadarFrameInput = {
  authKey: string;
  baseTime: string;
  qpf: RadarQpfMode;
  offsetMinutes: RadarFrameOffset;
  requestedEf?: string;
  frameKind: RadarFrameKind;
  sourceEndpoint: RadarSourceEndpoint;
};

type FetchRadarFrameResult = {
  frame: RadarForecastFrame;
  requestStatus: "available" | "nodata" | "error" | "permission";
  debug: Record<string, unknown>;
  errorMessage: string | null;
};

type WriteRadarFrameSetResult = {
  row: RadarFrameSetRow | null;
  canWriteFrames: boolean;
};

type SupabaseQueryResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type SupabaseQueryListResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

type SupabaseSelectBuilder<T> = PromiseLike<SupabaseQueryListResult<T>> & {
  eq: (column: string, value: unknown) => SupabaseSelectBuilder<T>;
  gt: (column: string, value: unknown) => SupabaseSelectBuilder<T>;
  order: (column: string, options: { ascending: boolean }) => SupabaseSelectBuilder<T>;
  limit: (count: number) => SupabaseSelectBuilder<T>;
  maybeSingle: () => Promise<SupabaseQueryResult<T>>;
};

type SupabaseWriteBuilder<T> = {
  select: (columns: string) => {
    maybeSingle: () => Promise<SupabaseQueryResult<T>>;
  };
};

type SupabaseUpdateBuilder = PromiseLike<unknown> & {
  eq: (column: string, value: unknown) => SupabaseUpdateBuilder;
};

type SupabaseUntypedTable = {
  select: <T = unknown>(columns: string) => SupabaseSelectBuilder<T>;
  upsert: <T = unknown>(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict: string },
  ) => SupabaseWriteBuilder<T>;
  update: (values: Record<string, unknown>) => SupabaseUpdateBuilder;
};

function weatherCacheTable(table: "weather_radar_frame_sets" | "weather_radar_frames") {
  return (createAdminClient() as unknown as {
    from: (tableName: string) => SupabaseUntypedTable;
  }).from(table);
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

function normalizeRadarOffset(value: number | string | null | undefined): RadarFrameOffset {
  const numeric = Number(value);
  return RADAR_FRAME_OFFSETS.includes(numeric as RadarFrameOffset)
    ? (numeric as RadarFrameOffset)
    : 0;
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

function getKstRadarBaseTimeCandidates(date = new Date()) {
  return RADAR_BASE_DELAY_MINUTES.map((delayMinutes) => getKstRadarBaseTime(delayMinutes, date));
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

function createEmptyRadarFrame(
  offsetMinutes: RadarFrameOffset,
  frameKind: RadarFrameKind,
  sourceEndpoint: RadarSourceEndpoint,
  status: RadarFrameStatus,
  errorMessage: string | null,
): RadarForecastFrame {
  return {
    offsetMinutes,
    frameKind,
    sourceEndpoint,
    status,
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
    errorMessage,
  };
}

function normalizeKmaRadarFrame(
  result: unknown,
  offsetMinutes: RadarFrameOffset,
  frameKind: RadarFrameKind,
  sourceEndpoint: RadarSourceEndpoint,
): RadarForecastFrame {
  const record = getRecord(result);
  if (!record) {
    return createEmptyRadarFrame(offsetMinutes, frameKind, sourceEndpoint, "nodata", null);
  }

  const nodata = readBoolean(record, ["nodata", "noData", "no_data"]);
  const imageUrl = toKmaAssetUrl(readString(record, ["url", "imageUrl", "imageURL"]));
  return {
    offsetMinutes,
    frameKind,
    sourceEndpoint,
    status: nodata || !imageUrl ? "nodata" : "available",
    imageUrl,
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
    nodata: nodata || !imageUrl,
    errorMessage: null,
  };
}

function buildCommonRadarParams(authKey: string, baseTime: string, qpf: RadarQpfMode) {
  return {
    PROJ: "LCC",
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
    overlay: "spr",
    color: "C4",
    effect: "N",
    height: "420",
    qpf,
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
  };
}

function buildKmaRadarObservedUrl(authKey: string, baseTime: string, qpf: RadarQpfMode) {
  const params = new URLSearchParams({
    ...buildCommonRadarParams(authKey, baseTime, qpf),
    cmp: "HSP",
    obs: "ECHD",
    qcd: "HSLP",
    dataDtlCd: "rdr_hsr_0",
    data1: "h01",
    data2: "hsr",
    data3: "0",
    ef: "",
    legend: "1",
  });
  return `${KMA_APIHUB_ORIGIN}/api/typ03/cgi/rdr/${HSR_ENDPOINT}?${params.toString()}`;
}

function buildKmaRadarForecastUrl(authKey: string, baseTime: string, requestedEf: string, qpf: RadarQpfMode) {
  const params = new URLSearchParams({
    ...buildCommonRadarParams(authKey, baseTime, qpf),
    cmp: "HSR",
    obs: "qpf",
    qcd: "EXT",
    dataDtlCd: "rdr_rdr_qpf_ana1_0",
    data1: "r01",
    data2: "rdr_qpf_ana1",
    data3: "0",
    ef: requestedEf,
    eva: "1",
    option: "1",
  });
  return `${KMA_APIHUB_ORIGIN}/api/typ03/cgi/rdr/${FORECAST_ENDPOINT}?${params.toString()}`;
}

function getForecastEfCandidates(offsetMinutes: RadarForecastOffset) {
  if (offsetMinutes === 40) {
    return ["40", "4"] as const;
  }
  return [String(offsetMinutes)] as const;
}

function isCompleteFrameSet(frames: RadarForecastFrame[]) {
  return RADAR_FRAME_OFFSETS.every((offset) =>
    frames.some((frame) => frame.offsetMinutes === offset && frame.status === "available" && frame.imageUrl && !frame.nodata),
  );
}

function getMissingFrames(frames: RadarForecastFrame[]) {
  return RADAR_FRAME_OFFSETS.filter((offset) => {
    const frame = frames.find((candidate) => candidate.offsetMinutes === offset);
    return !frame?.imageUrl || frame.nodata || frame.status !== "available";
  });
}

function getAvailableFrameCount(frames: RadarForecastFrame[]) {
  return RADAR_FRAME_OFFSETS.length - getMissingFrames(frames).length;
}

function radarFrameFromCacheRow(row: RadarCacheRow): RadarForecastFrame {
  const coverage = readCoverageRecord(row.coverage);
  const offsetMinutes = normalizeRadarOffset(row.ef_minutes);
  const frameKind: RadarFrameKind = row.frame_kind === "observed" ? "observed" : "forecast";
  const sourceEndpoint: RadarSourceEndpoint = row.source_endpoint === HSR_ENDPOINT ? HSR_ENDPOINT : FORECAST_ENDPOINT;
  const imageUrl = row.image_url;
  const nodata = row.nodata || !imageUrl;
  return {
    offsetMinutes,
    frameKind,
    sourceEndpoint,
    status: row.status === "available" && imageUrl && !nodata ? "available" : row.status === "error" ? "error" : "nodata",
    imageUrl,
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
    nodata,
    errorMessage: row.error_message,
  };
}

function frameSetPayloadFromRows(setRow: RadarFrameSetRow, frames: RadarForecastFrame[]): RadarFrameSetPayload {
  return {
    id: setRow.id,
    provider: setRow.provider,
    baseTimeKst: setRow.base_time_kst,
    qpf: setRow.qpf === "B" ? "B" : "M",
    fetchedAt: setRow.fetched_at,
    expiresAt: setRow.expires_at,
    isComplete: setRow.is_complete,
    isActive: setRow.is_active,
    missingFrames: (setRow.missing_frames ?? []).map((value) => normalizeRadarOffset(value)),
    frames: frames.sort((left, right) => left.offsetMinutes - right.offsetMinutes),
  };
}

function createAdHocFrameSetPayload(input: {
  baseTimeKst: string;
  qpf: RadarQpfMode;
  frames: RadarForecastFrame[];
  isActive: boolean;
}) {
  const now = new Date();
  return {
    id: null,
    provider: RADAR_CACHE_PROVIDER,
    baseTimeKst: input.baseTimeKst,
    qpf: input.qpf,
    fetchedAt: now.toISOString(),
    expiresAt: getCacheExpiresAt(now),
    isComplete: isCompleteFrameSet(input.frames),
    isActive: input.isActive,
    missingFrames: getMissingFrames(input.frames),
    frames: input.frames.sort((left, right) => left.offsetMinutes - right.offsetMinutes),
  } satisfies RadarFrameSetPayload;
}

async function readFramesBySetId(frameSetId: string) {
  if (!hasSupabaseAdminEnv()) return [];
  const { data, error } = await weatherCacheTable("weather_radar_frames")
    .select<RadarCacheRow>(
      "provider, base_time_kst, ef_minutes, qpf, image_url, legend_url, date_time_text, zoom_lvl, coverage, nodata, fetched_at, expires_at, error_message, frame_kind, frame_set_id, source_endpoint, status, debug",
    )
    .eq("frame_set_id", frameSetId)
    .eq("provider", RADAR_CACHE_PROVIDER)
    .order("ef_minutes", { ascending: true });

  if (error || !data) return [];
  return data.map(radarFrameFromCacheRow);
}

async function readActiveCompleteRadarSet(freshOnly: boolean) {
  if (!hasSupabaseAdminEnv()) return null;
  try {
    let query = weatherCacheTable("weather_radar_frame_sets")
      .select<RadarFrameSetRow>(
        "id, provider, base_time_kst, qpf, expected_frames, available_frames, missing_frames, is_complete, is_active, fetched_at, expires_at, error_message, debug",
      )
      .eq("provider", RADAR_CACHE_PROVIDER)
      .eq("is_active", true)
      .eq("is_complete", true)
      .order("fetched_at", { ascending: false })
      .limit(1);

    if (freshOnly) {
      query = query.gt("expires_at", new Date().toISOString());
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    const frames = await readFramesBySetId(data.id);
    if (!isCompleteFrameSet(frames)) return null;
    return frameSetPayloadFromRows(data, frames);
  } catch {
    return null;
  }
}

async function readFreshRefreshingRadarSet() {
  if (!hasSupabaseAdminEnv()) return null;
  try {
    const { data, error } = await weatherCacheTable("weather_radar_frame_sets")
      .select<RadarFrameSetRow>(
        "id, provider, base_time_kst, qpf, expected_frames, available_frames, missing_frames, is_complete, is_active, fetched_at, expires_at, error_message, debug",
      )
      .eq("provider", RADAR_CACHE_PROVIDER)
      .eq("error_message", REFRESHING_CACHE_MESSAGE)
      .gt("expires_at", new Date().toISOString())
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

async function readRadarFrameSetByCacheKey(baseTimeKst: string, qpf: RadarQpfMode) {
  if (!hasSupabaseAdminEnv()) return null;
  try {
    const { data, error } = await weatherCacheTable("weather_radar_frame_sets")
      .select<RadarFrameSetRow>(
        "id, provider, base_time_kst, qpf, expected_frames, available_frames, missing_frames, is_complete, is_active, fetched_at, expires_at, error_message, debug",
      )
      .eq("provider", RADAR_CACHE_PROVIDER)
      .eq("base_time_kst", baseTimeKst)
      .eq("qpf", qpf)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeRadarFrameSet(input: {
  baseTimeKst: string;
  qpf: RadarQpfMode;
  frames: RadarForecastFrame[];
  isComplete: boolean;
  isActive: boolean;
  errorMessage: string | null;
  debug: Record<string, unknown>;
}): Promise<WriteRadarFrameSetResult> {
  if (!hasSupabaseAdminEnv()) return { row: null, canWriteFrames: false };
  const now = new Date().toISOString();
  const missingFrames = getMissingFrames(input.frames);
  const availableFrames = getAvailableFrameCount(input.frames);

  try {
    if (!input.isComplete) {
      const existingSet = await readRadarFrameSetByCacheKey(input.baseTimeKst, input.qpf);
      if (existingSet?.is_complete) {
        return { row: existingSet, canWriteFrames: false };
      }
    }

    const { data, error } = await weatherCacheTable("weather_radar_frame_sets")
      .upsert<RadarFrameSetRow>(
        {
          provider: RADAR_CACHE_PROVIDER,
          base_time_kst: input.baseTimeKst,
          qpf: input.qpf,
          expected_frames: RADAR_FRAME_OFFSETS.length,
          available_frames: availableFrames,
          missing_frames: missingFrames,
          is_complete: input.isComplete,
          is_active: input.isActive,
          fetched_at: now,
          expires_at: getCacheExpiresAt(),
          error_message: input.errorMessage,
          debug: input.debug,
        },
        { onConflict: "provider,base_time_kst,qpf" },
      )
      .select("id, provider, base_time_kst, qpf, expected_frames, available_frames, missing_frames, is_complete, is_active, fetched_at, expires_at, error_message, debug")
      .maybeSingle();

    if (error || !data) return { row: null, canWriteFrames: false };
    return { row: data, canWriteFrames: true };
  } catch {
    return { row: null, canWriteFrames: false };
  }
}

async function writeRadarFrames(input: {
  baseTimeKst: string;
  qpf: RadarQpfMode;
  frameSetId: string | null;
  frames: RadarForecastFrame[];
}) {
  if (!hasSupabaseAdminEnv()) return;
  const now = new Date().toISOString();
  try {
    const rows: Record<string, unknown>[] = input.frames.map((frame) => ({
      provider: RADAR_CACHE_PROVIDER,
      base_time_kst: input.baseTimeKst,
      ef_minutes: frame.offsetMinutes,
      qpf: input.qpf,
      image_url: frame.imageUrl,
      legend_url: frame.legendUrl,
      date_time_text: frame.dateTime,
      zoom_lvl: frame.zoomLvl === null ? null : String(frame.zoomLvl),
      coverage: radarCoveragePayload(frame),
      nodata: frame.nodata,
      fetched_at: now,
      expires_at: getCacheExpiresAt(),
      error_message: frame.errorMessage,
      frame_kind: frame.frameKind,
      frame_set_id: input.frameSetId,
      source_endpoint: frame.sourceEndpoint,
      status: frame.status,
      debug: {
        imageUrlPresent: Boolean(frame.imageUrl),
        dateTime: frame.dateTime,
        ef: frame.ef,
      },
    }));

    await weatherCacheTable("weather_radar_frames")
      .upsert(
        rows,
        { onConflict: "provider,base_time_kst,ef_minutes,qpf" },
      );
  } catch {
    // Cache write failure must not block the API response.
  }
}

async function activateRadarFrameSet(frameSetId: string) {
  if (!hasSupabaseAdminEnv()) return;
  try {
    await weatherCacheTable("weather_radar_frame_sets")
      .update({ is_active: false })
      .eq("provider", RADAR_CACHE_PROVIDER)
      .eq("is_active", true);

    await weatherCacheTable("weather_radar_frame_sets")
      .update({ is_active: true })
      .eq("id", frameSetId);
  } catch {
    // Active flag failure must not block returning a complete set.
  }
}

function radarAttemptPayload(input: {
  baseTimeKst: string | null;
  qpf: RadarQpfMode | null;
  frames: RadarForecastFrame[];
  errorMessage: string | null;
  debug: Record<string, unknown>;
}): RadarAttemptPayload {
  return {
    baseTimeKst: input.baseTimeKst,
    qpf: input.qpf,
    missingFrames: getMissingFrames(input.frames),
    availableFrames: getAvailableFrameCount(input.frames),
    errorMessage: input.errorMessage,
    debug: input.debug,
  };
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKmaRadarFrame(input: FetchRadarFrameInput): Promise<FetchRadarFrameResult> {
  const requestedEf = input.sourceEndpoint === FORECAST_ENDPOINT
    ? input.requestedEf ?? String(input.offsetMinutes)
    : "";
  const url = input.sourceEndpoint === HSR_ENDPOINT
    ? buildKmaRadarObservedUrl(input.authKey, input.baseTime, input.qpf)
    : buildKmaRadarForecastUrl(input.authKey, input.baseTime, requestedEf, input.qpf);
  const debugBase = {
    baseTimeKst: input.baseTime,
    qpf: input.qpf,
    offsetMinutes: input.offsetMinutes,
    requestedEf,
    frameKind: input.frameKind,
    sourceEndpoint: input.sourceEndpoint,
  };

  try {
    const response = await fetchWithTimeout(url);
    if (response.status === 401 || response.status === 403) {
      const errorMessage = input.sourceEndpoint === HSR_ENDPOINT
        ? HSR_PERMISSION_MESSAGE
        : "KMA APIHub 인증 또는 활용신청 상태를 확인해 주세요.";
      return {
        frame: createEmptyRadarFrame(input.offsetMinutes, input.frameKind, input.sourceEndpoint, "error", errorMessage),
        requestStatus: "permission",
        errorMessage,
        debug: {
          ...debugBase,
          httpStatus: response.status,
          imageUrlPresent: false,
          dateTime: null,
        },
      };
    }

    if (!response.ok) {
      const errorMessage = "KMA APIHub 레이더 응답을 불러오지 못했습니다.";
      return {
        frame: createEmptyRadarFrame(input.offsetMinutes, input.frameKind, input.sourceEndpoint, "error", errorMessage),
        requestStatus: "error",
        errorMessage,
        debug: {
          ...debugBase,
          httpStatus: response.status,
          imageUrlPresent: false,
          dateTime: null,
        },
      };
    }

    const data = await response.json().catch(() => null) as KmaRadarResponse | null;
    const errCd = data?.meta?.errCd;
    if (!data || errCd !== "000") {
      const errMsg = readString(getRecord(data?.meta), ["errMsg", "msg"]);
      const errorMessage = errMsg || "KMA APIHub 레이더 응답 상태를 확인하지 못했습니다.";
      return {
        frame: createEmptyRadarFrame(input.offsetMinutes, input.frameKind, input.sourceEndpoint, "error", errorMessage),
        requestStatus: "error",
        errorMessage,
        debug: {
          ...debugBase,
          httpStatus: response.status,
          errCd: errCd ?? null,
          errMsg: errMsg ?? null,
          imageUrlPresent: false,
          dateTime: null,
        },
      };
    }

    const frame = normalizeKmaRadarFrame(data.data?.result ?? data.result, input.offsetMinutes, input.frameKind, input.sourceEndpoint);
    const errorMessage = frame.status === "available"
      ? null
      : "KMA APIHub 레이더 데이터가 아직 제공되지 않았습니다.";
    const normalizedFrame = {
      ...frame,
      dateTime: frame.dateTime ?? input.baseTime,
      ef: frame.ef ?? requestedEf,
      errorMessage,
    };
    return {
      frame: normalizedFrame,
      requestStatus: normalizedFrame.status === "available" ? "available" : "nodata",
      errorMessage,
      debug: {
        ...debugBase,
        httpStatus: response.status,
        errCd,
        imageUrlPresent: Boolean(normalizedFrame.imageUrl),
        dateTime: normalizedFrame.dateTime,
        responseEf: normalizedFrame.ef,
        nodata: normalizedFrame.nodata,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error && error.name === "AbortError"
      ? "KMA APIHub 레이더 응답 시간이 초과됐습니다."
      : "KMA APIHub 레이더 예측 정보를 처리하지 못했습니다.";
    return {
      frame: createEmptyRadarFrame(input.offsetMinutes, input.frameKind, input.sourceEndpoint, "error", errorMessage),
      requestStatus: "error",
      errorMessage,
      debug: {
        ...debugBase,
        imageUrlPresent: false,
        dateTime: null,
        errorName: error instanceof Error ? error.name : "unknown",
      },
    };
  }
}

async function fetchKmaRadarForecastFrame(input: Omit<FetchRadarFrameInput, "requestedEf" | "frameKind" | "sourceEndpoint">) {
  const candidateResults: Record<string, unknown>[] = [];
  let lastResult: FetchRadarFrameResult | null = null;

  for (const requestedEf of getForecastEfCandidates(input.offsetMinutes as RadarForecastOffset)) {
    const result = await fetchKmaRadarFrame({
      ...input,
      requestedEf,
      frameKind: "forecast",
      sourceEndpoint: FORECAST_ENDPOINT,
    });
    candidateResults.push(result.debug);

    if (result.requestStatus === "available") {
      return {
        ...result,
        debug: {
          ...result.debug,
          fallbackEfUsed: requestedEf !== String(input.offsetMinutes),
          candidateResults,
        },
      };
    }

    lastResult = result;
  }

  if (!lastResult) {
    return fetchKmaRadarFrame({
      ...input,
      requestedEf: String(input.offsetMinutes),
      frameKind: "forecast",
      sourceEndpoint: FORECAST_ENDPOINT,
    });
  }

  return {
    ...lastResult,
    debug: {
      ...lastResult.debug,
      fallbackEfUsed: false,
      candidateResults,
    },
  };
}

async function writeRefreshingPlaceholder(baseTimeKst: string, qpf: RadarQpfMode) {
  await writeRadarFrameSet({
    baseTimeKst,
    qpf,
    frames: [],
    isComplete: false,
    isActive: false,
    errorMessage: REFRESHING_CACHE_MESSAGE,
    debug: {
      note: "refresh placeholder; future advisory lock candidate",
    },
  });
}

async function buildRadarFrameSet(authKey: string) {
  let lastAttempt: RadarAttemptPayload | null = null;

  for (const baseTimeKst of getKstRadarBaseTimeCandidates()) {
    for (const qpf of RADAR_QPF_MODES) {
      await writeRefreshingPlaceholder(baseTimeKst, qpf);

      const observedResult = await fetchKmaRadarFrame({
        authKey,
        baseTime: baseTimeKst,
        qpf,
        offsetMinutes: 0,
        frameKind: "observed",
        sourceEndpoint: HSR_ENDPOINT,
      });
      if (observedResult.requestStatus === "permission") {
        const frames = [observedResult.frame];
        const debug = {
          hsrPermissionRequired: true,
          frames: [observedResult.debug],
        };
        const writeResult = await writeRadarFrameSet({
          baseTimeKst,
          qpf,
          frames,
          isComplete: false,
          isActive: false,
          errorMessage: HSR_PERMISSION_MESSAGE,
          debug,
        });
        if (writeResult.canWriteFrames) {
          await writeRadarFrames({
            baseTimeKst,
            qpf,
            frameSetId: writeResult.row?.id ?? null,
            frames,
          });
        }
        return {
          status: "hsr_permission_required" as const,
          set: null,
          attempt: radarAttemptPayload({
            baseTimeKst,
            qpf,
            frames,
            errorMessage: HSR_PERMISSION_MESSAGE,
            debug,
          }),
        };
      }

      const forecastResults = await Promise.all(
        SUPPORTED_FORECAST_EF_MINUTES.map((offsetMinutes) =>
          fetchKmaRadarForecastFrame({
            authKey,
            baseTime: baseTimeKst,
            qpf,
            offsetMinutes,
          }),
        ),
      );
      const frames = [observedResult.frame, ...forecastResults.map((result) => result.frame)];
      const isComplete = isCompleteFrameSet(frames);
      const errorMessage = isComplete
        ? null
        : [...forecastResults, observedResult].find((result) => result.errorMessage)?.errorMessage
          ?? "KMA APIHub가 일부 레이더 시간대를 반환하지 않았습니다.";
      const debug = {
        frames: [observedResult.debug, ...forecastResults.map((result) => result.debug)],
        supportedForecastEfMinutes: SUPPORTED_FORECAST_EF_MINUTES,
        forecastEfCandidateMap: Object.fromEntries(
          SUPPORTED_FORECAST_EF_MINUTES.map((offset) => [String(offset), getForecastEfCandidates(offset)]),
        ),
      };
      const writeResult = await writeRadarFrameSet({
        baseTimeKst,
        qpf,
        frames,
        isComplete,
        isActive: false,
        errorMessage,
        debug,
      });
      if (writeResult.canWriteFrames) {
        await writeRadarFrames({
          baseTimeKst,
          qpf,
          frameSetId: writeResult.row?.id ?? null,
          frames,
        });
      }

      lastAttempt = radarAttemptPayload({
        baseTimeKst,
        qpf,
        frames,
        errorMessage,
        debug,
      });

      if (isComplete) {
        if (writeResult.row?.id) {
          await activateRadarFrameSet(writeResult.row.id);
        }
        const activeSet = writeResult.row
          ? frameSetPayloadFromRows({ ...writeResult.row, is_active: true }, frames)
          : createAdHocFrameSetPayload({ baseTimeKst, qpf, frames, isActive: true });
        return {
          status: "available" as const,
          set: activeSet,
          attempt: lastAttempt,
        };
      }
    }
  }

  return {
    status: "unavailable" as const,
    set: null,
    attempt: lastAttempt,
  };
}

function payload(input: {
  status: RadarResponseStatus;
  message: string;
  set: RadarFrameSetPayload | null;
  latestAttempt?: RadarAttemptPayload | null;
}): RadarRoutePayload {
  return {
    status: input.status,
    message: input.message,
    generatedAt: new Date().toISOString(),
    set: input.set,
    latestAttempt: input.latestAttempt ?? null,
  };
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireWeatherAdmin();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const shouldRefresh = url.searchParams.get("refresh") === "1";

  const freshActiveSet = await readActiveCompleteRadarSet(true);
  if (freshActiveSet) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      payload({
        status: "available",
        message: "신선한 레이더 완성 세트를 반환했습니다.",
        set: freshActiveSet,
      }),
      { headers: CACHE_HEADERS },
    );
  }

  const activeFallbackSet = await readActiveCompleteRadarSet(false);
  const refreshingSet = await readFreshRefreshingRadarSet();
  if (refreshingSet) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      payload({
        status: "refreshing",
        message: activeFallbackSet
          ? "최신 레이더 세트를 갱신하는 중입니다. 이전 완성 자료를 표시합니다."
          : "레이더 세트를 갱신하는 중입니다.",
        set: activeFallbackSet,
      }),
      { headers: CACHE_HEADERS },
    );
  }

  if (!shouldRefresh) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      payload({
        status: activeFallbackSet ? "stale_available" : "unavailable",
        message: activeFallbackSet
          ? "캐시된 active 레이더 완성 세트를 반환했습니다. 외부 API 갱신은 새로고침 요청에서만 수행됩니다."
          : "active 레이더 완성 세트가 없습니다. 자료 새로고침을 눌러 주세요.",
        set: activeFallbackSet,
      }),
      { headers: CACHE_HEADERS },
    );
  }

  const authKey = process.env.KMA_APIHUB_AUTH_KEY?.trim();
  if (!authKey) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      payload({
        status: activeFallbackSet ? "stale_available" : "unavailable",
        message: activeFallbackSet
          ? "기상청 레이더 API 서버 설정이 없어 이전 완성 자료를 표시합니다."
          : "기상청 레이더 API 서버 설정이 필요합니다.",
        set: activeFallbackSet,
      }),
      { headers: CACHE_HEADERS },
    );
  }

  const result = await buildRadarFrameSet(authKey);
  if (result.status === "available" && result.set) {
    return jsonWithUsageDebug(
      request,
      startedAt,
      payload({
        status: "available",
        message: "레이더 현재 실황 1개와 1H예측 6개 프레임을 새 active set으로 저장했습니다.",
        set: result.set,
        latestAttempt: result.attempt,
      }),
      { headers: CACHE_HEADERS },
    );
  }

  if (result.status === "hsr_permission_required") {
    return jsonWithUsageDebug(
      request,
      startedAt,
      payload({
        status: "hsr_permission_required",
        message: activeFallbackSet
          ? `${HSR_PERMISSION_MESSAGE} 이전 완성 자료를 표시합니다.`
          : HSR_PERMISSION_MESSAGE,
        set: activeFallbackSet,
        latestAttempt: result.attempt,
      }),
      { headers: CACHE_HEADERS },
    );
  }

  return jsonWithUsageDebug(
    request,
    startedAt,
    payload({
      status: activeFallbackSet ? "stale_available" : "unavailable",
      message: activeFallbackSet
        ? "최신 레이더 세트가 아직 완성되지 않아 이전 완성 자료를 표시합니다."
        : "현재 사용할 수 있는 완성 레이더 세트가 없습니다.",
      set: activeFallbackSet,
      latestAttempt: result.attempt,
    }),
    { headers: CACHE_HEADERS },
  );
}
