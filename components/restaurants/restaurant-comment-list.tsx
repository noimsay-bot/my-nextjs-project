"use client";

import { useState } from "react";
import { deleteRestaurantComment, updateRestaurantComment } from "@/lib/restaurants/comments";
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
  restaurantAuthorId,
  onChanged,
}: {
  comments: RestaurantCommentRow[];
  currentUserId: string | null;
  restaurantAuthorId: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
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
    await onChanged();
  };

  const handleEditStart = (comment: RestaurantCommentRow) => {
    setEditingId(comment.id);
    setEditingContent(comment.content);
    setMessage("");
  };

  const handleEditSave = async (commentId: string) => {
    if (!currentUserId) return;

    setSavingId(commentId);
    setMessage("");
    const result = await updateRestaurantComment(currentUserId, commentId, { content: editingContent });
    setSavingId(null);

    if (!result.ok) {
      setMessageTone("warn");
      setMessage(result.message);
      return;
    }

    setEditingId(null);
    setEditingContent("");
    setMessageTone("ok");
    setMessage(result.message);
    await onChanged();
  };

  if (comments.length === 0) {
    return <div className="status note">아직 등록된 코멘트가 없습니다.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {comments.map((comment) => {
        const isOwn = currentUserId === comment.authorId;
        const canEdit = currentUserId === comment.authorId || currentUserId === restaurantAuthorId;
        const editing = editingId === comment.id;
        return (
          <article key={comment.id} className="panel">
            <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <strong style={{ fontSize: 16 }}>익명</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatCreatedAt(comment.createdAt) || "-"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (editing) {
                          setEditingId(null);
                          setEditingContent("");
                          return;
                        }
                        handleEditStart(comment);
                      }}
                      disabled={savingId === comment.id}
                    >
                      {editing ? "취소" : "수정"}
                    </button>
                  ) : null}
                  {isOwn ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void handleDelete(comment.id)}
                      disabled={deletingId === comment.id || savingId === comment.id}
                    >
                      {deletingId === comment.id ? "삭제 중..." : "삭제"}
                    </button>
                  ) : null}
                </div>
              </div>
              {editing ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <textarea
                    className="field-input"
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value.slice(0, 200))}
                    rows={4}
                    style={{ resize: "vertical", minHeight: 110 }}
                    disabled={savingId === comment.id}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {editingContent.length}/200
                    </span>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => void handleEditSave(comment.id)}
                      disabled={savingId === comment.id}
                    >
                      {savingId === comment.id ? "저장 중..." : "수정 저장"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{comment.content}</div>
              )}
            </div>
          </article>
        );
      })}
      {message ? <div className={`status ${messageTone}`}>{message}</div> : null}
    </div>
  );
}
