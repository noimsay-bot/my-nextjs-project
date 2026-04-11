"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { NearbyRestaurant, RestaurantLocation } from "@/lib/restaurants/types";

const DEFAULT_CENTER: RestaurantLocation = { lat: 37.5665, lng: 126.978 };
const NEARBY_VIEW_DISTANCE_METERS = 3_000;
const NEARBY_VIEW_LIMIT = 8;

type LeafletModule = typeof import("leaflet");

export function RestaurantsMap({
  currentLocation,
  restaurants,
  onSelectRestaurant,
}: {
  currentLocation: RestaurantLocation | null;
  restaurants: NearbyRestaurant[];
  onSelectRestaurant?: (restaurant: NearbyRestaurant) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      if (!containerRef.current || mapRef.current) return;

      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const layerGroup = L.layerGroup().addTo(map);
      mapRef.current = map;
      layerGroupRef.current = layerGroup;

      window.setTimeout(() => {
        map.invalidateSize();
      }, 0);
    }

    void initializeMap();

    return () => {
      cancelled = true;
      layerGroupRef.current?.clearLayers();
      layerGroupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!L || !map || !layerGroup) return;

    layerGroup.clearLayers();

    const points: [number, number][] = [];

    if (currentLocation) {
      points.push([currentLocation.lat, currentLocation.lng]);
      L.circleMarker([currentLocation.lat, currentLocation.lng], {
        radius: 10,
        weight: 3,
        color: "#ffffff",
        fillColor: "#8fd6dd",
        fillOpacity: 0.95,
      })
        .bindPopup("현재 위치")
        .addTo(layerGroup);
    }

    restaurants.forEach((restaurant) => {
      points.push([restaurant.lat, restaurant.lng]);
      const marker = L.circleMarker([restaurant.lat, restaurant.lng], {
        radius: 8,
        weight: 2,
        color: "#f8fafc",
        fillColor: "#f97316",
        fillOpacity: 0.88,
      });
      marker.bindPopup(
        `<strong>${restaurant.name}</strong>${restaurant.address ? `<br/>${restaurant.address}` : ""}`,
      );
      marker.on("click", () => {
        if (onSelectRestaurant) {
          onSelectRestaurant(restaurant);
          return;
        }
        router.push(`/restaurants/${restaurant.id}`);
      });
      marker.addTo(layerGroup);
    });

    if (points.length === 0) {
      map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);
      return;
    }

    if (currentLocation) {
      const nearbyPoints = restaurants
        .filter((restaurant) => restaurant.distanceMeters !== null && restaurant.distanceMeters <= NEARBY_VIEW_DISTANCE_METERS)
        .slice(0, NEARBY_VIEW_LIMIT)
        .map<[number, number]>((restaurant) => [restaurant.lat, restaurant.lng]);

      if (nearbyPoints.length > 0) {
        map.fitBounds([[currentLocation.lat, currentLocation.lng], ...nearbyPoints], {
          padding: [30, 30],
          maxZoom: 15,
        });
        return;
      }

      map.setView([currentLocation.lat, currentLocation.lng], 15);
      return;
    }

    if (points.length === 1) {
      const [lat, lng] = points[0] ?? [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];
      map.setView([lat, lng], currentLocation ? 15 : 14);
      return;
    }

    map.fitBounds(points, {
      padding: [30, 30],
    });
  }, [currentLocation, onSelectRestaurant, restaurants, router]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        minHeight: 380,
        height: "min(60vh, 520px)",
        borderRadius: 24,
        overflow: "hidden",
        border: "1px solid var(--line)",
        boxShadow: "0 12px 28px rgba(6, 10, 18, 0.18)",
      }}
    />
  );
}
