import styles from "@/components/home/HomeNews.module.css";
import { HomeNewsDataset } from "@/components/home/home-news.types";
import { type HomeDdayItem } from "@/lib/home-popup/storage";

type HomeNewsMetaProps = {
  data: HomeNewsDataset;
  ddayItems?: HomeDdayItem[];
  canManageDdays?: boolean;
  onManageDday?: (item: HomeDdayItem) => void;
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

function formatKstDate(value: string) {
  const parsed = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function getKstTodayStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function getDateValue(dateText: string) {
  const [year, month, day] = dateText.split("-").map((value) => Number(value));
  return Date.UTC(year, month - 1, day);
}

function getDdayLabel(targetDate: string) {
  const todayStamp = getKstTodayStamp();
  const diffDays = Math.round((getDateValue(targetDate) - getDateValue(todayStamp)) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "D-Day";
  if (diffDays > 0) return `D-${diffDays}`;
  return `D+${Math.abs(diffDays)}`;
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

function renderDdayItems(ddayItems: HomeDdayItem[], canManageDdays: boolean, onManageDday?: (item: HomeDdayItem) => void) {
  if (ddayItems.length === 0) return null;

  return (
    <div className={styles.metaBarDdays} aria-label="디데이 일정">
      {ddayItems.slice(0, 3).map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.metaBarDdayCard}
          onDoubleClick={() => {
            if (!canManageDdays || !onManageDday) return;
            onManageDday(item);
          }}
          title={canManageDdays ? "더블클릭하면 수정 또는 삭제할 수 있습니다." : undefined}
        >
          <strong className={styles.metaBarDdayValue}>{getDdayLabel(item.targetDate)}</strong>
          <div className={styles.metaBarDdayInfo}>
            <span className={styles.metaBarDdayTitle}>{item.title}</span>
            <span className={styles.metaBarDdayDate}>{formatKstDate(item.targetDate)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function HomeNewsMeta({ data, ddayItems = [], canManageDdays = false, onManageDday }: HomeNewsMetaProps) {
  const itemCount = countUniqueItems(data);
  let title = "";
  let detail = "";

  if (data.runtimeBriefing && data.sourceKind === "timed_live_preview") {
    const slotLabel = getIssueSlotLabel(data.runtimeBriefing.briefingSlot);
    const slotGuide = getRuntimeSlotGuide(data.runtimeBriefing.briefingSlot);
    const generatedLabel = formatKstDateTime(data.runtimeBriefing.generatedAt);

    title = `${slotLabel} · ${slotGuide}`;
    detail = `현재 시각 기준 반영${generatedLabel ? ` · ${generatedLabel} 갱신` : ""}${itemCount > 0 ? ` · ${itemCount}건 표시` : ""}`;
  } else if (data.issueSet && data.sourceKind === "official_issue_set") {
    const slotLabel = getIssueSlotLabel(data.issueSet.briefingSlot);
    const slotGuide = getIssueSlotGuide(data.issueSet.briefingSlot);
    const publishedLabel = formatKstDateTime(data.issueSet.publishedAt);

    title = `${slotLabel} · ${slotGuide}`;
    detail = `공식 발행본${publishedLabel ? ` · ${publishedLabel} 발행` : ""}${itemCount > 0 ? ` · ${itemCount}건 반영` : ""}`;
  } else {
    const latestLabel = formatKstDateTime(getLatestDatasetTimestamp(data));
    title = latestLabel ? `${latestLabel} 업데이트 기준` : "업데이트 시각 확인 중";
    detail = itemCount > 0 ? `${itemCount}건 표시` : "표시 가능한 뉴스 확인 중";
  }

  return (
    <div className={styles.metaBar} aria-live="polite">
      <div className={styles.metaBarInfo}>
        <div className={styles.metaBarTitle}>{title}</div>
        <div className={styles.metaBarDetail}>{detail}</div>
      </div>
      {renderDdayItems(ddayItems, canManageDdays, onManageDday)}
    </div>
  );
}
