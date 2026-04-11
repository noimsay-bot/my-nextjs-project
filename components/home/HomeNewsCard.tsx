import { useId } from "react";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsCardItem, HOME_NEWS_CATEGORY_LABELS } from "@/components/home/home-news.types";

type HomeNewsCardProps = {
  item: HomeNewsCardItem;
  expanded: boolean;
  onToggle: () => void;
  togglingPreference?: boolean;
  onSetPreference?: (nextPreference: "like" | "dislike" | null) => void;
  canDeleteNotice?: boolean;
  deletingNotice?: boolean;
  onDeleteNotice?: () => void;
};

export function HomeNewsCard({
  item,
  expanded,
  onToggle,
  togglingPreference = false,
  onSetPreference,
  canDeleteNotice = false,
  deletingNotice = false,
  onDeleteNotice,
}: HomeNewsCardProps) {
  const panelId = useId();
  const viewerHasLiked = item.viewerHasLiked ?? false;
  const viewerHasDisliked = item.viewerHasDisliked ?? false;
  const likesCount = item.likesCount ?? 0;

  return (
    <article className={`${styles.card} ${item.noticeTone === "urgent" ? styles.cardNoticeUrgent : item.noticeTone === "normal" ? styles.cardNoticeNormal : ""}`}>
      <button
        type="button"
        className={`${styles.cardToggle} ${!expanded ? styles.cardToggleCollapsed : ""}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {expanded ? (
          <div className={styles.cardHeader}>
            <span className={styles.badge}>{item.badgeLabel ?? HOME_NEWS_CATEGORY_LABELS[item.category]}</span>
            <span className={styles.tag}>{item.tagLabel ?? "접기"}</span>
          </div>
        ) : null}
        <div className={`${styles.cardBody} ${!expanded ? styles.cardBodyCollapsed : ""}`}>
          <h3 className={`${styles.cardTitle} ${!expanded ? styles.cardTitleCollapsed : ""}`}>{item.title}</h3>
        </div>
      </button>
      {expanded ? (
        <div id={panelId} className={styles.cardExpanded}>
          {canDeleteNotice && onDeleteNotice ? (
            <div className={styles.noticeManageRow}>
              <button
                type="button"
                className={styles.noticeDeleteButton}
                disabled={deletingNotice}
                onClick={onDeleteNotice}
              >
                {deletingNotice ? "삭제 중..." : "삭제"}
              </button>
            </div>
          ) : null}
          <div className={styles.summary}>
            {item.summary.map((line, index) => (
              <p key={`${item.id}-${index}`}>{line}</p>
            ))}
          </div>
          {item.sourceLabel ? (
            <p className={styles.sourceNote}>참고 출처: {item.sourceLabel}</p>
          ) : null}
          {onSetPreference && !item.disablePreferenceActions ? (
            <div className={styles.cardActions}>
              <button
                type="button"
                className={`${styles.feedbackButton} ${viewerHasLiked ? styles.feedbackButtonActive : ""}`}
                aria-pressed={viewerHasLiked}
                aria-label={viewerHasLiked ? "좋아요 취소" : "좋아요"}
                disabled={togglingPreference}
                onClick={() => onSetPreference(viewerHasLiked ? null : "like")}
              >
                <span className={styles.feedbackButtonIcon} aria-hidden="true">
                  {viewerHasLiked ? "★" : "☆"}
                </span>
                <span>좋아요</span>
                <span className={styles.feedbackCount}>{likesCount}</span>
              </button>
              <button
                type="button"
                className={`${styles.feedbackButton} ${viewerHasDisliked ? styles.feedbackButtonMuted : ""}`}
                aria-pressed={viewerHasDisliked}
                aria-label={viewerHasDisliked ? "별로.. 취소" : "별로.."}
                disabled={togglingPreference}
                onClick={() => onSetPreference(viewerHasDisliked ? null : "dislike")}
              >
                <span className={styles.feedbackButtonIcon} aria-hidden="true">
                  {viewerHasDisliked ? "●" : "○"}
                </span>
                <span>별로..</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
