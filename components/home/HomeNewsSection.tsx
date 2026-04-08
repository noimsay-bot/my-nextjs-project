import { HomeNewsMeta } from "@/components/home/HomeNewsMeta";
import { HomeNewsTicker } from "@/components/home/HomeNewsTicker";
import { HomeNewsTabs } from "@/components/home/HomeNewsTabs";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsDataset } from "@/components/home/home-news.types";

type HomeNewsSectionProps = {
  data: HomeNewsDataset;
  loading?: boolean;
  togglingPreferenceId?: string | null;
  onSetPreference?: (itemId: string, nextPreference: "like" | "dislike" | null) => void;
};

export function HomeNewsSection({
  data,
  loading = false,
  togglingPreferenceId = null,
  onSetPreference,
}: HomeNewsSectionProps) {
  return (
    <section className={styles.section} aria-label="뉴스 브리핑">
      <HomeNewsMeta data={data} />
      <HomeNewsTicker items={data.tickerItems} loading={loading} />
      <HomeNewsTabs
        cardsByCategory={data.cardsByCategory}
        recommendedCategory={data.recommendedCategory}
        loading={loading}
        togglingPreferenceId={togglingPreferenceId}
        onSetPreference={onSetPreference}
      />
    </section>
  );
}
