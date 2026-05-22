import { WeatherDashboard, type InitialWeatherRecommendations } from "@/components/weather/weather-dashboard";
import {
  generateRainDispatchRecommendations,
  type WeatherDispatchRangeMinutes,
} from "@/lib/weather/recommendation";

const INITIAL_RANGES: WeatherDispatchRangeMinutes[] = [30, 45, 60];

export const dynamic = "force-static";
export const revalidate = 300;

export default function WeatherPage() {
  const initialRecommendations = Object.fromEntries(
    INITIAL_RANGES.map((range) => [range, generateRainDispatchRecommendations(range)]),
  ) as InitialWeatherRecommendations;

  return <WeatherDashboard initialRecommendations={initialRecommendations} />;
}
