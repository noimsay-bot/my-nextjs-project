"use client";

import React from "react";

interface AppRouteBoundaryProps {
  resetKey: string;
  children: React.ReactNode;
}

interface AppRouteBoundaryState {
  hasError: boolean;
}

export class AppRouteBoundary extends React.Component<AppRouteBoundaryProps, AppRouteBoundaryState> {
  state: AppRouteBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error) {
    console.error("AppRouteBoundary caught an error.", error);
  }

  override componentDidUpdate(prevProps: AppRouteBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <section className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
            <div className="chip">오류 안내</div>
            <strong style={{ fontSize: 24 }}>페이지를 불러오는 중 오류가 발생했습니다.</strong>
            <div className="status warn">
              이 페이지에서 예외가 발생해 화면을 다시 그리지 못했습니다. 새로고침 후 다시 시도해 주세요.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  this.setState({ hasError: false });
                  window.location.reload();
                }}
              >
                새로고침
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
