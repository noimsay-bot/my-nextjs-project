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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setBody("");
      setAttachments([]);
      setAttachmentPreviews([]);
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

  useEffect(() => {
    const urls = attachments.map((file) => URL.createObjectURL(file));
    setAttachmentPreviews(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  if (!open) return null;

  const canSubmit = body.trim().length > 0 && !submitting;
  const addAttachments = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) return;
    const imageFiles = nextFiles.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length !== nextFiles.length) {
      setMessage("사진 파일만 첨부할 수 있습니다.");
      return;
    }
    if (imageFiles.some((file) => file.size > 5 * 1024 * 1024)) {
      setMessage("사진은 파일당 5MB 이하로 첨부해 주세요.");
      return;
    }
    setAttachments((current) => {
      const combined = [...current, ...imageFiles].slice(0, 3);
      if (current.length + imageFiles.length > 3) {
        setMessage("사진은 최대 3장까지 첨부할 수 있습니다.");
      } else {
        setMessage("");
      }
      return combined;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setMessage("");
  };

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
          const result = await submitCustomerSupportMessage(body, attachments);
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
        <div className="customer-support-dialog__attachments">
          <input
            ref={fileInputRef}
            id="customer-support-attachments"
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => addAttachments(event.target.files)}
            disabled={submitting || attachments.length >= 3}
          />
          <label
            className={`btn ${attachments.length >= 3 || submitting ? "disabled" : ""}`.trim()}
            htmlFor="customer-support-attachments"
            aria-disabled={attachments.length >= 3 || submitting}
          >
            사진 첨부
          </label>
          <span className="muted">최대 3장, 파일당 5MB</span>
        </div>
        {attachments.length > 0 ? (
          <div className="customer-support-dialog__preview-list">
            {attachments.map((file, index) => (
              <div key={`${file.name}-${file.lastModified}-${index}`} className="customer-support-dialog__preview">
                {attachmentPreviews[index] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attachmentPreviews[index]} alt="" />
                ) : null}
                <span>{file.name}</span>
                <button type="button" className="btn" onClick={() => removeAttachment(index)} disabled={submitting}>
                  삭제
                </button>
              </div>
            ))}
          </div>
        ) : null}
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
