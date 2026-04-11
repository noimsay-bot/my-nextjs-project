"use client";

import { useState } from "react";
import { deleteRestaurantComment } from "@/lib/restaurants/comments";
import type { RestaurantCommentRow } from "@/lib/restaurants/types";

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function RestaurantCommentList({
  comments,
  currentUserId,
  onDeleted,
}: {
  comments: RestaurantCommentRow[];
  currentUserId: string | null;
  onDeleted: () => Promise<void> | void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "warn" | "note">("note");

  const handleDelete = async (commentId: string) => {
    if (!currentUserId) return;

    const confirmed = window.confirm("이 코멘트를 삭제하시겠습니까?");
    if (!confirmed) return;

    setDeletingId(commentId);
    setMessage("");
    const result = await deleteRestaurantComment(currentUserId, commentId);
    setDeletingId(null);

    if (!result.ok) {
      setMessageTone("warn");
      setMessage(result.message);
      return;
    }

    setMessageTone("ok");
    setMessage(result.message);
    await onDeleted();
  };

  if (comments.length === 0) {
    return <div className="status note">아직 등록된 코멘트가 없습니다.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {comments.map((comment) => {
        const isOwn = currentUserId === comment.authorId;
        return (
          <article key={comment.id} className="panel">
            <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <strong style={{ fontSize: 16 }}>{comment.authorName || "이름 미확인"}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatCreatedAt(comment.createdAt) || "-"}
                  </span>
                </div>
                {isOwn ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleDelete(comment.id)}
                    disabled={deletingId === comment.id}
                  >
                    {deletingId === comment.id ? "삭제 중..." : "삭제"}
                  </button>
                ) : null}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{comment.content}</div>
            </div>
          </article>
        );
      })}
      {message ? <div className={`status ${messageTone}`}>{message}</div> : null}
    </div>
  );
}
