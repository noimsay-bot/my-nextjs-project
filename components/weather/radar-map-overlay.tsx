"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  WEATHER_MAP_CENTER,
  WEATHER_MAP_DEFAULT_ZOOM,
  WEATHER_MAP_TILE,
} from "@/lib/weather/map-config";
import { getRadarOverlayBounds, type RadarProjectionInput } from "@/lib/weather/radar-projection";
import styles from "@/components/weather/weather.module.css";

type RadarMapOverlayProps = {
  frame: RadarProjectionInput & {
    imageUrl: string | null;
    legendUrl: string | null;
  };
  label: string;
  opacity: number;
  onImageError?: () => void;
};

type LeafletModule = typeof import("leaflet");

export function RadarMapOverlay({ frame, label, opacity, onImageError }: RadarMapOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const overlayRef = useRef<import("leaflet").ImageOverlay | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const overlayBounds = useMemo(() => getRadarOverlayBounds(frame), [frame]);

  useEffect(() => {
    let cancelled = false;
    let initializedMap: import("leaflet").Map | null = null;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [WEATHER_MAP_CENTER.lat, WEATHER_MAP_CENTER.lng],
        zoom: WEATHER_MAP_DEFAULT_ZOOM,
        minZoom: WEATHER_MAP_TILE.minZoom,
        maxZoom: WEATHER_MAP_TILE.maxZoom,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
      });

      L.tileLayer(WEATHER_MAP_TILE.url, {
        attribution: WEATHER_MAP_TILE.attribution,
        minZoom: WEATHER_MAP_TILE.minZoom,
        maxZoom: WEATHER_MAP_TILE.maxZoom,
      }).addTo(map);

      initializedMap = map;
      mapRef.current = map;
      setMapReady(true);
      window.setTimeout(() => map.invalidateSize(), 0);
    }

    void initMap();

    return () => {
      cancelled = true;
      setMapReady(false);
      if (initializedMap) {
        initializedMap.remove();
      }
      if (mapRef.current === initializedMap) {
        mapRef.current = null;
      }
      overlayRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !frame.imageUrl || !overlayBounds) return;

    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    const overlay = L.imageOverlay(frame.imageUrl, overlayBounds, {
      opacity,
      interactive: false,
      crossOrigin: false,
      alt: `레이더 1H 강수예측 ${label}`,
    }).addTo(map);
    overlay.getElement()?.setAttribute("referrerpolicy", "no-referrer");

    overlay.once("error", () => {
      onImageError?.();
    });

    overlayRef.current = overlay;
    map.setMaxBounds(overlayBounds);
    map.fitBounds(overlayBounds, { padding: [0, 0], animate: false });

    return () => {
      overlay.remove();
      if (overlayRef.current === overlay) {
        overlayRef.current = null;
      }
    };
  }, [frame.imageUrl, label, onImageError, opacity, overlayBounds]);

  useEffect(() => {
    overlayRef.current?.setOpacity(opacity);
  }, [opacity]);

  if (!frame.imageUrl) return null;

  if (!overlayBounds) {
    return (
      <div className={styles.mapViewport}>
        <span className={styles.mapBadge}>{label}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.mapImage}
          src={frame.imageUrl}
          alt={`레이더 1H 강수예측 ${label}`}
          referrerPolicy="no-referrer"
          onError={onImageError}
        />
        {frame.legendUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.mapLegend}
            src={frame.legendUrl}
            alt="레이더 강수강도 범례"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <div className={styles.mapOverlayNotice}>
          레이더 오버레이 좌표를 확정하지 못해 원본 영상만 표시합니다.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.mapViewport}>
      <div ref={containerRef} className={styles.leafletMap} aria-label={`지도 기반 레이더 1H 강수예측 ${label}`} />
      <span className={styles.mapBadge}>{label}</span>
      {!mapReady ? <div className={styles.mapLoading}>지도 준비 중</div> : null}
      {frame.legendUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.mapLegend}
          src={frame.legendUrl}
          alt="레이더 강수강도 범례"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
    </div>
  );
}
