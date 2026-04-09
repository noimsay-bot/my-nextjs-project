import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsDataset } from "@/components/home/home-news.types";

type HomeNewsMetaProps = {
  data: HomeNewsDataset;
};

function formatKstDateTime(value?: string) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getIssueSlotLabel(slot?: "morning_6" | "afternoon_3") {
  if (slot === "morning_6") return "오늘 오전판";
  if (slot === "afternoon_3") return "오늘 오후판";
  return "";
}

function getIssueSlotGuide(slot?: "morning_6" | "afternoon_3") {
  if (slot === "morning_6") return "오전 6시 기준 공식 브리핑";
  if (slot === "afternoon_3") return "오후 3시 기준 공식 브리핑";
  return "";
}

function getRuntimeSlotGuide(slot?: "morning_6" | "afternoon_3") {
  if (slot === "morning_6") return "오전 6시 기준 브리핑";
  if (slot === "afternoon_3") return "오후 3시 기준 브리핑";
  return "";
}

function countUniqueItems(data: HomeNewsDataset) {
  const ids = new Set(
    Object.values(data.cardsByCategory)
      .flatMap((items) => items ?? [])
      .map((item) => item.id),
  );
  return ids.size > 0 ? ids.size : data.tickerItems.length;
}

function getLatestDatasetTimestamp(data: HomeNewsDataset) {
  const timestamps = [
    ...data.tickerItems.map((item) => item.publishedAt).filter(Boolean),
    ...Object.values(data.cardsByCategory)
      .flatMap((items) => items ?? [])
      .flatMap((item) => [item.publishedAt, item.occurredAt])
      .filter(Boolean),
  ];

  const latest = timestamps
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];

  return Number.isFinite(latest) ? new Date(latest).toISOString() : "";
}

export function HomeNewsMeta({ data }: HomeNewsMetaProps) {
  const itemCount = countUniqueItems(data);

  if (data.runtimeBriefing && data.sourceKind === "timed_live_preview") {
    const slotLabel = getIssueSlotLabel(data.runtimeBriefing.briefingSlot);
    const slotGuide = getRuntimeSlotGuide(data.runtimeBriefing.briefingSlot);
    const generatedLabel = formatKstDateTime(data.runtimeBriefing.generatedAt);

    return (
      <div className={styles.metaBar} aria-live="polite">
        <div className={styles.metaBarTitle}>
          {slotLabel} · {slotGuide}
        </div>
        <div className={styles.metaBarDetail}>
          현재 시각 기준 반영
          {generatedLabel ? ` · ${generatedLabel} 갱신` : ""}
          {itemCount > 0 ? ` · ${itemCount}건 표시` : ""}
        </div>
      </div>
    );
  }

  if (data.issueSet && data.sourceKind === "official_issue_set") {
    const slotLabel = getIssueSlotLabel(data.issueSet.briefingSlot);
    const slotGuide = getIssueSlotGuide(data.issueSet.briefingSlot);
    const publishedLabel = formatKstDateTime(data.issueSet.publishedAt);

    return (
      <div className={styles.metaBar} aria-live="polite">
        <div className={styles.metaBarTitle}>
          {slotLabel} · {slotGuide}
        </div>
        <div className={styles.metaBarDetail}>
          공식 발행본
          {publishedLabel ? ` · ${publishedLabel} 발행` : ""}
          {itemCount > 0 ? ` · ${itemCount}건 반영` : ""}
        </div>
      </div>
    );
  }

  const latestLabel = formatKstDateTime(getLatestDatasetTimestamp(data));

  return (
    <div className={styles.metaBar} aria-live="polite">
      <div className={styles.metaBarTitle}>
        {latestLabel ? `${latestLabel} 업데이트 기준` : "업데이트 시각 확인 중"}
      </div>
      <div className={styles.metaBarDetail}>
        {itemCount > 0 ? `${itemCount}건 표시` : "표시 가능한 뉴스 확인 중"}
      </div>
    </div>
  );
}
