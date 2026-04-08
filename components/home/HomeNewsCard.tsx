import { useId } from "react";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsCardItem, HOME_NEWS_CATEGORY_LABELS } from "@/components/home/home-news.types";

type HomeNewsCardProps = {
  item: HomeNewsCardItem;
  expanded: boolean;
  onToggle: () => void;
  togglingLike?: boolean;
  onToggleLike?: (nextLiked: boolean) => void;
};

export function HomeNewsCard({
  item,
  expanded,
  onToggle,
  togglingLike = false,
  onToggleLike,
}: HomeNewsCardProps) {
  const panelId = useId();
  const viewerHasLiked = item.viewerHasLiked ?? false;
  const likesCount = item.likesCount ?? 0;

  return (
    <article className={styles.card}>
      <button
        type="button"
        className={`${styles.cardToggle} ${!expanded ? styles.cardToggleCollapsed : ""}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {expanded ? (
          <div className={styles.cardHeader}>
            <span className={styles.badge}>{HOME_NEWS_CATEGORY_LABELS[item.category]}</span>
            <span className={styles.tag}>접기</span>
          </div>
        ) : null}
        <div className={`${styles.cardBody} ${!expanded ? styles.cardBodyCollapsed : ""}`}>
          <h3 className={`${styles.cardTitle} ${!expanded ? styles.cardTitleCollapsed : ""}`}>{item.title}</h3>
        </div>
      </button>
      {expanded ? (
        <div id={panelId} className={styles.cardExpanded}>
          <div className={styles.summary}>
            {item.summary.map((line, index) => (
              <p key={`${item.id}-${index}`}>{line}</p>
            ))}
          </div>
          {onToggleLike ? (
            <div className={styles.cardActions}>
              <button
                type="button"
                className={`${styles.likeButton} ${viewerHasLiked ? styles.likeButtonActive : ""}`}
                aria-pressed={viewerHasLiked}
                aria-label={viewerHasLiked ? "좋아요 취소" : "좋아요"}
                disabled={togglingLike}
                onClick={() => onToggleLike(!viewerHasLiked)}
              >
                <span className={styles.likeButtonIcon} aria-hidden="true">
                  {viewerHasLiked ? "★" : "☆"}
                </span>
                <span>{viewerHasLiked ? "관심중" : "관심"}</span>
                <span className={styles.likeCount}>{likesCount}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
