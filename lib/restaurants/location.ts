"use client";

import type {
  GeolocationPermissionState,
  RestaurantLocation,
} from "@/lib/restaurants/types";

function supportsGeolocation() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function supportsPermissionsApi() {
  return typeof navigator !== "undefined" && "permissions" in navigator;
}

export async function readGeolocationPermissionState(): Promise<GeolocationPermissionState> {
  if (!supportsGeolocation()) {
    return "unsupported";
  }

  if (!supportsPermissionsApi()) {
    return "prompt";
  }

  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

export async function requestBrowserLocation() {
  if (!supportsGeolocation()) {
    return {
      ok: false as const,
      permissionState: "unsupported" as const,
      message: "이 브라우저에서는 위치 정보를 지원하지 않습니다.",
    };
  }

  return await new Promise<
    | { ok: true; permissionState: "granted"; location: RestaurantLocation }
    | { ok: false; permissionState: GeolocationPermissionState; message: string }
  >((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          ok: true,
          permissionState: "granted",
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve({
            ok: false,
            permissionState: "denied",
            message: "위치 권한이 거부되었습니다.",
          });
          return;
        }

        resolve({
          ok: false,
          permissionState: "error",
          message: "현재 위치를 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      },
    );
  });
}
