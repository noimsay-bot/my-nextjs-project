"use client";

import type { RainDispatchRecommendationResponse, WeatherDispatchRangeMinutes } from "@/lib/weather/recommendation";
import { RadarForecastPanel } from "@/components/weather/radar-forecast-panel";
import { RainDispatchRecommendation } from "@/components/weather/rain-dispatch-recommendation";
import styles from "@/components/weather/weather.module.css";

export type InitialWeatherRecommendations = Record<WeatherDispatchRangeMinutes, RainDispatchRecommendationResponse>;

const WEATHER_LINKS = [
  {
    badge: "필수",
    icon: "🌧️",
    title: "초단기 강수예측",
    desc: "6시간 내 강수 예측",
    url: "https://www.weather.go.kr/w/weather/radar/rain.do",
  },
  {
    badge: "경보",
    icon: "🚨",
    title: "기상특보",
    desc: "폭염·한파·호우·대설",
    url: "https://www.weather.go.kr/w/special-report/overall.do",
  },
  {
    badge: "",
    icon: "🌀",
    title: "태풍",
    desc: "경로·강도·진로",
    url: "https://www.weather.go.kr/w/typhoon/ko/weather/typhoon_02.jsp",
  },
];

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
        <div className="wx-wrap">
          <div className="wx-grid" id="wxGrid">
            {WEATHER_LINKS.map((link) => (
              <a key={link.title} className="wx-card" href={link.url} target="_blank" rel="noopener">
                {link.badge ? (
                  <span className={`wx-badge${link.badge === "필수" ? " key" : ""}`}>{link.badge}</span>
                ) : null}
                <span className="wx-icon">{link.icon}</span>
                <span className="wx-text">
                  <span className="wx-title">{link.title}</span>
                  <span className="wx-desc">{link.desc}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
        <div id="weatherRadarForecastPanel" className={styles.hiddenRadarPanel} hidden>
          <RadarForecastPanel />
        </div>
        <RainDispatchRecommendation initialRecommendations={initialRecommendations} />
      </div>
    </section>
  );
}
