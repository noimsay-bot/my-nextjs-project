"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  clearHomePopupNoticeApplications,
  closeHomePopupNotice,
  getHomePopupNotice,
  getHomePopupNoticeApplications,
  HOME_POPUP_NOTICE_EVENT,
  HOME_POPUP_NOTICE_STATUS_EVENT,
  refreshHomePopupNoticeWorkspace,
  saveHomePopupNotice,
} from "@/lib/home-popup/storage";

function formatNoticeDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function DeskPopupNoticeManager({
  inline = false,
  showButtons = true,
  showMeta = true,
}: {
  inline?: boolean;
  showButtons?: boolean;
  showMeta?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [applicationsOpen, setApplicationsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notice, setNotice] = useState(() => getHomePopupNotice());
  const [applications, setApplications] = useState(() => getHomePopupNoticeApplications());
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const syncFromCache = () => {
    setNotice(getHomePopupNotice());
    setApplications(getHomePopupNoticeApplications());
  };

  const loadWorkspace = async () => {
    try {
      await refreshHomePopupNoticeWorkspace();
      syncFromCache();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "팝업 공지 정보를 불러오지 못했습니다.",
      });
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const onRefresh = () => {
      void loadWorkspace();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail?.message) return;
      setMessage({ tone: detail.ok ? "ok" : "warn", text: detail.message });
      syncFromCache();
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

  useEffect(() => {
    if (!applicationsOpen) return;
    const timer = window.setInterval(() => {
      void loadWorkspace();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [applicationsOpen]);

  const applicationCountLabel = useMemo(() => {
    if (!notice?.noticeId) return "";
    return `${applications.length}명 신청`;
  }, [applications.length, notice?.noticeId]);

  const openComposer = () => {
    setMessage(null);
    setTitle(notice?.isActive ? notice.title : "");
    setBody(notice?.isActive ? notice.body : "");
    setExpiresAt(notice?.isActive ? toDateTimeLocalValue(notice.expiresAt) : "");
    setComposerOpen(true);
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await saveHomePopupNotice({ title, body, expiresAt });
      setComposerOpen(false);
      await loadWorkspace();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "팝업 공지를 저장하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseNotice = async () => {
    if (typeof window !== "undefined" && !window.confirm("현재 홈 팝업 공지를 종료하시겠습니까?")) {
      return;
    }

    setSubmitting(true);
    try {
      await closeHomePopupNotice();
      await loadWorkspace();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "팝업 공지를 종료하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearApplications = async () => {
    if (typeof window !== "undefined" && !window.confirm("현재 공지의 신청자 목록을 초기화하시겠습니까?")) {
      return;
    }

    setSubmitting(true);
    try {
      await clearHomePopupNoticeApplications();
      await loadWorkspace();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "신청 목록을 초기화하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const buttonRow = showButtons ? (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: inline ? "nowrap" : "wrap",
        alignItems: "center",
        minWidth: inline ? "max-content" : undefined,
      }}
    >
        <button className="btn" type="button" onClick={openComposer}>
          팝업공지
        </button>
        <button
          className="btn"
          type="button"
          disabled={!notice?.noticeId}
          onClick={() => setApplicationsOpen((current) => !current)}
        >
          신청자 보기
        </button>
        {notice?.isActive ? (
          <button className="btn" type="button" disabled={submitting} onClick={() => void handleCloseNotice()}>
            팝업 종료
          </button>
        ) : null}
        {notice?.isActive ? <span className="chip">홈 팝업 게시중</span> : null}
        {notice?.noticeId ? <span className="muted">{applicationCountLabel}</span> : null}
      </div>
  ) : null;

  return (
    <div style={{ display: "grid", gap: showButtons && showMeta ? 10 : 0 }}>
      {buttonRow}

      {showMeta && loaded && notice?.noticeId ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,.14)",
            borderRadius: 12,
            padding: "10px 12px",
            background: "rgba(15,23,42,.38)",
            display: "grid",
            gap: 6,
          }}
        >
          <strong style={{ fontSize: 15 }}>{notice.title || "제목 없음"}</strong>
          <div className="muted" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {notice.body || "본문 없음"}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {notice.isActive ? "현재 홈 화면에 노출 중" : "종료된 팝업"}
            {notice.expiresAt ? ` · 종료 ${formatNoticeDateTime(notice.expiresAt)}` : ""}
            {` · ${formatNoticeDateTime(notice.updatedAt)}`}
          </div>
        </div>
      ) : null}

      {showMeta && message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}

      {composerOpen && portalReady
        ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
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
              width: "min(640px, 100%)",
              maxHeight: "none",
              overflow: "auto",
              background: "rgb(15,23,42)",
              border: "1px solid rgba(148,163,184,.26)",
              boxShadow: "0 28px 80px rgba(0,0,0,.48)",
            }}
          >
            <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
              <div className="chip">홈 팝업 공지</div>
              {message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
              <label style={{ display: "grid", gap: 6 }}>
                <strong>제목</strong>
                <input
                  className="field-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="팝업 제목을 입력하세요"
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <strong>본문</strong>
                <textarea
                  className="field-input"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="팝업 본문을 입력하세요"
                  rows={8}
                  style={{ resize: "vertical" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <strong>종료일</strong>
                <input
                  className="field-input"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
                <span className="muted">비워 두면 수동 종료 전까지 계속 노출됩니다.</span>
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={() => setComposerOpen(false)}>
                  취소
                </button>
                <button className="btn primary" type="button" disabled={submitting} onClick={() => void handleSave()}>
                  확인
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
        : null}

      {applicationsOpen && portalReady
        ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
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
              width: "min(760px, 100%)",
              maxHeight: "none",
              overflow: "auto",
              background: "rgb(15,23,42)",
              border: "1px solid rgba(148,163,184,.26)",
              boxShadow: "0 28px 80px rgba(0,0,0,.48)",
            }}
          >
            <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div className="chip">신청자 보기</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="btn" type="button" onClick={() => void loadWorkspace()}>
                    새로고침
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={submitting || applications.length === 0}
                    onClick={() => void handleClearApplications()}
                  >
                    목록 삭제
                  </button>
                  <button className="btn" type="button" onClick={() => setApplicationsOpen(false)}>
                    닫기
                  </button>
                </div>
              </div>
              {message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
              {showMeta && loaded && notice?.noticeId ? (
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,.14)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    background: "rgba(255,255,255,.04)",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <strong style={{ fontSize: 15 }}>{notice.title || "제목 없음"}</strong>
                  <div className="muted" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {notice.body || "본문 없음"}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {notice.isActive ? "현재 홈 화면에 노출 중" : "종료된 팝업"}
                    {notice.expiresAt ? ` · 종료 ${formatNoticeDateTime(notice.expiresAt)}` : ""}
                    {` · ${formatNoticeDateTime(notice.updatedAt)}`}
                  </div>
                </div>
              ) : null}
              {applications.length > 0 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {applications.map((application) => (
                    <div
                      key={application.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,.12)",
                        background: "rgba(255,255,255,.04)",
                      }}
                    >
                      <strong>{application.applicantName}</strong>
                      <span className="muted">{formatNoticeDateTime(application.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="status note">아직 신청 로그가 없습니다.</div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
