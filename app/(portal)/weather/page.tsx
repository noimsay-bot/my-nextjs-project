import { WeatherDashboard, type InitialWeatherRecommendations } from "@/components/weather/weather-dashboard";
import {
  generateRainDispatchRecommendationsFromForecasts,
  type WeatherDispatchRangeMinutes,
} from "@/lib/weather/recommendation";

const INITIAL_RANGES: WeatherDispatchRangeMinutes[] = [30, 45, 60];

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
        message: "현재 강수 출동 추천이 없습니다. 필요하면 추천 새로고침을 눌러 주세요.",
      }),
    ]),
  ) as InitialWeatherRecommendations;

  return <WeatherDashboard initialRecommendations={initialRecommendations} />;
}
