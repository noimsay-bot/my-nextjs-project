"use client";

import { useMemo, useRef, useState } from "react";
import type {
  RainDispatchRecommendationResponse,
  WeatherDispatchRangeMinutes,
} from "@/lib/weather/recommendation";
import type { InitialWeatherRecommendations } from "@/components/weather/weather-dashboard";
import styles from "@/components/weather/weather.module.css";

const RANGE_OPTIONS: WeatherDispatchRangeMinutes[] = [30, 45, 60];
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function formatRain(value: number) {
  return `${Number(value.toFixed(1)).toLocaleString("ko-KR")}mm/h`;
}

export function RainDispatchRecommendation({
  initialRecommendations,
}: {
  initialRecommendations: InitialWeatherRecommendations;
}) {
  const [selectedRange, setSelectedRange] = useState<WeatherDispatchRangeMinutes>(30);
  const [recommendationsByRange, setRecommendationsByRange] =
    useState<InitialWeatherRecommendations>(initialRecommendations);
  const [loadingRange, setLoadingRange] = useState<WeatherDispatchRangeMinutes | null>(null);
  const [message, setMessage] = useState("");
  const cacheRef = useRef(
    new Map<WeatherDispatchRangeMinutes, { data: RainDispatchRecommendationResponse; cachedAt: number }>(
      RANGE_OPTIONS.map((range) => [range, { data: initialRecommendations[range], cachedAt: Date.now() }]),
    ),
  );

  const currentRecommendations = recommendationsByRange[selectedRange];
  const formattedGeneratedAt = useMemo(
    () => formatDateTime(currentRecommendations.generatedAt),
    [currentRecommendations.generatedAt],
  );

  async function refreshRecommendations(force = false) {
    const cached = cacheRef.current.get(selectedRange);
    if (!force && cached && Date.now() - cached.cachedAt < CLIENT_CACHE_TTL_MS) {
      setRecommendationsByRange((current) => ({
        ...current,
        [selectedRange]: cached.data,
      }));
      setMessage("최근 추천 결과를 다시 사용했습니다.");
      return;
    }

    setLoadingRange(selectedRange);
    setMessage("");

    try {
      const response = await fetch(`/api/weather/dispatch-recommendation?range=${selectedRange}`, {
        headers: {
          Accept: "application/json",
        },
      });
      const data = (await response.json()) as RainDispatchRecommendationResponse | { message?: string };

      if (!response.ok) {
        const errorMessage = "message" in data ? data.message : null;
        setMessage(errorMessage ?? "강수 출동 추천을 불러오지 못했습니다.");
        return;
      }

      if (!("items" in data)) {
        setMessage(data.message ?? "강수 출동 추천을 불러오지 못했습니다.");
        return;
      }

      cacheRef.current.set(selectedRange, { data, cachedAt: Date.now() });
      setRecommendationsByRange((current) => ({
        ...current,
        [selectedRange]: data,
      }));
      setMessage("강수 출동 추천을 새로 계산했습니다.");
    } catch {
      setMessage("강수 출동 추천을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoadingRange(null);
    }
  }

  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <div className="chip">Dispatch</div>
            <h2>강수 출동 추천</h2>
            <p className={styles.sectionDescription}>
              상암동 기준 지금 출발했을 때, 도착 직후가 아니라 도착 후 촬영 가능한 시간대에 강하고 오래 비가 이어질 가능성이 높은 지역을 추천합니다.
            </p>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={loadingRange === selectedRange}
            onClick={() => void refreshRecommendations(true)}
          >
            {loadingRange === selectedRange ? "계산 중" : "추천 새로고침"}
          </button>
        </div>

        <div className={styles.recommendationHeader}>
          <div className={styles.toolbar} aria-label="이동권 선택">
            {RANGE_OPTIONS.map((range) => (
              <button
                key={range}
                type="button"
                className={`btn ${selectedRange === range ? "white" : ""} ${styles.rangeButton}`.trim()}
                onClick={() => {
                  setSelectedRange(range);
                  setMessage("");
                }}
              >
                {range}분 이내
              </button>
            ))}
          </div>
          <span className="muted">
            기준: {currentRecommendations.base.name} · 도착 후 10~40분 기준 · 계산 {formattedGeneratedAt}
          </span>
        </div>

        {message ? (
          <div className={message.includes("못했") || message.includes("오류") ? "status warn" : "status note"}>
            {message}
          </div>
        ) : null}

        <div className={styles.recommendationCards}>
          {currentRecommendations.items.map((item) => (
            <article key={`${selectedRange}-${item.placeName}`} className={styles.recommendationCard}>
              <div className={styles.cardHead}>
                <div style={{ display: "grid", gap: 4 }}>
                  <span className={styles.rankBadge}>{item.rank}순위</span>
                  <h3 className={styles.placeName}>{item.placeName}</h3>
                </div>
                <span className={styles.scoreText}>{item.score.toLocaleString("ko-KR")}점</span>
              </div>

              <div className={styles.metricGrid}>
                <div className={styles.metric}>
                  <span>예상 이동권</span>
                  <strong>{item.travelBandMinutes}분권</strong>
                </div>
                <div className={styles.metric}>
                  <span>직선거리</span>
                  <strong>{item.distanceKm.toLocaleString("ko-KR")}km</strong>
                </div>
                <div className={styles.metric}>
                  <span>예상 강수강도</span>
                  <strong>
                    {item.expectedIntensityLabel} · {formatRain(item.peakRainMmPerHour)}
                  </strong>
                </div>
                <div className={styles.metric}>
                  <span>강수 피크 시점</span>
                  <strong>도착 후 {item.peakAfterArrivalMinutes}분</strong>
                </div>
                <div className={styles.metric}>
                  <span>예상 지속시간</span>
                  <strong>{item.sustainedMinutes}분</strong>
                </div>
                <div className={styles.metric}>
                  <span>평가 기준</span>
                  <strong>도착 후 10~40분 기준</strong>
                </div>
              </div>

              <p className={styles.cardText}>{item.reason}</p>
              <div className={styles.cardNote}>
                <strong>주의</strong>
                <span>{item.caution}</span>
              </div>
            </article>
          ))}
        </div>

        {currentRecommendations.items.length === 0 ? (
          <div className="status note">선택한 이동권 안에서 추천할 강수 후보가 없습니다.</div>
        ) : null}
      </div>
    </article>
  );
}
