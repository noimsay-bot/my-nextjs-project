"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchRestaurants } from "@/lib/restaurants/fetch";
import { calculateDistanceMeters } from "@/lib/restaurants/distance";
import { readGeolocationPermissionState, requestBrowserLocation } from "@/lib/restaurants/location";
import type {
  GeolocationPermissionState,
  NearbyRestaurant,
  RestaurantLocation,
  RestaurantLocationStatus,
  RestaurantRow,
} from "@/lib/restaurants/types";
import { LocationPermissionBanner } from "@/components/restaurants/location-permission-banner";
import { RestaurantsList } from "@/components/restaurants/restaurants-list";
import { RestaurantsMap } from "@/components/restaurants/restaurants-map";

type RestaurantsFetchState =
  | { status: "loading"; message: string; restaurants: RestaurantRow[] }
  | { status: "ready"; message: string; restaurants: RestaurantRow[] }
  | { status: "error"; message: string; restaurants: RestaurantRow[] };

function getGeoStatusMessage(status: RestaurantLocationStatus, errorMessage: string) {
  switch (status) {
    case "requesting":
      return { tone: "note" as const, text: "위치 권한을 요청하는 중입니다." };
    case "locating":
      return { tone: "note" as const, text: "현재 위치를 가져오는 중입니다." };
    case "denied":
      return { tone: "warn" as const, text: "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요." };
    case "error":
      return { tone: "warn" as const, text: errorMessage || "현재 위치를 가져오지 못했습니다." };
    case "ready":
      return { tone: "ok" as const, text: "현재 위치를 확인했습니다." };
    default:
      return { tone: "note" as const, text: "현재 위치 확인을 준비 중입니다." };
  }
}

export function RestaurantsPage() {
  const router = useRouter();
  const [restaurantsState, setRestaurantsState] = useState<RestaurantsFetchState>({
    status: "loading",
    message: "등록된 맛집을 불러오는 중입니다.",
    restaurants: [],
  });
  const [locationStatus, setLocationStatus] = useState<RestaurantLocationStatus>("idle");
  const [permissionState, setPermissionState] = useState<GeolocationPermissionState>("checking");
  const [locationError, setLocationError] = useState("");
  const [currentLocation, setCurrentLocation] = useState<RestaurantLocation | null>(null);

  const loadRestaurants = useCallback(async () => {
    setRestaurantsState({
      status: "loading",
      message: "등록된 맛집을 불러오는 중입니다.",
      restaurants: [],
    });

    const result = await fetchRestaurants();
    if (!result.ok) {
      setRestaurantsState({
        status: "error",
        message: result.message ?? "맛집 데이터를 불러오지 못했습니다.",
        restaurants: [],
      });
      return;
    }

    setRestaurantsState({
      status: "ready",
      message: result.restaurants.length === 0 ? "등록된 맛집이 아직 없습니다." : "",
      restaurants: result.restaurants,
    });
  }, []);

  const requestCurrentLocation = useCallback(() => {
    setPermissionState("requesting");
    setLocationError("");
    setLocationStatus("requesting");
    setLocationStatus("locating");

    void requestBrowserLocation().then((result) => {
      if (result.ok) {
        setCurrentLocation(result.location);
        setPermissionState("granted");
        setLocationStatus("ready");
        return;
      }

      setCurrentLocation(null);
      setPermissionState(result.permissionState);
      setLocationStatus(result.permissionState === "denied" ? "denied" : "error");
      setLocationError(result.message);
    });
  }, []);

  useEffect(() => {
    void loadRestaurants();
  }, [loadRestaurants]);

  useEffect(() => {
    let cancelled = false;

    void readGeolocationPermissionState().then((nextPermissionState) => {
      if (cancelled) return;
      setPermissionState(nextPermissionState);
      if (nextPermissionState === "granted") {
        requestCurrentLocation();
        return;
      }
      if (nextPermissionState === "denied") {
        setLocationStatus("denied");
        setLocationError("현재 위치 권한이 꺼져 있어 가까운 순 정렬이 제한됩니다.");
        return;
      }
      if (nextPermissionState === "unsupported") {
        setLocationStatus("error");
        setLocationError("이 브라우저에서는 위치 정보를 지원하지 않습니다.");
        return;
      }
      setLocationStatus("idle");
    });

    return () => {
      cancelled = true;
    };
  }, [requestCurrentLocation]);

  const nearbyRestaurants = useMemo<NearbyRestaurant[]>(() => {
    const mapped = restaurantsState.restaurants.map((restaurant) => ({
      ...restaurant,
      distanceMeters: currentLocation
        ? calculateDistanceMeters(currentLocation, {
            lat: restaurant.lat,
            lng: restaurant.lng,
          })
        : null,
    }));

    return mapped.sort((left, right) => {
      if (left.distanceMeters === null && right.distanceMeters === null) {
        return right.createdAt.localeCompare(left.createdAt);
      }
      if (left.distanceMeters === null) return 1;
      if (right.distanceMeters === null) return -1;
      return left.distanceMeters - right.distanceMeters;
    });
  }, [currentLocation, restaurantsState.restaurants]);

  const locationStatusView = getGeoStatusMessage(locationStatus, locationError);
  const showPermissionBanner = permissionState !== "granted" || locationStatus !== "ready";

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="chip">내 주변 맛집</div>
            <div>
              <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 44px)", lineHeight: 1.05 }}>내 주변 맛집</h1>
              <p className="muted" style={{ margin: "10px 0 0", fontSize: 15 }}>
                현재 위치 기준으로 등록된 맛집을 확인할 수 있습니다.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn white" onClick={requestCurrentLocation}>
              현재 위치 다시 찾기
            </button>
            <Link href="/restaurants/new" className="btn" style={{ textDecoration: "none" }}>
              맛집 등록
            </Link>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div className={`status ${locationStatusView.tone}`}>{locationStatusView.text}</div>
          {showPermissionBanner ? (
            <LocationPermissionBanner
              permissionState={permissionState}
              locationStatus={locationStatus}
              onRetry={requestCurrentLocation}
              message={locationError || undefined}
            />
          ) : null}
          {restaurantsState.status === "loading" ? (
            <div className="status note">등록된 맛집을 불러오는 중입니다.</div>
          ) : null}
          {restaurantsState.status === "error" ? (
            <div className="status warn">{restaurantsState.message}</div>
          ) : null}
          {restaurantsState.status === "ready" && restaurantsState.restaurants.length === 0 ? (
            <div className="status note">등록된 맛집이 아직 없습니다.</div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
            <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontSize: 18 }}>지도</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  {currentLocation ? "현재 위치와 등록 맛집을 함께 표시합니다." : "위치 권한이 없어도 등록 맛집은 계속 볼 수 있습니다."}
                </span>
              </div>
              <RestaurantsMap
                currentLocation={currentLocation}
                restaurants={nearbyRestaurants}
                onSelectRestaurant={(restaurant) => {
                  router.push(`/restaurants/${restaurant.id}`);
                }}
              />
            </div>
          </div>

          <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
            <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontSize: 18 }}>가까운 맛집 목록</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  {currentLocation ? "현재 위치 기준 가까운 순" : "현재 위치 권한이 없으면 기본 등록 순으로 표시됩니다."}
                </span>
              </div>
              <RestaurantsList restaurants={nearbyRestaurants} hasCurrentLocation={Boolean(currentLocation)} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
