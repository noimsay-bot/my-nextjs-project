import styles from "@/components/home/HomeNews.module.css";

type HomeNoticeTickerItem = {
  id: string;
  text: string;
};

type HomeNewsTickerProps = {
  items: HomeNoticeTickerItem[];
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
        <strong>아직 표시할 공지가 없습니다.</strong>
        <p>공지 제목이 등록되면 이 영역에 흐르는 전광판처럼 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className={styles.tickerViewport} aria-label="공지 제목 흐름">
      <div className={styles.tickerTrack}>
        {[0, 1].map((groupIndex) => (
          <div key={groupIndex} className={styles.tickerGroup} aria-hidden={groupIndex === 1}>
            {items.map((item) => (
              <button
                key={`${groupIndex}-${item.id}`}
                type="button"
                className={styles.tickerItem}
                aria-label={`공지 제목 ${item.text}`}
                aria-hidden={groupIndex === 1}
                tabIndex={groupIndex === 1 ? -1 : 0}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  handleSelectItem(item.id);
                }}
                onClick={() => handleSelectItem(item.id)}
              >
                <span className={styles.tickerCategory}>공지</span>
                <span className={styles.tickerText}>{item.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
