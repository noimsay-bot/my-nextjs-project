"use client";

import { CSSProperties, useLayoutEffect, useRef, useState } from "react";

type FittedNameTextProps = {
  text: string;
  className?: string;
  minFontSize?: number;
  maxFontSize?: number;
  lineHeight?: number;
  style?: CSSProperties;
  observeElementResize?: boolean;
  observeWindowResize?: boolean;
  measurementIterations?: number;
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
  observeElementResize = true,
  observeWindowResize = true,
  measurementIterations = 12,
}: FittedNameTextProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;

    const updateSize = () => {
      const node = ref.current;
      if (!node) return;
      if (!text.trim()) {
        setFontSize(maxFontSize);
        return;
      }
      const availableWidth = Math.max(0, node.clientWidth);
      if (!availableWidth) return;

      let low = minFontSize;
      let high = maxFontSize;
      let best = minFontSize;

      for (let index = 0; index < measurementIterations; index += 1) {
        const mid = (low + high) / 2;
        const measuredWidth = measureTextWidth(text, mid, node);
        if (measuredWidth <= availableWidth) {
          best = mid;
          low = mid;
        } else {
          high = mid;
        }
      }

      setFontSize((current) => (Math.abs(current - best) < 0.2 ? current : Number(best.toFixed(2))));
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateSize);
    };

    scheduleUpdate();

    const resizeObserver =
      observeElementResize && typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleUpdate) : null;
    if (resizeObserver) {
      resizeObserver.observe(element);
      if (element.parentElement) {
        resizeObserver.observe(element.parentElement);
      }
    }

    if (observeWindowResize) {
      window.addEventListener("resize", scheduleUpdate);
    }
    void document.fonts?.ready?.then(scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      if (observeWindowResize) {
        window.removeEventListener("resize", scheduleUpdate);
      }
      resizeObserver?.disconnect();
    };
  }, [text, minFontSize, maxFontSize, measurementIterations, observeElementResize, observeWindowResize]);

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
        ...style,
      }}
    >
      {text}
    </span>
  );
}
