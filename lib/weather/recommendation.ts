import {
  SANGAM_BASE,
  WEATHER_DISPATCH_CANDIDATES,
  type WeatherDispatchCandidate,
  type WeatherDispatchPoint,
} from "@/lib/weather/candidates";
import { getHaversineDistanceKm, getTravelBandMinutes, type WeatherTravelBandMinutes } from "@/lib/weather/distance";

export type WeatherDispatchRangeMinutes = 10 | 20 | 30;

export interface RainForecastFrame {
  afterMinutes: number;
  rainMmPerHour: number;
  forecastAt?: string;
  precipitationType?: string | null;
}

export interface RainDispatchRecommendationItem {
  rank: number;
  placeName: string;
  distanceKm: number;
  travelBandMinutes: WeatherTravelBandMinutes;
  peakAfterArrivalMinutes: number;
  peakRainMmPerHour: number;
  expectedIntensityLabel: string;
  sustainedMinutes: number;
  score: number;
  reason: string;
  caution: string;
  dataBasisAt: string;
  estimationNote: string;
}

export interface RainDispatchRecommendationResponse {
  status?: "available" | "unavailable";
  message?: string | null;
  base: WeatherDispatchPoint;
  rangeMinutes: WeatherDispatchRangeMinutes;
  generatedAt: string;
  dataBasisAt?: string | null;
  note?: string | null;
  items: RainDispatchRecommendationItem[];
}

export const WEATHER_FORECAST_OFFSETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const EVALUATION_SETUP_MINUTES = 10;
const EVALUATION_WINDOW_MINUTES = 40;

const MOCK_RAIN_FORECASTS: Record<string, number[]> = {
  "sangam-dmc": [0.2, 0.8, 2.5, 4.8, 6.4, 5.2, 3.1, 1.2, 0.2, 0, 0],
  "worldcup-stadium": [0, 0.4, 1.6, 4.2, 8.5, 10.2, 7.4, 3.2, 0.8, 0, 0],
  "mangwon-hangang": [0, 0, 0.8, 2.2, 5.5, 9, 12, 8, 3.5, 1.2, 0],
  yeouido: [0, 0, 0.1, 0.7, 3.8, 7.6, 10.4, 6.2, 2.1, 0.4, 0],
  gwanghwamun: [2.8, 6.4, 8.6, 6.1, 2.4, 0.8, 0.2, 0, 0, 0, 0],
  "seoul-station": [0.4, 1.4, 3.6, 6.8, 8.2, 5.4, 2.2, 0.6, 0, 0, 0],
  yongsan: [0, 0.2, 1.2, 2.8, 6.2, 9.8, 13.6, 11.4, 5.6, 1.8, 0.2],
  "eunpyeong-bulgwang": [0, 1.2, 4.4, 8.2, 7.2, 3.6, 1.1, 0.2, 0, 0, 0],
  "gimpo-magok": [0, 0, 0, 0.5, 2.4, 5.8, 9.4, 12.2, 9.8, 4.4, 1],
  "goyang-hwajeong": [0, 0, 0.2, 1.4, 4.2, 8.8, 15.8, 19.6, 12.2, 5.4, 1.4],
  "ilsan-kintex": [0, 0, 0, 0.4, 1.8, 4.8, 9.6, 16.4, 21.2, 14.6, 6.2],
  "bucheon-sangdong": [0, 0.1, 0.8, 2.6, 5.8, 11.2, 18.4, 24.8, 18.2, 7.2, 2.2],
  "paju-unjeong": [0, 0, 0, 0, 0.8, 2.4, 5.8, 10.8, 17.2, 26.4, 18.8],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function parseWeatherDispatchRange(value: string | null | undefined): WeatherDispatchRangeMinutes {
  const numeric = Number(value);
  return numeric === 10 || numeric === 20 ? numeric : 30;
}

export function getRainIntensityLabel(mmPerHour: number) {
  if (mmPerHour <= 0) return "비 없음";
  if (mmPerHour < 1) return "약한 비";
  if (mmPerHour < 3) return "촬영 가능";
  if (mmPerHour < 7) return "보통~강한 비";
  if (mmPerHour < 15) return "강한 비, 추천";
  if (mmPerHour < 30) return "매우 강한 비, 안전주의";
  return "위험 강수";
}

function getMockForecast(candidateId: string): RainForecastFrame[] {
  const values = MOCK_RAIN_FORECASTS[candidateId] ?? [];
  return WEATHER_FORECAST_OFFSETS.map((afterMinutes, index) => ({
    afterMinutes,
    rainMmPerHour: Math.max(0, values[index] ?? 0),
  }));
}

function maxRain(frames: RainForecastFrame[]) {
  return frames.reduce<RainForecastFrame | null>((best, frame) => {
    if (!best || frame.rainMmPerHour > best.rainMmPerHour) return frame;
    return best;
  }, null);
}

function formatRain(value: number) {
  return `${Number(value.toFixed(1)).toLocaleString("ko-KR")}mm/h`;
}

export function parseRainAmount(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value ?? "").trim();
  if (!text || text === "강수없음") return 0;
  if (text.includes("1mm 미만")) return 0.5;

  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    if (Number.isFinite(left) && Number.isFinite(right)) return Math.max(left, right);
  }

  const numericMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!numericMatch) return 0;
  const numeric = Number(numericMatch[1]);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function buildReason(input: {
  candidate: WeatherDispatchCandidate;
  peakAfterArrivalMinutes: number;
  peakRainMmPerHour: number;
  sustainedMinutes: number;
  trend: "rising" | "steady" | "passing";
}) {
  const timing =
    input.peakAfterArrivalMinutes <= 20
      ? "세팅 직후 강수 피크가 들어옵니다"
      : `도착 ${input.peakAfterArrivalMinutes}분 뒤 강수 피크가 예상됩니다`;
  const sustain =
    input.sustainedMinutes >= 40
      ? "평가 구간 대부분에서 1mm/h 이상이 유지됩니다"
      : input.sustainedMinutes >= 30
        ? "촬영 가능한 비가 30분 안팎 이어집니다"
        : "촬영 가능한 비가 20분 이상 유지됩니다";
  const trend =
    input.trend === "rising"
      ? "도착 시점보다 도착 후 10~20분 강수가 강해지는 흐름입니다"
      : input.trend === "passing"
        ? "피크가 지나가는 흐름이라 현장 도착 지연에 주의가 필요합니다"
        : "강수 흐름이 비교적 안정적입니다";

  return `${timing}. ${sustain}. ${trend}. ${input.candidate.name}은 촬영 적합도 ${Math.round(
    input.candidate.shootingSuitability * 100,
  )}%로 반영했습니다.`;
}

function buildCaution(candidate: WeatherDispatchCandidate, peakRainMmPerHour: number) {
  const rainCaution =
    peakRainMmPerHour >= 30
      ? "위험 강수 가능성이 있어 안전 확보와 침수 구간 확인이 필요합니다."
      : peakRainMmPerHour >= 15
        ? "강한 비가 예상되어 방수 장비와 이동 동선을 먼저 확인해야 합니다."
        : "실제 출동 전 최신 레이더와 현장 안전 상황을 다시 확인해야 합니다.";

  return candidate.caution ? `${rainCaution} ${candidate.caution}` : rainCaution;
}

function scoreCandidate(
  base: WeatherDispatchPoint,
  candidate: WeatherDispatchCandidate,
  rangeMinutes: WeatherDispatchRangeMinutes,
  frames: RainForecastFrame[],
  dataBasisAt: string,
  estimationNote: string,
) {
  const distanceKm = getHaversineDistanceKm(base, candidate);
  const travelBandMinutes = getTravelBandMinutes(distanceKm);

  if (!travelBandMinutes || travelBandMinutes > rangeMinutes) {
    return null;
  }

  const evaluationStart = travelBandMinutes + EVALUATION_SETUP_MINUTES;
  const evaluationEnd = travelBandMinutes + EVALUATION_WINDOW_MINUTES;
  const evaluationFrames = frames.filter(
    (frame) => frame.afterMinutes >= evaluationStart && frame.afterMinutes <= evaluationEnd,
  );
  const peakFrame = maxRain(evaluationFrames);

  if (!peakFrame || peakFrame.rainMmPerHour <= 0) {
    return null;
  }

  const sustainedMinutes = evaluationFrames.filter((frame) => frame.rainMmPerHour >= 1).length * 10;
  if (sustainedMinutes === 0) {
    return null;
  }

  const arrivalFrame =
    frames.find((frame) => frame.afterMinutes >= travelBandMinutes) ??
    frames[frames.length - 1] ??
    peakFrame;
  const earlyAfterArrivalFrame =
    frames.find((frame) => frame.afterMinutes >= travelBandMinutes + 20) ??
    peakFrame;
  const peakBeforeEvaluation = maxRain(frames.filter((frame) => frame.afterMinutes < evaluationStart));
  const peakAfterArrivalMinutes = peakFrame.afterMinutes - travelBandMinutes;
  const trend =
    earlyAfterArrivalFrame.rainMmPerHour > arrivalFrame.rainMmPerHour + 1
      ? "rising"
      : peakBeforeEvaluation && peakBeforeEvaluation.rainMmPerHour > peakFrame.rainMmPerHour
        ? "passing"
        : "steady";
  const intensityScore = clamp(peakFrame.rainMmPerHour / 15, 0, 1);
  const sustainedScore = clamp(sustainedMinutes / 40, 0, 1);
  const peakTimingScore =
    peakAfterArrivalMinutes >= 10 && peakAfterArrivalMinutes <= 20
      ? 1
      : peakAfterArrivalMinutes <= 30
        ? 0.86
        : 0.72;
  const distanceScore = clamp(1 - distanceKm / 35, 0, 1);
  const passingPenalty =
    peakBeforeEvaluation && peakBeforeEvaluation.rainMmPerHour > peakFrame.rainMmPerHour * 1.15
      ? 0.76
      : peakBeforeEvaluation && peakBeforeEvaluation.rainMmPerHour > peakFrame.rainMmPerHour
        ? 0.9
        : 1;
  const suitabilityFactor = 0.85 + candidate.shootingSuitability * 0.3;
  const risingBonus = trend === "rising" ? 4 : 0;
  const weightedScore =
    (intensityScore * 0.4 + sustainedScore * 0.3 + peakTimingScore * 0.2 + distanceScore * 0.1) *
      100 *
      passingPenalty *
      suitabilityFactor +
    risingBonus;
  const score = clamp(weightedScore, 0, 100);
  const peakRainMmPerHour = Number(peakFrame.rainMmPerHour.toFixed(1));

  return {
    placeName: candidate.name,
    distanceKm: Number(distanceKm.toFixed(1)),
    travelBandMinutes,
    peakAfterArrivalMinutes,
    peakRainMmPerHour,
    expectedIntensityLabel: getRainIntensityLabel(peakRainMmPerHour),
    sustainedMinutes,
    score: Number(score.toFixed(1)),
    reason: buildReason({
      candidate,
      peakAfterArrivalMinutes,
      peakRainMmPerHour,
      sustainedMinutes,
      trend,
    }),
    caution: buildCaution(candidate, peakRainMmPerHour),
    dataBasisAt: peakFrame.forecastAt ?? dataBasisAt,
    estimationNote,
    sortRain: peakRainMmPerHour,
    sortSustained: sustainedMinutes,
  };
}

export function generateRainDispatchRecommendationsFromForecasts(
  rangeMinutes: WeatherDispatchRangeMinutes,
  forecastsByCandidateId: Map<string, RainForecastFrame[]>,
  options: {
    generatedAt?: string;
    dataBasisAt?: string | null;
    note?: string | null;
    status?: "available" | "unavailable";
    message?: string | null;
    base?: WeatherDispatchPoint;
  } = {},
): RainDispatchRecommendationResponse {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const dataBasisAt = options.dataBasisAt ?? generatedAt;
  const estimationNote = options.note ?? "예보 시간 단위 기반 추정";
  const base = options.base ?? SANGAM_BASE;
  const scored = WEATHER_DISPATCH_CANDIDATES.map((candidate) => {
    const frames = forecastsByCandidateId.get(candidate.id) ?? [];
    return scoreCandidate(base, candidate, rangeMinutes, frames, dataBasisAt, estimationNote);
  })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.sortRain !== left.sortRain) return right.sortRain - left.sortRain;
      if (right.sortSustained !== left.sortSustained) return right.sortSustained - left.sortSustained;
      return left.distanceKm - right.distanceKm;
    })
    .slice(0, 3)
    .map(({ sortRain: _sortRain, sortSustained: _sortSustained, ...item }, index) => ({
      rank: index + 1,
      ...item,
    }));

  return {
    status: options.status ?? "available",
    message: options.message ?? null,
    base,
    rangeMinutes,
    generatedAt,
    dataBasisAt,
    note: estimationNote,
    items: scored,
  };
}

export function generateRainDispatchRecommendations(
  rangeMinutes: WeatherDispatchRangeMinutes,
  generatedAt = new Date().toISOString(),
): RainDispatchRecommendationResponse {
  const forecastsByCandidateId = new Map(
    WEATHER_DISPATCH_CANDIDATES.map((candidate) => [candidate.id, getMockForecast(candidate.id)] as const),
  );
  const response = generateRainDispatchRecommendationsFromForecasts(rangeMinutes, forecastsByCandidateId, {
    generatedAt,
    dataBasisAt: generatedAt,
    note: "개발용 mock 강수 흐름",
  });
  return response;
}

export function formatRainAmountForDisplay(value: number) {
  return formatRain(value);
}
