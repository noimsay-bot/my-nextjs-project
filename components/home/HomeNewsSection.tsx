import { HomeNoticeFeed } from "@/components/home/HomeNoticeFeed";
import { HomeNewsMeta } from "@/components/home/HomeNewsMeta";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsCardItem } from "@/components/home/home-news.types";
import { type HomeDdayItem } from "@/lib/home-popup/storage";

type HomeNewsSectionProps = {
  noticeItems: HomeNewsCardItem[];
  ddayItems?: HomeDdayItem[];
  canManageDdays?: boolean;
  onManageDday?: (item: HomeDdayItem) => void;
  loading?: boolean;
  canDeleteNotice?: boolean;
  deletingNoticeId?: string | null;
  onDeleteNotice?: (itemId: string) => void;
};

export function HomeNewsSection({
  noticeItems,
  ddayItems = [],
  canManageDdays = false,
  onManageDday,
  loading = false,
  canDeleteNotice = false,
  deletingNoticeId = null,
  onDeleteNotice,
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
      <HomeNoticeFeed
        items={noticeItems}
        loading={loading}
        canDeleteNotice={canDeleteNotice}
        deletingNoticeId={deletingNoticeId}
        onDeleteNotice={onDeleteNotice}
      />
    </section>
  );
}
