import { WeatherDashboard, type InitialWeatherRecommendations } from "@/components/weather/weather-dashboard";
import {
  generateRainDispatchRecommendationsFromForecasts,
  type WeatherDispatchRangeMinutes,
} from "@/lib/weather/recommendation";

const INITIAL_RANGES: WeatherDispatchRangeMinutes[] = [10, 20, 30];
const CURRENT_LOCATION_PENDING_BASE = {
  name: "현재 위치 확인 전",
  lat: 37.5796,
  lon: 126.8908,
} as const;

export const dynamic = "force-static";
export const revalidate = 300;

export default function WeatherPage() {
  const generatedAt = new Date().toISOString();
  const initialRecommendations = Object.fromEntries(
    INITIAL_RANGES.map((range) => [
      range,
      generateRainDispatchRecommendationsFromForecasts(range, new Map(), {
        generatedAt,
        dataBasisAt: null,
        status: "unavailable",
        message: "브라우저 위치 권한을 허용하면 현재 위치 기준 추천을 계산합니다.",
        base: CURRENT_LOCATION_PENDING_BASE,
      }),
    ]),
  ) as InitialWeatherRecommendations;

  return <WeatherDashboard initialRecommendations={initialRecommendations} />;
}
