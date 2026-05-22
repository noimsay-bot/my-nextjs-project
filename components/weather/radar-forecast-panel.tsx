"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/components/weather/weather.module.css";

const RADAR_OFFSETS = [0, 10, 20, 30, 40, 50, 60] as const;
const RADAR_CACHE_TTL_MS = 5 * 60 * 1000;

type RadarOffset = (typeof RADAR_OFFSETS)[number];

type RadarFrame = {
  offsetMinutes: RadarOffset;
  imageUrl: string | null;
};

type RadarForecastResponse =
  | {
      status: "available";
      message: null;
      generatedAt: string;
      baseTime: string;
      frame: RadarFrame;
    }
  | {
      status: "unavailable";
      message: string;
      detail: string | null;
      generatedAt: string;
      frame: RadarFrame;
    };

function getOffsetLabel(offset: RadarOffset) {
  return offset === 0 ? "현재" : `${offset}분 후`;
}

function getNextOffset(current: RadarOffset) {
  const currentIndex = RADAR_OFFSETS.indexOf(current);
  return RADAR_OFFSETS[(currentIndex + 1) % RADAR_OFFSETS.length] ?? RADAR_OFFSETS[0];
}

export function RadarForecastPanel() {
  const [selectedOffset, setSelectedOffset] = useState<RadarOffset>(0);
  const [frames, setFrames] = useState<Partial<Record<RadarOffset, RadarFrame>>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "available" | "unavailable" | "error">("idle");
  const [message, setMessage] = useState("기상청 API 활용신청 승인 후 레이더 영상이 표시됩니다.");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const cacheRef = useRef<Partial<Record<RadarOffset, { frame: RadarFrame; cachedAt: number }>>>({});

  async function loadFrame(offset: RadarOffset, force = false) {
    const cached = cacheRef.current[offset];
    if (!force && cached && Date.now() - cached.cachedAt < RADAR_CACHE_TTL_MS) {
      setFrames((current) => ({ ...current, [offset]: cached.frame }));
      return;
    }

    setStatus("loading");
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
        return;
      }

      if ("status" in data && data.status === "available") {
        cacheRef.current[offset] = { frame: data.frame, cachedAt: Date.now() };
        setFrames((current) => ({ ...current, [offset]: data.frame }));
        setStatus("available");
        setMessage("레이더 예측 영상을 불러왔습니다.");
        setGeneratedAt(data.generatedAt);
        return;
      }

      if ("status" in data && data.status === "unavailable") {
        setStatus("unavailable");
        setMessage(data.message);
        setGeneratedAt(data.generatedAt);
        setFrames((current) => ({ ...current, [offset]: data.frame }));
        return;
      }

      setStatus("error");
      setMessage("레이더 예측 응답 형식을 확인하지 못했습니다.");
    } catch {
      setStatus("error");
      setMessage("레이더 예측 정보를 불러오는 중 오류가 발생했습니다.");
    }
  }

  useEffect(() => {
    void loadFrame(0);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setSelectedOffset((current) => getNextOffset(current));
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [isPlaying]);

  const selectedFrame = frames[selectedOffset];
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
            onClick={() => setIsPlaying((current) => !current)}
          >
            {isPlaying ? "정지" : "재생"}
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
                void loadFrame(offset);
              }}
            >
              {getOffsetLabel(offset)}
            </button>
          ))}
        </div>

        <div className={styles.mapShell}>
          <div className={styles.mapViewport}>
            <span className={styles.mapBadge}>{getOffsetLabel(selectedOffset)}</span>
            {selectedFrame?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.mapImage}
                src={selectedFrame.imageUrl}
                alt={`레이더 1H 강수예측 ${getOffsetLabel(selectedOffset)}`}
                onError={() => {
                  setStatus("unavailable");
                  setMessage("레이더 영상을 불러오지 못했습니다. 기상청 APIHub 승인 또는 응답 상태를 확인해 주세요.");
                }}
              />
            ) : (
              <div className={styles.mapPlaceholder}>
                <div className={styles.mapPlaceholderInner}>
                  <strong>레이더 영상 대기 중</strong>
                  <p className={styles.cardText}>기상청 API 활용신청 승인 후 레이더 영상이 표시됩니다.</p>
                  <p className={styles.metaText}>
                    재생은 화면의 시간 상태만 전환하며, 자동 반복 API 호출은 하지 않습니다.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className={statusClassName} aria-live="polite">
            {status === "loading" ? "레이더 예측 정보를 불러오는 중입니다." : message}
            {formattedGeneratedAt ? ` · 확인 ${formattedGeneratedAt}` : ""}
          </div>
        </div>
      </div>
    </article>
  );
}
