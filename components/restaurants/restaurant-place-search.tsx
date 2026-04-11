"use client";

import { useEffect, useMemo, useState } from "react";
import { hasGoogleMapsApiKey, loadGoogleMapsPlacesApi } from "@/lib/google/maps";
import {
  fetchRestaurantPlaceDetails,
  searchRestaurantPredictionsWithMode,
  type RestaurantPlacePrediction,
  type RestaurantPlaceSelection,
  type RestaurantPlaceSearchMode,
} from "@/lib/restaurants/google-places";
import type { RestaurantLocation } from "@/lib/restaurants/types";

export function RestaurantPlaceSearch({
  currentLocation,
  disabled,
  onSelect,
}: {
  currentLocation: RestaurantLocation | null;
  disabled?: boolean;
  onSelect: (place: RestaurantPlaceSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [apiStatus, setApiStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [apiMessage, setApiMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [predictions, setPredictions] = useState<RestaurantPlacePrediction[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [resultState, setResultState] = useState<"idle" | "empty" | "ready" | "search-error" | "detail-error">("idle");
  const [resultMessage, setResultMessage] = useState("");
  const [searchMode, setSearchMode] = useState<RestaurantPlaceSearchMode>("global");

  useEffect(() => {
    let cancelled = false;

    if (!hasGoogleMapsApiKey()) {
      setApiStatus("error");
      setApiMessage(
        "구글 장소 검색을 쓰려면 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 환경변수를 설정해 주세요. 지금은 수동 입력으로 등록할 수 있습니다.",
      );
      return;
    }

    setApiStatus("loading");
    void loadGoogleMapsPlacesApi()
      .then(() => {
        if (cancelled) return;
        setApiStatus("ready");
      })
      .catch((error) => {
        console.error("Google Places load error:", error);
        if (cancelled) return;
        setApiStatus("error");
        setApiMessage(error instanceof Error ? error.message : "구글 Places를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (apiStatus !== "ready") return;

    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setPredictions([]);
      setResultState("idle");
      setResultMessage("");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchRestaurantPredictionsWithMode(trimmedQuery, currentLocation, searchMode)
        .then((nextPredictions) => {
          if (cancelled) return;
          setPredictions(nextPredictions);
          setResultState(nextPredictions.length > 0 ? "ready" : "empty");
          setResultMessage("");
        })
        .catch((error) => {
          console.error("Google Places prediction error:", error);
          if (cancelled) return;
          setPredictions([]);
          setResultState("search-error");
          setResultMessage(error instanceof Error ? error.message : "검색 결과를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (cancelled) return;
          setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiStatus, currentLocation, query, searchMode]);

  const helperStatus = useMemo(() => {
    if (apiStatus === "loading") {
      return { tone: "note" as const, text: "Places를 불러오는 중입니다." };
    }
    if (apiStatus === "error") {
      return { tone: "warn" as const, text: apiMessage };
    }
    if (searching) {
      return { tone: "note" as const, text: "검색 결과를 찾는 중입니다." };
    }
    if (resultState === "search-error" || resultState === "detail-error") {
      return {
        tone: "warn" as const,
        text:
          resultMessage ||
          (resultState === "detail-error"
            ? "선택한 장소 상세 정보를 불러오지 못했습니다."
            : "검색 결과를 불러오지 못했습니다."),
      };
    }
    if (query.trim().length >= 2 && resultState === "empty") {
      return { tone: "note" as const, text: "검색 결과가 없습니다." };
    }
    if (selectedPlaceId) {
      return { tone: "ok" as const, text: "장소 선택이 완료되었습니다." };
    }
    if (searchMode === "nearby" && !currentLocation) {
      return { tone: "note" as const, text: "현재 위치가 없어서 전체 검색과 비슷하게 동작할 수 있습니다." };
    }
    return {
      tone: "note" as const,
      text:
        searchMode === "nearby"
          ? "현재 위치를 기준으로 가까운 음식점을 우선 찾아 보여줍니다."
          : "전세계 검색 모드입니다. 해외 음식점도 검색할 수 있습니다.",
    };
  }, [apiMessage, apiStatus, currentLocation, query, resultState, searchMode, searching, selectedPlaceId]);

  const handleSelectPrediction = async (prediction: RestaurantPlacePrediction) => {
    setSearching(true);
    try {
      const selectedPlace = await fetchRestaurantPlaceDetails(prediction.placeId);
      setSelectedPlaceId(selectedPlace.placeId);
      setQuery(prediction.description);
      setPredictions([]);
      setResultState("idle");
      setResultMessage("");
      onSelect(selectedPlace);
    } catch (error) {
      console.error("Google Places detail error:", error);
      setResultState("detail-error");
      setResultMessage(error instanceof Error ? error.message : "선택한 장소를 불러오지 못했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const searchEnabled = apiStatus === "ready";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label style={{ display: "grid", gap: 8 }}>
        <span>장소 검색</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={searchMode === "global" ? "btn white" : "btn"}
            onClick={() => setSearchMode("global")}
            disabled={disabled || !searchEnabled}
          >
            전체 검색
          </button>
          <button
            type="button"
            className={searchMode === "nearby" ? "btn white" : "btn"}
            onClick={() => setSearchMode("nearby")}
            disabled={disabled || !searchEnabled}
          >
            현재 주변 우선
          </button>
        </div>
        <input
          className="field-input"
          placeholder={searchMode === "global" ? "해외 포함 전세계 음식점을 검색해 주세요." : "현재 위치 근처 음식점을 우선 검색해 주세요."}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedPlaceId(null);
            setResultMessage("");
            setResultState("idle");
          }}
          disabled={disabled || !searchEnabled}
        />
      </label>

      <div className={`status ${helperStatus.tone}`}>{helperStatus.text}</div>

      {predictions.length > 0 ? (
        <div
          className="panel"
          style={{
            background: "rgba(35, 52, 84, 0.22)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div className="panel-pad" style={{ display: "grid", gap: 8, padding: 10 }}>
            {predictions.map((prediction) => (
              <button
                key={prediction.placeId}
                type="button"
                className="btn"
                onClick={() => void handleSelectPrediction(prediction)}
                disabled={disabled || searching}
                style={{
                  width: "100%",
                  textAlign: "left",
                  justifyContent: "flex-start",
                  padding: "12px 14px",
                  display: "grid",
                  gap: 4,
                }}
              >
                <strong style={{ fontSize: 15 }}>{prediction.title}</strong>
                <span className="muted" style={{ fontSize: 13, whiteSpace: "normal" }}>
                  {prediction.subtitle || prediction.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
