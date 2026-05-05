"use client";

import { isReadOnlyPortalRole, type UserRole } from "@/lib/auth/storage";
import type { TeamLeadTripPersonCard } from "@/lib/team-lead/storage";
import {
  getPortalSession,
  getPortalSupabaseClient,
  getSupabaseStorageErrorMessage,
  isSupabaseSchemaMissingError,
} from "@/lib/supabase/portal";

const HOME_POPUP_NOTICE_ROW_KEY = "active";
const HOME_NOTICE_STORE_VERSION = 5;

export const HOME_POPUP_NOTICE_EVENT = "j-home-popup-notice-updated";
export const HOME_POPUP_NOTICE_STATUS_EVENT = "j-home-popup-notice-status";

export type HomeNoticeKind = "general" | "popup";
export type HomeNoticeTone = "normal" | "urgent";
export type CommunityBoardCategory = "notice" | "family" | "celebration" | "resource";

export interface HomeNotice {
  id: string;
  title: string;
  body: string;
  kind: HomeNoticeKind;
  tone: HomeNoticeTone;
  isActive: boolean;
  applicationEnabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomePopupNotice extends HomeNotice {
  kind: "popup";
}

export interface HomeDdayItem {
  id: string;
  title: string;
  targetDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityBoardPost {
  id: string;
  category: CommunityBoardCategory;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  attachment?: CommunityBoardAttachment | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityBoardAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface CommunityBoardComment {
  id: string;
  targetKey: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface HomePopupNoticeApplication {
  id: string;
  noticeId: string;
  applicantId: string;
  applicantName: string;
  createdAt: string;
}

interface HomePopupNoticeStateRow {
  key: string;
  notice_id: string;
  title: string;
  body: string;
  is_active: boolean;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface HomePopupNoticeApplicationRow {
  id: string;
  notice_id: string;
  applicant_id: string;
  applicant_name: string;
  created_at: string;
}

interface HomeNoticeStorePayload {
  version: number;
  notices: HomeNotice[];
  ddays?: HomeDdayItem[];
  communityPosts?: CommunityBoardPost[];
  communityComments?: CommunityBoardComment[];
}

type RefreshResult = {
  notice: HomePopupNotice | null;
  notices: HomeNotice[];
  ddays: HomeDdayItem[];
  communityPosts: CommunityBoardPost[];
  communityComments: CommunityBoardComment[];
  applications: HomePopupNoticeApplication[];
  tripCards: TeamLeadTripPersonCard[];
};

type HomePublicWorkspaceResponse = {
  notice: HomePopupNotice | null;
  notices: HomeNotice[];
  ddays: HomeDdayItem[];
  communityPosts: CommunityBoardPost[];
  communityComments: CommunityBoardComment[];
  applications: HomePopupNoticeApplication[];
  ownApplied: boolean;
  tripCards?: TeamLeadTripPersonCard[];
};

type RefreshHomePopupNoticeWorkspaceOptions = {
  force?: boolean;
  includeTrips?: boolean;
};

let noticeCache: HomePopupNotice | null = null;
let noticeListCache: HomeNotice[] = [];
let homeDdayCache: HomeDdayItem[] = [];
let communityPostCache: CommunityBoardPost[] = [];
let communityCommentCache: CommunityBoardComment[] = [];
let applicationCache: HomePopupNoticeApplication[] = [];
let tripCardCache: TeamLeadTripPersonCard[] = [];
let currentUserAppliedCache = false;
let refreshPromise: Promise<RefreshResult> | null = null;
let homeWorkspaceLoaded = false;
let homeWorkspaceTripCardsLoaded = false;
let homeWorkspaceLastFetchedAt = 0;
let homeWorkspaceSessionKey: string | null = null;
let homeWorkspaceLastFailureAt = 0;

const HOME_POPUP_WORKSPACE_TTL_MS = 30_000;
const HOME_POPUP_WORKSPACE_REQUEST_TIMEOUT_MS = 4_000;
const HOME_POPUP_WORKSPACE_FAILURE_COOLDOWN_MS = 10_000;

function isManagerRole(role: string | null | undefined) {
  return role === "desk" || role === "admin" || role === "team_lead";
}

function getHomeWorkspaceSessionKey(
  session: Awaited<ReturnType<typeof getPortalSession>> | null,
) {
  if (!session?.approved) return "guest";
  return `${session.id}:${session.role}`;
}

function canWriteCommunityCategory(
  category: CommunityBoardCategory,
  session: { approved: boolean; role: UserRole | null | undefined } | null,
) {
  if (!session?.approved) return false;
  if (isReadOnlyPortalRole(session.role)) {
    return false;
  }
  if (category === "notice") {
    return isManagerRole(session.role);
  }
  return true;
}

function validateCommunityCommentContent(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("댓글 내용을 입력해 주세요.");
  }
  if (normalized.length > 300) {
    throw new Error("댓글은 300자 이내로 입력해 주세요.");
  }
  return normalized;
}

function validateHomeDdayInput(input: { title: string; targetDate: string }) {
  const title = input.title.trim();
  const targetDate = input.targetDate.trim();

  if (!title) {
    throw new Error("디데이 이름을 입력해 주세요.");
  }

  if (!targetDate) {
    throw new Error("목표 날짜를 선택해 주세요.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("목표 날짜 형식을 다시 확인해 주세요.");
  }

  const parsed = new Date(`${targetDate}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("목표 날짜 형식을 다시 확인해 주세요.");
  }

  return { title, targetDate };
}

function validateCommunityBoardAttachment(attachment: CommunityBoardAttachment | null | undefined) {
  const normalized = normalizeCommunityBoardAttachment(attachment);
  if (!normalized) return null;
  if (normalized.sizeBytes > 6 * 1024 * 1024) {
    throw new Error("첨부 파일은 6MB 이내로 업로드해 주세요.");
  }
  if (!normalized.dataUrl.startsWith("data:")) {
    throw new Error("첨부 파일 형식을 확인해 주세요.");
  }
  return normalized;
}

function emitHomePopupNoticeEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HOME_POPUP_NOTICE_EVENT));
}

function emitHomePopupNoticeStatus(detail: { ok: boolean; message: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HOME_POPUP_NOTICE_STATUS_EVENT, { detail }));
}

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return false;
  return time <= Date.now();
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";
  const hint = typeof record.hint === "string" ? record.hint : "";
  const combined = `${message}\n${details}\n${hint}`.toLowerCase();
  return combined.includes(columnName.toLowerCase()) && combined.includes("does not exist");
}

function isMissingExpiresAtColumnError(error: unknown) {
  return isMissingColumnError(error, "expires_at");
}

function isMissingAuditColumnError(error: unknown) {
  return isMissingColumnError(error, "created_by") || isMissingColumnError(error, "updated_by");
}

function clonePopupNotice(notice: HomePopupNotice | null) {
  return notice ? { ...notice } : null;
}

function cloneNoticeList(notices: HomeNotice[]) {
  return notices.map((notice) => ({ ...notice }));
}

function cloneDdayList(ddays: HomeDdayItem[]) {
  return ddays.map((item) => ({ ...item }));
}

function normalizeHomeDday(item: HomeDdayItem): HomeDdayItem {
  return {
    id: item.id,
    title: item.title.trim(),
    targetDate: item.targetDate.trim(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
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

function isActiveHomeDday(targetDate: string, todayStamp = getKstTodayStamp()) {
  return targetDate >= todayStamp;
}

function sortHomeDdays(ddays: HomeDdayItem[]) {
  return [...ddays].sort((left, right) => {
    const dateDiff = left.targetDate.localeCompare(right.targetDate);
    if (dateDiff !== 0) return dateDiff;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function cloneCommunityPostList(posts: CommunityBoardPost[]) {
  return posts.map((post) => ({ ...post }));
}

function cloneCommunityCommentList(comments: CommunityBoardComment[]) {
  return comments.map((comment) => ({ ...comment }));
}

function cloneApplications(applications: HomePopupNoticeApplication[]) {
  return applications.map((application) => ({ ...application }));
}

function cloneTripCards(cards: TeamLeadTripPersonCard[]) {
  return cards.map((card) => ({
    name: card.name,
    items: card.items.map((item) => ({
      tripTagId: item.tripTagId,
      tripTagLabel: item.tripTagLabel,
      travelType: item.travelType,
      startDateKey: item.startDateKey,
      endDateKey: item.endDateKey,
      dayCount: item.dayCount,
      dateKeys: [...item.dateKeys],
      duties: [...item.duties],
      schedules: [...item.schedules],
    })),
  }));
}

function normalizeTone(value: unknown): HomeNoticeTone {
  return value === "urgent" ? "urgent" : "normal";
}

function normalizeKind(value: unknown): HomeNoticeKind {
  return value === "general" ? "general" : "popup";
}

function normalizeCommunityCategory(value: unknown): CommunityBoardCategory {
  if (value === "family" || value === "celebration" || value === "resource") return value;
  return "notice";
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function normalizeHomeNotice(input: Partial<HomeNotice> & { id: string; title: string; body: string }): HomeNotice {
  const fallbackDate = new Date().toISOString();
  const kind = normalizeKind(input.kind);
  const expiresAt =
    typeof input.expiresAt === "string" && input.expiresAt.trim()
      ? normalizeIsoDate(input.expiresAt, "")
      : null;

  return {
    id: input.id,
    title: input.title.trim(),
    body: input.body.trim(),
    kind,
    tone: normalizeTone(input.tone),
    isActive: kind === "popup" ? Boolean(input.isActive) && !isExpired(expiresAt) : true,
    applicationEnabled: kind === "popup" ? Boolean(input.applicationEnabled) : false,
    expiresAt,
    createdAt: normalizeIsoDate(input.createdAt, fallbackDate),
    updatedAt: normalizeIsoDate(input.updatedAt, fallbackDate),
  };
}

function normalizeCommunityBoardPost(
  input: Partial<CommunityBoardPost> & {
    id: string;
    title: string;
    body: string;
    authorId: string;
    authorName: string;
  },
): CommunityBoardPost {
  const fallbackDate = new Date().toISOString();
  return {
    id: input.id,
    category: normalizeCommunityCategory(input.category),
    title: input.title.trim(),
    body: input.body.trim(),
    authorId: input.authorId.trim(),
    authorName: input.authorName.trim(),
    attachment: normalizeCommunityBoardAttachment(input.attachment),
    createdAt: normalizeIsoDate(input.createdAt, fallbackDate),
    updatedAt: normalizeIsoDate(input.updatedAt, fallbackDate),
  };
}

function normalizeCommunityBoardAttachment(value: unknown): CommunityBoardAttachment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl.trim() : "";
  const sizeBytes = typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? record.sizeBytes : 0;
  if (!fileName || !dataUrl || sizeBytes <= 0) {
    return null;
  }
  return {
    fileName,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function normalizeCommunityBoardComment(
  input: Partial<CommunityBoardComment> & {
    id: string;
    targetKey: string;
    authorId: string;
    authorName: string;
    content: string;
  },
): CommunityBoardComment {
  const fallbackDate = new Date().toISOString();
  return {
    id: input.id,
    targetKey: input.targetKey.trim(),
    authorId: input.authorId.trim(),
    authorName: input.authorName.trim(),
    content: input.content.trim(),
    createdAt: normalizeIsoDate(input.createdAt, fallbackDate),
    updatedAt: normalizeIsoDate(input.updatedAt, fallbackDate),
  };
}

function sortNotices(notices: HomeNotice[]) {
  return [...notices].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function sortCommunityPosts(posts: CommunityBoardPost[]) {
  return [...posts].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function sortCommunityComments(comments: CommunityBoardComment[]) {
  return [...comments].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function getActivePopupNotice(notices: HomeNotice[]) {
  const popup = notices.find((notice) => notice.kind === "popup" && notice.isActive && !isExpired(notice.expiresAt));
  return popup ? ({ ...popup, kind: "popup" } as HomePopupNotice) : null;
}

function rowToLegacyNotice(row: HomePopupNoticeStateRow | null | undefined) {
  if (!row?.notice_id || !row.title.trim() || !row.body.trim()) return [] as HomeNotice[];
  return [
    normalizeHomeNotice({
      id: row.notice_id,
      title: row.title,
      body: row.body,
      kind: "popup",
      tone: "normal",
      isActive: row.is_active,
      applicationEnabled: true,
      expiresAt: row.expires_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  ];
}

function parseStorePayload(row: HomePopupNoticeStateRow | null | undefined) {
  const raw = row?.body?.trim();
  if (!raw) {
    return {
      notices: rowToLegacyNotice(row),
      ddays: [] as HomeDdayItem[],
      communityPosts: [] as CommunityBoardPost[],
      communityComments: [] as CommunityBoardComment[],
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HomeNoticeStorePayload> | null;
    const parsedNotices = Array.isArray(parsed?.notices) ? parsed.notices : null;
    if (
      (parsed?.version !== 2 &&
        parsed?.version !== 3 &&
        parsed?.version !== 4 &&
        parsed?.version !== HOME_NOTICE_STORE_VERSION) ||
      !parsedNotices
    ) {
      return {
        notices: rowToLegacyNotice(row),
        ddays: [],
        communityPosts: [],
        communityComments: [],
      };
    }

    return {
      notices: sortNotices(
        parsedNotices
          .filter((item): item is HomeNotice => Boolean(item && typeof item.id === "string"))
          .map((item) =>
            normalizeHomeNotice({
              ...item,
              id: item.id,
              title: item.title,
              body: item.body,
            }),
          )
          .filter((item) => item.title && item.body),
      ),
      ddays: sortHomeDdays(
        (parsed.ddays ?? [])
          .filter((item): item is HomeDdayItem => Boolean(item && typeof item.id === "string"))
          .map((item) =>
            normalizeHomeDday({
              ...item,
              id: item.id,
              title: item.title,
              targetDate: item.targetDate,
            }),
          )
          .filter((item) => item.title && /^\d{4}-\d{2}-\d{2}$/.test(item.targetDate))
          .slice(0, 3),
      ),
      communityPosts: sortCommunityPosts(
        (parsed.communityPosts ?? [])
          .filter((item): item is CommunityBoardPost => Boolean(item && typeof item.id === "string"))
          .map((item) =>
            normalizeCommunityBoardPost({
              ...item,
              id: item.id,
              title: item.title,
              body: item.body,
              authorId: item.authorId,
              authorName: item.authorName,
              attachment: item.attachment,
            }),
          )
          .filter((item) => item.title && item.body && item.authorId && item.authorName),
      ),
      communityComments: sortCommunityComments(
        (parsed.communityComments ?? [])
          .filter((item): item is CommunityBoardComment => Boolean(item && typeof item.id === "string"))
          .map((item) =>
            normalizeCommunityBoardComment({
              ...item,
              id: item.id,
              targetKey: item.targetKey,
              authorId: item.authorId,
              authorName: item.authorName,
              content: item.content,
            }),
          )
          .filter((item) => item.targetKey && item.authorId && item.authorName && item.content),
      ),
    };
  } catch {
    return {
      notices: rowToLegacyNotice(row),
      ddays: [],
      communityPosts: [],
      communityComments: [],
    };
  }
}

function getActiveHomeDdays(ddays: HomeDdayItem[]) {
  const todayStamp = getKstTodayStamp();
  return ddays.filter((item) => isActiveHomeDday(item.targetDate, todayStamp));
}

function rowToApplication(row: HomePopupNoticeApplicationRow): HomePopupNoticeApplication {
  return {
    id: row.id,
    noticeId: row.notice_id,
    applicantId: row.applicant_id,
    applicantName: row.applicant_name,
    createdAt: row.created_at,
  };
}

function buildStorePayload(
  notices: HomeNotice[],
  ddays: HomeDdayItem[],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
) {
  return JSON.stringify({
    version: HOME_NOTICE_STORE_VERSION,
    notices: sortNotices(notices),
    ddays: sortHomeDdays(ddays).slice(0, 3),
    communityPosts: sortCommunityPosts(communityPosts),
    communityComments: sortCommunityComments(communityComments),
  } satisfies HomeNoticeStorePayload);
}

function buildRowPayload(
  notices: HomeNotice[],
  ddays: HomeDdayItem[],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  sessionId: string,
) {
  const sortedNotices = sortNotices(notices);
  const activePopup = getActivePopupNotice(sortedNotices);
  const latestNotice = sortedNotices[0] ?? null;
  const representativeNotice = sortedNotices.find((notice) => isUuidLike(notice.id)) ?? null;
  const now = new Date().toISOString();

  return {
    key: HOME_POPUP_NOTICE_ROW_KEY,
    notice_id: activePopup?.id ?? representativeNotice?.id ?? crypto.randomUUID(),
    title: activePopup?.title ?? latestNotice?.title ?? "",
    body: buildStorePayload(sortedNotices, ddays, communityPosts, communityComments),
    is_active: Boolean(activePopup),
    expires_at: activePopup?.expiresAt ?? null,
    created_at: now,
    updated_at: now,
    created_by: sessionId,
    updated_by: sessionId,
  };
}

function syncCaches(
  notices: HomeNotice[],
  ddays: HomeDdayItem[] = [],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  applications: HomePopupNoticeApplication[],
  ownApplied = false,
  tripCards: TeamLeadTripPersonCard[] = tripCardCache,
) {
  noticeListCache = cloneNoticeList(sortNotices(notices));
  homeDdayCache = cloneDdayList(sortHomeDdays(ddays).slice(0, 3));
  communityPostCache = cloneCommunityPostList(sortCommunityPosts(communityPosts));
  communityCommentCache = cloneCommunityCommentList(sortCommunityComments(communityComments));
  noticeCache = clonePopupNotice(getActivePopupNotice(noticeListCache));
  applicationCache = cloneApplications(applications);
  tripCardCache = cloneTripCards(tripCards);
  currentUserAppliedCache = ownApplied;
}

function hasFreshHomePopupWorkspace(
  session: Awaited<ReturnType<typeof getPortalSession>> | null,
  options: RefreshHomePopupNoticeWorkspaceOptions,
) {
  if (!homeWorkspaceLoaded) return false;
  if (homeWorkspaceSessionKey !== getHomeWorkspaceSessionKey(session)) return false;
  if (Date.now() - homeWorkspaceLastFetchedAt >= HOME_POPUP_WORKSPACE_TTL_MS) return false;
  if (options.includeTrips && !homeWorkspaceTripCardsLoaded) return false;
  return true;
}

function markHomePopupWorkspaceFresh(
  session: Awaited<ReturnType<typeof getPortalSession>> | null,
  options: RefreshHomePopupNoticeWorkspaceOptions,
) {
  homeWorkspaceLoaded = true;
  homeWorkspaceTripCardsLoaded = homeWorkspaceTripCardsLoaded || Boolean(options.includeTrips);
  homeWorkspaceLastFetchedAt = Date.now();
  homeWorkspaceSessionKey = getHomeWorkspaceSessionKey(session);
}

function resetSessionScopedWorkspaceState() {
  applicationCache = [];
  currentUserAppliedCache = false;
}

function hasRecentHomePopupWorkspaceFailure() {
  if (!homeWorkspaceLastFailureAt) return false;
  return Date.now() - homeWorkspaceLastFailureAt < HOME_POPUP_WORKSPACE_FAILURE_COOLDOWN_MS;
}

function buildCachedWorkspaceResult(): RefreshResult {
  return {
    notice: getHomePopupNotice(),
    notices: getHomeNotices(),
    ddays: getHomeDdays(),
    communityPosts: getCommunityBoardPosts(),
    communityComments: getCommunityBoardComments(),
    applications: getHomePopupNoticeApplications(),
    tripCards: getHomePublicTripCards(),
  };
}

export function getHomePopupNotice() {
  return clonePopupNotice(noticeCache);
}

export function getHomeNotices() {
  return cloneNoticeList(noticeListCache);
}

export function getHomeDdays() {
  return cloneDdayList(homeDdayCache);
}

export function getCommunityBoardPosts() {
  return cloneCommunityPostList(communityPostCache);
}

export function getCommunityBoardComments() {
  return cloneCommunityCommentList(communityCommentCache);
}

export function getHomePopupNoticeApplications() {
  return cloneApplications(applicationCache);
}

export function getHomePublicTripCards() {
  return cloneTripCards(tripCardCache);
}

export function hasAppliedToCurrentHomePopupNotice() {
  return currentUserAppliedCache;
}

async function fetchHomePublicWorkspaceFallback(
  session: NonNullable<Awaited<ReturnType<typeof getPortalSession>>>,
): Promise<HomePublicWorkspaceResponse> {
  const supabase = await getPortalSupabaseClient();
  const { data: noticeRow, error: noticeError } = await selectHomePopupNoticeRow(supabase);
  if (noticeError) {
    throw new Error(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
  }

  const workspace = parseStorePayload(noticeRow ?? null);
  const activePopup = getActivePopupNotice(workspace.notices);
  let ownApplied = false;
  let applications: HomePopupNoticeApplication[] = [];

  if (activePopup?.applicationEnabled) {
    const { data: ownApplicationRow, error: ownApplicationError } = await supabase
      .from("home_popup_notice_applications")
      .select("id")
      .eq("notice_id", activePopup.id)
      .eq("applicant_id", session.id)
      .maybeSingle<{ id: string }>();

    if (ownApplicationError) {
      throw new Error(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
    }

    ownApplied = Boolean(ownApplicationRow?.id);

    if (isManagerRole(session.role)) {
      const { data: applicationRows, error: applicationError } = await supabase
        .from("home_popup_notice_applications")
        .select("id, notice_id, applicant_id, applicant_name, created_at")
        .eq("notice_id", activePopup.id)
        .order("created_at", { ascending: false })
        .returns<HomePopupNoticeApplicationRow[]>();

      if (applicationError) {
        throw new Error(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
      }

      applications = (applicationRows ?? []).map(rowToApplication);
    }
  }

  return {
    notice: activePopup,
    notices: workspace.notices,
    ddays: workspace.ddays,
    communityPosts: workspace.communityPosts,
    communityComments: workspace.communityComments,
    applications,
    ownApplied,
  };
}

async function fetchHomePublicWorkspace(options: RefreshHomePopupNoticeWorkspaceOptions = {}) {
  const searchParams = new URLSearchParams();
  if (options.includeTrips === false) {
    searchParams.set("includeTrips", "0");
  }

  const requestUrl = searchParams.size > 0
    ? `/api/home/public-workspace?${searchParams.toString()}`
    : "/api/home/public-workspace";

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HOME_POPUP_WORKSPACE_REQUEST_TIMEOUT_MS);

  try {
    const session = await getPortalSession();
    const response = await fetch(requestUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | HomePublicWorkspaceResponse | null;
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && options.includeTrips === false && session?.approved) {
        return fetchHomePublicWorkspaceFallback(session);
      }
      throw new Error(payload && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "홈 데이터를 불러오지 못했습니다.");
    }

    return payload as HomePublicWorkspaceResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("홈 데이터 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function selectHomePopupNoticeRow(supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>) {
  const preferred = await supabase
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
    .eq("key", HOME_POPUP_NOTICE_ROW_KEY)
    .maybeSingle<HomePopupNoticeStateRow>();

  if (!preferred.error || !isMissingExpiresAtColumnError(preferred.error)) {
    return preferred;
  }

  return supabase
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body, is_active, created_at, updated_at")
    .eq("key", HOME_POPUP_NOTICE_ROW_KEY)
    .maybeSingle<HomePopupNoticeStateRow>();
}

async function persistNotices(
  notices: HomeNotice[],
  ddays: HomeDdayItem[],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  sessionId: string,
  supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>,
) {
  const payload = buildRowPayload(notices, ddays, communityPosts, communityComments, sessionId);

  let { data, error } = await supabase
    .from("home_popup_notice_state")
    .upsert(payload)
    .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
    .maybeSingle<HomePopupNoticeStateRow>();

  if (error && (isMissingExpiresAtColumnError(error) || isMissingAuditColumnError(error))) {
    const fallbackPayload = {
      key: payload.key,
      notice_id: payload.notice_id,
      title: payload.title,
      body: payload.body,
      is_active: payload.is_active,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
    };

    ({ data, error } = await supabase
      .from("home_popup_notice_state")
      .upsert(fallbackPayload)
      .select("key, notice_id, title, body, is_active, created_at, updated_at")
      .maybeSingle<HomePopupNoticeStateRow>());
  }

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_state"));
  }

  return parseStorePayload(data ?? null);
}

export async function refreshHomePopupNoticeWorkspace(options: RefreshHomePopupNoticeWorkspaceOptions = {}) {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = await getPortalSession();
    const sessionKey = getHomeWorkspaceSessionKey(session);

    if (homeWorkspaceSessionKey && homeWorkspaceSessionKey !== sessionKey) {
      homeWorkspaceTripCardsLoaded = false;
      resetSessionScopedWorkspaceState();
    }

    if (!session?.approved) {
      syncCaches([], [], [], [], [], false, []);
      homeWorkspaceLoaded = true;
      homeWorkspaceTripCardsLoaded = true;
      homeWorkspaceLastFetchedAt = Date.now();
      homeWorkspaceSessionKey = sessionKey;
      emitHomePopupNoticeEvent();
      return {
        notice: null,
        notices: [],
        ddays: [],
        communityPosts: [],
        communityComments: [],
        applications: [],
        tripCards: [],
      };
    }

    if (!options.force && hasFreshHomePopupWorkspace(session, options)) {
      return buildCachedWorkspaceResult();
    }

    if (!options.force && hasRecentHomePopupWorkspaceFailure()) {
      return buildCachedWorkspaceResult();
    }

    try {
      const workspace = await fetchHomePublicWorkspace(options);

      syncCaches(
        workspace.notices,
        workspace.ddays,
        workspace.communityPosts,
        workspace.communityComments,
        workspace.applications,
        workspace.ownApplied,
        workspace.tripCards,
      );
      homeWorkspaceLastFailureAt = 0;
      markHomePopupWorkspaceFresh(session, options);
      emitHomePopupNoticeEvent();
      return buildCachedWorkspaceResult();
    } catch (error) {
      homeWorkspaceLastFailureAt = Date.now();
      if (homeWorkspaceLoaded) {
        console.warn(error instanceof Error ? error.message : "홈 데이터를 불러오지 못했습니다.");
        return buildCachedWorkspaceResult();
      }
      throw error;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function saveHomeDday(input: { title: string; targetDate: string }) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const { title, targetDate } = validateHomeDdayInput(input);
  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? {
        notices: getHomeNotices(),
        ddays: getHomeDdays(),
        communityPosts: getCommunityBoardPosts(),
        communityComments: getCommunityBoardComments(),
      }
    : await refreshHomePopupNoticeWorkspace();

  if (workspace.ddays.length >= 3) {
    throw new Error("디데이는 최대 3개까지 등록할 수 있습니다.");
  }

  const now = new Date().toISOString();
  const nextDday = normalizeHomeDday({
    id: crypto.randomUUID(),
    title,
    targetDate,
    createdAt: now,
    updatedAt: now,
  });

  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    workspace.notices,
    [...workspace.ddays, nextDday],
    workspace.communityPosts,
    workspace.communityComments,
    session.id,
    supabase,
  );

  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "디데이를 등록했습니다." });
  emitHomePopupNoticeEvent();
  return cloneDdayList(persistedWorkspace.ddays);
}

export async function deleteHomeDday(ddayId: string) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const trimmedDdayId = ddayId.trim();
  if (!trimmedDdayId) {
    throw new Error("삭제할 디데이를 찾지 못했습니다.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? {
        notices: getHomeNotices(),
        ddays: getHomeDdays(),
        communityPosts: getCommunityBoardPosts(),
        communityComments: getCommunityBoardComments(),
      }
    : await refreshHomePopupNoticeWorkspace();

  if (!workspace.ddays.some((item) => item.id === trimmedDdayId)) {
    throw new Error("삭제할 디데이를 찾지 못했습니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    workspace.notices,
    workspace.ddays.filter((item) => item.id !== trimmedDdayId),
    workspace.communityPosts,
    workspace.communityComments,
    session.id,
    supabase,
  );

  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "디데이를 삭제했습니다." });
  emitHomePopupNoticeEvent();
  return cloneDdayList(persistedWorkspace.ddays);
}

export async function updateHomeDday(input: { ddayId: string; title: string; targetDate: string }) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const ddayId = input.ddayId.trim();
  if (!ddayId) {
    throw new Error("수정할 디데이를 찾지 못했습니다.");
  }

  const { title, targetDate } = validateHomeDdayInput(input);
  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? {
        notices: getHomeNotices(),
        ddays: getHomeDdays(),
        communityPosts: getCommunityBoardPosts(),
        communityComments: getCommunityBoardComments(),
      }
    : await refreshHomePopupNoticeWorkspace();

  const target = workspace.ddays.find((item) => item.id === ddayId) ?? null;
  if (!target) {
    throw new Error("수정할 디데이를 찾지 못했습니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    workspace.notices,
    workspace.ddays.map((item) =>
      item.id === ddayId
        ? normalizeHomeDday({
            ...item,
            title,
            targetDate,
            updatedAt: new Date().toISOString(),
          })
        : item,
    ),
    workspace.communityPosts,
    workspace.communityComments,
    session.id,
    supabase,
  );

  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "디데이를 수정했습니다." });
  emitHomePopupNoticeEvent();
  return cloneDdayList(persistedWorkspace.ddays);
}

export async function saveHomeNotice(input: {
  title: string;
  body: string;
  kind: HomeNoticeKind;
  tone: HomeNoticeTone;
  expiresAt?: string | null;
  applicationEnabled?: boolean;
}) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  const expiresAt = input.expiresAt?.trim() ? new Date(input.expiresAt).toISOString() : null;
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    throw new Error("종료일 형식을 다시 확인해 주세요.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? { notices: getHomeNotices(), ddays: getHomeDdays(), communityPosts: getCommunityBoardPosts() }
    : await refreshHomePopupNoticeWorkspace();
  const existingNotices = workspace.notices;
  const now = new Date().toISOString();
  const nextNotice = normalizeHomeNotice({
    id: crypto.randomUUID(),
    title,
    body,
    kind: input.kind,
    tone: input.tone,
    isActive: input.kind === "popup",
    applicationEnabled: input.kind === "popup" ? Boolean(input.applicationEnabled) : false,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const nextNotices = sortNotices([
    nextNotice,
    ...existingNotices.map((notice) =>
      input.kind === "popup" && notice.kind === "popup"
        ? { ...notice, isActive: false }
        : notice,
    ),
  ]);

  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    nextNotices,
    workspace.ddays,
    workspace.communityPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(persistedWorkspace.notices, persistedWorkspace.ddays, persistedWorkspace.communityPosts, persistedWorkspace.communityComments, [], false);
  emitHomePopupNoticeStatus({
    ok: true,
    message: input.kind === "popup" ? "팝업 공지를 게시했습니다." : "일반 공지를 등록했습니다.",
  });
  emitHomePopupNoticeEvent();
  return nextNotice;
}

export async function saveHomePopupNotice(input: { title: string; body: string; expiresAt?: string | null }) {
  return saveHomeNotice({
    title: input.title,
    body: input.body,
    kind: "popup",
    tone: "normal",
    expiresAt: input.expiresAt,
    applicationEnabled: true,
  });
}

export async function deleteHomeNotice(noticeId: string) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const trimmedNoticeId = noticeId.trim();
  if (!trimmedNoticeId) {
    throw new Error("삭제할 공지를 찾지 못했습니다.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? { notices: getHomeNotices(), ddays: getHomeDdays(), communityPosts: getCommunityBoardPosts() }
    : await refreshHomePopupNoticeWorkspace();
  const existingNotices = workspace.notices;
  const targetNotice = existingNotices.find((notice) => notice.id === trimmedNoticeId) ?? null;
  if (!targetNotice) {
    throw new Error("삭제할 공지를 찾지 못했습니다.");
  }

  const supabase = await getPortalSupabaseClient();
  if (targetNotice.kind === "popup") {
    const { error } = await supabase
      .from("home_popup_notice_applications")
      .delete()
      .eq("notice_id", trimmedNoticeId);

    if (error && !isSupabaseSchemaMissingError(error)) {
      throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
    }
  }

  const nextNotices = existingNotices.filter((notice) => notice.id !== trimmedNoticeId);
  const nextComments = getCommunityBoardComments().filter((comment) => comment.targetKey !== `notice:${trimmedNoticeId}`);
  const persistedWorkspace = await persistNotices(nextNotices, workspace.ddays, workspace.communityPosts, nextComments, session.id, supabase);
  const nextActivePopup = getActivePopupNotice(persistedWorkspace.notices);
  const currentApplications =
    nextActivePopup?.id && noticeCache?.id === nextActivePopup.id ? getHomePopupNoticeApplications() : [];
  const ownApplied = nextActivePopup?.id && noticeCache?.id === nextActivePopup.id ? currentUserAppliedCache : false;

  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    currentApplications,
    ownApplied,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "공지를 삭제했습니다." });
  emitHomePopupNoticeEvent();
  return cloneNoticeList(persistedWorkspace.notices);
}

export async function updateHomeNotice(input: {
  noticeId: string;
  title: string;
  body: string;
}) {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("공지 수정은 DESK 또는 총괄팀장 권한이 필요합니다.");
  }

  const noticeId = input.noticeId.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!noticeId) {
    throw new Error("수정할 공지를 찾지 못했습니다.");
  }
  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? { notices: getHomeNotices(), ddays: getHomeDdays(), communityPosts: getCommunityBoardPosts() }
    : await refreshHomePopupNoticeWorkspace();
  const targetNotice = workspace.notices.find((notice) => notice.id === noticeId) ?? null;
  if (!targetNotice) {
    throw new Error("수정할 공지를 찾지 못했습니다.");
  }

  const nextNotices = workspace.notices.map((notice) =>
    notice.id === noticeId
      ? normalizeHomeNotice({
          ...notice,
          title,
          body,
          updatedAt: new Date().toISOString(),
        })
      : notice,
  );
  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    nextNotices,
    workspace.ddays,
    workspace.communityPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "공지를 수정했습니다." });
  emitHomePopupNoticeEvent();
  return cloneNoticeList(persistedWorkspace.notices);
}

export async function closeHomePopupNotice() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentPopup = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentPopup) {
    syncCaches(getHomeNotices(), getHomeDdays(), getCommunityBoardPosts(), getCommunityBoardComments(), [], false);
    emitHomePopupNoticeEvent();
    return null;
  }

  const nextNotices = getHomeNotices().filter((notice) => notice.id !== currentPopup.id);
  const supabase = await getPortalSupabaseClient();
  const nextComments = getCommunityBoardComments().filter((comment) => comment.targetKey !== `notice:${currentPopup.id}`);
  const persistedWorkspace = await persistNotices(nextNotices, getHomeDdays(), getCommunityBoardPosts(), nextComments, session.id, supabase);
  syncCaches(persistedWorkspace.notices, persistedWorkspace.ddays, persistedWorkspace.communityPosts, persistedWorkspace.communityComments, [], false);
  emitHomePopupNoticeStatus({ ok: true, message: "팝업 종료를 반영했습니다." });
  emitHomePopupNoticeEvent();
  return getHomePopupNotice();
}

export async function clearHomePopupNoticeApplications() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentPopup = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentPopup?.id) {
    applicationCache = [];
    currentUserAppliedCache = false;
    emitHomePopupNoticeEvent();
    return 0;
  }

  const supabase = await getPortalSupabaseClient();
  const { error, count } = await supabase
    .from("home_popup_notice_applications")
    .delete({ count: "exact" })
    .eq("notice_id", currentPopup.id);

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
  }

  applicationCache = [];
  currentUserAppliedCache = false;
  emitHomePopupNoticeStatus({ ok: true, message: "신청 목록을 초기화했습니다." });
  emitHomePopupNoticeEvent();
  return count ?? 0;
}

export async function closeHomePopupNoticeApplications() {
  const session = await getPortalSession();
  if (!session?.approved || !isManagerRole(session.role)) {
    throw new Error("DESK 권한이 필요합니다.");
  }

  const currentPopup = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentPopup?.id) {
    applicationCache = [];
    currentUserAppliedCache = false;
    emitHomePopupNoticeEvent();
    return null;
  }

  const supabase = await getPortalSupabaseClient();
  const { error } = await supabase
    .from("home_popup_notice_applications")
    .delete()
    .eq("notice_id", currentPopup.id);

  if (error) {
    throw new Error(getSupabaseStorageErrorMessage(error, "home_popup_notice_applications"));
  }

  const nextNotices = getHomeNotices().map((notice) =>
    notice.id === currentPopup.id
      ? normalizeHomeNotice({
          ...notice,
          applicationEnabled: false,
          updatedAt: new Date().toISOString(),
        })
      : notice,
  );
  const persistedWorkspace = await persistNotices(
    nextNotices,
    getHomeDdays(),
    getCommunityBoardPosts(),
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(persistedWorkspace.notices, persistedWorkspace.ddays, persistedWorkspace.communityPosts, persistedWorkspace.communityComments, [], false);
  emitHomePopupNoticeStatus({ ok: true, message: "신청을 마감했습니다." });
  emitHomePopupNoticeEvent();
  return getHomePopupNotice();
}

export async function saveCommunityBoardPost(input: {
  category: CommunityBoardCategory;
  title: string;
  body: string;
  attachment?: CommunityBoardAttachment | null;
}) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  if (!canWriteCommunityCategory(input.category, session)) {
    throw new Error(
      input.category === "notice"
        ? "공지 게시판은 DESK 또는 총괄팀장 권한자만 작성할 수 있습니다."
        : "Observer 등급은 커뮤니티 글을 작성할 수 없습니다.",
    );
  }

  const title = input.title.trim();
  const body = input.body.trim();
  const attachment = validateCommunityBoardAttachment(input.attachment);
  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? { notices: getHomeNotices(), ddays: getHomeDdays(), communityPosts: getCommunityBoardPosts() }
    : await refreshHomePopupNoticeWorkspace();
  const now = new Date().toISOString();
  const nextPost = normalizeCommunityBoardPost({
    id: crypto.randomUUID(),
    category: input.category,
    title,
    body,
    authorId: session.id,
    authorName: session.username,
    attachment,
    createdAt: now,
    updatedAt: now,
  });

  let nextNotices = workspace.notices;
  if (input.category === "notice") {
    const shadowNotice = normalizeHomeNotice({
      id: `shadow:${nextPost.id}`,
      title,
      body,
      kind: "general",
      tone: "normal",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    nextNotices = sortNotices([shadowNotice, ...nextNotices]);
  }

  const nextPosts = sortCommunityPosts([nextPost, ...workspace.communityPosts]);
  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    nextNotices,
    workspace.ddays,
    nextPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "커뮤니티 글을 등록했습니다." });
  emitHomePopupNoticeEvent();
  return nextPost;
}

export async function updateCommunityBoardPost(input: {
  postId: string;
  title: string;
  body: string;
  attachment?: CommunityBoardAttachment | null;
}) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  if (isReadOnlyPortalRole(session.role)) {
    throw new Error("Observer 등급은 커뮤니티 글을 수정할 수 없습니다.");
  }

  const postId = input.postId.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  const attachment = validateCommunityBoardAttachment(input.attachment);
  if (!postId) {
    throw new Error("수정할 글을 찾지 못했습니다.");
  }
  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? { notices: getHomeNotices(), ddays: getHomeDdays(), communityPosts: getCommunityBoardPosts() }
    : await refreshHomePopupNoticeWorkspace();
  const targetPost = workspace.communityPosts.find((post) => post.id === postId) ?? null;
  if (!targetPost) {
    throw new Error("수정할 글을 찾지 못했습니다.");
  }

  const canManage =
    targetPost.category === "notice"
      ? isManagerRole(session.role)
      : isManagerRole(session.role) || targetPost.authorId === session.id;
  if (!canManage) {
    throw new Error(
      targetPost.category === "notice"
        ? "공지 수정은 DESK 또는 총괄팀장 권한이 필요합니다."
        : "작성자 또는 DESK 권한이 필요합니다.",
    );
  }

  const nextPosts = workspace.communityPosts.map((post) =>
    post.id === postId
      ? normalizeCommunityBoardPost({
          ...post,
          title,
          body,
          attachment,
          updatedAt: new Date().toISOString(),
        })
      : post,
  );

  const nextNotices = workspace.notices.map((notice) =>
    notice.id === `shadow:${postId}`
      ? normalizeHomeNotice({
          ...notice,
          title,
          body,
          updatedAt: new Date().toISOString(),
        })
      : notice,
  );

  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    nextNotices,
    workspace.ddays,
    nextPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "커뮤니티 글을 수정했습니다." });
  emitHomePopupNoticeEvent();
  return getCommunityBoardPosts();
}

export async function deleteCommunityBoardPost(postId: string) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  if (isReadOnlyPortalRole(session.role)) {
    throw new Error("Observer 등급은 커뮤니티 글을 삭제할 수 없습니다.");
  }

  const trimmedPostId = postId.trim();
  if (!trimmedPostId) {
    throw new Error("삭제할 글을 찾지 못했습니다.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || homeDdayCache.length > 0
    ? { notices: getHomeNotices(), ddays: getHomeDdays(), communityPosts: getCommunityBoardPosts() }
    : await refreshHomePopupNoticeWorkspace();
  const targetPost = workspace.communityPosts.find((post) => post.id === trimmedPostId) ?? null;
  if (!targetPost) {
    throw new Error("삭제할 글을 찾지 못했습니다.");
  }

  const canManage =
    targetPost.category === "notice"
      ? isManagerRole(session.role)
      : isManagerRole(session.role) || targetPost.authorId === session.id;
  if (!canManage) {
    throw new Error(
      targetPost.category === "notice"
        ? "공지 삭제는 DESK 또는 총괄팀장 권한이 필요합니다."
        : "작성자 또는 DESK 권한이 필요합니다.",
    );
  }

  const nextPosts = workspace.communityPosts.filter((post) => post.id !== trimmedPostId);
  const nextNotices = workspace.notices.filter((notice) => notice.id !== `shadow:${trimmedPostId}`);

  const supabase = await getPortalSupabaseClient();
  const nextComments = getCommunityBoardComments().filter((comment) => comment.targetKey !== `manual:${trimmedPostId}`);
  const persistedWorkspace = await persistNotices(nextNotices, workspace.ddays, nextPosts, nextComments, session.id, supabase);
  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "커뮤니티 글을 삭제했습니다." });
  emitHomePopupNoticeEvent();
  return getCommunityBoardPosts();
}

export async function saveCommunityBoardComment(input: {
  targetKey: string;
  content: string;
}) {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  if (isReadOnlyPortalRole(session.role)) {
    throw new Error("Observer 등급은 댓글을 등록할 수 없습니다.");
  }

  const targetKey = input.targetKey.trim();
  const content = validateCommunityCommentContent(input.content);
  if (!targetKey) {
    throw new Error("댓글을 남길 게시글을 찾지 못했습니다.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || communityCommentCache.length > 0 || homeDdayCache.length > 0
    ? {
        notices: getHomeNotices(),
        ddays: getHomeDdays(),
        communityPosts: getCommunityBoardPosts(),
        communityComments: getCommunityBoardComments(),
      }
    : await refreshHomePopupNoticeWorkspace();
  const targetExists =
    workspace.notices.some((notice) => `notice:${notice.id}` === targetKey) ||
    workspace.communityPosts.some((post) => `manual:${post.id}` === targetKey);
  if (!targetExists) {
    throw new Error("댓글을 남길 게시글을 찾지 못했습니다.");
  }

  const now = new Date().toISOString();
  const nextComment = normalizeCommunityBoardComment({
    id: crypto.randomUUID(),
    targetKey,
    authorId: session.id,
    authorName: session.username,
    content,
    createdAt: now,
    updatedAt: now,
  });
  const nextComments = sortCommunityComments([nextComment, ...workspace.communityComments]);
  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    workspace.notices,
    workspace.ddays,
    workspace.communityPosts,
    nextComments,
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
    persistedWorkspace.ddays,
    persistedWorkspace.communityPosts,
    persistedWorkspace.communityComments,
    getHomePopupNoticeApplications(),
    currentUserAppliedCache,
  );
  emitHomePopupNoticeStatus({ ok: true, message: "댓글을 등록했습니다." });
  emitHomePopupNoticeEvent();
  return nextComment;
}

export async function applyToHomePopupNotice() {
  const session = await getPortalSession();
  if (!session?.approved) {
    throw new Error("승인된 로그인 세션이 필요합니다.");
  }
  if (isReadOnlyPortalRole(session.role)) {
    throw new Error("Observer 등급은 신청할 수 없습니다.");
  }

  const currentNotice = noticeCache ?? (await refreshHomePopupNoticeWorkspace()).notice;
  if (!currentNotice?.isActive) {
    throw new Error("현재 신청 가능한 공지가 없습니다.");
  }
  if (!currentNotice.applicationEnabled) {
    throw new Error("신청 기능이 없는 공지입니다.");
  }
  if (currentUserAppliedCache) {
    throw new Error("이미 신청한 공지입니다.");
  }

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("home_popup_notice_applications")
    .insert({
      notice_id: currentNotice.id,
      applicant_id: session.id,
      applicant_name: session.username,
    })
    .select("id, notice_id, applicant_id, applicant_name, created_at")
    .single<HomePopupNoticeApplicationRow>();

  if (error) {
    const message = getSupabaseStorageErrorMessage(error, "home_popup_notice_applications");
    if (message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique")) {
      currentUserAppliedCache = true;
      emitHomePopupNoticeEvent();
      throw new Error("이미 신청한 공지입니다.");
    }
    throw new Error(message);
  }

  const nextApplication = rowToApplication(data);
  currentUserAppliedCache = true;
  if (noticeCache?.id === nextApplication.noticeId) {
    applicationCache = [nextApplication, ...applicationCache];
  }

  emitHomePopupNoticeStatus({ ok: true, message: "신청 로그를 남겼습니다." });
  emitHomePopupNoticeEvent();
  return nextApplication;
}
