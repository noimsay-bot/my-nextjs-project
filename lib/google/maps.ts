"use client";

const GOOGLE_MAPS_SCRIPT_ID = "jtbc-google-maps-js";
const GOOGLE_MAPS_CALLBACK_NAME = "__jtbcGoogleMapsInit";

let googleMapsPromise: Promise<typeof window.google> | null = null;
let googleMapsPlacesLibraryPromise: Promise<google.maps.PlacesLibrary> | null = null;

function getGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function hasGoogleMapsApiKey() {
  return getGoogleMapsApiKey().length > 0;
}

function getGoogleLoaderState() {
  return {
    hasGoogle: typeof window !== "undefined" && !!window.google,
    hasMaps: typeof window !== "undefined" && !!window.google?.maps,
    importLibraryType:
      typeof window === "undefined" ? "undefined" : typeof window.google?.maps?.importLibrary,
  };
}

function logGoogleLoaderError(label: string, error: unknown) {
  console.error(label, error);
  console.error("Google loader state", getGoogleLoaderState());
}

function ensureGoogleMapsBootstrapLoader() {
  if (typeof window === "undefined") {
    throw new Error("Google Places는 브라우저에서만 사용할 수 있습니다.");
  }

  if (!hasGoogleMapsApiKey()) {
    throw new Error(
      "구글 장소 검색을 쓰려면 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 환경변수를 설정해 주세요.",
    );
  }

  if (typeof window.google?.maps?.importLibrary === "function") {
    return;
  }

  const googleNamespace = (window.google ??= {} as typeof window.google);
  const mapsNamespace = (googleNamespace.maps ??= {} as typeof google.maps);
  if (typeof mapsNamespace.importLibrary === "function") {
    return;
  }

  let loaderPromise: Promise<void> | null = null;
  const requestedLibraries = new Set<string>();

  const loadScript = () => {
    if (loaderPromise) {
      return loaderPromise;
    }

    loaderPromise = new Promise<void>((resolve, reject) => {
      const previousScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
      if (previousScript) {
        previousScript.remove();
      }

      const mapsNamespaceWithCallback = mapsNamespace as typeof mapsNamespace & Record<string, unknown>;
      mapsNamespaceWithCallback[GOOGLE_MAPS_CALLBACK_NAME] = () => {
        const script = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
        if (script) {
          script.dataset.loaded = "true";
        }
        resolve();
      };

      const script = document.createElement("script");
      const params = new URLSearchParams({
        key: getGoogleMapsApiKey(),
        v: "weekly",
        language: "ko",
        region: "KR",
        loading: "async",
        callback: `google.maps.${GOOGLE_MAPS_CALLBACK_NAME}`,
      });

      if (requestedLibraries.size > 0) {
        params.set("libraries", Array.from(requestedLibraries).join(","));
      }

      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        loaderPromise = null;
        delete mapsNamespaceWithCallback[GOOGLE_MAPS_CALLBACK_NAME];
        reject(new Error("구글 Places 스크립트 로딩에 실패했습니다."));
      };

      document.head.appendChild(script);
    }).then(() => undefined);

    return loaderPromise;
  };

  mapsNamespace.importLibrary = ((libraryName: string, ...args: unknown[]) => {
    requestedLibraries.add(libraryName);
    return loadScript().then(() => {
      if (typeof window.google?.maps?.importLibrary !== "function") {
        throw new Error("구글 Maps 스크립트는 로드됐지만 importLibrary를 찾지 못했습니다.");
      }

      return window.google.maps.importLibrary(libraryName, ...(args as []));
    });
  }) as typeof google.maps.importLibrary;
}

async function loadGoogleMapsApi() {
  if (typeof window === "undefined") {
    throw new Error("Google Places는 브라우저에서만 사용할 수 있습니다.");
  }

  if (typeof window.google?.maps?.importLibrary === "function") {
    return window.google;
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = Promise.resolve()
    .then(() => {
      ensureGoogleMapsBootstrapLoader();
      return window.google.maps.importLibrary("core");
    })
    .then(() => {
      if (!window.google?.maps || typeof window.google.maps.importLibrary !== "function") {
        throw new Error("구글 Maps 스크립트를 불러오지 못했습니다.");
      }

      return window.google;
    })
    .catch((error) => {
      logGoogleLoaderError("Google Places load error:", error);
      googleMapsPromise = null;
      throw error;
    });

  return googleMapsPromise;
}

export async function loadGoogleMapsPlacesLibrary() {
  await loadGoogleMapsApi();

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

  googleMapsPlacesLibraryPromise = window.google.maps
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
      logGoogleLoaderError("Google Places library error:", error);
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
