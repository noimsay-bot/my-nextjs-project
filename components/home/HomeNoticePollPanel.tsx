"use client";

import { useMemo, useState } from "react";
import {
  type HomeNoticePoll,
  voteHomeNoticePoll,
} from "@/lib/home-popup/storage";

type HomeNoticePollPanelProps = {
  noticeId: string;
  poll: HomeNoticePoll;
  readOnly?: boolean;
  compact?: boolean;
  onVoted?: () => void;
};

export function HomeNoticePollPanel({
  noticeId,
  poll,
  readOnly = false,
  compact = false,
  onVoted,
}: HomeNoticePollPanelProps) {
  const [submittingOptionId, setSubmittingOptionId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const currentUserVote = useMemo(
    () => poll.votes.find((vote) => vote.isCurrentUser) ?? null,
    [poll.votes],
  );
  const totalVotes = poll.votes.length;

  const voteCountsByOption = useMemo(() => {
    return poll.options.reduce<Record<string, number>>((counts, option) => {
      counts[option.id] = poll.votes.filter((vote) => vote.optionId === option.id).length;
      return counts;
    }, {});
  }, [poll.options, poll.votes]);

  const namesByOption = useMemo(() => {
    if (poll.voterMode !== "named") return {};
    return poll.options.reduce<Record<string, string[]>>((names, option) => {
      names[option.id] = poll.votes
        .filter((vote) => vote.optionId === option.id && vote.voterName)
        .map((vote) => vote.voterName as string);
      return names;
    }, {});
  }, [poll.options, poll.voterMode, poll.votes]);

  const handleVote = async (optionId: string) => {
    if (readOnly || currentUserVote || submittingOptionId) return;

    setSubmittingOptionId(optionId);
    setMessage(null);
    try {
      await voteHomeNoticePoll({ noticeId, optionId });
      setMessage({ tone: "ok", text: "투표를 반영했습니다." });
      onVoted?.();
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "투표를 반영하지 못했습니다.",
      });
    } finally {
      setSubmittingOptionId(null);
    }
  };

  return (
    <section
      style={{
        display: "grid",
        gap: compact ? 8 : 10,
        padding: compact ? "12px" : "14px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,.12)",
        background: "rgba(15,23,42,.36)",
      }}
      aria-label={`투표 ${poll.title}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: compact ? 15 : 16, lineHeight: 1.35 }}>{poll.title}</strong>
        <span className="chip">{poll.voterMode === "named" ? "실명 투표" : "익명 투표"} · {totalVotes}표</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {poll.options.map((option) => {
          const voteCount = voteCountsByOption[option.id] ?? 0;
          const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
          const selected = currentUserVote?.optionId === option.id;
          const disabled = readOnly || Boolean(currentUserVote) || Boolean(submittingOptionId);
          const voterNames = namesByOption[option.id] ?? [];

          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => void handleVote(option.id)}
              style={{
                position: "relative",
                display: "grid",
                gap: 6,
                width: "100%",
                minWidth: 0,
                padding: "10px 12px",
                overflow: "hidden",
                borderRadius: 12,
                border: selected ? "1px solid rgba(96,165,250,.66)" : "1px solid rgba(255,255,255,.12)",
                background: selected ? "rgba(59,130,246,.18)" : "rgba(255,255,255,.045)",
                color: "inherit",
                textAlign: "left",
                cursor: disabled ? "default" : "pointer",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${percentage}%`,
                  background: selected ? "rgba(96,165,250,.2)" : "rgba(148,163,184,.14)",
                  pointerEvents: "none",
                }}
              />
              <span style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                <strong style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.35 }}>
                  {option.title}
                </strong>
                <span className="muted" style={{ flex: "0 0 auto", fontSize: 12 }}>
                  {submittingOptionId === option.id ? "반영 중..." : `${voteCount}표 · ${percentage}%`}
                </span>
              </span>
              {poll.voterMode === "named" && voterNames.length > 0 ? (
                <span className="muted" style={{ position: "relative", fontSize: 12, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                  {voterNames.join(", ")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {readOnly ? <div className="status note">조회 전용 계정은 투표할 수 없습니다.</div> : null}
      {currentUserVote ? <div className="status note">이미 투표했습니다.</div> : null}
      {message?.text ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
    </section>
  );
}
