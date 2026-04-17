"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "Pretendard, system-ui, sans-serif",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: 480,
            borderRadius: 20,
            border: "1px solid rgba(148,163,184,0.28)",
            background: "rgba(15,23,42,0.92)",
            padding: 24,
            boxShadow: "0 20px 60px rgba(15,23,42,0.35)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 24 }}>문제가 발생했습니다.</h2>
          <p style={{ margin: "12px 0 0", lineHeight: 1.6, color: "#cbd5e1" }}>
            오류 정보는 자동으로 수집되었습니다. 잠시 후 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "#e2e8f0",
              color: "#0f172a",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
