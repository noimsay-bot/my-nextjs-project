"use client";

import { loadGoogleMapsPlacesApi } from "@/lib/google/maps";
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

let autocompleteService: google.maps.places.AutocompleteService | null = null;
let placesService: google.maps.places.PlacesService | null = null;

function ensureServices() {
  if (typeof window === "undefined" || !window.google?.maps?.places) {
    throw new Error("구글 Places가 아직 준비되지 않았습니다.");
  }

  if (!autocompleteService) {
    autocompleteService = new window.google.maps.places.AutocompleteService();
  }

  if (!placesService) {
    placesService = new window.google.maps.places.PlacesService(document.createElement("div"));
  }

  return {
    autocompleteService,
    placesService,
  };
}

export async function searchRestaurantPredictions(query: string, location?: RestaurantLocation | null) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [] as RestaurantPlacePrediction[];
  }

  await loadGoogleMapsPlacesApi();
  const { autocompleteService } = ensureServices();

  return await new Promise<RestaurantPlacePrediction[]>((resolve, reject) => {
    autocompleteService.getPlacePredictions(
      {
        input: trimmedQuery,
        componentRestrictions: { country: "kr" },
        types: ["restaurant"],
        locationBias: location
          ? new window.google.maps.Circle({
              center: location,
              radius: 20000,
            })
          : undefined,
      },
      (predictions, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
          return;
        }

        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !predictions) {
          reject(new Error("검색 결과를 불러오지 못했습니다."));
          return;
        }

        resolve(
          predictions.map((prediction) => ({
            placeId: prediction.place_id,
            title: prediction.structured_formatting.main_text,
            subtitle: prediction.structured_formatting.secondary_text ?? "",
            description: prediction.description,
          })),
        );
      },
    );
  });
}

export async function fetchRestaurantPlaceDetails(placeId: string) {
  await loadGoogleMapsPlacesApi();
  const { placesService } = ensureServices();

  return await new Promise<RestaurantPlaceSelection>((resolve, reject) => {
    placesService.getDetails(
      {
        placeId,
        fields: ["place_id", "name", "formatted_address", "geometry"],
      },
      (place, status) => {
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) {
          reject(new Error("선택한 장소 정보를 가져오지 못했습니다."));
          return;
        }

        const lat = place.geometry?.location?.lat();
        const lng = place.geometry?.location?.lng();
        if (
          typeof place.name !== "string" ||
          typeof place.formatted_address !== "string" ||
          typeof place.place_id !== "string" ||
          typeof lat !== "number" ||
          typeof lng !== "number"
        ) {
          reject(new Error("장소 정보가 충분하지 않습니다."));
          return;
        }

        resolve({
          placeId: place.place_id,
          name: place.name,
          address: place.formatted_address,
          lat,
          lng,
        });
      },
    );
  });
}
