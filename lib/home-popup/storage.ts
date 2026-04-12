"use client";

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
  communityPosts?: CommunityBoardPost[];
  communityComments?: CommunityBoardComment[];
}

type RefreshResult = {
  notice: HomePopupNotice | null;
  notices: HomeNotice[];
  communityPosts: CommunityBoardPost[];
  communityComments: CommunityBoardComment[];
  applications: HomePopupNoticeApplication[];
};

let noticeCache: HomePopupNotice | null = null;
let noticeListCache: HomeNotice[] = [];
let communityPostCache: CommunityBoardPost[] = [];
let communityCommentCache: CommunityBoardComment[] = [];
let applicationCache: HomePopupNoticeApplication[] = [];
let currentUserAppliedCache = false;
let refreshPromise: Promise<RefreshResult> | null = null;

function isManagerRole(role: string | null | undefined) {
  return role === "desk" || role === "admin" || role === "team_lead";
}

function canWriteCommunityCategory(
  category: CommunityBoardCategory,
  session: { approved: boolean; role: string | null | undefined } | null,
) {
  if (!session?.approved) return false;
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

function cloneCommunityPostList(posts: CommunityBoardPost[]) {
  return posts.map((post) => ({ ...post }));
}

function cloneCommunityCommentList(comments: CommunityBoardComment[]) {
  return comments.map((comment) => ({ ...comment }));
}

function cloneApplications(applications: HomePopupNoticeApplication[]) {
  return applications.map((application) => ({ ...application }));
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
      communityPosts: [] as CommunityBoardPost[],
      communityComments: [] as CommunityBoardComment[],
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HomeNoticeStorePayload>;
    if ((parsed?.version !== 2 && parsed?.version !== 3 && parsed?.version !== 4 && parsed?.version !== HOME_NOTICE_STORE_VERSION) || !Array.isArray(parsed.notices)) {
      return {
        notices: rowToLegacyNotice(row),
        communityPosts: [],
        communityComments: [],
      };
    }

    return {
      notices: sortNotices(
        parsed.notices
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
      communityPosts: [],
      communityComments: [],
    };
  }
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
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
) {
  return JSON.stringify({
    version: HOME_NOTICE_STORE_VERSION,
    notices: sortNotices(notices),
    communityPosts: sortCommunityPosts(communityPosts),
    communityComments: sortCommunityComments(communityComments),
  } satisfies HomeNoticeStorePayload);
}

function buildRowPayload(
  notices: HomeNotice[],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  sessionId: string,
) {
  const sortedNotices = sortNotices(notices);
  const activePopup = getActivePopupNotice(sortedNotices);
  const latestNotice = sortedNotices[0] ?? null;
  const now = new Date().toISOString();

  return {
    key: HOME_POPUP_NOTICE_ROW_KEY,
    notice_id: activePopup?.id ?? latestNotice?.id ?? crypto.randomUUID(),
    title: activePopup?.title ?? latestNotice?.title ?? "",
    body: buildStorePayload(sortedNotices, communityPosts, communityComments),
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
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  applications: HomePopupNoticeApplication[],
  ownApplied = false,
) {
  noticeListCache = cloneNoticeList(sortNotices(notices));
  communityPostCache = cloneCommunityPostList(sortCommunityPosts(communityPosts));
  communityCommentCache = cloneCommunityCommentList(sortCommunityComments(communityComments));
  noticeCache = clonePopupNotice(getActivePopupNotice(noticeListCache));
  applicationCache = cloneApplications(applications);
  currentUserAppliedCache = ownApplied;
}

export function getHomePopupNotice() {
  return clonePopupNotice(noticeCache);
}

export function getHomeNotices() {
  return cloneNoticeList(noticeListCache);
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

export function hasAppliedToCurrentHomePopupNotice() {
  return currentUserAppliedCache;
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
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  sessionId: string,
  supabase: Awaited<ReturnType<typeof getPortalSupabaseClient>>,
) {
  const payload = buildRowPayload(notices, communityPosts, communityComments, sessionId);

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

export async function refreshHomePopupNoticeWorkspace() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const session = await getPortalSession();
    if (!session?.approved) {
      syncCaches([], [], [], [], false);
      emitHomePopupNoticeEvent();
      return {
        notice: null,
        notices: [],
        communityPosts: [],
        communityComments: [],
        applications: [],
      };
    }

    const supabase = await getPortalSupabaseClient();
    const { data: noticeRow, error: noticeError } = await selectHomePopupNoticeRow(supabase);

    if (noticeError) {
      if (isSupabaseSchemaMissingError(noticeError)) {
        console.warn(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
        syncCaches([], [], [], [], false);
        emitHomePopupNoticeEvent();
        return {
          notice: null,
          notices: [],
          communityPosts: [],
          communityComments: [],
          applications: [],
        };
      }

      throw new Error(getSupabaseStorageErrorMessage(noticeError, "home_popup_notice_state"));
    }

    const workspace = parseStorePayload(noticeRow ?? null);
    const notices = workspace.notices;
    const communityPosts = workspace.communityPosts;
    const communityComments = workspace.communityComments;
    const activePopup = getActivePopupNotice(notices);
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
        if (isSupabaseSchemaMissingError(ownApplicationError)) {
          console.warn(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
        } else {
          throw new Error(getSupabaseStorageErrorMessage(ownApplicationError, "home_popup_notice_applications"));
        }
      } else {
        ownApplied = Boolean(ownApplicationRow?.id);
      }

      if (isManagerRole(session.role)) {
        const { data: applicationRows, error: applicationError } = await supabase
          .from("home_popup_notice_applications")
          .select("id, notice_id, applicant_id, applicant_name, created_at")
          .eq("notice_id", activePopup.id)
          .order("created_at", { ascending: false })
          .returns<HomePopupNoticeApplicationRow[]>();

        if (applicationError) {
          if (isSupabaseSchemaMissingError(applicationError)) {
            console.warn(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
          } else {
            throw new Error(getSupabaseStorageErrorMessage(applicationError, "home_popup_notice_applications"));
          }
        } else {
          applications = (applicationRows ?? []).map(rowToApplication);
        }
      }
    }

    syncCaches(notices, communityPosts, communityComments, applications, ownApplied);
    emitHomePopupNoticeEvent();
    return {
      notice: getHomePopupNotice(),
      notices: getHomeNotices(),
      communityPosts: getCommunityBoardPosts(),
      communityComments: getCommunityBoardComments(),
      applications: getHomePopupNoticeApplications(),
    };
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
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

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0
    ? { notices: getHomeNotices(), communityPosts: getCommunityBoardPosts() }
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
    workspace.communityPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(persistedWorkspace.notices, persistedWorkspace.communityPosts, persistedWorkspace.communityComments, [], false);
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

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0
    ? { notices: getHomeNotices(), communityPosts: getCommunityBoardPosts() }
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
  const persistedWorkspace = await persistNotices(nextNotices, workspace.communityPosts, nextComments, session.id, supabase);
  const nextActivePopup = getActivePopupNotice(persistedWorkspace.notices);
  const currentApplications =
    nextActivePopup?.id && noticeCache?.id === nextActivePopup.id ? getHomePopupNoticeApplications() : [];
  const ownApplied = nextActivePopup?.id && noticeCache?.id === nextActivePopup.id ? currentUserAppliedCache : false;

  syncCaches(
    persistedWorkspace.notices,
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
    throw new Error("공지 수정은 DESK 또는 팀장 권한이 필요합니다.");
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

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0
    ? { notices: getHomeNotices(), communityPosts: getCommunityBoardPosts() }
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
    workspace.communityPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
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
    syncCaches(getHomeNotices(), getCommunityBoardPosts(), getCommunityBoardComments(), [], false);
    emitHomePopupNoticeEvent();
    return null;
  }

  const nextNotices = getHomeNotices().filter((notice) => notice.id !== currentPopup.id);
  const supabase = await getPortalSupabaseClient();
  const nextComments = getCommunityBoardComments().filter((comment) => comment.targetKey !== `notice:${currentPopup.id}`);
  const persistedWorkspace = await persistNotices(nextNotices, getCommunityBoardPosts(), nextComments, session.id, supabase);
  syncCaches(persistedWorkspace.notices, persistedWorkspace.communityPosts, persistedWorkspace.communityComments, [], false);
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
    getCommunityBoardPosts(),
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(persistedWorkspace.notices, persistedWorkspace.communityPosts, persistedWorkspace.communityComments, [], false);
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
    throw new Error("공지 게시판은 DESK 또는 팀장 권한자만 작성할 수 있습니다.");
  }

  const title = input.title.trim();
  const body = input.body.trim();
  const attachment = validateCommunityBoardAttachment(input.attachment);
  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0
    ? { notices: getHomeNotices(), communityPosts: getCommunityBoardPosts() }
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
  const nextPosts = sortCommunityPosts([nextPost, ...workspace.communityPosts]);
  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    workspace.notices,
    nextPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
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

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0
    ? { notices: getHomeNotices(), communityPosts: getCommunityBoardPosts() }
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
        ? "공지 수정은 DESK 또는 팀장 권한이 필요합니다."
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
  const supabase = await getPortalSupabaseClient();
  const persistedWorkspace = await persistNotices(
    workspace.notices,
    nextPosts,
    getCommunityBoardComments(),
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
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

  const trimmedPostId = postId.trim();
  if (!trimmedPostId) {
    throw new Error("삭제할 글을 찾지 못했습니다.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0
    ? { notices: getHomeNotices(), communityPosts: getCommunityBoardPosts() }
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
        ? "공지 삭제는 DESK 또는 팀장 권한이 필요합니다."
        : "작성자 또는 DESK 권한이 필요합니다.",
    );
  }

  const nextPosts = workspace.communityPosts.filter((post) => post.id !== trimmedPostId);
  const supabase = await getPortalSupabaseClient();
  const nextComments = getCommunityBoardComments().filter((comment) => comment.targetKey !== `manual:${trimmedPostId}`);
  const persistedWorkspace = await persistNotices(workspace.notices, nextPosts, nextComments, session.id, supabase);
  syncCaches(
    persistedWorkspace.notices,
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

  const targetKey = input.targetKey.trim();
  const content = validateCommunityCommentContent(input.content);
  if (!targetKey) {
    throw new Error("댓글을 남길 게시글을 찾지 못했습니다.");
  }

  const workspace = noticeListCache.length > 0 || communityPostCache.length > 0 || communityCommentCache.length > 0
    ? {
        notices: getHomeNotices(),
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
    workspace.communityPosts,
    nextComments,
    session.id,
    supabase,
  );
  syncCaches(
    persistedWorkspace.notices,
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
