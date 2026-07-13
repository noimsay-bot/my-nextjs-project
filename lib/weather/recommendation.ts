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
  rawRainMmPerHour: number;
  rainAdjustment?: "none" | "trace" | "pty-only";
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
  algorithmVersion?: string;
  base: WeatherDispatchPoint;
  rangeMinutes: WeatherDispatchRangeMinutes;
  generatedAt: string;
  dataBasisAt?: string | null;
  note?: string | null;
  items: RainDispatchRecommendationItem[];
  // Optional bundle of every range computed from the same upstream forecast, so
  // a single request can populate all ranges without refetching data.go.kr.
  allRanges?: Partial<Record<WeatherDispatchRangeMinutes, RainDispatchRecommendationResponse>>;
}

export const WEATHER_FORECAST_OFFSETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
export const WEATHER_DISPATCH_RECOMMENDATION_VERSION = "significant-rain-v3";
// 카메라에 명확히 포착되는 보통 비(기상청 기준) 이상만 출동 후보로 인정한다.
export const SIGNIFICANT_RAIN_PEAK_MM_PER_HOUR = 4;
export const SIGNIFICANT_RAIN_SUSTAINED_MINUTES = 10;
// 지속 강수도 같은 강도 기준으로 계산해 부슬비와 빗방울을 제외한다.
export const SUSTAINED_RAIN_MM_PER_HOUR = 4;
const EVALUATION_SETUP_MINUTES = 5;
const EVALUATION_WINDOW_MINUTES = 40;
const NO_SIGNIFICANT_RAIN_MESSAGE = "현재 유의미한 강수 출동 추천이 없습니다.";

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
    rawRainMmPerHour: Math.max(0, values[index] ?? 0),
    rainAdjustment: "none",
  }));
}

function getDecisionRainMmPerHour(frame: RainForecastFrame) {
  return frame.rawRainMmPerHour;
}

function maxRain(frames: RainForecastFrame[], readRain: (frame: RainForecastFrame) => number = getDecisionRainMmPerHour) {
  return frames.reduce<RainForecastFrame | null>((best, frame) => {
    if (!best || readRain(frame) > readRain(best)) return frame;
    return best;
  }, null);
}

function formatRain(value: number) {
  return `${Number(value.toFixed(1)).toLocaleString("ko-KR")}mm/h`;
}

export function parseRainAmount(value: string | number | null | undefined) {
  return parseRainAmountDetail(value).adjustedRainMmPerHour;
}

export function parseRainAmountDetail(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rainMmPerHour = Math.max(0, value);
    return {
      rawRainMmPerHour: rainMmPerHour,
      adjustedRainMmPerHour: rainMmPerHour,
      adjustment: "none" as const,
    };
  }

  const text = String(value ?? "").trim();
  if (!text || text === "강수없음") {
    return {
      rawRainMmPerHour: 0,
      adjustedRainMmPerHour: 0,
      adjustment: "none" as const,
    };
  }
  if (text.includes("1mm 미만")) {
    return {
      rawRainMmPerHour: 0,
      adjustedRainMmPerHour: 0.5,
      adjustment: "trace" as const,
    };
  }

  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    const rainMmPerHour = Number.isFinite(left) && Number.isFinite(right) ? Math.max(left, right) : 0;
    return {
      rawRainMmPerHour: rainMmPerHour,
      adjustedRainMmPerHour: rainMmPerHour,
      adjustment: "none" as const,
    };
  }

  const numericMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!numericMatch) {
    return {
      rawRainMmPerHour: 0,
      adjustedRainMmPerHour: 0,
      adjustment: "none" as const,
    };
  }
  const numeric = Number(numericMatch[1]);
  const rainMmPerHour = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  return {
    rawRainMmPerHour: rainMmPerHour,
    adjustedRainMmPerHour: rainMmPerHour,
    adjustment: "none" as const,
  };
}

function buildReason(input: {
  candidate: WeatherDispatchCandidate;
  peakAfterArrivalMinutes: number;
  peakRainMmPerHour: number;
  sustainedMinutes: number;
  trend: "rising" | "steady";
}) {
  const timing =
    input.peakAfterArrivalMinutes <= 20
      ? "세팅 직후 강수 피크가 들어옵니다"
      : `도착 ${input.peakAfterArrivalMinutes}분 뒤 강수 피크가 예상됩니다`;
  const sustain =
    input.sustainedMinutes >= 40
      ? `평가 구간 대부분에서 ${SUSTAINED_RAIN_MM_PER_HOUR}mm/h 이상이 유지됩니다`
      : input.sustainedMinutes >= 30
        ? "촬영 가능한 비가 30분 안팎 이어집니다"
        : input.sustainedMinutes >= 20
          ? "촬영 가능한 비가 20분 이상 유지됩니다"
          : `촬영 가능한 비가 최소 ${SIGNIFICANT_RAIN_SUSTAINED_MINUTES}분 유지됩니다`;
  const trend =
    input.trend === "rising"
      ? "도착 시점보다 도착 후 10~20분 강수가 강해지는 흐름입니다"
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

  // 이동과 세팅을 마친 뒤부터 이동 시간 + 40분까지를 촬영 가능한 평가창으로 고정한다.
  const evaluationStart = travelBandMinutes + EVALUATION_SETUP_MINUTES;
  const evaluationEnd = travelBandMinutes + EVALUATION_WINDOW_MINUTES;
  const evaluationFrames = frames.filter(
    (frame) => frame.afterMinutes >= evaluationStart && frame.afterMinutes <= evaluationEnd,
  );
  const peakFrame = maxRain(evaluationFrames);
  const peakDecisionRainMmPerHour = peakFrame ? getDecisionRainMmPerHour(peakFrame) : 0;

  if (!peakFrame || peakDecisionRainMmPerHour < SIGNIFICANT_RAIN_PEAK_MM_PER_HOUR) {
    return null;
  }

  const sustainedMinutes = evaluationFrames.filter(
    (frame) => getDecisionRainMmPerHour(frame) >= SUSTAINED_RAIN_MM_PER_HOUR,
  ).length * 10;
  if (sustainedMinutes < SIGNIFICANT_RAIN_SUSTAINED_MINUTES) {
    return null;
  }

  const evaluationStartFrame = evaluationFrames[0] ?? peakFrame;
  const laterEvaluationFrame =
    evaluationFrames.find((frame) => frame.afterMinutes >= evaluationStart + 20) ?? peakFrame;
  // 도착 전 강수 피크만 별도로 봐서, 현장에 도착하기 전에 지나간 비는 감점한다.
  const peakBeforeArrival = maxRain(frames.filter((frame) => frame.afterMinutes < travelBandMinutes));
  const peakAfterArrivalMinutes = peakFrame.afterMinutes - travelBandMinutes;
  const trend =
    getDecisionRainMmPerHour(laterEvaluationFrame) > getDecisionRainMmPerHour(evaluationStartFrame) + 1
      ? "rising"
      : "steady";
  const intensityScore = clamp(peakDecisionRainMmPerHour / 15, 0, 1);
  const sustainedScore = clamp(sustainedMinutes / 40, 0, 1);
  const peakTimingScore =
    peakAfterArrivalMinutes >= 10 && peakAfterArrivalMinutes <= 20
      ? 1
      : peakAfterArrivalMinutes <= 30
        ? 0.86
        : 0.72;
  const distanceScore = clamp(1 - distanceKm / 35, 0, 1);
  const passingPenalty =
    peakBeforeArrival && getDecisionRainMmPerHour(peakBeforeArrival) > peakDecisionRainMmPerHour * 1.15
      ? 0.76
      : peakBeforeArrival && getDecisionRainMmPerHour(peakBeforeArrival) > peakDecisionRainMmPerHour
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
  const peakRainMmPerHour = Number(peakDecisionRainMmPerHour.toFixed(1));

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

type ScoredDispatchCandidate = NonNullable<ReturnType<typeof scoreCandidate>>;

type GenerateRecommendationOptions = {
  generatedAt?: string;
  dataBasisAt?: string | null;
  note?: string | null;
  status?: "available" | "unavailable";
  message?: string | null;
  base?: WeatherDispatchPoint;
};

// Score is range-independent (rangeMinutes only gates which candidates qualify),
// so candidates are scored once at the widest supported range and then filtered
// per range. This lets a single upstream forecast feed every range.
const WIDEST_DISPATCH_RANGE_MINUTES: WeatherDispatchRangeMinutes = 30;

function scoreDispatchCandidates(
  base: WeatherDispatchPoint,
  forecastsByCandidateId: Map<string, RainForecastFrame[]>,
  dataBasisAt: string,
  estimationNote: string,
): ScoredDispatchCandidate[] {
  return WEATHER_DISPATCH_CANDIDATES
    .map((candidate) => {
      const frames = forecastsByCandidateId.get(candidate.id) ?? [];
      return scoreCandidate(base, candidate, WIDEST_DISPATCH_RANGE_MINUTES, frames, dataBasisAt, estimationNote);
    })
    .filter((item): item is ScoredDispatchCandidate => Boolean(item));
}

function selectTopItemsForRange(
  scored: ScoredDispatchCandidate[],
  rangeMinutes: WeatherDispatchRangeMinutes,
): RainDispatchRecommendationItem[] {
  return scored
    .filter((item) => item.travelBandMinutes <= rangeMinutes)
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
}

function buildRangeResponse(
  rangeMinutes: WeatherDispatchRangeMinutes,
  items: RainDispatchRecommendationItem[],
  resolved: { generatedAt: string; dataBasisAt: string; estimationNote: string; base: WeatherDispatchPoint },
  options: GenerateRecommendationOptions,
): RainDispatchRecommendationResponse {
  return {
    algorithmVersion: WEATHER_DISPATCH_RECOMMENDATION_VERSION,
    status: options.status ?? (items.length > 0 ? "available" : "unavailable"),
    message: options.message ?? (items.length > 0 ? null : NO_SIGNIFICANT_RAIN_MESSAGE),
    base: resolved.base,
    rangeMinutes,
    generatedAt: resolved.generatedAt,
    dataBasisAt: resolved.dataBasisAt,
    note: resolved.estimationNote,
    items,
  };
}

function resolveGenerateOptions(options: GenerateRecommendationOptions) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return {
    generatedAt,
    dataBasisAt: options.dataBasisAt ?? generatedAt,
    estimationNote: options.note ?? "예보 시간 단위 기반 추정",
    base: options.base ?? SANGAM_BASE,
  };
}

export function generateRainDispatchRecommendationsFromForecasts(
  rangeMinutes: WeatherDispatchRangeMinutes,
  forecastsByCandidateId: Map<string, RainForecastFrame[]>,
  options: GenerateRecommendationOptions = {},
): RainDispatchRecommendationResponse {
  const resolved = resolveGenerateOptions(options);
  const scored = scoreDispatchCandidates(resolved.base, forecastsByCandidateId, resolved.dataBasisAt, resolved.estimationNote);
  return buildRangeResponse(rangeMinutes, selectTopItemsForRange(scored, rangeMinutes), resolved, options);
}

export function generateRainDispatchRecommendationsForRanges(
  ranges: readonly WeatherDispatchRangeMinutes[],
  forecastsByCandidateId: Map<string, RainForecastFrame[]>,
  options: GenerateRecommendationOptions = {},
): Partial<Record<WeatherDispatchRangeMinutes, RainDispatchRecommendationResponse>> {
  const resolved = resolveGenerateOptions(options);
  const scored = scoreDispatchCandidates(resolved.base, forecastsByCandidateId, resolved.dataBasisAt, resolved.estimationNote);
  const result: Partial<Record<WeatherDispatchRangeMinutes, RainDispatchRecommendationResponse>> = {};
  for (const rangeMinutes of ranges) {
    result[rangeMinutes] = buildRangeResponse(rangeMinutes, selectTopItemsForRange(scored, rangeMinutes), resolved, options);
  }
  return result;
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
