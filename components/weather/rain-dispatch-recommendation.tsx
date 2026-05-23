"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RainDispatchRecommendationResponse,
  WeatherDispatchRangeMinutes,
} from "@/lib/weather/recommendation";
import type { InitialWeatherRecommendations } from "@/components/weather/weather-dashboard";
import styles from "@/components/weather/weather.module.css";

const RANGE_OPTIONS: WeatherDispatchRangeMinutes[] = [10, 20, 30];
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

type CurrentLocation = {
  lat: number;
  lon: number;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function formatRain(value: number) {
  return `${Number(value.toFixed(1)).toLocaleString("ko-KR")}mm/h`;
}

function isRecommendationResponse(value: unknown): value is RainDispatchRecommendationResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { items?: unknown }).items) &&
      typeof (value as { rangeMinutes?: unknown }).rangeMinutes === "number",
  );
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(5));
}

function getRecommendationCacheKey(range: WeatherDispatchRangeMinutes, location: CurrentLocation) {
  return `${range}:${location.lat.toFixed(5)}:${location.lon.toFixed(5)}`;
}

function getRecommendationUrl(range: WeatherDispatchRangeMinutes, location: CurrentLocation) {
  const params = new URLSearchParams({
    range: String(range),
    lat: location.lat.toFixed(5),
    lon: location.lon.toFixed(5),
  });
  return `/api/weather/dispatch-recommendation?${params.toString()}`;
}

function getLocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "브라우저 위치 권한을 허용하면 현재 위치 기준 추천을 계산합니다.";
  }
  if (error.code === error.TIMEOUT) {
    return "현재 위치 확인 시간이 초과됐습니다. 다시 시도해 주세요.";
  }
  return "현재 위치를 확인하지 못했습니다. 브라우저 위치 설정을 확인해 주세요.";
}

export function RainDispatchRecommendation({
  initialRecommendations,
}: {
  initialRecommendations: InitialWeatherRecommendations;
}) {
  const [selectedRange, setSelectedRange] = useState<WeatherDispatchRangeMinutes>(10);
  const [recommendationsByRange, setRecommendationsByRange] =
    useState<InitialWeatherRecommendations>(initialRecommendations);
  const [loadingRange, setLoadingRange] = useState<WeatherDispatchRangeMinutes | null>(null);
  const [message, setMessage] = useState("");
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation | null>(null);
  const [locationStatus, setLocationStatus] =
    useState<"idle" | "checking" | "ready" | "blocked" | "unsupported">("idle");
  const cacheRef = useRef(
    new Map<string, { data: RainDispatchRecommendationResponse; cachedAt: number }>(),
  );

  const currentRecommendations = recommendationsByRange[selectedRange];
  const formattedGeneratedAt = useMemo(
    () => formatDateTime(currentRecommendations.generatedAt),
    [currentRecommendations.generatedAt],
  );
  const formattedDataBasisAt = useMemo(() => {
    if (!currentRecommendations.dataBasisAt) return "";
    return formatDateTime(currentRecommendations.dataBasisAt);
  }, [currentRecommendations.dataBasisAt]);

  const refreshRecommendationsForRange = useCallback(async (
    range: WeatherDispatchRangeMinutes,
    location: CurrentLocation,
    force = false,
    announce = true,
  ) => {
    const cacheKey = getRecommendationCacheKey(range, location);
    const cached = cacheRef.current.get(cacheKey);
    if (!force && cached && Date.now() - cached.cachedAt < CLIENT_CACHE_TTL_MS) {
      setRecommendationsByRange((current) => ({
        ...current,
        [range]: cached.data,
      }));
      if (announce) setMessage("최근 추천 결과를 다시 사용했습니다.");
      return;
    }

    setLoadingRange(range);
    if (announce) setMessage("");

    try {
      const response = await fetch(getRecommendationUrl(range, location), {
        headers: {
          Accept: "application/json",
        },
      });
      const data = (await response.json()) as RainDispatchRecommendationResponse | { message?: string };

      if (!response.ok) {
        const errorMessage = "message" in data ? data.message : null;
        if (announce) setMessage(errorMessage ?? "강수 출동 추천을 불러오지 못했습니다.");
        return;
      }

      if (!("items" in data)) {
        if (announce) setMessage(data.message ?? "강수 출동 추천을 불러오지 못했습니다.");
        return;
      }

      cacheRef.current.set(cacheKey, { data, cachedAt: Date.now() });
      setRecommendationsByRange((current) => ({
        ...current,
        [range]: data,
      }));
      if (announce) {
        setMessage(data.status === "unavailable" ? data.message ?? "강수 출동 추천을 불러오지 못했습니다." : "강수 출동 추천을 새로 계산했습니다.");
      }
    } catch {
      if (announce) setMessage("강수 출동 추천을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoadingRange(null);
    }
  }, []);

  const requestCurrentLocation = useCallback((
    range: WeatherDispatchRangeMinutes,
    announce = true,
  ) => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      if (announce) setMessage("이 브라우저에서는 현재 위치를 확인할 수 없습니다.");
      return;
    }

    setLocationStatus("checking");
    if (announce) setMessage("현재 위치를 확인하는 중입니다.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          lat: roundCoordinate(position.coords.latitude),
          lon: roundCoordinate(position.coords.longitude),
        };
        setCurrentLocation(nextLocation);
        setLocationStatus("ready");
        if (announce) setMessage("현재 위치 기준으로 강수 출동 추천을 계산합니다.");
        void refreshRecommendationsForRange(range, nextLocation, true, announce);
      },
      (error) => {
        setLocationStatus(error.code === error.PERMISSION_DENIED ? "blocked" : "idle");
        if (announce) setMessage(getLocationErrorMessage(error));
      },
      {
        enableHighAccuracy: false,
        maximumAge: CLIENT_CACHE_TTL_MS,
        timeout: 10000,
      },
    );
  }, [refreshRecommendationsForRange]);

  useEffect(() => {
    requestCurrentLocation(10, false);
  }, [requestCurrentLocation]);

  async function refreshRecommendations(force = false) {
    if (currentLocation) {
      await refreshRecommendationsForRange(selectedRange, currentLocation, force);
      return;
    }
    requestCurrentLocation(selectedRange);
  }

  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <div className="chip">Dispatch</div>
            <h2>강수 출동 추천</h2>
            <p className={styles.sectionDescription}>
              현재 위치에서 지금 출발했을 때, 도착 직후가 아니라 도착 후 촬영 가능한 시간대에 강하고 오래 비가 이어질 가능성이 높은 지역을 추천합니다.
            </p>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={loadingRange === selectedRange || locationStatus === "checking"}
            onClick={() => void refreshRecommendations(true)}
          >
            {locationStatus === "checking"
              ? "위치 확인 중"
              : loadingRange === selectedRange
                ? "계산 중"
                : currentLocation
                  ? "추천 새로고침"
                  : "현재 위치 확인"}
          </button>
        </div>

        <div className={styles.recommendationHeader}>
          <div className={styles.toolbar} aria-label="이동권 선택">
            {RANGE_OPTIONS.map((range) => (
              <button
                key={range}
                type="button"
                disabled={locationStatus === "checking"}
                className={`btn ${selectedRange === range ? "white" : ""} ${styles.rangeButton}`.trim()}
                onClick={() => {
                  setSelectedRange(range);
                  setMessage("");
                  if (currentLocation) {
                    void refreshRecommendationsForRange(range, currentLocation, false, true);
                  } else {
                    requestCurrentLocation(range);
                  }
                }}
              >
                {range}분 이내
              </button>
            ))}
          </div>
          <span className="muted">
            기준: {currentRecommendations.base.name} · 도착 후 10~40분 기준 · 계산 {formattedGeneratedAt}
            {formattedDataBasisAt ? ` · 자료 ${formattedDataBasisAt}` : ""}
          </span>
        </div>

        {message ? (
          <div className={message.includes("못했") || message.includes("오류") || message.includes("권한") ? "status warn" : "status note"}>
            {message}
          </div>
        ) : null}

        {currentRecommendations.message && currentRecommendations.items.length > 0 ? (
          <div className="status warn">{currentRecommendations.message}</div>
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
                  <strong>{item.estimationNote || "도착 후 10~40분 기준"}</strong>
                </div>
                <div className={styles.metric}>
                  <span>데이터 기준 시각</span>
                  <strong>{formatDateTime(item.dataBasisAt)}</strong>
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
          <div className="status note">
            {currentRecommendations.message ?? "현재 강수 출동 추천이 없습니다."}
          </div>
        ) : null}
      </div>
    </article>
  );
}
