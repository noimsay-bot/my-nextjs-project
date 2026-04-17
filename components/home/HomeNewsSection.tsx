import { HomeNewsMeta } from "@/components/home/HomeNewsMeta";
import { HomeNewsTicker } from "@/components/home/HomeNewsTicker";
import { HomeNewsTabs } from "@/components/home/HomeNewsTabs";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsDataset } from "@/components/home/home-news.types";
import { type HomeDdayItem } from "@/lib/home-popup/storage";

type HomeNewsSectionProps = {
  data: HomeNewsDataset;
  ddayItems?: HomeDdayItem[];
  canManageDdays?: boolean;
  onManageDday?: (item: HomeDdayItem) => void;
  loading?: boolean;
  requestedOpenItemId?: string | null;
  requestedOpenToken?: number;
  togglingPreferenceId?: string | null;
  onSelectTickerItem?: (itemId: string) => void;
  onSetPreference?: (itemId: string, nextPreference: "like" | "dislike" | null) => void;
  canDeleteNotice?: boolean;
  deletingNoticeId?: string | null;
  onDeleteNotice?: (itemId: string) => void;
};

export function HomeNewsSection({
  data,
  ddayItems = [],
  canManageDdays = false,
  onManageDday,
  loading = false,
  requestedOpenItemId = null,
  requestedOpenToken = 0,
  togglingPreferenceId = null,
  onSelectTickerItem,
  onSetPreference,
  canDeleteNotice = false,
  deletingNoticeId = null,
  onDeleteNotice,
}: HomeNewsSectionProps) {
  return (
    <section className={styles.section} aria-label="뉴스 브리핑">
      <HomeNewsMeta data={data} ddayItems={ddayItems} canManageDdays={canManageDdays} onManageDday={onManageDday} />
      <HomeNewsTicker
        items={data.tickerItems}
        loading={loading}
        onSelectItem={onSelectTickerItem}
      />
      <HomeNewsTabs
        cardsByCategory={data.cardsByCategory}
        temporarySections={data.temporarySections}
        recommendedCategory={data.recommendedCategory}
        loading={loading}
        requestedOpenItemId={requestedOpenItemId}
        requestedOpenToken={requestedOpenToken}
        togglingPreferenceId={togglingPreferenceId}
        onSetPreference={onSetPreference}
        canDeleteNotice={canDeleteNotice}
        deletingNoticeId={deletingNoticeId}
        onDeleteNotice={onDeleteNotice}
      />
    </section>
  );
}
