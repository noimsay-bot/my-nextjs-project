"use client";

import type { RainDispatchRecommendationResponse, WeatherDispatchRangeMinutes } from "@/lib/weather/recommendation";
import { RadarForecastPanel } from "@/components/weather/radar-forecast-panel";
import { RainDispatchRecommendation } from "@/components/weather/rain-dispatch-recommendation";
import styles from "@/components/weather/weather.module.css";

export type InitialWeatherRecommendations = Record<WeatherDispatchRangeMinutes, RainDispatchRecommendationResponse>;

export function WeatherDashboard({
  initialRecommendations,
}: {
  initialRecommendations: InitialWeatherRecommendations;
}) {
  return (
    <section className={styles.dashboard}>
      <article className="panel">
        <div className="panel-pad">
          <div className={styles.header}>
            <div className="chip">관리자 도구</div>
            <h1 className="page-title">날씨</h1>
            <p>상암동 기준 강수예측과 출동 추천을 확인합니다.</p>
          </div>
        </div>
      </article>

      <div className={styles.panelStack}>
        <RadarForecastPanel />
        <RainDispatchRecommendation initialRecommendations={initialRecommendations} />
      </div>
    </section>
  );
}
