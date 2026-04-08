import { useId } from "react";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsCardItem, HOME_NEWS_CATEGORY_LABELS } from "@/components/home/home-news.types";

type HomeNewsCardProps = {
  item: HomeNewsCardItem;
  expanded: boolean;
  onToggle: () => void;
};

export function HomeNewsCard({ item, expanded, onToggle }: HomeNewsCardProps) {
  const panelId = useId();

  return (
    <article className={styles.card}>
      <button
        type="button"
        className={styles.cardToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <div className={styles.cardHeader}>
          <span className={styles.badge}>{HOME_NEWS_CATEGORY_LABELS[item.category]}</span>
          <span className={styles.tag}>{expanded ? "접기" : "펼치기"}</span>
        </div>
        <div className={styles.cardBody}>
          <h3 className={styles.cardTitle}>{item.title}</h3>
          <div className={styles.cardPreview}>
            <p>{item.summary[0]}</p>
          </div>
        </div>
        <span className={styles.cardChevron} aria-hidden="true">
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded ? (
        <div id={panelId} className={styles.cardExpanded}>
          <div className={styles.summary}>
            {item.summary.map((line, index) => (
              <p key={`${item.id}-${index}`}>{line}</p>
            ))}
          </div>
          <dl className={styles.meta}>
            <div className={styles.metaRow}>
              <dt>왜 중요한지</dt>
              <dd>{item.whyItMatters}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>오늘 체크 포인트</dt>
              <dd>
                <ul className={styles.checkList}>
                  {item.checkPoints.map((point, index) => (
                    <li key={`${item.id}-checkpoint-${index}`}>{point}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </article>
  );
}
