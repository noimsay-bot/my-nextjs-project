"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CelebrationOverlay } from "@/components/events/celebration-overlay";
import {
  createCelebrationEvent,
  deleteCelebrationEvent,
  getRecentCelebrationEvents,
  isCelebrationEventCurrentlyVisible,
  updateCelebrationEventActive,
  type CelebrationEvent,
  type CelebrationEventDraft,
  type CelebrationIntensity,
  type CelebrationRecurrence,
} from "@/lib/celebrations/storage";
import { getSession, hasAdminAccess } from "@/lib/auth/storage";

const defaultDraft: CelebrationEventDraft = {
  title: "축 ○○○ 복귀",
  message: "건강하게 돌아오신 것을 환영합니다.",
  button_label: "확인하고 닫기",
  intensity: "normal",
  starts_at: "",
  ends_at: "",
  recurrence: "none",
  is_active: true,
};

const intensityLabels: Record<CelebrationIntensity, string> = {
  light: "light",
  normal: "normal",
  strong: "strong",
};

const recurrenceLabels: Record<CelebrationRecurrence, string> = {
  none: "반복 없음",
  yearly: "매년 반복",
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

function formatStatus(event: CelebrationEvent) {
  if (!event.is_active) return "비활성";
  const now = Date.now();
  if (event.recurrence === "yearly") {
    const startsAt = event.starts_at ? new Date(event.starts_at).getTime() : null;
    if (startsAt && startsAt > now) return "반복예약";
    return isCelebrationEventCurrentlyVisible(event) ? "오늘 노출" : "매년 반복";
  }
  const startsAt = event.starts_at ? new Date(event.starts_at).getTime() : null;
  const endsAt = event.ends_at ? new Date(event.ends_at).getTime() : null;
  if (startsAt && startsAt > now) return "예약";
  if (endsAt && endsAt < now) return "종료";
  return "활성";
}

export default function AdminCelebrationsPage() {
  const [draft, setDraft] = useState<CelebrationEventDraft>(defaultDraft);
  const [deactivateExisting, setDeactivateExisting] = useState(true);
  const [events, setEvents] = useState<CelebrationEvent[]>([]);
  const [previewEvent, setPreviewEvent] = useState<CelebrationEvent | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  const canManage = useMemo(() => {
    const session = getSession();
    return Boolean(session?.approved && hasAdminAccess(session.actualRole));
  }, []);

  async function refreshEvents() {
    if (!canManage) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setEvents(await getRecentCelebrationEvents());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "축하 현수막 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshEvents();
  }, [canManage]);

  const updateDraft = <Key extends keyof CelebrationEventDraft>(
    key: Key,
    value: CelebrationEventDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handlePreview = () => {
    setPreviewEvent({
      id: "preview",
      title: draft.title.trim() || defaultDraft.title,
      message: draft.message.trim() || null,
      button_label: draft.button_label.trim() || defaultDraft.button_label,
      effect: "confetti",
      intensity: draft.intensity,
      is_active: draft.is_active,
      starts_at: null,
      ends_at: null,
      recurrence: draft.recurrence,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  };

  const handlePublish = async () => {
    setSaving(true);
    setMessage("");
    try {
      await createCelebrationEvent(draft, { deactivateExisting: draft.recurrence === "none" && deactivateExisting });
      setMessage("축하 현수막을 게시했습니다.");
      setDraft(defaultDraft);
      await refreshEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "축하 현수막 게시에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div className="chip">축하 현수막</div>
              <h1 className="page-title" style={{ margin: 0 }}>이벤트 게시</h1>
            </div>
            <Link href="/admin" className="btn">
              관리자 홈
            </Link>
          </div>

          {message ? <div className="status note">{message}</div> : null}
          {!canManage ? <div className="status warn">관리자 권한이 필요합니다.</div> : null}

          <div className="celebration-admin-grid">
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">title</span>
              <input
                className="field-input"
                value={draft.title}
                onChange={(event) => updateDraft("title", event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">message</span>
              <input
                className="field-input"
                value={draft.message}
                onChange={(event) => updateDraft("message", event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">button_label</span>
              <input
                className="field-input"
                value={draft.button_label}
                onChange={(event) => updateDraft("button_label", event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">intensity</span>
              <select
                className="field-select"
                value={draft.intensity}
                onChange={(event) => updateDraft("intensity", event.target.value as CelebrationIntensity)}
              >
                {Object.entries(intensityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">반복</span>
              <select
                className="field-select"
                value={draft.recurrence}
                onChange={(event) => updateDraft("recurrence", event.target.value as CelebrationRecurrence)}
              >
                {Object.entries(recurrenceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                생일은 시작일을 생일 날짜로 넣고 매년 반복을 선택하세요.
              </span>
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">{draft.recurrence === "yearly" ? "반복 기준 시작일" : "예약 시작일"}</span>
              <input
                className="field-input"
                type="datetime-local"
                value={draft.starts_at}
                onChange={(event) => updateDraft("starts_at", event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="muted">{draft.recurrence === "yearly" ? "반복 종료 기준일" : "종료일"}</span>
              <input
                className="field-input"
                type="datetime-local"
                value={draft.ends_at}
                onChange={(event) => updateDraft("ends_at", event.target.value)}
              />
              {draft.recurrence === "yearly" ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  비워 두면 시작일의 월/일 하루만 매년 노출됩니다.
                </span>
              ) : null}
            </label>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label className="celebration-admin-check">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => updateDraft("is_active", event.target.checked)}
              />
              <span>게시 즉시 활성화</span>
            </label>
            <label className="celebration-admin-check">
              <input
                type="checkbox"
                checked={draft.recurrence === "yearly" ? false : deactivateExisting}
                disabled={draft.recurrence === "yearly"}
                onChange={(event) => setDeactivateExisting(event.target.checked)}
              />
              <span>{draft.recurrence === "yearly" ? "매년반복 이벤트는 기존 이벤트를 유지합니다" : "새 이벤트 게시 시 기존 활성 이벤트 비활성화"}</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={handlePreview}>
              미리보기
            </button>
            <button type="button" className="btn primary" disabled={!canManage || saving} onClick={handlePublish}>
              {saving ? "게시 중" : "게시"}
            </button>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">최근 이벤트</div>
            <button type="button" className="btn" disabled={loading} onClick={() => void refreshEvents()}>
              새로고침
            </button>
          </div>

          <div className="celebration-admin-list">
            {events.map((event) => (
              <article key={event.id} className="celebration-admin-row">
                <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <strong>{event.title}</strong>
                    <span className="chip">{formatStatus(event)}</span>
                  </div>
                  {event.message ? <span className="muted">{event.message}</span> : null}
                  <span className="muted" style={{ fontSize: 13 }}>
                    {formatDateTime(event.starts_at)} ~ {formatDateTime(event.ends_at)} · {recurrenceLabels[event.recurrence]} · {event.intensity} · {event.id}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyEventId === event.id}
                    onClick={async () => {
                      setBusyEventId(event.id);
                      setMessage("");
                      try {
                        await updateCelebrationEventActive(event.id, !event.is_active);
                        await refreshEvents();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "상태 변경에 실패했습니다.");
                      } finally {
                        setBusyEventId(null);
                      }
                    }}
                  >
                    {event.is_active ? "비활성화" : "활성화"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyEventId === event.id}
                    onClick={async () => {
                      const confirmed = window.confirm("이 축하 현수막 이벤트를 삭제하시겠습니까?");
                      if (!confirmed) return;
                      setBusyEventId(event.id);
                      setMessage("");
                      try {
                        await deleteCelebrationEvent(event.id);
                        await refreshEvents();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "삭제에 실패했습니다.");
                      } finally {
                        setBusyEventId(null);
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              </article>
            ))}
          </div>

          {!events.length ? (
            <div className="status note">{loading ? "불러오는 중입니다." : "표시할 이벤트가 없습니다."}</div>
          ) : null}
        </div>
      </article>

      {previewEvent ? <CelebrationOverlay event={previewEvent} onDismiss={() => setPreviewEvent(null)} /> : null}
    </section>
  );
}
