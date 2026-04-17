import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsTickerItem, HOME_NEWS_CATEGORY_LABELS } from "@/components/home/home-news.types";

type HomeNewsTickerProps = {
  items: HomeNewsTickerItem[];
  loading?: boolean;
  onSelectItem?: (itemId: string) => void;
};

export function HomeNewsTicker({ items, loading = false, onSelectItem }: HomeNewsTickerProps) {
  const handleSelectItem = (itemId: string) => {
    onSelectItem?.(itemId);
  };

  if (loading) {
    return (
      <div className={styles.tickerSkeleton} aria-hidden="true">
        <span className={styles.tickerSkeletonPill} />
        <span className={styles.tickerSkeletonLine} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty} role="status" aria-live="polite">
        <strong>아직 표시할 브리핑 문구가 없습니다.</strong>
        <p>뉴스 요약 데이터가 연결되면 이 영역에 전광판형 브리핑이 자동으로 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className={styles.tickerViewport} aria-label="핵심 뉴스 브리핑">
      <div className={styles.tickerTrack}>
        {[0, 1].map((groupIndex) => (
          <div key={groupIndex} className={styles.tickerGroup} aria-hidden={groupIndex === 1}>
            {items.map((item) => (
              <button
                key={`${groupIndex}-${item.id}`}
                type="button"
                className={styles.tickerItem}
                aria-label={`${HOME_NEWS_CATEGORY_LABELS[item.category]} 브리핑`}
                aria-hidden={groupIndex === 1}
                tabIndex={groupIndex === 1 ? -1 : 0}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  handleSelectItem(item.id);
                }}
                onClick={() => handleSelectItem(item.id)}
              >
                <span className={styles.tickerCategory}>{HOME_NEWS_CATEGORY_LABELS[item.category]}</span>
                <span className={styles.tickerText}>{item.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
