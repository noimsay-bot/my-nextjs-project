"use client";

import { useEffect, useState } from "react";

export function ScrollToTop({ className = "" }: { className?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // 스크롤이 150px 이상 내려가면 버튼을 보여줍니다.
      setVisible(window.scrollY > 150);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={`portal-scroll-top-button ${className}`.trim()}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        padding: "16px 8px",
        backgroundColor: "rgba(15, 23, 42, 0.8)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "12px",
        color: "#f8fbff",
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
        e.currentTarget.style.backgroundColor = "rgba(30, 41, 59, 0.95)";
        e.currentTarget.style.left = "16px";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "rgba(15, 23, 42, 0.8)";
        e.currentTarget.style.left = "12px";
      }}
    >
      상단가기
    </button>
  );
}
