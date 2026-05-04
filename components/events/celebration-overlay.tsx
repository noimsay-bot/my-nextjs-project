"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { CelebrationIntensity } from "@/lib/celebrations/storage";

type CelebrationOverlayEvent = {
  id: string;
  title: string;
  message: string | null;
  button_label: string;
  intensity: CelebrationIntensity;
};

type CelebrationOverlayProps = {
  event: CelebrationOverlayEvent;
  onDismiss: () => void;
};

const intensitySettings: Record<CelebrationIntensity, { particleCount: number; spread: number; scalar: number; bursts: number }> = {
  light: { particleCount: 210, spread: 68, scalar: 0.9, bursts: 3 },
  normal: { particleCount: 330, spread: 78, scalar: 1.04, bursts: 4 },
  strong: { particleCount: 480, spread: 92, scalar: 1.12, bursts: 5 },
};

function shouldReduceMotion() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CelebrationOverlay({ event, onDismiss }: CelebrationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    overlayRef.current?.focus();
  }, [event.id]);

  useEffect(() => {
    if (shouldReduceMotion()) return;

    let cancelled = false;
    const timeoutIds: number[] = [];
    let resetConfetti: (() => void) | null = null;

    void import("canvas-confetti").then((module) => {
      if (cancelled) return;
      const canvas = confettiCanvasRef.current;
      if (!canvas) return;

      const confetti = module.default.create(canvas, {
        resize: true,
        useWorker: true,
      });
      const settings = intensitySettings[event.intensity] ?? intensitySettings.normal;
      resetConfetti = () => confetti.reset?.();
      const origins = [
        { x: 0.14, y: 0.08, angle: 58 },
        { x: 0.86, y: 0.1, angle: 122 },
        { x: 0.5, y: 0.04, angle: 90 },
      ];
      const fireworkOrigins = [
        { x: 0.22, y: 0.94 },
        { x: 0.5, y: 0.96 },
        { x: 0.78, y: 0.94 },
      ];

      for (let index = 0; index < settings.bursts; index += 1) {
        const timeoutId = window.setTimeout(() => {
          const origin = origins[index % origins.length] ?? origins[0];
          confetti({
            particleCount: settings.particleCount,
            spread: settings.spread,
            angle: origin.angle,
            startVelocity: 44,
            gravity: 0.78,
            ticks: 230,
            scalar: settings.scalar,
            origin: {
              x: origin.x,
              y: origin.y,
            },
            disableForReducedMotion: true,
          });
        }, index * 420);
        timeoutIds.push(timeoutId);
      }

      fireworkOrigins.forEach((origin, index) => {
        const timeoutId = window.setTimeout(() => {
          confetti({
            particleCount: Math.round(settings.particleCount * 0.72),
            spread: 112,
            startVelocity: 72,
            gravity: 0.95,
            ticks: 260,
            scalar: settings.scalar * 1.08,
            origin,
            colors: ["#dc2626", "#facc15", "#2563eb", "#ffffff", "#fb7185"],
            disableForReducedMotion: true,
          });
        }, 240 + index * 360);
        timeoutIds.push(timeoutId);
      });
    });

    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      resetConfetti?.();
    };
  }, [event.id, event.intensity]);

  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
    keyboardEvent.preventDefault();
    onDismiss();
  };

  return (
    <div
      ref={overlayRef}
      className="celebration-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`celebration-title-${event.id}`}
      aria-describedby={event.message ? `celebration-message-${event.id}` : undefined}
      tabIndex={0}
      onClick={onDismiss}
      onKeyDown={handleKeyDown}
    >
      <div className="celebration-hanging-scene">
        <div className="celebration-pole celebration-pole--left" aria-hidden="true" />
        <section className="celebration-banner" aria-label="축하 현수막">
          <span className="celebration-banner__rope celebration-banner__rope--left" aria-hidden="true" />
          <span className="celebration-banner__rope celebration-banner__rope--right" aria-hidden="true" />
          <div className="celebration-banner__topline" aria-hidden="true" />
          <div className="celebration-banner__body">
            <div className="celebration-banner__eyebrow">JTBC NEWS CAMERA HUB</div>
            <h2 id={`celebration-title-${event.id}`} className="celebration-banner__title">
              {event.title}
            </h2>
            {event.message ? (
              <p id={`celebration-message-${event.id}`} className="celebration-banner__message">
                {event.message}
              </p>
            ) : null}
          </div>
        </section>
        <div className="celebration-pole celebration-pole--right" aria-hidden="true" />
      </div>
      <canvas ref={confettiCanvasRef} className="celebration-confetti-layer" aria-hidden="true" />
    </div>
  );
}
