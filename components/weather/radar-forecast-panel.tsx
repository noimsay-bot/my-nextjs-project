"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { RadarMapOverlay } from "@/components/weather/radar-map-overlay";
import styles from "@/components/weather/weather.module.css";

const RADAR_OFFSETS = [0, 10, 20, 30, 40, 50, 60] as const;
const RADAR_CACHE_PROVIDER = "kma_apihub_radar_1h";

type RadarOffset = (typeof RADAR_OFFSETS)[number];
type RadarFrameKind = "observed" | "forecast";
type RadarFrameStatus = "available" | "nodata" | "error";
type RadarRouteStatus =
  | "available"
  | "stale_available"
  | "refreshing"
  | "hsr_permission_required"
  | "unavailable";

type RadarFrame = {
  offsetMinutes: RadarOffset;
  frameKind: RadarFrameKind;
  sourceEndpoint: string;
  status: RadarFrameStatus;
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
  errorMessage: string | null;
  hasVisibleRadarEcho?: boolean | null;
  imageStats?: {
    hasVisiblePixels?: boolean | null;
  } | null;
};

type RadarFrameSet = {
  id: string | null;
  provider: string;
  baseTimeKst: string;
  qpf: string;
  fetchedAt: string;
  expiresAt: string;
  isComplete: boolean;
  isActive: boolean;
  missingFrames: RadarOffset[];
  frames: RadarFrame[];
};

type RadarAttempt = {
  baseTimeKst: string | null;
  qpf: string | null;
  missingFrames: RadarOffset[];
  availableFrames: number;
  errorMessage: string | null;
  debug: unknown;
};

type RadarForecastResponse = {
  status: RadarRouteStatus;
  message: string;
  generatedAt: string;
  set: RadarFrameSet | null;
  latestAttempt: RadarAttempt | null;
};

type RadarFrameSetRow = {
  id: string;
  provider: string;
  base_time_kst: string;
  qpf: string;
  expected_frames: number;
  available_frames: number;
  missing_frames: number[] | null;
  is_complete: boolean;
  is_active: boolean;
  fetched_at: string;
  expires_at: string;
  error_message: string | null;
  debug: unknown;
};

type RadarCacheRow = {
  provider: string;
  base_time_kst: string;
  ef_minutes: number;
  qpf: string;
  image_url: string | null;
  legend_url: string | null;
  date_time_text: string | null;
  zoom_lvl: string | null;
  coverage: unknown;
  nodata: boolean;
  fetched_at: string;
  expires_at: string;
  error_message: string | null;
  frame_kind: string | null;
  frame_set_id: string | null;
  source_endpoint: string | null;
  status: string | null;
  debug?: unknown;
};

function getOffsetLabel(offset: RadarOffset) {
  return offset === 0 ? "현재" : `+${offset}분`;
}

function normalizeOffset(value: number | string | null | undefined): RadarOffset {
  const numeric = Number(value);
  return RADAR_OFFSETS.includes(numeric as RadarOffset) ? (numeric as RadarOffset) : 0;
}

function getMissingOffsetLabels(frames: Partial<Record<RadarOffset, RadarFrame>>) {
  return RADAR_OFFSETS.filter((offset) => {
    const frame = frames[offset];
    return !frame?.imageUrl || frame.nodata || frame.status !== "available";
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

function readDebugImageStats(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const debug = value as Record<string, unknown>;
  const imageStats = debug.imageStats;
  if (!imageStats || typeof imageStats !== "object" || Array.isArray(imageStats)) return null;
  const stats = imageStats as Record<string, unknown>;
  return typeof stats.hasVisiblePixels === "boolean" ? stats.hasVisiblePixels : null;
}

function readFrameImageStats(frame: RadarFrame) {
  return typeof frame.imageStats?.hasVisiblePixels === "boolean" ? frame.imageStats.hasVisiblePixels : null;
}

function cacheRowToFrame(row: RadarCacheRow): RadarFrame {
  const offset = normalizeOffset(row.ef_minutes);
  const status: RadarFrameStatus = row.status === "available"
    ? "available"
    : row.status === "error"
      ? "error"
      : "nodata";
  const nodata = row.nodata || !row.image_url || status !== "available";
  return {
    offsetMinutes: offset,
    frameKind: row.frame_kind === "observed" ? "observed" : "forecast",
    sourceEndpoint: row.source_endpoint ?? "",
    status: nodata ? "nodata" : status,
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
    nodata,
    errorMessage: row.error_message,
    hasVisibleRadarEcho: readDebugImageStats(row.debug),
  };
}

function frameSetFromRows(setRow: RadarFrameSetRow, frameRows: RadarCacheRow[]): RadarFrameSet {
  return {
    id: setRow.id,
    provider: setRow.provider,
    baseTimeKst: setRow.base_time_kst,
    qpf: setRow.qpf,
    fetchedAt: setRow.fetched_at,
    expiresAt: setRow.expires_at,
    isComplete: setRow.is_complete,
    isActive: setRow.is_active,
    missingFrames: (setRow.missing_frames ?? []).map(normalizeOffset),
    frames: frameRows.map(cacheRowToFrame).sort((left, right) => left.offsetMinutes - right.offsetMinutes),
  };
}

function framesToRecord(frameSet: RadarFrameSet) {
  const nextFrames: Partial<Record<RadarOffset, RadarFrame>> = {};
  for (const frame of frameSet.frames) {
    if (frame.imageUrl && !frame.nodata && frame.status === "available") {
      nextFrames[frame.offsetMinutes] = {
        ...frame,
        hasVisibleRadarEcho: frame.hasVisibleRadarEcho ?? readFrameImageStats(frame),
      };
    }
  }
  return nextFrames;
}

function hasPlayableCompleteSet(frameSet: RadarFrameSet | null) {
  if (!frameSet?.isComplete) return false;
  return isCompleteRadarFrameSet(framesToRecord(frameSet));
}

function formatKstTimestamp(value: string | null) {
  if (!value) return "";
  if (/^\d{12}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)} KST`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function missingLabelsFromAttempt(attempt: RadarAttempt | null) {
  if (!attempt?.missingFrames.length) return "";
  return attempt.missingFrames.map(getOffsetLabel).join(", ");
}

export function RadarForecastPanel() {
  const [selectedOffset, setSelectedOffset] = useState<RadarOffset>(0);
  const [frames, setFrames] = useState<Partial<Record<RadarOffset, RadarFrame>>>({});
  const [activeSet, setActiveSet] = useState<RadarFrameSet | null>(null);
  const [latestAttempt, setLatestAttempt] = useState<RadarAttempt | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable" | "warning" | "error">("idle");
  const [message, setMessage] = useState("기상청 API 활용신청 승인 후 레이더 영상이 표시됩니다.");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const framesRef = useRef<Partial<Record<RadarOffset, RadarFrame>>>({});
  const autoRefreshStartedRef = useRef(false);

  const applyCompleteFrameSet = useCallback((frameSet: RadarFrameSet) => {
    if (!hasPlayableCompleteSet(frameSet)) return false;
    const nextFrames = framesToRecord(frameSet);
    framesRef.current = nextFrames;
    setFrames(nextFrames);
    setActiveSet(frameSet);
    setSelectedOffset((current) => (nextFrames[current] ? current : 0));
    return true;
  }, []);

  const loadCachedFrames = useCallback(async () => {
    if (!hasSupabaseEnv()) {
      setStatus("unavailable");
      setMessage("레이더 세트 캐시를 확인하지 못했습니다. 자료 새로고침을 눌러 주세요.");
      return false;
    }

    try {
      const supabase = createClient();
      const { data: setRow, error: setError } = await supabase
        .from("weather_radar_frame_sets")
        .select(
          "id, provider, base_time_kst, qpf, expected_frames, available_frames, missing_frames, is_complete, is_active, fetched_at, expires_at, error_message, debug",
        )
        .eq("provider", RADAR_CACHE_PROVIDER)
        .eq("is_active", true)
        .eq("is_complete", true)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle<RadarFrameSetRow>();

      if (setError || !setRow) {
        setStatus("unavailable");
        setMessage("active 레이더 완성 세트가 없습니다. 자료 새로고침을 눌러 주세요.");
        return false;
      }

      const { data: frameRows, error: frameError } = await supabase
        .from("weather_radar_frames")
        .select(
          "provider, base_time_kst, ef_minutes, qpf, image_url, legend_url, date_time_text, zoom_lvl, coverage, nodata, fetched_at, expires_at, error_message, frame_kind, frame_set_id, source_endpoint, status, debug",
        )
        .eq("provider", RADAR_CACHE_PROVIDER)
        .eq("frame_set_id", setRow.id)
        .order("ef_minutes", { ascending: true });

      if (frameError || !frameRows) {
        setStatus("unavailable");
        setMessage("active 레이더 세트의 프레임을 확인하지 못했습니다. 자료 새로고침을 눌러 주세요.");
        return false;
      }

      const frameSet = frameSetFromRows(setRow, frameRows as RadarCacheRow[]);
      if (!applyCompleteFrameSet(frameSet)) {
        setStatus("unavailable");
        setMessage("active 레이더 세트가 7개 프레임 완성 조건을 만족하지 않습니다. 자료 새로고침을 눌러 주세요.");
        return false;
      }

      setStatus("available");
      setMessage("Supabase 캐시에서 active 레이더 완성 세트를 불러왔습니다.");
      setGeneratedAt(frameSet.fetchedAt);
      return true;
    } catch {
      setStatus("unavailable");
      setMessage("레이더 세트 캐시를 확인하지 못했습니다. 자료 새로고침을 눌러 주세요.");
      return false;
    }
  }, [applyCompleteFrameSet]);

  const refreshAllFrames = useCallback(async (options?: { auto?: boolean }) => {
    setStatus("loading");
    setMessage(options?.auto ? "레이더 현재 세트를 자동 확인하는 중입니다." : "레이더 세트를 확인하는 중입니다.");

    try {
      const response = await fetch("/api/weather/radar-forecast?refresh=1", {
        headers: {
          Accept: "application/json",
        },
      });
      const data = (await response.json()) as RadarForecastResponse | { message?: string };

      if (!response.ok || !("status" in data)) {
        setStatus("error");
        setMessage(data.message ?? "레이더 세트 갱신 응답을 확인하지 못했습니다.");
        return;
      }

      setGeneratedAt(data.generatedAt);
      setLatestAttempt(data.latestAttempt);

      if (data.set && applyCompleteFrameSet(data.set)) {
        setStatus(data.status === "available" ? "available" : "warning");
        setMessage(data.message);
        return;
      }

      if (isCompleteRadarFrameSet(framesRef.current)) {
        setStatus("warning");
        setMessage(data.message || "최신 레이더 세트가 아직 완성되지 않아 이전 완성 자료를 표시합니다.");
        return;
      }

      setStatus(data.status === "hsr_permission_required" ? "warning" : "unavailable");
      setMessage(data.message || "현재 사용할 수 있는 완성 레이더 세트가 없습니다.");
    } catch {
      if (isCompleteRadarFrameSet(framesRef.current)) {
        setStatus("warning");
        setMessage("레이더 세트 갱신 중 오류가 발생해 이전 완성 자료를 표시합니다.");
        return;
      }

      setStatus("error");
      setMessage("레이더 세트 갱신 중 오류가 발생했습니다.");
    }
  }, [applyCompleteFrameSet]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadCachedFrames();
      if (cancelled || autoRefreshStartedRef.current) return;
      autoRefreshStartedRef.current = true;
      await refreshAllFrames({ auto: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCachedFrames, refreshAllFrames]);

  const hasCompleteRadarFrames = isCompleteRadarFrameSet(frames);

  // Warm the browser cache with every frame image as soon as a complete set is
  // applied, so pressing 재생 plays the frames back-to-back without the map
  // flashing empty while a mid-sequence image is still being fetched.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const preloaded: HTMLImageElement[] = [];
    for (const offset of RADAR_OFFSETS) {
      const url = frames[offset]?.imageUrl;
      if (!url) continue;
      const image = new window.Image();
      image.referrerPolicy = "no-referrer";
      image.src = url;
      preloaded.push(image);
    }
    return () => {
      for (const image of preloaded) {
        image.src = "";
      }
    };
  }, [frames]);

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

  const selectedFrame = hasCompleteRadarFrames ? frames[selectedOffset] : null;
  const selectedOffsetLabel = getOffsetLabel(selectedOffset);
  const handleRadarImageError = useCallback(() => {
    setStatus("warning");
    setMessage("active 레이더 세트의 이미지 로드에 실패했습니다. APIHub 이미지 접근 상태를 확인해 주세요.");
  }, []);
  const statusClassName = status === "error" || status === "warning"
    ? "status warn"
    : status === "available"
      ? "status ok"
      : "status note";
  const formattedGeneratedAt = useMemo(() => formatKstTimestamp(generatedAt), [generatedAt]);
  const activeBaseTimeText = useMemo(() => formatKstTimestamp(activeSet?.baseTimeKst ?? null), [activeSet]);
  const latestMissingLabels = missingLabelsFromAttempt(latestAttempt);

  return (
    <article className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <div className="chip">Radar</div>
            <h2>레이더 1H 강수예측</h2>
            <p className={styles.sectionDescription}>
              현재는 HSR 실황, 예측은 1H예측 완성 세트를 표시합니다.
            </p>
          </div>
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
          <button
            type="button"
            className={`btn primary ${styles.playButton}`}
            disabled={!hasCompleteRadarFrames}
            onClick={() => setIsPlaying((current) => !current)}
          >
            {isPlaying ? "정지" : "재생"}
          </button>
          {RADAR_OFFSETS.map((offset) => (
            <button
              key={offset}
              type="button"
              className={`btn ${selectedOffset === offset ? "white" : ""} ${styles.timeButton}`.trim()}
              disabled={!hasCompleteRadarFrames}
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
              min="15"
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
              hasVisibleRadarEcho={selectedFrame.hasVisibleRadarEcho}
              onImageError={handleRadarImageError}
            />
          ) : (
            <div className={styles.radarEmptyState}>
              <strong>레이더 영상 없음</strong>
              <p className={styles.cardText}>
                active complete 레이더 세트가 없거나 현재 선택한 시간대의 영상이 없습니다.
              </p>
              <div className={styles.emptyMetaRow}>
                <span>{selectedOffsetLabel}</span>
                <span>자동 반복 호출 없음</span>
              </div>
            </div>
          )}
          <div className={statusClassName} aria-live="polite">
            {status === "loading" ? "레이더 세트 정보를 불러오는 중입니다." : message}
            {formattedGeneratedAt ? ` · 확인 ${formattedGeneratedAt}` : ""}
          </div>
          {activeSet ? (
            <div className="status note">
              active 기준시각 {activeBaseTimeText || activeSet.baseTimeKst} · {activeSet.qpf} · 7/7 프레임
            </div>
          ) : null}
          {latestAttempt ? (
            <div className={latestMissingLabels ? "status warn" : "status note"}>
              최근 갱신 시도 {latestAttempt.baseTimeKst ? formatKstTimestamp(latestAttempt.baseTimeKst) : "기준시각 없음"} ·{" "}
              {latestAttempt.availableFrames}/7 프레임
              {latestMissingLabels ? ` · 누락 프레임: ${latestMissingLabels}` : " · 누락 프레임 없음"}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
