"use client";

import { useEffect, useRef, useState } from "react";
import { submitCustomerSupportMessage } from "@/lib/portal/customer-support";

const CUSTOMER_SUPPORT_PLACEHOLDER =
  "익명으로 전송됩니다. 사이트 오류 신고, 기능제안, 개선 제안 등 관리자에게 전달할 내용을 작성해주세요";

type CustomerSupportDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function CustomerSupportDialog({ open, onClose }: CustomerSupportDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setBody("");
      setMessage("");
      setSubmitting(false);
      return;
    }

    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const canSubmit = body.trim().length > 0 && !submitting;

  return (
    <div className="customer-support-dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="customer-support-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-support-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSubmit) return;

          setSubmitting(true);
          setMessage("");
          const result = await submitCustomerSupportMessage(body);
          setSubmitting(false);
          if (!result.ok) {
            setMessage(result.message);
            return;
          }

          onClose();
        }}
      >
        <div className="customer-support-dialog__header">
          <h2 id="customer-support-dialog-title">고객센터</h2>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="field-textarea customer-support-dialog__textarea"
          placeholder={CUSTOMER_SUPPORT_PLACEHOLDER}
          value={body}
          maxLength={2000}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="customer-support-dialog__footer">
          <span className={message ? "status warn" : "muted"} aria-live="polite">
            {message || `${body.trim().length.toLocaleString("ko-KR")} / 2,000`}
          </span>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {submitting ? "전송 중" : "작성완료"}
          </button>
        </div>
      </form>
    </div>
  );
}
