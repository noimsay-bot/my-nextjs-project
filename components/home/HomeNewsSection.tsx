import { HomeNewsTicker } from "@/components/home/HomeNewsTicker";
import { HomeNewsTabs } from "@/components/home/HomeNewsTabs";
import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsDataset } from "@/components/home/home-news.types";

type HomeNewsSectionProps = {
  data: HomeNewsDataset;
  loading?: boolean;
};

export function HomeNewsSection({ data, loading = false }: HomeNewsSectionProps) {
  return (
    <section className={styles.section} aria-label="뉴스 브리핑">
      <HomeNewsTicker items={data.tickerItems} loading={loading} />
      <HomeNewsTabs cardsByCategory={data.cardsByCategory} loading={loading} />
    </section>
  );
}
