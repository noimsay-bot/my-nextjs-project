"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyToHomePopupNotice,
  getHomePopupNotice,
  hasAppliedToCurrentHomePopupNotice,
  HOME_POPUP_NOTICE_EVENT,
  HOME_POPUP_NOTICE_STATUS_EVENT,
  refreshHomePopupNoticeWorkspace,
} from "@/lib/home-popup/storage";

function getNoticeToneStyle(tone: "normal" | "urgent") {
  if (tone === "urgent") {
    return {
      background: "rgba(127,29,29,.92)",
      border: "1px solid rgba(248,113,113,.44)",
    };
  }

  return {
    background: "rgba(20,83,45,.92)",
    border: "1px solid rgba(74,222,128,.32)",
  };
}

export function HomePopupNoticeModal() {
  const [notice, setNotice] = useState(() => getHomePopupNotice());
  const [hasApplied, setHasApplied] = useState(() => hasAppliedToCurrentHomePopupNotice());
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const lastNoticeIdRef = useRef<string>("");

  const syncFromCache = () => {
    const nextNotice = getHomePopupNotice();
    const nextHasApplied = hasAppliedToCurrentHomePopupNotice();
    setNotice(nextNotice);
    setHasApplied(nextHasApplied);
    if (nextNotice?.isActive && (!nextHasApplied || !nextNotice.applicationEnabled) && nextNotice.id !== lastNoticeIdRef.current) {
      lastNoticeIdRef.current = nextNotice.id;
      setOpen(true);
      setMessage(null);
    }
    if (!nextNotice?.isActive || (nextNotice.applicationEnabled && nextHasApplied)) {
      setOpen(false);
    }
  };

  const loadNotice = async () => {
    try {
      await refreshHomePopupNoticeWorkspace();
      syncFromCache();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "홈 공지를 불러오지 못했습니다.",
      });
    }
  };

  useEffect(() => {
    void loadNotice();
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const onRefresh = () => {
      void loadNotice();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail?.message) return;
      setMessage({ tone: detail.ok ? "ok" : "warn", text: detail.message });
    };

    window.addEventListener("focus", onRefresh);
    window.addEventListener(HOME_POPUP_NOTICE_EVENT, onRefresh);
    window.addEventListener(HOME_POPUP_NOTICE_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(HOME_POPUP_NOTICE_EVENT, onRefresh);
      window.removeEventListener(HOME_POPUP_NOTICE_STATUS_EVENT, onStatus);
    };
  }, []);

  const handleApply = async () => {
    setSubmitting(true);
    try {
      await applyToHomePopupNotice();
      setHasApplied(true);
      setOpen(false);
      setMessage({ tone: "ok", text: "신청이 접수되었습니다." });
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "신청을 처리하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!notice?.isActive || !open || (notice.applicationEnabled && hasApplied) || !portalReady) return null;

  const toneStyle = getNoticeToneStyle(notice.tone);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 140,
        background: "rgba(2,6,23,.56)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        overflowY: "auto",
        padding: "48px 20px 32px",
      }}
    >
      <div
        className="panel"
        style={{
          width: "min(560px, 100%)",
          ...toneStyle,
          boxShadow: "0 30px 80px rgba(2,6,23,.42)",
        }}
      >
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
            <div className="chip">공지</div>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <strong style={{ fontSize: 24, lineHeight: 1.25 }}>{notice.title}</strong>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: "#f8fafc" }}>{notice.body}</div>
          </div>
          {message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {notice.applicationEnabled ? (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" disabled={submitting} onClick={() => void handleApply()}>
                신청하기
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
