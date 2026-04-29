import { HomeNoticeFeed } from "@/components/home/HomeNoticeFeed";
import { HomeNewsMeta } from "@/components/home/HomeNewsMeta";
import { HomeNewsTicker } from "@/components/home/HomeNewsTicker";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsCardItem } from "@/components/home/home-news.types";
import { type HomeDdayItem } from "@/lib/home-popup/storage";

type HomeNewsSectionProps = {
  noticeItems: HomeNewsCardItem[];
  ddayItems?: HomeDdayItem[];
  canManageDdays?: boolean;
  onManageDday?: (item: HomeDdayItem) => void;
  loading?: boolean;
  requestedOpenItemId?: string | null;
  requestedOpenToken?: number;
  canDeleteNotice?: boolean;
  deletingNoticeId?: string | null;
  onDeleteNotice?: (itemId: string) => void;
  onSelectTickerItem?: (itemId: string) => void;
};

export function HomeNewsSection({
  noticeItems,
  ddayItems = [],
  canManageDdays = false,
  onManageDday,
  loading = false,
  requestedOpenItemId = null,
  requestedOpenToken = 0,
  canDeleteNotice = false,
  deletingNoticeId = null,
  onDeleteNotice,
  onSelectTickerItem,
}: HomeNewsSectionProps) {
  return (
    <section className={styles.section} aria-label="공지">
      <HomeNewsMeta
        noticeItems={noticeItems.map((item) => ({
          id: item.id,
          title: item.title,
          publishedAt: item.publishedAt,
        }))}
        ddayItems={ddayItems}
        canManageDdays={canManageDdays}
        onManageDday={onManageDday}
      />
      <HomeNewsTicker
        items={noticeItems.map((item) => ({
          id: item.id,
          text: item.title,
        }))}
        loading={loading}
        onSelectItem={onSelectTickerItem}
      />
      <HomeNoticeFeed
        items={noticeItems}
        loading={loading}
        requestedOpenItemId={requestedOpenItemId}
        requestedOpenToken={requestedOpenToken}
        canDeleteNotice={canDeleteNotice}
        deletingNoticeId={deletingNoticeId}
        onDeleteNotice={onDeleteNotice}
      />
    </section>
  );
}
