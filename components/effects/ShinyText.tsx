"use client";

import type { CSSProperties } from "react";
import styles from "./ShinyText.module.css";

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
  color?: string;
  shineColor?: string;
  spread?: number;
  yoyo?: boolean;
  pauseOnHover?: boolean;
  direction?: "left" | "right";
  delay?: number;
}

export function ShinyText({
  text,
  disabled = false,
  speed = 2,
  className = "",
  color = "#b5b5b5",
  shineColor = "#ffffff",
  spread = 120,
  yoyo = false,
  pauseOnHover = false,
  direction = "left",
  delay = 0,
}: ShinyTextProps) {
  const duration = Number.isFinite(speed) ? Math.max(speed, 0.001) : 2;
  const wait = Number.isFinite(delay) ? Math.max(delay, 0) : 0;
  const cycle = duration + wait;
  const gradientStyle = {
    backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
    backgroundSize: "200% auto",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    "--shine-start": direction === "left" ? "150%" : "-50%",
    "--shine-end": direction === "left" ? "-50%" : "150%",
    animationDuration: `${cycle * (yoyo ? 2 : 1)}s`,
    // Each pass moves for speed seconds, then holds for delay seconds.
    animationTimingFunction: `linear(0, 1 ${(duration / cycle) * 100}%, 1)`,
    animationPlayState: disabled ? "paused" : undefined,
  } as CSSProperties;

  return (
    <span
      key={direction}
      className={[styles.shinyText, yoyo ? styles.yoyo : "", pauseOnHover ? styles.pauseOnHover : "", className].filter(Boolean).join(" ")}
      style={gradientStyle}
    >
      {text}
    </span>
  );
}

export default ShinyText;
