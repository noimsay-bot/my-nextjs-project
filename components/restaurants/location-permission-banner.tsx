"use client";

import type { GeolocationPermissionState, RestaurantLocationStatus } from "@/lib/restaurants/types";

function getBannerContent(permissionState: GeolocationPermissionState, locationStatus: RestaurantLocationStatus) {
  if (permissionState === "unsupported") {
    return {
      tone: "warn" as const,
      title: "현재 기기에서는 위치 정보를 지원하지 않습니다.",
      body: "맛집 목록은 계속 볼 수 있지만 가까운 순 정렬과 내 위치 표시는 제한됩니다.",
    };
  }

  if (permissionState === "checking") {
    return {
      tone: "note" as const,
      title: "위치 권한 상태를 확인하는 중입니다.",
      body: "잠시만 기다려 주세요.",
    };
  }

  if (permissionState === "prompt") {
    return {
      tone: "note" as const,
      title: "현재 위치를 사용하면 가까운 순으로 더 정확하게 볼 수 있습니다.",
      body: "위치 권한을 허용하지 않아도 목록은 계속 볼 수 있습니다.",
    };
  }

  if (permissionState === "requesting" || locationStatus === "requesting" || locationStatus === "locating") {
    return {
      tone: "note" as const,
      title: "현재 위치를 확인하는 중입니다.",
      body: "위치 권한 요청 또는 좌표 확인이 진행 중입니다.",
    };
  }

  if (permissionState === "denied" || locationStatus === "denied") {
    return {
      tone: "warn" as const,
      title: "현재 위치 권한이 꺼져 있어 가까운 순 정렬이 제한됩니다.",
      body: "브라우저 또는 휴대폰 설정에서 위치 권한을 허용한 뒤 다시 시도해 주세요.",
    };
  }

  if (permissionState === "error" || locationStatus === "error") {
    return {
      tone: "warn" as const,
      title: "현재 위치를 가져오지 못했습니다.",
      body: "네트워크나 위치 설정을 확인한 뒤 다시 시도해 주세요.",
    };
  }

  if (permissionState === "granted" && locationStatus === "ready") {
    return {
      tone: "ok" as const,
      title: "현재 위치를 확인했습니다.",
      body: "내 위치 기준으로 가까운 순 정렬을 적용하고 있습니다.",
    };
  }

  return {
    tone: "note" as const,
    title: "현재 위치를 사용하면 더 편리합니다.",
    body: "필요하면 위치 다시 찾기를 눌러 주세요.",
  };
}

export function LocationPermissionBanner({
  permissionState,
  locationStatus,
  onRetry,
  message,
}: {
  permissionState: GeolocationPermissionState;
  locationStatus: RestaurantLocationStatus;
  onRetry: () => void;
  message?: string;
}) {
  const content = getBannerContent(permissionState, locationStatus);

  return (
    <div className={`status ${content.tone}`} style={{ display: "grid", gap: 10 }}>
      <strong>{content.title}</strong>
      <span>{message || content.body}</span>
      {(permissionState === "prompt" ||
        permissionState === "denied" ||
        permissionState === "error" ||
        permissionState === "unsupported") ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {permissionState !== "unsupported" ? (
            <button type="button" className="btn white" onClick={onRetry}>
              다시 시도
            </button>
          ) : null}
          {(permissionState === "denied" || permissionState === "error") ? (
            <span className="muted" style={{ fontSize: 13 }}>
              모바일에서는 브라우저 또는 휴대폰 설정에서 위치 권한을 켜야 할 수 있습니다.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
