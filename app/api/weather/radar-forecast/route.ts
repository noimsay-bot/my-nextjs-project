import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { requireWeatherAdmin } from "@/lib/weather/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RADAR_FRAME_OFFSETS = [0, 10, 20, 30, 40, 50, 60] as const;
const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
};
const RADAR_UNAVAILABLE_MESSAGE = "기상청 API 활용신청 승인 후 레이더 영상이 표시됩니다.";

type RadarFrameOffset = (typeof RADAR_FRAME_OFFSETS)[number];

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
    frame: {
      offsetMinutes,
      imageUrl: null,
    },
  };
}

function getKstRadarBaseTime(date = new Date()) {
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  kstDate.setUTCMinutes(Math.floor(kstDate.getUTCMinutes() / 10) * 10, 0, 0);
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getUTCDate()).padStart(2, "0");
  const hour = String(kstDate.getUTCHours()).padStart(2, "0");
  const minute = String(kstDate.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

function buildKmaRadarForecastUrl(authKey: string, baseTime: string, offsetMinutes: RadarFrameOffset) {
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
    qpf: "M",
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

function normalizeBaseTime(value: string | null) {
  return typeof value === "string" && /^\d{12}$/.test(value) ? value : getKstRadarBaseTime();
}

function buildRadarImageUrl(request: Request, offsetMinutes: RadarFrameOffset, baseTime: string) {
  const url = new URL(request.url);
  url.searchParams.set("offset", String(offsetMinutes));
  url.searchParams.set("format", "image");
  url.searchParams.set("baseTime", baseTime);
  return `${url.pathname}?${url.searchParams.toString()}`;
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

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = await requireWeatherAdmin();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const offsetMinutes = normalizeRadarOffset(url.searchParams.get("offset"));
  const authKey = process.env.KMA_APIHUB_AUTH_KEY?.trim();

  if (!authKey) {
    const payload = createUnavailableResponse(offsetMinutes, "KMA_APIHUB_AUTH_KEY 서버 환경변수가 설정되지 않았습니다.");
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  }

  const baseTime = normalizeBaseTime(url.searchParams.get("baseTime"));
  const radarUrl = buildKmaRadarForecastUrl(authKey, baseTime, offsetMinutes);
  const isImageRequest = url.searchParams.get("format") === "image";

  if (!isImageRequest) {
    const payload = {
      status: "available" as const,
      message: null,
      generatedAt: new Date().toISOString(),
      baseTime,
      frame: {
        offsetMinutes,
        imageUrl: buildRadarImageUrl(request, offsetMinutes, baseTime),
      },
    };
    return jsonWithUsageDebug(request, startedAt, payload, { headers: CACHE_HEADERS });
  }

  try {
    const response = await fetch(radarUrl, {
      cache: "no-store",
      headers: {
        Accept: "image/*",
      },
    });

    if (response.status === 401 || response.status === 403) {
      logRouteUsageDebug(request, { status: response.status, startedAt, responseBytes: 0 });
      return new Response(null, { status: response.status, headers: CACHE_HEADERS });
    }

    if (!response.ok) {
      logRouteUsageDebug(request, { status: 502, startedAt, responseBytes: 0 });
      return new Response(null, { status: 502, headers: CACHE_HEADERS });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      logRouteUsageDebug(request, { status: 502, startedAt, responseBytes: 0 });
      return new Response(null, { status: 502, headers: CACHE_HEADERS });
    }

    const imageBytes = Buffer.from(await response.arrayBuffer());
    logRouteUsageDebug(request, { status: 200, startedAt, responseBytes: imageBytes.byteLength });
    return new Response(imageBytes, {
      status: 200,
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": contentType,
      },
    });
  } catch {
    logRouteUsageDebug(request, { status: 502, startedAt, responseBytes: 0 });
    return new Response(null, { status: 502, headers: CACHE_HEADERS });
  }
}
