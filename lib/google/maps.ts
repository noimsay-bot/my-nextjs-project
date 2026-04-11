"use client";

const GOOGLE_MAPS_SCRIPT_ID = "jtbc-google-maps-js";

let googleMapsPromise: Promise<typeof window.google> | null = null;

function getGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function hasGoogleMapsApiKey() {
  return getGoogleMapsApiKey().length > 0;
}

export async function loadGoogleMapsPlacesApi() {
  if (typeof window === "undefined") {
    throw new Error("Google Places는 브라우저에서만 사용할 수 있습니다.");
  }

  if (window.google?.maps?.places) {
    return window.google;
  }

  if (!hasGoogleMapsApiKey()) {
    throw new Error(
      "구글 장소 검색을 쓰려면 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 환경변수를 설정해 주세요.",
    );
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise<typeof window.google>((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.google?.maps?.places) {
          resolve(window.google);
          return;
        }
        reject(new Error("구글 Places 스크립트를 불러오지 못했습니다."));
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("구글 Places 스크립트 로딩에 실패했습니다."));
      });
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: getGoogleMapsApiKey(),
      libraries: "places",
      language: "ko",
      region: "KR",
      loading: "async",
    });
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps?.places) {
        resolve(window.google);
        return;
      }
      reject(new Error("구글 Places 스크립트를 불러오지 못했습니다."));
    };
    script.onerror = () => {
      reject(new Error("구글 Places 스크립트 로딩에 실패했습니다."));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    console.error("Google Places load error:", error);
    googleMapsPromise = null;
    throw error;
  });

  return googleMapsPromise;
}
