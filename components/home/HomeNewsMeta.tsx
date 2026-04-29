import Image from "next/image";
import styles from "@/components/home/HomeNews.module.css";
import { type HomeDdayItem } from "@/lib/home-popup/storage";

type HomeNoticeMetaItem = {
  id: string;
  title: string;
  publishedAt?: string;
};

type HomeNewsMetaProps = {
  noticeItems?: HomeNoticeMetaItem[];
  ddayItems?: HomeDdayItem[];
  canManageDdays?: boolean;
  onManageDday?: (item: HomeDdayItem) => void;
};

const WORLD_CUP_PROJECT_URL = "https://marchis1015ab-sketch.github.io/2026worldcup-project/";

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

function getLatestNoticeTimestamp(noticeItems: HomeNoticeMetaItem[]) {
  const latest = noticeItems
    .map((item) => (item.publishedAt ? new Date(item.publishedAt).getTime() : Number.NaN))
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

function renderWorldCupHoverBanner() {
  return (
    <a
      href={WORLD_CUP_PROJECT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.metaBarHoverBanner}
      aria-label="2026 월드컵 프로젝트 바로가기"
    >
      <Image
        src="/images/worldcup-banner-jtbc.png"
        alt="짜릿하게 대체불가 월드컵은 JTBC 배너"
        fill
        sizes="(max-width: 768px) 100vw, 340px"
        className={styles.metaBarHoverBannerDefault}
      />
    </a>
  );
}

function renderDdayArea(ddayItems: HomeDdayItem[], canManageDdays: boolean, onManageDday?: (item: HomeDdayItem) => void) {
  return (
    <div className={styles.metaBarDdayArea}>
      {renderWorldCupHoverBanner()}
      {renderDdayItems(ddayItems, canManageDdays, onManageDday)}
    </div>
  );
}

export function HomeNewsMeta({ noticeItems = [], ddayItems = [], canManageDdays = false, onManageDday }: HomeNewsMetaProps) {
  const latestLabel = formatKstDateTime(getLatestNoticeTimestamp(noticeItems));
  const title = latestLabel ? `${latestLabel} 공지 업데이트 기준` : "공지 업데이트 기준";
  const detail =
    noticeItems.length > 0
      ? `등록 공지 ${noticeItems.length}건 · 제목 클릭 시 본문으로 이동`
      : "등록된 공지를 기다리는 중입니다.";

  return (
    <div className={styles.metaBar} aria-live="polite">
      <div className={styles.metaBarInfo}>
        <div className={styles.metaBarTitle}>{title}</div>
        <div className={styles.metaBarDetail} data-portal-news-meta-detail="true">
          {detail}
        </div>
      </div>
      {renderDdayArea(ddayItems, canManageDdays, onManageDday)}
    </div>
  );
}
