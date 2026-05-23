"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { RadarMapOverlay } from "@/components/weather/radar-map-overlay";
import styles from "@/components/weather/weather.module.css";

const RADAR_OFFSETS = [0, 10, 20, 30, 40, 50, 60] as const;
const RADAR_CACHE_TTL_MS = 5 * 60 * 1000;
const RADAR_CACHE_PROVIDER = "kma_apihub_radar_1h";

type RadarOffset = (typeof RADAR_OFFSETS)[number];

type RadarFrame = {
  offsetMinutes: RadarOffset;
  imageUrl: string | null;
  legendUrl: string | null;
  dateTime: string | null;
  ef: string | null;
  imageCoverageStartProjX: number | null;
  imageCoverageStartProjY: number | null;
  imageCoverageEndProjX: number | null;
  imageCoverageEndProjY: number | null;
  layerCoverageStartProjX: number | null;
  layerCoverageStartProjY: number | null;
  layerCoverageEndProjX: number | null;
  layerCoverageEndProjY: number | null;
  zoomLvl: number | null;
  nodata: boolean;
};

type RadarForecastResponse =
  | {
      status: "available";
      message: null;
      generatedAt: string;
      frame: RadarFrame;
    }
  | {
      status: "unavailable";
      message: string;
      detail: string | null;
      generatedAt: string;
      frame: RadarFrame;
    };

type RadarCacheRow = {
  base_time_kst: string;
  ef_minutes: number;
  image_url: string | null;
  legend_url: string | null;
  date_time_text: string | null;
  zoom_lvl: string | null;
  coverage: unknown;
  nodata: boolean;
  fetched_at: string;
  expires_at: string;
  error_message: string | null;
};

function getOffsetLabel(offset: RadarOffset) {
  return offset === 0 ? "현재" : `${offset}분 후`;
}

function getMissingOffsetLabels(frames: Partial<Record<RadarOffset, RadarFrame>>) {
  return RADAR_OFFSETS.filter((offset) => {
    const frame = frames[offset];
    return !frame?.imageUrl || frame.nodata;
  }).map(getOffsetLabel);
}

function isCompleteRadarFrameSet(frames: Partial<Record<RadarOffset, RadarFrame>>) {
  return getMissingOffsetLabels(frames).length === 0;
}

function getNextOffset(current: RadarOffset) {
  const currentIndex = RADAR_OFFSETS.indexOf(current);
  return RADAR_OFFSETS[(currentIndex + 1) % RADAR_OFFSETS.length] ?? RADAR_OFFSETS[0];
}

function readCoverageNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawValue = record[key];
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) return rawValue;
  if (typeof rawValue === "string" && rawValue.trim()) {
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function cacheRowToFrame(row: RadarCacheRow): RadarFrame {
  const offset = RADAR_OFFSETS.includes(row.ef_minutes as RadarOffset)
    ? (row.ef_minutes as RadarOffset)
    : 0;
  return {
    offsetMinutes: offset,
    imageUrl: row.image_url,
    legendUrl: row.legend_url,
    dateTime: row.date_time_text ?? row.base_time_kst,
    ef: String(row.ef_minutes),
    imageCoverageStartProjX: readCoverageNumber(row.coverage, "imageCoverageStartProjX"),
    imageCoverageStartProjY: readCoverageNumber(row.coverage, "imageCoverageStartProjY"),
    imageCoverageEndProjX: readCoverageNumber(row.coverage, "imageCoverageEndProjX"),
    imageCoverageEndProjY: readCoverageNumber(row.coverage, "imageCoverageEndProjY"),
    layerCoverageStartProjX: readCoverageNumber(row.coverage, "layerCoverageStartProjX"),
    layerCoverageStartProjY: readCoverageNumber(row.coverage, "layerCoverageStartProjY"),
    layerCoverageEndProjX: readCoverageNumber(row.coverage, "layerCoverageEndProjX"),
    layerCoverageEndProjY: readCoverageNumber(row.coverage, "layerCoverageEndProjY"),
    zoomLvl: row.zoom_lvl ? Number(row.zoom_lvl) : null,
    nodata: row.nodata,
  };
}

export function RadarForecastPanel() {
  const [selectedOffset, setSelectedOffset] = useState<RadarOffset>(0);
  const [frames, setFrames] = useState<Partial<Record<RadarOffset, RadarFrame>>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable" | "error">("idle");
  const [message, setMessage] = useState("기상청 API 활용신청 승인 후 레이더 영상이 표시됩니다.");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.68);
  const cacheRef = useRef<Partial<Record<RadarOffset, { frame: RadarFrame; cachedAt: number }>>>({});

  const loadCachedFrames = useCallback(async () => {
    if (!hasSupabaseEnv()) {
      setStatus("unavailable");
      setMessage("레이더 캐시를 확인하지 못했습니다. 자료 새로고침을 눌러 주세요.");
      return false;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("weather_radar_frames")
        .select(
          "base_time_kst, ef_minutes, image_url, legend_url, date_time_text, zoom_lvl, coverage, nodata, fetched_at, expires_at, error_message",
        )
        .eq("provider", RADAR_CACHE_PROVIDER)
        .gt("expires_at", new Date().toISOString())
        .order("fetched_at", { ascending: false });

      if (error || !data) {
        setStatus("unavailable");
        setMessage("레이더 캐시를 확인하지 못했습니다. 자료 새로고침을 눌러 주세요.");
        return false;
      }

      const nextFrames: Partial<Record<RadarOffset, RadarFrame>> = {};
      for (const row of data as RadarCacheRow[]) {
        const frame = cacheRowToFrame(row);
        if (frame.imageUrl && !frame.nodata && !nextFrames[frame.offsetMinutes]) {
          nextFrames[frame.offsetMinutes] = frame;
          cacheRef.current[frame.offsetMinutes] = { frame, cachedAt: new Date(row.fetched_at).getTime() };
        }
      }

      setFrames(nextFrames);
      if (isCompleteRadarFrameSet(nextFrames)) {
        setStatus("available");
        setMessage("Supabase 캐시에서 레이더 예측 7개 프레임을 불러왔습니다.");
        return true;
      }

      const missingLabels = getMissingOffsetLabels(nextFrames);
      setStatus("unavailable");
      setMessage(
        Object.keys(nextFrames).length > 0
          ? `레이더 캐시에 일부 시간대만 있습니다. 누락: ${missingLabels.join(", ")}.`
          : "레이더 캐시가 비어 있습니다. 자료 새로고침을 눌러 주세요.",
      );
      return false;
    } catch {
      setStatus("unavailable");
      setMessage("레이더 캐시를 확인하지 못했습니다. 자료 새로고침을 눌러 주세요.");
      return false;
    }
  }, []);

  async function refreshFrame(offset: RadarOffset, force = false) {
    const cached = cacheRef.current[offset];
    if (!force && cached && Date.now() - cached.cachedAt < RADAR_CACHE_TTL_MS) {
      setFrames((current) => ({ ...current, [offset]: cached.frame }));
      return cached.frame;
    }

    try {
      const response = await fetch(`/api/weather/radar-forecast?offset=${offset}`, {
        headers: {
          Accept: "application/json",
        },
      });
      const data = (await response.json()) as RadarForecastResponse | { message?: string };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.message ?? "레이더 예측 정보를 불러오지 못했습니다.");
        return null;
      }

      if ("status" in data && data.status === "available") {
        const frame = data.frame;
        cacheRef.current[offset] = { frame, cachedAt: Date.now() };
        setFrames((current) => ({ ...current, [offset]: frame }));
        setStatus("available");
        setMessage("레이더 예측 영상을 불러왔습니다.");
        setGeneratedAt(data.generatedAt);
        return frame;
      }

      if ("status" in data && data.status === "unavailable") {
        setStatus("unavailable");
        setMessage(data.detail ?? data.message);
        setGeneratedAt(data.generatedAt);
        setFrames((current) => ({ ...current, [offset]: data.frame }));
        return data.frame;
      }

      setStatus("error");
      setMessage("레이더 예측 응답 형식을 확인하지 못했습니다.");
      return null;
    } catch {
      setStatus("error");
      setMessage("레이더 예측 정보를 불러오는 중 오류가 발생했습니다.");
      return null;
    }
  }

  async function refreshAllFrames() {
    setStatus("loading");
    setMessage("");
    const refreshedFrames = await Promise.all(RADAR_OFFSETS.map((offset) => refreshFrame(offset, true)));
    const hasAvailableFrame = refreshedFrames.some((frame) => frame?.imageUrl && !frame.nodata);
    if (hasAvailableFrame) {
      const nextFrames: Partial<Record<RadarOffset, RadarFrame>> = {};
      for (const frame of refreshedFrames) {
        if (frame) nextFrames[frame.offsetMinutes] = frame;
      }
      setFrames(nextFrames);
      for (const offset of RADAR_OFFSETS) {
        const frame = nextFrames[offset];
        if (frame?.imageUrl && !frame.nodata) cacheRef.current[offset] = { frame, cachedAt: Date.now() };
      }
      if (isCompleteRadarFrameSet(nextFrames)) {
        setStatus("available");
        setMessage("레이더 예측 7개 프레임을 새로 불러왔습니다.");
        return;
      }

      setStatus("unavailable");
      setMessage(`KMA APIHub가 일부 시간대만 반환했습니다. 누락: ${getMissingOffsetLabels(nextFrames).join(", ")}.`);
      return;
    }

    setStatus("unavailable");
    setMessage("기상청 레이더 API 자료를 불러올 수 없습니다. 서버 환경변수와 APIHub 활용신청 상태를 확인해 주세요.");
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await loadCachedFrames();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCachedFrames]);

  const hasCompleteRadarFrames = isCompleteRadarFrameSet(frames);

  useEffect(() => {
    if (isPlaying && !hasCompleteRadarFrames) {
      setIsPlaying(false);
    }
  }, [hasCompleteRadarFrames, isPlaying]);

  useEffect(() => {
    if (!isPlaying || !hasCompleteRadarFrames) return;
    const timer = window.setInterval(() => {
      setSelectedOffset((current) => getNextOffset(current));
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasCompleteRadarFrames, isPlaying]);

  const selectedFrame = frames[selectedOffset];
  const selectedOffsetLabel = getOffsetLabel(selectedOffset);
  const handleRadarImageError = useCallback(() => {
    setStatus("unavailable");
    setMessage("레이더 영상을 불러오지 못했습니다. 기상청 APIHub 승인 또는 응답 상태를 확인해 주세요.");
  }, []);
  const statusClassName = status === "error" ? "status warn" : status === "available" ? "status ok" : "status note";
  const formattedGeneratedAt = useMemo(() => {
    if (!generatedAt) return "";
    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) return generatedAt;
    return date.toLocaleString("ko-KR");
  }, [generatedAt]);

  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <div className="chip">Radar</div>
            <h2>레이더 1H 강수예측</h2>
            <p className={styles.sectionDescription}>
              기상청 레이더 기반 1시간 강수예측 레이어를 표시합니다.
            </p>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={!hasCompleteRadarFrames}
            onClick={() => setIsPlaying((current) => !current)}
          >
            {isPlaying ? "정지" : "재생"}
          </button>
          <button
            type="button"
            className="btn white"
            disabled={status === "loading"}
            onClick={() => void refreshAllFrames()}
          >
            {status === "loading" ? "갱신 중" : "자료 새로고침"}
          </button>
        </div>

        <div className={styles.toolbar} aria-label="레이더 예측 시간 선택">
          {RADAR_OFFSETS.map((offset) => (
            <button
              key={offset}
              type="button"
              className={`btn ${selectedOffset === offset ? "white" : ""} ${styles.timeButton}`.trim()}
              onClick={() => {
                setIsPlaying(false);
                setSelectedOffset(offset);
              }}
            >
              {getOffsetLabel(offset)}
            </button>
          ))}
        </div>

        <div className={styles.radarMapControls}>
          <span>레이더 영상은 기상청 배경지도 없음 자료를 지도 위에 오버레이한 것입니다.</span>
          <label className={styles.opacityControl}>
            <span>투명도</span>
            <input
              type="range"
              min="35"
              max="90"
              step="5"
              value={Math.round(overlayOpacity * 100)}
              onChange={(event) => setOverlayOpacity(Number(event.target.value) / 100)}
            />
            <strong>{Math.round(overlayOpacity * 100)}%</strong>
          </label>
        </div>

        <div className={styles.mapShell}>
          {selectedFrame?.imageUrl ? (
            <RadarMapOverlay
              frame={selectedFrame}
              label={selectedOffsetLabel}
              opacity={overlayOpacity}
              onImageError={handleRadarImageError}
            />
          ) : (
            <div className={styles.radarEmptyState}>
              <strong>레이더 영상 없음</strong>
              <p className={styles.cardText}>
                현재 선택한 시간대의 레이더 예측 영상이 없습니다. 자료 새로고침 후에도 비어 있으면 APIHub 자료 제공 상태를 확인해 주세요.
              </p>
              <div className={styles.emptyMetaRow}>
                <span>{selectedOffsetLabel}</span>
                <span>자동 반복 호출 없음</span>
              </div>
            </div>
          )}
          <div className={statusClassName} aria-live="polite">
            {status === "loading" ? "레이더 예측 정보를 불러오는 중입니다." : message}
            {formattedGeneratedAt ? ` · 확인 ${formattedGeneratedAt}` : ""}
          </div>
        </div>
      </div>
    </article>
  );
}
