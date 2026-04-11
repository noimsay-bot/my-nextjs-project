"use client";

const GOOGLE_MAPS_SCRIPT_ID = "jtbc-google-maps-js";

let googleMapsPromise: Promise<typeof window.google> | null = null;
let googleMapsPlacesLibraryPromise: Promise<google.maps.PlacesLibrary> | null = null;

function getGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function hasGoogleMapsApiKey() {
  return getGoogleMapsApiKey().length > 0;
}

async function loadGoogleMapsApi() {
  if (typeof window === "undefined") {
    throw new Error("Google Places는 브라우저에서만 사용할 수 있습니다.");
  }

  if (window.google?.maps) {
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
      if (window.google?.maps) {
        resolve(window.google);
        return;
      }

      const handleLoad = () => {
        if (window.google?.maps) {
          resolve(window.google);
          return;
        }
        reject(new Error("구글 Places 스크립트를 불러오지 못했습니다."));
      };
      const handleError = () => {
        reject(new Error("구글 Places 스크립트 로딩에 실패했습니다."));
      };
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: getGoogleMapsApiKey(),
      language: "ko",
      region: "KR",
      loading: "async",
      v: "weekly",
    });
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      if (window.google?.maps) {
        resolve(window.google);
        return;
      }
      reject(new Error("구글 Maps 스크립트는 로드됐지만 Places 초기화에 필요한 importLibrary를 찾지 못했습니다."));
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

export async function loadGoogleMapsPlacesLibrary() {
  const google = await loadGoogleMapsApi();

  if (
    window.google?.maps?.places?.AutocompleteSuggestion &&
    window.google?.maps?.places?.Place &&
    window.google?.maps?.places?.AutocompleteSessionToken
  ) {
    return window.google.maps.places as unknown as google.maps.PlacesLibrary;
  }

  if (googleMapsPlacesLibraryPromise) {
    return googleMapsPlacesLibraryPromise;
  }

  googleMapsPlacesLibraryPromise = google.maps
    .importLibrary("places")
    .then((library) => {
      const placesLibrary = library as google.maps.PlacesLibrary;
      if (
        !placesLibrary.AutocompleteSuggestion ||
        !placesLibrary.Place ||
        !placesLibrary.AutocompleteSessionToken
      ) {
        throw new Error("구글 Places 라이브러리를 초기화하지 못했습니다.");
      }
      return placesLibrary;
    })
    .catch((error) => {
      console.error("Google Places library error:", error);
      googleMapsPlacesLibraryPromise = null;
      throw error;
    });

  return googleMapsPlacesLibraryPromise;
}

export async function loadGoogleMapsPlacesApi() {
  await loadGoogleMapsApi();
  await loadGoogleMapsPlacesLibrary();
  return window.google;
}
