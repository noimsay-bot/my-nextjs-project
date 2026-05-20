"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSession, hasAdminAccess, subscribeToAuth } from "@/lib/auth/storage";
import {
  createCelebrationEvent,
  type CelebrationEventDraft,
  type CelebrationIntensity,
  type CelebrationRecurrence,
} from "@/lib/celebrations/storage";
import {
  closeHomePopupNoticeApplications,
  closeHomePopupNotice,
  getHomeNotices,
  getHomePopupNotice,
  getHomePopupNoticeApplications,
  HOME_POPUP_NOTICE_EVENT,
  HOME_POPUP_NOTICE_STATUS_EVENT,
  refreshHomePopupNoticeWorkspace,
  saveHomeNotice,
  type HomeNotice,
  type HomeNoticeTone,
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

function getNoticeToneStyle(tone: HomeNoticeTone) {
  if (tone === "urgent") {
    return {
      background: "rgba(239,68,68,.18)",
      border: "1px solid rgba(248,113,113,.42)",
      color: "#ffe4e6",
    };
  }

  return {
    background: "rgba(34,197,94,.16)",
    border: "1px solid rgba(74,222,128,.34)",
    color: "#dcfce7",
  };
}

type MessageTone = "ok" | "warn" | "note";

const defaultCelebrationDraft: CelebrationEventDraft = {
  title: "축 ○○○ 생일",
  message: "오늘의 주인공을 축하합니다.",
  button_label: "확인하고 닫기",
  intensity: "normal",
  starts_at: "",
  ends_at: "",
  recurrence: "yearly",
  is_active: true,
};

const celebrationIntensityLabels: Record<CelebrationIntensity, string> = {
  light: "가볍게",
  normal: "보통",
  strong: "강하게",
};

const celebrationRecurrenceLabels: Record<CelebrationRecurrence, string> = {
  none: "반복 없음",
  yearly: "매년 반복",
};

function canManageCelebrationFromSession() {
  const session = getSession();
  return Boolean(session?.approved && hasAdminAccess(session.actualRole));
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
  const [generalTitle, setGeneralTitle] = useState("");
  const [generalBody, setGeneralBody] = useState("");
  const [generalTone, setGeneralTone] = useState<HomeNoticeTone>("normal");
  const [popupTitle, setPopupTitle] = useState("");
  const [popupBody, setPopupBody] = useState("");
  const [popupTone, setPopupTone] = useState<HomeNoticeTone>("normal");
  const [popupExpiresAt, setPopupExpiresAt] = useState("");
  const [popupWithApplication, setPopupWithApplication] = useState(true);
  const [activePopup, setActivePopup] = useState(() => getHomePopupNotice());
  const [notices, setNotices] = useState<HomeNotice[]>(() => getHomeNotices());
  const [applications, setApplications] = useState(() => getHomePopupNoticeApplications());
  const [message, setMessage] = useState<{ tone: MessageTone; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [canManageCelebrations, setCanManageCelebrations] = useState(canManageCelebrationFromSession);
  const [celebrationDraft, setCelebrationDraft] = useState<CelebrationEventDraft>(defaultCelebrationDraft);
  const [celebrationDeactivateExisting, setCelebrationDeactivateExisting] = useState(false);

  const syncFromCache = () => {
    setActivePopup(getHomePopupNotice());
    setNotices(getHomeNotices());
    setApplications(getHomePopupNoticeApplications());
  };

  const loadWorkspace = async () => {
    try {
      await refreshHomePopupNoticeWorkspace({ includeTrips: false });
      syncFromCache();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "공지 정보를 불러오지 못했습니다.",
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
    return subscribeToAuth((session) => {
      setCanManageCelebrations(Boolean(session?.approved && hasAdminAccess(session.actualRole)));
    });
  }, []);

  useEffect(() => {
    const onFocusRefresh = () => {
      void loadWorkspace();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
      if (!detail?.message) return;
      setMessage({ tone: detail.ok ? "ok" : "warn", text: detail.message });
      syncFromCache();
    };

    window.addEventListener("focus", onFocusRefresh);
    window.addEventListener(HOME_POPUP_NOTICE_EVENT, syncFromCache);
    window.addEventListener(HOME_POPUP_NOTICE_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener("focus", onFocusRefresh);
      window.removeEventListener(HOME_POPUP_NOTICE_EVENT, syncFromCache);
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
    if (!activePopup?.applicationEnabled) return "";
    return `${applications.length}명 신청`;
  }, [activePopup?.applicationEnabled, applications.length]);

  const openComposer = () => {
    setMessage(null);
    setGeneralTitle("");
    setGeneralBody("");
    setGeneralTone("normal");
    setPopupTitle("");
    setPopupBody("");
    setPopupTone("normal");
    setPopupExpiresAt(activePopup?.isActive ? toDateTimeLocalValue(activePopup.expiresAt) : "");
    setPopupWithApplication(activePopup?.applicationEnabled ?? true);
    setCelebrationDraft(defaultCelebrationDraft);
    setCelebrationDeactivateExisting(false);
    setComposerOpen(true);
  };

  const updateCelebrationDraft = <Key extends keyof CelebrationEventDraft>(
    key: Key,
    value: CelebrationEventDraft[Key],
  ) => {
    setCelebrationDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSaveGeneralNotice = async () => {
    setSubmitting(true);
    try {
      await saveHomeNotice({
        title: generalTitle,
        body: generalBody,
        kind: "general",
        tone: generalTone,
      });
      setGeneralTitle("");
      setGeneralBody("");
      setGeneralTone("normal");
      await loadWorkspace();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "일반 공지를 저장하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePopupNotice = async () => {
    setSubmitting(true);
    try {
      await saveHomeNotice({
        title: popupTitle,
        body: popupBody,
        kind: "popup",
        tone: popupTone,
        expiresAt: popupExpiresAt,
        applicationEnabled: popupWithApplication,
      });
      setPopupTitle("");
      setPopupBody("");
      setPopupTone("normal");
      setPopupExpiresAt("");
      setPopupWithApplication(true);
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

  const handleSaveCelebration = async () => {
    setSubmitting(true);
    try {
      await createCelebrationEvent(celebrationDraft, {
        deactivateExisting:
          celebrationDraft.recurrence === "none" && celebrationDeactivateExisting,
      });
      setCelebrationDraft(defaultCelebrationDraft);
      setCelebrationDeactivateExisting(false);
      setMessage({ tone: "ok", text: "축하 현수막을 저장했습니다." });
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "축하 현수막을 저장하지 못했습니다.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseNotice = async () => {
    if (typeof window !== "undefined" && !window.confirm("현재 팝업 공지를 종료하시겠습니까?")) {
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

  const handleCloseApplications = async () => {
    if (typeof window !== "undefined" && !window.confirm("현재 공지의 신청을 마감하시겠습니까?")) {
      return;
    }

    setSubmitting(true);
    try {
      await closeHomePopupNoticeApplications();
      setApplicationsOpen(false);
      await loadWorkspace();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "신청 마감을 처리하지 못했습니다.",
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
        공지
      </button>
      {activePopup?.isActive && activePopup.applicationEnabled ? (
        <button className="btn" type="button" onClick={() => setApplicationsOpen((current) => !current)}>
          신청자 보기
        </button>
      ) : null}
      {activePopup?.isActive ? (
        <button className="btn" type="button" disabled={submitting} onClick={() => void handleCloseNotice()}>
          팝업 종료
        </button>
      ) : null}
      {activePopup?.isActive ? <span className="chip">홈 공지 게시중</span> : null}
      {activePopup?.applicationEnabled ? <span className="muted">{applicationCountLabel}</span> : null}
    </div>
  ) : null;

  return (
    <div style={{ display: "grid", gap: showButtons && showMeta ? 10 : 0 }}>
      {buttonRow}

      {showMeta && loaded && notices.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          {notices.map((notice) => {
            const toneStyle = getNoticeToneStyle(notice.tone);
            return (
              <article
                key={notice.id}
                style={{
                  borderRadius: 14,
                  padding: "12px 14px",
                  display: "grid",
                  gap: 6,
                  ...toneStyle,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <strong>{notice.title}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {notice.kind === "popup" ? "팝업" : "일반"} · {formatNoticeDateTime(notice.updatedAt)}
                  </span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{notice.body}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {notice.kind === "popup" && notice.isActive ? "팝업 자동 노출중" : "목록 노출중"}
                  {notice.expiresAt ? ` · 종료 ${formatNoticeDateTime(notice.expiresAt)}` : ""}
                  {notice.kind === "popup" && notice.applicationEnabled ? " · 신청 가능" : ""}
                </div>
              </article>
            );
          })}
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
                  width: "min(1180px, 100%)",
                  background: "rgb(15,23,42)",
                  border: "1px solid rgba(148,163,184,.26)",
                  boxShadow: "0 28px 80px rgba(0,0,0,.48)",
                }}
              >
                <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <div className="chip">홈 공지 · 축하 현수막</div>
                    <button className="btn" type="button" onClick={() => setComposerOpen(false)}>
                      닫기
                    </button>
                  </div>
                  {message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <section
                      style={{
                        display: "grid",
                        gap: 10,
                        border: "1px solid rgba(255,255,255,.12)",
                        borderRadius: 16,
                        padding: 14,
                        background: "rgba(255,255,255,.04)",
                      }}
                    >
                      <strong>일반 공지 만들기</strong>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>공지 유형</span>
                        <select className="field-select" value={generalTone} onChange={(event) => setGeneralTone(event.target.value as HomeNoticeTone)}>
                          <option value="normal">일반공지</option>
                          <option value="urgent">긴급공지</option>
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>제목</span>
                        <input className="field-input" value={generalTitle} onChange={(event) => setGeneralTitle(event.target.value)} />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>본문</span>
                        <textarea className="field-input" rows={8} value={generalBody} onChange={(event) => setGeneralBody(event.target.value)} style={{ resize: "vertical" }} />
                      </label>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="btn primary" type="button" disabled={submitting} onClick={() => void handleSaveGeneralNotice()}>
                          일반 공지 등록
                        </button>
                      </div>
                    </section>

                    <section
                      style={{
                        display: "grid",
                        gap: 10,
                        border: "1px solid rgba(255,255,255,.12)",
                        borderRadius: 16,
                        padding: 14,
                        background: "rgba(255,255,255,.04)",
                      }}
                    >
                      <strong>팝업 공지 만들기</strong>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>공지 유형</span>
                        <select className="field-select" value={popupTone} onChange={(event) => setPopupTone(event.target.value as HomeNoticeTone)}>
                          <option value="normal">일반공지</option>
                          <option value="urgent">긴급공지</option>
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>제목</span>
                        <input className="field-input" value={popupTitle} onChange={(event) => setPopupTitle(event.target.value)} />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>본문</span>
                        <textarea className="field-input" rows={8} value={popupBody} onChange={(event) => setPopupBody(event.target.value)} style={{ resize: "vertical" }} />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>종료일</span>
                        <input className="field-input" type="datetime-local" value={popupExpiresAt} onChange={(event) => setPopupExpiresAt(event.target.value)} />
                        <span className="muted">비워 두면 수동 종료 전까지 계속 노출됩니다.</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={popupWithApplication} onChange={(event) => setPopupWithApplication(event.target.checked)} />
                        <span>신청하기 만들기</span>
                      </label>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="btn primary" type="button" disabled={submitting} onClick={() => void handleSavePopupNotice()}>
                          팝업 공지 등록
                        </button>
                      </div>
                    </section>

                    {canManageCelebrations ? (
                      <section
                        style={{
                          display: "grid",
                          gap: 10,
                          border: "1px solid rgba(255,255,255,.12)",
                          borderRadius: 16,
                          padding: 14,
                          background: "rgba(255,255,255,.04)",
                        }}
                      >
                        <strong>축하 현수막 만들기</strong>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>제목</span>
                          <input
                            className="field-input"
                            value={celebrationDraft.title}
                            onChange={(event) => updateCelebrationDraft("title", event.target.value)}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>문구</span>
                          <textarea
                            className="field-input"
                            rows={4}
                            value={celebrationDraft.message}
                            onChange={(event) => updateCelebrationDraft("message", event.target.value)}
                            style={{ resize: "vertical" }}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>닫기 버튼 문구</span>
                          <input
                            className="field-input"
                            value={celebrationDraft.button_label}
                            onChange={(event) => updateCelebrationDraft("button_label", event.target.value)}
                          />
                        </label>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span>효과 강도</span>
                            <select
                              className="field-select"
                              value={celebrationDraft.intensity}
                              onChange={(event) => updateCelebrationDraft("intensity", event.target.value as CelebrationIntensity)}
                            >
                              {Object.entries(celebrationIntensityLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span>반복</span>
                            <select
                              className="field-select"
                              value={celebrationDraft.recurrence}
                              onChange={(event) => updateCelebrationDraft("recurrence", event.target.value as CelebrationRecurrence)}
                            >
                              {Object.entries(celebrationRecurrenceLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>{celebrationDraft.recurrence === "yearly" ? "반복 기준 시작일" : "예약 시작일"}</span>
                          <input
                            className="field-input"
                            type="datetime-local"
                            value={celebrationDraft.starts_at}
                            onChange={(event) => updateCelebrationDraft("starts_at", event.target.value)}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span>{celebrationDraft.recurrence === "yearly" ? "반복 종료 기준일" : "종료일"}</span>
                          <input
                            className="field-input"
                            type="datetime-local"
                            value={celebrationDraft.ends_at}
                            onChange={(event) => updateCelebrationDraft("ends_at", event.target.value)}
                          />
                          <span className="muted">
                            생일은 생일 날짜를 시작일로 넣고 매년 반복을 선택하세요. 종료일을 비우면 해당 하루만 매년 노출됩니다.
                          </span>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={celebrationDraft.is_active}
                            onChange={(event) => updateCelebrationDraft("is_active", event.target.checked)}
                          />
                          <span>게시 즉시 활성화</span>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={celebrationDraft.recurrence === "yearly" ? false : celebrationDeactivateExisting}
                            disabled={celebrationDraft.recurrence === "yearly"}
                            onChange={(event) => setCelebrationDeactivateExisting(event.target.checked)}
                          />
                          <span>
                            {celebrationDraft.recurrence === "yearly"
                              ? "매년 반복 현수막은 기존 현수막을 유지합니다"
                              : "저장 시 기존 활성 현수막 끄기"}
                          </span>
                        </label>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <button className="btn primary" type="button" disabled={submitting} onClick={() => void handleSaveCelebration()}>
                            축하 현수막 등록
                          </button>
                        </div>
                      </section>
                    ) : null}
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
                        disabled={submitting || !activePopup?.applicationEnabled}
                        onClick={() => void handleCloseApplications()}
                      >
                        신청마감
                      </button>
                      <button className="btn" type="button" onClick={() => setApplicationsOpen(false)}>
                        닫기
                      </button>
                    </div>
                  </div>
                  {message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
                  {activePopup ? (
                    <div
                      style={{
                        borderRadius: 12,
                        padding: "10px 12px",
                        display: "grid",
                        gap: 6,
                        ...getNoticeToneStyle(activePopup.tone),
                      }}
                    >
                      <strong style={{ fontSize: 15 }}>{activePopup.title || "제목 없음"}</strong>
                      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{activePopup.body || "본문 없음"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {activePopup.isActive ? "현재 홈 화면에 노출 중" : "비활성화된 팝업"}
                        {activePopup.expiresAt ? ` · 종료 ${formatNoticeDateTime(activePopup.expiresAt)}` : ""}
                        {` · ${formatNoticeDateTime(activePopup.updatedAt)}`}
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
