"use client";

import { useEffect, useState } from "react";

export function ScrollToTop({ className = "" }: { className?: string }) {
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // 스크롤이 150px 이상 내려가면 버튼을 보여줍니다.
      setVisible(window.scrollY > 150);
    };

    const syncViewport = () => {
      const mobileViewport = window.matchMedia("(max-width: 820px)").matches;
      const coarsePointer = window.matchMedia("(any-pointer: coarse)").matches;
      setIsMobile(mobileViewport || coarsePointer);
    };

    syncViewport();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  if (!visible || isMobile) return null;

  return (
    <button
      type="button"
      className={`portal-scroll-top-button ${className}`.trim()}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        padding: "16px 8px",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "12px",
        fontSize: "13px",
        fontWeight: 800,
        cursor: "pointer",
        writingMode: "vertical-rl",
        textOrientation: "upright",
        letterSpacing: "4px",
        transition: "all 0.2s ease",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.left = "16px";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.left = "12px";
      }}
    >
      상단가기
    </button>
  );
}
