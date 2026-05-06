"use client";

import { CSSProperties, useLayoutEffect, useRef, useState } from "react";

type FittedNameTextProps = {
  text: string;
  className?: string;
  minFontSize?: number;
  maxFontSize?: number;
  lineHeight?: number;
  style?: CSSProperties;
};

let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext() {
  if (typeof document === "undefined") return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
  }
  return measureCanvas.getContext("2d");
}

function getLetterSpacingPx(value: string) {
  if (!value || value === "normal") return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureTextWidth(text: string, fontSize: number, element: HTMLElement) {
  const context = getMeasureContext();
  if (!context) return 0;
  const computed = window.getComputedStyle(element);
  const fontStyle = computed.fontStyle || "normal";
  const fontVariant = computed.fontVariant || "normal";
  const fontWeight = computed.fontWeight || "700";
  const fontFamily = computed.fontFamily || "sans-serif";
  const letterSpacing = getLetterSpacingPx(computed.letterSpacing);
  context.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize}px ${fontFamily}`;
  const measured = context.measureText(text).width;
  const graphemeCount = [...text].length;
  return measured + Math.max(0, graphemeCount - 1) * letterSpacing;
}

export function FittedNameText({
  text,
  className,
  minFontSize = 10,
  maxFontSize = 14,
  lineHeight = 1.15,
  style,
}: FittedNameTextProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const [scaleX, setScaleX] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;

    const updateSize = () => {
      const node = ref.current;
      if (!node) return;
      if (!text.trim()) {
        setFontSize(maxFontSize);
        setScaleX(1);
        return;
      }
      const availableWidth = Math.max(0, node.clientWidth);
      if (!availableWidth) return;

      let low = minFontSize;
      let high = maxFontSize;
      let best = minFontSize;
      let bestMeasuredWidth = measureTextWidth(text, minFontSize, node);

      for (let index = 0; index < 12; index += 1) {
        const mid = (low + high) / 2;
        const measuredWidth = measureTextWidth(text, mid, node);
        if (measuredWidth <= availableWidth) {
          best = mid;
          bestMeasuredWidth = measuredWidth;
          low = mid;
        } else {
          high = mid;
        }
      }

      setFontSize((current) => (Math.abs(current - best) < 0.2 ? current : Number(best.toFixed(2))));
      const nextScaleX = bestMeasuredWidth > availableWidth && bestMeasuredWidth > 0
        ? Math.max(0.72, availableWidth / bestMeasuredWidth)
        : 1;
      setScaleX((current) => (Math.abs(current - nextScaleX) < 0.01 ? current : Number(nextScaleX.toFixed(3))));
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateSize);
    };

    scheduleUpdate();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(element);
    if (element.parentElement) {
      resizeObserver?.observe(element.parentElement);
    }

    window.addEventListener("resize", scheduleUpdate);
    void document.fonts?.ready?.then(scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [text, minFontSize, maxFontSize]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        display: "block",
        width: "100%",
        fontSize,
        lineHeight,
        whiteSpace: "nowrap",
        overflow: "visible",
        textOverflow: "clip",
        textAlign: "center",
        transform: scaleX < 1 ? `scaleX(${scaleX})` : undefined,
        transformOrigin: "center",
        ...style,
      }}
    >
      {text}
    </span>
  );
}
