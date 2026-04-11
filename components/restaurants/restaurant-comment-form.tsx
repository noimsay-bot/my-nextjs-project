"use client";

import { useState } from "react";
import { createRestaurantComment } from "@/lib/restaurants/comments";

export function RestaurantCommentForm({
  restaurantId,
  authorId,
  onCreated,
}: {
  restaurantId: string;
  authorId: string | null;
  onCreated: () => Promise<void> | void;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "warn" | "note">("note");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authorId) {
      setMessageTone("warn");
      setMessage("로그인 정보가 없습니다. 다시 로그인해 주세요.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    const result = await createRestaurantComment(authorId, restaurantId, { content });
    setSubmitting(false);

    if (!result.ok) {
      setMessageTone("warn");
      setMessage(result.message);
      return;
    }

    setContent("");
    setMessageTone("ok");
    setMessage(result.message);
    await onCreated();
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <textarea
        className="field-input"
        value={content}
        onChange={(event) => setContent(event.target.value.slice(0, 200))}
        placeholder="이 맛집에 대한 짧은 코멘트를 남겨 주세요."
        rows={4}
        style={{ resize: "vertical", minHeight: 110 }}
        disabled={submitting}
      />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {content.length}/200
        </span>
        <button type="submit" className="btn primary" disabled={submitting}>
          {submitting ? "등록 중..." : "코멘트 등록"}
        </button>
      </div>
      {message ? <div className={`status ${messageTone}`}>{message}</div> : null}
    </form>
  );
}
