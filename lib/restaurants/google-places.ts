"use client";

import { loadGoogleMapsPlacesApi, loadGoogleMapsPlacesLibrary } from "@/lib/google/maps";
import type { RestaurantLocation } from "@/lib/restaurants/types";

export interface RestaurantPlacePrediction {
  placeId: string;
  title: string;
  subtitle: string;
  description: string;
}

export interface RestaurantPlaceSelection {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export type RestaurantPlaceSearchMode = "global" | "nearby";

let autocompleteSessionToken: google.maps.places.AutocompleteSessionToken | null = null;

async function loadPlacesContext() {
  const google = await loadGoogleMapsPlacesApi();
  const placesLibrary = await loadGoogleMapsPlacesLibrary();
  return {
    google,
    placesLibrary,
  };
}

function getAutocompleteSessionToken(placesLibrary: google.maps.PlacesLibrary) {
  if (!autocompleteSessionToken) {
    autocompleteSessionToken = new placesLibrary.AutocompleteSessionToken();
  }

  return autocompleteSessionToken;
}

function resetAutocompleteSessionToken() {
  autocompleteSessionToken = null;
}

function formatPredictionDescription(prediction: google.maps.places.PlacePrediction) {
  const title = prediction.mainText?.text?.trim() ?? "";
  const subtitle = prediction.secondaryText?.text?.trim() ?? "";
  if (!title) {
    return prediction.text?.text?.trim() ?? "";
  }
  if (!subtitle) {
    return title;
  }
  return `${title} · ${subtitle}`;
}

function ensureLocationBias(location?: RestaurantLocation | null) {
  if (!location) {
    return undefined;
  }

  return {
    center: location,
    radius: 20_000,
  } satisfies google.maps.CircleLiteral;
}

function ensurePlaceSelection(place: google.maps.places.Place): RestaurantPlaceSelection {
  const lat = place.location?.lat();
  const lng = place.location?.lng();
  if (
    typeof place.displayName !== "string" ||
    typeof place.formattedAddress !== "string" ||
    typeof place.id !== "string" ||
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    throw new Error("장소 정보가 충분하지 않습니다.");
  }

  return {
    placeId: place.id,
    name: place.displayName,
    address: place.formattedAddress,
    lat,
    lng,
  };
}

function ensurePlacesReady() {
  if (typeof window === "undefined" || !window.google?.maps?.importLibrary) {
    throw new Error("구글 Places가 아직 준비되지 않았습니다.");
  }
}

export async function searchRestaurantPredictions(query: string, location?: RestaurantLocation | null) {
  return searchRestaurantPredictionsWithMode(query, location, "global");
}

export async function searchRestaurantPredictionsWithMode(
  query: string,
  location?: RestaurantLocation | null,
  mode: RestaurantPlaceSearchMode = "global",
) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [] as RestaurantPlacePrediction[];
  }

  ensurePlacesReady();

  try {
    const { placesLibrary } = await loadPlacesContext();
    const sessionToken = getAutocompleteSessionToken(placesLibrary);
    const useNearbyBias = mode === "nearby" && !!location;
    const { suggestions } = await placesLibrary.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: trimmedQuery,
      includedPrimaryTypes: ["restaurant"],
      language: "ko",
      locationBias: useNearbyBias ? ensureLocationBias(location) : undefined,
      origin: useNearbyBias ? (location ?? undefined) : undefined,
      sessionToken,
    });

    return suggestions
      .map((suggestion) => suggestion.placePrediction)
      .filter((prediction): prediction is google.maps.places.PlacePrediction => Boolean(prediction))
      .map((prediction) => ({
        placeId: prediction.placeId,
        title: prediction.mainText?.text ?? prediction.text?.text ?? "이름 없음",
        subtitle: prediction.secondaryText?.text ?? "",
        description: formatPredictionDescription(prediction),
      }));
  } catch (error) {
    console.error("Google Places prediction error:", error);
    throw new Error("구글 Places 검색 결과를 불러오지 못했습니다.");
  }
}

export async function fetchRestaurantPlaceDetails(placeId: string) {
  ensurePlacesReady();

  try {
    const { placesLibrary } = await loadPlacesContext();
    const place = new placesLibrary.Place({
      id: placeId,
      requestedLanguage: "ko",
    });
    const details = await place.fetchFields({
      fields: ["displayName", "formattedAddress", "location", "id"],
    });
    const selection = ensurePlaceSelection(details.place);
    resetAutocompleteSessionToken();
    return selection;
  } catch (error) {
    console.error("Google Places detail error:", error);
    throw new Error("선택한 장소 상세 정보를 불러오지 못했습니다.");
  }
}
