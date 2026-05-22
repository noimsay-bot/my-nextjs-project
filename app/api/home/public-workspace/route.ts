import { NextResponse } from "next/server";
import { getJsonResponseByteLength, logRouteUsageDebug } from "@/lib/server/usage-debug";
import { getScheduleCategoryLabel } from "@/lib/schedule/constants";
import type { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

const HOME_PUBLIC_WORKSPACE_TIMEOUT_MS = 4_000;
const HOME_COMMUNITY_ATTACHMENT_BUCKET = "home-community-attachments";
const HOME_TRIP_LOOKBACK_DAYS = 14;
const HOME_TRIP_LOOKAHEAD_DAYS = 7;
const CURRENT_TRIP_TRAVEL_TYPES = new Set<AssignmentTravelType>(["국내출장", "해외출장"]);

function jsonWithUsageDebug(request: Request, startedAt: number, payload: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  logRouteUsageDebug(request, {
    status,
    startedAt,
    responseBytes: getJsonResponseByteLength(payload),
  });
  return NextResponse.json(payload, init);
}

type AppRole = "member" | "outlet" | "reviewer" | "team_lead" | "admin" | "desk" | "observer" | "partner";
type AssignmentTravelType = "" | "국내출장" | "해외출장" | "당일출장";
type AssignmentTripTagPhase = "" | "departure" | "ongoing" | "return";

interface ProfileRow {
  id: string;
  name?: string | null;
  role: AppRole;
  approved: boolean;
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

type HomeNoticePollVoterMode = "anonymous" | "named";

interface HomeNoticePollOption {
  id: string;
  title: string;
}

interface HomeNoticePollVote {
  optionId: string;
  voterName?: string;
  createdAt: string;
  isCurrentUser?: boolean;
}

interface HomeNoticePoll {
  id: string;
  title: string;
  voterMode: HomeNoticePollVoterMode;
  options: HomeNoticePollOption[];
  votes: HomeNoticePollVote[];
  createdAt: string;
  updatedAt: string;
}

interface HomeNotice {
  id: string;
  title: string;
  body: string;
  kind: "general" | "popup";
  tone: "normal" | "urgent";
  isActive: boolean;
  applicationEnabled: boolean;
  poll?: HomeNoticePoll | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HomeDdayItem {
  id: string;
  title: string;
  targetDate: string;
  createdAt: string;
  updatedAt: string;
}

interface CommunityBoardAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  downloadUrl?: string;
  storagePath?: string;
}

interface CommunityBoardPost {
  id: string;
  category: "notice" | "family" | "celebration" | "resource";
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  attachment?: CommunityBoardAttachment | null;
  createdAt: string;
  updatedAt: string;
}

interface CommunityBoardComment {
  id: string;
  targetKey: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface HomePopupNoticeApplication {
  id: string;
  noticeId: string;
  applicantId: string;
  applicantName: string;
  createdAt: string;
}

interface HomeNoticePollVoteRow {
  id: string;
  notice_id: string;
  poll_id: string;
  option_id: string;
  voter_id: string;
  voter_name: string | null;
  created_at: string;
}

interface HomeNoticeStorePayload {
  version: number;
  notices: HomeNotice[];
  ddays?: HomeDdayItem[];
  communityPosts?: CommunityBoardPost[];
  communityComments?: CommunityBoardComment[];
}

interface TeamLeadScheduleAssignmentRow {
  month_key: string;
  entries: Record<string, Partial<ScheduleAssignmentEntry>> | null;
  rows: Record<string, Partial<ScheduleAssignmentDayRows>> | null;
}

interface ScheduleMonthRow {
  month_key: string;
  published_state: GeneratedSchedule | null;
}

interface ScheduleAssignmentEntry {
  schedules: string[];
  travelType: AssignmentTravelType;
  tripTagId: string;
  tripTagLabel: string;
  tripTagPhase: AssignmentTripTagPhase;
}

interface ScheduleAssignmentCustomRow {
  id: string;
  name: string;
  duty: string;
}

interface ScheduleAssignmentRowOverride {
  name: string;
  duty: string;
}

interface ScheduleAssignmentDayRows {
  addedRows: ScheduleAssignmentCustomRow[];
  deletedRowKeys: string[];
  rowOverrides: Record<string, ScheduleAssignmentRowOverride>;
}

interface ScheduleAssignmentRow {
  key: string;
  name: string;
  duty: string;
}

interface TeamLeadTripItem {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
  startDateKey: string;
  endDateKey: string;
  dayCount: number;
  dateKeys: string[];
  duties: string[];
  schedules: string[];
}

interface TeamLeadTripPersonCard {
  name: string;
  items: TeamLeadTripItem[];
}

interface TripTimelineRow {
  rowKey: string;
  dateKey: string;
  entry: ScheduleAssignmentEntry;
}

interface ActiveTripState {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
}

interface TripAggregateBuilder {
  tripTagId: string;
  tripTagLabel: string;
  travelType: AssignmentTravelType;
  startDateKey: string;
  endDateKey: string;
  dateKeys: string[];
  dateKeySet: Set<string>;
  schedules: string[];
  scheduleSet: Set<string>;
}

function withTimeout<T>(promise: PromiseLike<T>, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, HOME_PUBLIC_WORKSPACE_TIMEOUT_MS);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function isManagerRole(role: AppRole) {
  return role === "desk" || role === "admin" || role === "team_lead";
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
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

function isSupabaseSchemaMissingError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";
  const hint = typeof record.hint === "string" ? record.hint : "";
  const combined = `${message}\n${details}\n${hint}`.toLowerCase();

  return (
    code === "PGRST205" ||
    combined.includes("schema cache") ||
    (combined.includes('relation "public.') && combined.includes("does not exist")) ||
    (combined.includes("could not find the table") && combined.includes("public."))
  );
}

function isUniqueViolationError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as Record<string, unknown>).code === "23505");
}

function normalizeTone(value: unknown) {
  return value === "urgent" ? "urgent" : "normal";
}

function normalizePollVoterMode(value: unknown): HomeNoticePollVoterMode {
  return value === "named" ? "named" : "anonymous";
}

function normalizeKind(value: unknown) {
  return value === "general" ? "general" : "popup";
}

function normalizeCommunityCategory(value: unknown): CommunityBoardPost["category"] {
  if (value === "family" || value === "celebration" || value === "resource") return value;
  return "notice";
}

function normalizeCommunityBoardAttachment(value: unknown): CommunityBoardAttachment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl.trim() : "";
  const downloadUrl = typeof record.downloadUrl === "string" ? record.downloadUrl.trim() : "";
  const storagePath = typeof record.storagePath === "string" ? record.storagePath.trim() : "";
  const sizeBytes = typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? record.sizeBytes : 0;
  if (!fileName || (!dataUrl && !storagePath && !downloadUrl) || sizeBytes <= 0) {
    return null;
  }
  return {
    fileName,
    mimeType,
    sizeBytes,
    ...(dataUrl ? { dataUrl } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(storagePath ? { storagePath } : {}),
  };
}

function normalizeHomeNoticePoll(value: unknown): HomeNoticePoll | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<HomeNoticePoll>;
  const fallbackDate = new Date().toISOString();
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const options = (Array.isArray(record.options) ? record.options : [])
    .filter((option): option is HomeNoticePollOption => Boolean(option && typeof option.id === "string"))
    .map((option) => ({
      id: option.id.trim(),
      title: typeof option.title === "string" ? option.title.trim() : "",
    }))
    .filter((option) => option.id && option.title)
    .slice(0, 12);
  const optionIds = new Set(options.map((option) => option.id));
  const votes = (Array.isArray(record.votes) ? record.votes : [])
    .filter((vote): vote is HomeNoticePollVote => Boolean(vote && typeof vote.optionId === "string"))
    .map((vote) => ({
      optionId: vote.optionId.trim(),
      voterName: typeof vote.voterName === "string" ? vote.voterName.trim() : undefined,
      createdAt: normalizeIsoDate(vote.createdAt, fallbackDate),
      isCurrentUser: Boolean(vote.isCurrentUser),
    }))
    .filter((vote) => optionIds.has(vote.optionId));

  if (!title || options.length < 2) return null;

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : crypto.randomUUID(),
    title,
    voterMode: normalizePollVoterMode(record.voterMode),
    options,
    votes,
    createdAt: normalizeIsoDate(record.createdAt, fallbackDate),
    updatedAt: normalizeIsoDate(record.updatedAt, fallbackDate),
  };
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
    poll: normalizeHomeNoticePoll(input.poll),
    expiresAt,
    createdAt: normalizeIsoDate(input.createdAt, fallbackDate),
    updatedAt: normalizeIsoDate(input.updatedAt, fallbackDate),
  };
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

function serializeNoticeForStore(notice: HomeNotice): HomeNotice {
  const normalized = normalizeHomeNotice({
    ...notice,
    id: notice.id,
    title: notice.title,
    body: notice.body,
  });

  if (!normalized.poll) return normalized;

  return {
    ...normalized,
    poll: {
      ...normalized.poll,
      votes: [],
    },
  };
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

function getActiveHomeDdays(ddays: HomeDdayItem[]) {
  const todayStamp = getKstTodayStamp();
  return ddays.filter((item) => item.targetDate >= todayStamp);
}

function getActivePopupNotice(notices: HomeNotice[]) {
  const popup = notices.find((notice) => notice.kind === "popup" && notice.isActive && !isExpired(notice.expiresAt));
  return popup ?? null;
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
        parsed?.version !== 5 &&
        parsed?.version !== 6) ||
      !parsedNotices
    ) {
      return {
        notices: rowToLegacyNotice(row),
        ddays: [] as HomeDdayItem[],
        communityPosts: [] as CommunityBoardPost[],
        communityComments: [] as CommunityBoardComment[],
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
      ddays: getActiveHomeDdays(
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
          .filter((item) => item.title && /^\d{4}-\d{2}-\d{2}$/.test(item.targetDate)),
      ).slice(0, 3),
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
      ddays: [] as HomeDdayItem[],
      communityPosts: [] as CommunityBoardPost[],
      communityComments: [] as CommunityBoardComment[],
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

function sanitizePollForProfile(notice: HomeNotice, profile: Pick<ProfileRow, "id"> | null | undefined): HomeNoticePoll | null {
  if (!notice.poll) return null;
  const voterMode = notice.poll.voterMode;

  return {
    ...notice.poll,
    votes: notice.poll.votes.map((vote) => ({
      optionId: vote.optionId,
      voterName: voterMode === "named" ? vote.voterName : undefined,
      createdAt: vote.createdAt,
      isCurrentUser: Boolean(vote.isCurrentUser),
    })),
  };
}

function sanitizeNoticeForProfile(notice: HomeNotice, profile: Pick<ProfileRow, "id"> | null | undefined): HomeNotice {
  return {
    ...notice,
    poll: sanitizePollForProfile(notice, profile),
  };
}

function sanitizeWorkspaceForProfile(
  workspace: ReturnType<typeof parseStorePayload>,
  profile: Pick<ProfileRow, "id"> | null | undefined,
) {
  return {
    ...workspace,
    notices: workspace.notices.map((notice) => sanitizeNoticeForProfile(notice, profile)),
  };
}

function getCommunityAttachmentDownloadUrl(postId: string) {
  return `/api/home/public-workspace?attachmentPostId=${encodeURIComponent(postId)}`;
}

function serializeCommunityPostForResponse(post: CommunityBoardPost): CommunityBoardPost {
  if (!post.attachment) return post;
  const { dataUrl: _dataUrl, ...attachment } = post.attachment;
  return {
    ...post,
    attachment: {
      ...attachment,
      downloadUrl: attachment.downloadUrl || getCommunityAttachmentDownloadUrl(post.id),
    },
  };
}

function serializeCommunityPostsForResponse(posts: CommunityBoardPost[]) {
  return posts.map(serializeCommunityPostForResponse);
}

function parseAttachmentDataUrl(dataUrl: string, fallbackMimeType: string) {
  const matched = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!matched) return null;
  const mimeType = matched[1]?.trim() || fallbackMimeType || "application/octet-stream";
  const isBase64 = Boolean(matched[2]);
  const payload = matched[3] ?? "";
  try {
    return {
      mimeType,
      bytes: isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8"),
    };
  } catch {
    return null;
  }
}

function getSafeAttachmentFilename(fileName: string) {
  const normalized = fileName.trim().replace(/[\r\n"\\]/g, "_");
  return normalized || "attachment";
}

async function ensureCommunityAttachmentBucket(admin: ReturnType<typeof createAdminClient>) {
  const { error } = await admin.storage.createBucket(HOME_COMMUNITY_ATTACHMENT_BUCKET, {
    public: false,
  });
  if (error && !/already exists|duplicate|exists/i.test(error.message)) {
    throw new Error("첨부 파일 저장소를 준비하지 못했습니다.");
  }
}

function getAttachmentFileExtension(fileName: string, mimeType: string) {
  const fromName = fileName.split(".").pop()?.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName) return fromName.slice(0, 12);
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "bin";
}

function getCommunityAttachmentStoragePath(postId: string, attachment: CommunityBoardAttachment) {
  const extension = getAttachmentFileExtension(attachment.fileName, attachment.mimeType);
  return `community/${postId}/${crypto.randomUUID()}.${extension}`;
}

async function persistCommunityAttachmentToStorage(
  admin: ReturnType<typeof createAdminClient>,
  postId: string,
  attachment: CommunityBoardAttachment | null,
  ownerId: string,
): Promise<CommunityBoardAttachment | null> {
  if (attachment?.storagePath) {
    const ownerPrefix = `community/${ownerId}/`;
    const legacyPostPrefix = `community/${postId}/`;
    if (!attachment.storagePath.startsWith(ownerPrefix) && !attachment.storagePath.startsWith(legacyPostPrefix)) {
      throw new Error("첨부 파일 저장 경로를 확인해 주세요.");
    }
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storagePath: attachment.storagePath,
      downloadUrl: attachment.downloadUrl || getCommunityAttachmentDownloadUrl(postId),
    };
  }
  if (!attachment?.dataUrl) return attachment;
  const parsed = parseAttachmentDataUrl(attachment.dataUrl, attachment.mimeType);
  if (!parsed) {
    throw new Error("첨부 파일 형식을 확인해 주세요.");
  }

  await ensureCommunityAttachmentBucket(admin);
  const storagePath = getCommunityAttachmentStoragePath(postId, attachment);
  const { error } = await admin.storage.from(HOME_COMMUNITY_ATTACHMENT_BUCKET).upload(storagePath, parsed.bytes, {
    contentType: parsed.mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error("첨부 파일을 저장하지 못했습니다.");
  }

  return {
    fileName: attachment.fileName,
    mimeType: parsed.mimeType,
    sizeBytes: attachment.sizeBytes,
    storagePath,
    downloadUrl: getCommunityAttachmentDownloadUrl(postId),
  };
}

async function buildStorageAttachmentDownloadResponse(
  request: Request,
  startedAt: number,
  attachment: CommunityBoardAttachment,
) {
  const storagePath = attachment.storagePath?.trim();
  if (!storagePath) {
    return jsonWithUsageDebug(request, startedAt, { message: "첨부 파일을 찾지 못했습니다." }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(HOME_COMMUNITY_ATTACHMENT_BUCKET).download(storagePath);
  if (error || !data) {
    return jsonWithUsageDebug(request, startedAt, { message: "첨부 파일을 찾지 못했습니다." }, { status: 404 });
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  const fileName = getSafeAttachmentFilename(attachment.fileName);
  logRouteUsageDebug(request, {
    status: 200,
    startedAt,
    responseBytes: bytes.byteLength,
  });
  return new Response(bytes, {
    headers: {
      "Content-Type": attachment.mimeType || data.type || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function buildAttachmentDownloadResponse(request: Request, startedAt: number, post: CommunityBoardPost) {
  const attachment = post.attachment;
  if (!attachment?.dataUrl && !attachment?.storagePath) {
    return jsonWithUsageDebug(request, startedAt, { message: "첨부 파일을 찾지 못했습니다." }, { status: 404 });
  }

  if (attachment.storagePath) {
    return buildStorageAttachmentDownloadResponse(request, startedAt, attachment);
  }

  const parsed = parseAttachmentDataUrl(attachment.dataUrl ?? "", attachment.mimeType);
  if (!parsed) {
    return jsonWithUsageDebug(request, startedAt, { message: "첨부 파일 형식을 확인해 주세요." }, { status: 415 });
  }

  const fileName = getSafeAttachmentFilename(attachment.fileName);
  logRouteUsageDebug(request, {
    status: 200,
    startedAt,
    responseBytes: parsed.bytes.byteLength,
  });
  return new Response(parsed.bytes, {
    headers: {
      "Content-Type": parsed.mimeType,
      "Content-Length": String(parsed.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function fetchHomeNoticePollVoteRows(
  admin: ReturnType<typeof createAdminClient>,
  notices: HomeNotice[],
) {
  const noticeIds = notices
    .filter((notice) => notice.poll && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notice.id))
    .map((notice) => notice.id);

  if (noticeIds.length === 0) return [] as HomeNoticePollVoteRow[];

  const { data, error } = await admin
    .from("home_notice_poll_votes")
    .select("id, notice_id, poll_id, option_id, voter_id, voter_name, created_at")
    .in("notice_id", noticeIds)
    .returns<HomeNoticePollVoteRow[]>();

  if (error) {
    if (isSupabaseSchemaMissingError(error)) {
      return [];
    }
    throw new Error("투표 결과 조회에 실패했습니다.");
  }

  return data ?? [];
}

function mergePollVotesIntoWorkspace(
  workspace: ReturnType<typeof parseStorePayload>,
  voteRows: HomeNoticePollVoteRow[],
  profile: Pick<ProfileRow, "id"> | null | undefined,
) {
  if (voteRows.length === 0) return workspace;

  const rowsByPoll = voteRows.reduce<Record<string, HomeNoticePollVoteRow[]>>((groups, row) => {
    const key = `${row.notice_id}:${row.poll_id}`;
    groups[key] = groups[key] ?? [];
    groups[key].push(row);
    return groups;
  }, {});

  return {
    ...workspace,
    notices: workspace.notices.map((notice) => {
      if (!notice.poll) return notice;

      const key = `${notice.id}:${notice.poll.id}`;
      const rows = rowsByPoll[key] ?? [];
      const optionIds = new Set(notice.poll.options.map((option) => option.id));
      return normalizeHomeNotice({
        ...notice,
        poll: {
          ...notice.poll,
          votes: rows
            .filter((row) => optionIds.has(row.option_id))
            .map((row) => ({
              optionId: row.option_id,
              voterName: notice.poll?.voterMode === "named" ? row.voter_name ?? "사용자" : undefined,
              createdAt: row.created_at,
              isCurrentUser: Boolean(profile?.id && row.voter_id === profile.id),
            })),
        },
      });
    }),
  };
}

function canWriteCommunityCategory(
  category: CommunityBoardPost["category"],
  profile: ProfileRow,
) {
  if (!profile.approved || profile.role === "observer") return false;
  if (category === "notice") return isManagerRole(profile.role);
  return true;
}

function validateCommunityPostInput(input: unknown) {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const category = normalizeCommunityCategory(record.category);
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const body = typeof record.body === "string" ? record.body.trim() : "";
  const attachment = normalizeCommunityBoardAttachment(record.attachment);

  if (!title || !body) {
    throw new Error("제목과 본문을 모두 입력해 주세요.");
  }

  return { category, title, body, attachment };
}

function validateCommunityCommentInput(input: unknown) {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const targetKey = typeof record.targetKey === "string" ? record.targetKey.trim() : "";
  const content = typeof record.content === "string" ? record.content.trim() : "";

  if (!targetKey) {
    throw new Error("댓글을 남길 게시글을 찾지 못했습니다.");
  }
  if (!content) {
    throw new Error("댓글 내용을 입력해 주세요.");
  }
  if (content.length > 300) {
    throw new Error("댓글은 300자 이내로 입력해 주세요.");
  }

  return { targetKey, content };
}

function buildStorePayload(
  notices: HomeNotice[],
  ddays: HomeDdayItem[],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
) {
  return JSON.stringify({
    version: 6,
    notices: sortNotices(notices.map(serializeNoticeForStore)),
    ddays: getActiveHomeDdays(ddays).slice(0, 3),
    communityPosts: sortCommunityPosts(communityPosts),
    communityComments: sortCommunityComments(communityComments),
  } satisfies HomeNoticeStorePayload);
}

function buildRowPayload(
  notices: HomeNotice[],
  ddays: HomeDdayItem[],
  communityPosts: CommunityBoardPost[],
  communityComments: CommunityBoardComment[],
  profileId: string,
) {
  const sortedNotices = sortNotices(notices);
  const activePopup = getActivePopupNotice(sortedNotices);
  const latestNotice = sortedNotices[0] ?? null;
  const representativeNotice = sortedNotices.find((notice) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notice.id)) ?? null;
  const now = new Date().toISOString();

  return {
    key: "active",
    notice_id: activePopup?.id ?? representativeNotice?.id ?? crypto.randomUUID(),
    title: activePopup?.title ?? latestNotice?.title ?? "",
    body: buildStorePayload(sortedNotices, ddays, communityPosts, communityComments),
    is_active: Boolean(activePopup),
    expires_at: activePopup?.expiresAt ?? null,
    created_at: now,
    updated_at: now,
    created_by: profileId,
    updated_by: profileId,
  };
}

async function selectHomePopupNoticeRow(admin: ReturnType<typeof createAdminClient>) {
  const preferred = await admin
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
    .eq("key", "active")
    .maybeSingle<HomePopupNoticeStateRow>();

  if (!preferred.error || !isMissingExpiresAtColumnError(preferred.error)) {
    return preferred;
  }

  return admin
    .from("home_popup_notice_state")
    .select("key, notice_id, title, body, is_active, created_at, updated_at")
    .eq("key", "active")
    .maybeSingle<HomePopupNoticeStateRow>();
}

async function persistHomeWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspace: {
    notices: HomeNotice[];
    ddays: HomeDdayItem[];
    communityPosts: CommunityBoardPost[];
    communityComments: CommunityBoardComment[];
  },
  profileId: string,
) {
  const payload = buildRowPayload(
    workspace.notices,
    workspace.ddays,
    workspace.communityPosts,
    workspace.communityComments,
    profileId,
  );

  let { data, error } = await admin
    .from("home_popup_notice_state")
    .upsert(payload as never)
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

    ({ data, error } = await admin
      .from("home_popup_notice_state")
      .upsert(fallbackPayload as never)
      .select("key, notice_id, title, body, is_active, created_at, updated_at")
      .maybeSingle<HomePopupNoticeStateRow>());
  }

  if (error) {
    throw new Error("커뮤니티 게시글 저장에 실패했습니다.");
  }

  return parseStorePayload(data ?? null);
}

function buildWorkspaceJson(
  workspace: ReturnType<typeof parseStorePayload>,
  applications: HomePopupNoticeApplication[] = [],
  ownApplied = false,
  profile: Pick<ProfileRow, "id"> | null | undefined = null,
) {
  const safeWorkspace = sanitizeWorkspaceForProfile(workspace, profile);
  const activePopup = getActivePopupNotice(safeWorkspace.notices);
  return {
    notice: activePopup,
    notices: safeWorkspace.notices,
    ddays: safeWorkspace.ddays,
    communityPosts: serializeCommunityPostsForResponse(safeWorkspace.communityPosts),
    communityComments: safeWorkspace.communityComments,
    applications,
    ownApplied,
  };
}

function createAssignmentRowKey(dateKey: string, category: string, index: number, name: string) {
  return `${dateKey}::${category}::${index}::${name}`;
}

function createCustomAssignmentRowKey(dateKey: string, customId: string) {
  return `${dateKey}::custom::${customId}`;
}

function createDefaultScheduleAssignmentEntry(): ScheduleAssignmentEntry {
  return {
    schedules: [""],
    travelType: "",
    tripTagId: "",
    tripTagLabel: "",
    tripTagPhase: "",
  };
}

function normalizeScheduleAssignmentEntry(
  entry: Partial<ScheduleAssignmentEntry> | undefined,
): ScheduleAssignmentEntry {
  return {
    schedules:
      entry?.schedules && entry.schedules.length > 0
        ? entry.schedules.map((item) => (typeof item === "string" ? item : ""))
        : [""],
    travelType:
      entry?.travelType === "국내출장" || entry?.travelType === "해외출장" || entry?.travelType === "당일출장"
        ? entry.travelType
        : "",
    tripTagId: typeof entry?.tripTagId === "string" ? entry.tripTagId : "",
    tripTagLabel: typeof entry?.tripTagLabel === "string" ? entry.tripTagLabel : "",
    tripTagPhase:
      entry?.tripTagPhase === "departure" || entry?.tripTagPhase === "ongoing" || entry?.tripTagPhase === "return"
        ? entry.tripTagPhase
        : "",
  };
}

function createDefaultScheduleAssignmentDayRows(): ScheduleAssignmentDayRows {
  return {
    addedRows: [],
    deletedRowKeys: [],
    rowOverrides: {},
  };
}

function normalizeDayRows(dayRows: Partial<ScheduleAssignmentDayRows> | undefined): ScheduleAssignmentDayRows {
  return {
    addedRows:
      Array.isArray(dayRows?.addedRows)
        ? dayRows.addedRows
          .filter((row): row is ScheduleAssignmentCustomRow => Boolean(row && typeof row.id === "string"))
          .map((row) => ({
            id: row.id,
            name: row.name ?? "",
            duty: row.duty ?? "",
          }))
        : [],
    deletedRowKeys: Array.isArray(dayRows?.deletedRowKeys) ? dayRows.deletedRowKeys.filter(Boolean) : [],
    rowOverrides:
      dayRows?.rowOverrides && typeof dayRows.rowOverrides === "object"
        ? Object.fromEntries(
          Object.entries(dayRows.rowOverrides).map(([rowKey, row]) => [
            rowKey,
            {
              name: row?.name ?? "",
              duty: row?.duty ?? "",
            },
          ]),
        )
        : {},
  };
}

function getScheduleAssignmentRows(
  day: DaySchedule,
  dayRows: ScheduleAssignmentDayRows = createDefaultScheduleAssignmentDayRows(),
) {
  const baseRows = Object.entries(day.assignments)
    .filter(([category, names]) => category !== "휴가" && category !== "제크" && names.length > 0)
    .flatMap(([category, names]) =>
      names.map((name, index) => {
        const key = createAssignmentRowKey(day.dateKey, category, index, name);
        const override = dayRows.rowOverrides[key];
        return {
          key,
          name: override?.name || name,
          duty: override?.duty || getScheduleCategoryLabel(category),
        };
      }),
    )
    .filter((row) => !dayRows.deletedRowKeys.includes(row.key));

  const addedRows = dayRows.addedRows
    .map((row) => ({
      key: createCustomAssignmentRowKey(day.dateKey, row.id),
      name: row.name,
      duty: row.duty,
    }))
    .filter((row) => !dayRows.deletedRowKeys.includes(row.key));

  return [...addedRows, ...baseRows] satisfies ScheduleAssignmentRow[];
}

function buildTripCards(
  scheduleRows: ScheduleMonthRow[],
  assignmentRows: TeamLeadScheduleAssignmentRow[],
): TeamLeadTripPersonCard[] {
  const assignmentMap = new Map(assignmentRows.map((row) => [row.month_key, row] as const));
  const timelineMap = new Map<string, TripTimelineRow[]>();

  scheduleRows
    .map((row) => ({
      month_key: row.month_key,
      schedule: row.published_state,
    }))
    .filter((row): row is { month_key: string; schedule: GeneratedSchedule } => Boolean(row.schedule))
    .sort((left, right) => left.month_key.localeCompare(right.month_key))
    .forEach(({ month_key, schedule }) => {
      const assignment = assignmentMap.get(month_key);
      const monthEntries = assignment?.entries ?? {};
      const monthRows = assignment?.rows ?? {};

      schedule.days
        .filter((day) => day.month === schedule.month)
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
        .forEach((day) => {
          const rows = getScheduleAssignmentRows(day, normalizeDayRows(monthRows[day.dateKey]));
          rows.forEach((row) => {
            const personName = row.name.trim();
            if (!personName) return;
            const entry = normalizeScheduleAssignmentEntry(monthEntries[row.key]);
            const current = timelineMap.get(personName) ?? [];
            current.push({
              rowKey: row.key,
              dateKey: day.dateKey,
              entry,
            });
            timelineMap.set(personName, current);
          });
        });
    });

  const personTripBuilderMap = new Map<string, Map<string, TripAggregateBuilder>>();

  timelineMap.forEach((rows, personName) => {
    let activeTrip: ActiveTripState | null = null;
    const sortedRows = [...rows].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.rowKey.localeCompare(right.rowKey));

    sortedRows.forEach((row) => {
      const explicitTrip =
        row.entry.tripTagId && row.entry.tripTagLabel
          ? {
              tripTagId: row.entry.tripTagId,
              tripTagLabel: row.entry.tripTagLabel,
              travelType: (row.entry.travelType || activeTrip?.travelType || "") as AssignmentTravelType,
              phase: row.entry.tripTagPhase,
            }
          : null;

      const visibleTrip = explicitTrip ?? (activeTrip
        ? {
            tripTagId: activeTrip.tripTagId,
            tripTagLabel: activeTrip.tripTagLabel,
            travelType: activeTrip.travelType,
            phase: "ongoing" as AssignmentTripTagPhase,
          }
        : null);

      if (explicitTrip?.phase === "departure" || (explicitTrip?.phase === "ongoing" && !activeTrip)) {
        activeTrip = {
          tripTagId: explicitTrip.tripTagId,
          tripTagLabel: explicitTrip.tripTagLabel,
          travelType: explicitTrip.travelType,
        };
      } else if (activeTrip && explicitTrip && explicitTrip.tripTagId === activeTrip.tripTagId) {
        activeTrip = {
          tripTagId: activeTrip.tripTagId,
          tripTagLabel: explicitTrip.tripTagLabel,
          travelType: explicitTrip.travelType || activeTrip.travelType,
        };
      }

      const tripForDay =
        explicitTrip?.travelType === "당일출장"
          ? explicitTrip
          : explicitTrip?.phase === "departure" || explicitTrip?.phase === "ongoing"
            ? activeTrip
            : activeTrip && visibleTrip && visibleTrip.tripTagId === activeTrip.tripTagId
              ? activeTrip
              : null;

      if (tripForDay && tripForDay.travelType) {
        const personTrips = personTripBuilderMap.get(personName) ?? new Map<string, TripAggregateBuilder>();
        const currentBuilder = personTrips.get(tripForDay.tripTagId) ?? {
          tripTagId: tripForDay.tripTagId,
          tripTagLabel: tripForDay.tripTagLabel,
          travelType: tripForDay.travelType,
          startDateKey: row.dateKey,
          endDateKey: row.dateKey,
          dateKeys: [],
          dateKeySet: new Set<string>(),
          schedules: [],
          scheduleSet: new Set<string>(),
        };

        if (!currentBuilder.dateKeySet.has(row.dateKey)) {
          currentBuilder.dateKeySet.add(row.dateKey);
          currentBuilder.dateKeys.push(row.dateKey);
          currentBuilder.startDateKey = currentBuilder.startDateKey <= row.dateKey ? currentBuilder.startDateKey : row.dateKey;
          currentBuilder.endDateKey = currentBuilder.endDateKey >= row.dateKey ? currentBuilder.endDateKey : row.dateKey;
        }

        row.entry.schedules
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((scheduleText) => {
            if (currentBuilder.scheduleSet.has(scheduleText)) return;
            currentBuilder.scheduleSet.add(scheduleText);
            currentBuilder.schedules.push(scheduleText);
          });

        currentBuilder.tripTagLabel = tripForDay.tripTagLabel;
        currentBuilder.travelType = tripForDay.travelType;
        personTrips.set(tripForDay.tripTagId, currentBuilder);
        personTripBuilderMap.set(personName, personTrips);
      }

      if (explicitTrip?.phase === "return" && activeTrip && explicitTrip.tripTagId === activeTrip.tripTagId) {
        activeTrip = null;
      }
    });
  });

  return Array.from(personTripBuilderMap.entries())
    .map(([name, tripMap]) => ({
      name,
      items: Array.from(tripMap.values())
        .map((builder) => ({
          tripTagId: builder.tripTagId,
          tripTagLabel: builder.tripTagLabel,
          travelType: builder.travelType,
          startDateKey: builder.startDateKey,
          endDateKey: builder.endDateKey,
          dayCount: builder.dateKeys.length,
          dateKeys: [...builder.dateKeys],
          duties: [],
          schedules: [...builder.schedules],
        }))
        .sort((left, right) => left.startDateKey.localeCompare(right.startDateKey)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getMonthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getHomeTripDateWindow(now = new Date()) {
  const startDate = addDays(now, -HOME_TRIP_LOOKBACK_DAYS);
  const endDate = addDays(now, HOME_TRIP_LOOKAHEAD_DAYS);
  const monthKeys = new Set<string>();
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= endMonth) {
    monthKeys.add(getMonthKeyFromDate(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return {
    todayKey: formatDateKey(now),
    startKey: formatDateKey(startDate),
    endKey: formatDateKey(endDate),
    monthKeys: Array.from(monthKeys).sort((left, right) => left.localeCompare(right)),
  };
}

function filterScheduleRowsToDateWindow(rows: ScheduleMonthRow[], startKey: string, endKey: string): ScheduleMonthRow[] {
  return rows.map((row) => {
    if (!row.published_state) return row;
    return {
      ...row,
      published_state: {
        ...row.published_state,
        days: row.published_state.days.filter((day) => day.dateKey >= startKey && day.dateKey <= endKey),
      },
    };
  });
}

function filterCurrentTripCards(cards: TeamLeadTripPersonCard[], todayKey: string) {
  return cards
    .map((card) => ({
      ...card,
      items: card.items.filter((item) =>
        CURRENT_TRIP_TRAVEL_TYPES.has(item.travelType) &&
        item.startDateKey <= todayKey &&
        item.endDateKey >= todayKey,
      ),
    }))
    .filter((card) => card.items.length > 0);
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    if (!hasSupabaseAdminEnv()) {
      return jsonWithUsageDebug(request, startedAt, { message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const includeTrips = searchParams.get("includeTrips") !== "0";
    const includeCommunity = searchParams.get("includeCommunity") !== "0";
    const attachmentPostId = searchParams.get("attachmentPostId")?.trim() ?? "";

    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await withTimeout(supabase.auth.getUser(), "로그인 세션 확인이 지연되고 있습니다.");

    if (userError || !user) {
      return jsonWithUsageDebug(request, startedAt, { message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await withTimeout(
      admin
        .from("profiles")
        .select("id, role, approved")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>(),
      "프로필 확인이 지연되고 있습니다.",
    );

    if (profileError || !profile || !profile.approved) {
      return jsonWithUsageDebug(request, startedAt, { message: "승인된 계정이 필요합니다." }, { status: 403 });
    }

    if (attachmentPostId) {
      const { data: noticeRow, error: noticeError } = await withTimeout(
        selectHomePopupNoticeRow(admin),
        "첨부 파일 조회가 지연되고 있습니다.",
      );

      if (noticeError) {
        throw new Error("커뮤니티 게시글 조회에 실패했습니다.");
      }

      const workspace = sanitizeWorkspaceForProfile(parseStorePayload(noticeRow ?? null), profile);
      const targetPost = workspace.communityPosts.find((post) => post.id === attachmentPostId) ?? null;
      if (!targetPost || targetPost.category !== "resource") {
        return jsonWithUsageDebug(request, startedAt, { message: "첨부 파일을 찾지 못했습니다." }, { status: 404 });
      }

      return await buildAttachmentDownloadResponse(request, startedAt, targetPost);
    }

    const tripWindow = includeTrips ? getHomeTripDateWindow() : null;
    const monthKeys = tripWindow?.monthKeys ?? [];
    const [{ data: noticeRow, error: noticeError }, { data: scheduleRows }, { data: assignmentRows }] = await withTimeout(
      Promise.all([
        selectHomePopupNoticeRow(admin),
        includeTrips
          ? admin
            .from("schedule_months")
            .select("month_key, published_state")
            .in("month_key", monthKeys)
            .returns<ScheduleMonthRow[]>()
          : Promise.resolve({ data: [] as ScheduleMonthRow[] }),
        includeTrips
          ? admin
            .from("team_lead_schedule_assignments")
            .select("month_key, entries, rows")
            .in("month_key", monthKeys)
            .returns<TeamLeadScheduleAssignmentRow[]>()
          : Promise.resolve({ data: [] as TeamLeadScheduleAssignmentRow[] }),
      ]),
      "홈 워크스페이스 조회가 지연되고 있습니다.",
    );

    if (noticeError) {
      throw new Error("커뮤니티 게시글 조회에 실패했습니다.");
    }

    const workspace = parseStorePayload(noticeRow ?? null);
    const voteRows = await withTimeout(
      fetchHomeNoticePollVoteRows(admin, workspace.notices),
      "투표 결과 조회가 지연되고 있습니다.",
    );
    const workspaceWithVotes = mergePollVotesIntoWorkspace(workspace, voteRows, profile);
    const activePopup = getActivePopupNotice(workspaceWithVotes.notices);
    let ownApplied = false;
    let applications: HomePopupNoticeApplication[] = [];

    if (activePopup?.applicationEnabled) {
      const { data: ownApplicationRow } = await withTimeout(
        admin
          .from("home_popup_notice_applications")
          .select("id")
          .eq("notice_id", activePopup.id)
          .eq("applicant_id", profile.id)
          .maybeSingle<{ id: string }>(),
        "홈 신청 상태 확인이 지연되고 있습니다.",
      );
      ownApplied = Boolean(ownApplicationRow?.id);

      if (isManagerRole(profile.role)) {
        const { data: applicationRows } = await withTimeout(
          admin
            .from("home_popup_notice_applications")
            .select("id, notice_id, applicant_id, applicant_name, created_at")
            .eq("notice_id", activePopup.id)
            .order("created_at", { ascending: false })
            .returns<HomePopupNoticeApplicationRow[]>(),
          "홈 신청 목록 조회가 지연되고 있습니다.",
        );
        applications = (applicationRows ?? []).map(rowToApplication);
      }
    }

    const safeWorkspace = sanitizeWorkspaceForProfile(workspaceWithVotes, profile);
    const safeActivePopup = getActivePopupNotice(safeWorkspace.notices);
    const payload = {
      notice: safeActivePopup,
      notices: safeWorkspace.notices,
      ddays: safeWorkspace.ddays,
      communityPosts: includeCommunity ? serializeCommunityPostsForResponse(safeWorkspace.communityPosts) : [],
      communityComments: includeCommunity ? safeWorkspace.communityComments : [],
      applications,
      ownApplied,
      ...(includeTrips && tripWindow
        ? {
            tripCards: filterCurrentTripCards(
              buildTripCards(
                filterScheduleRowsToDateWindow(scheduleRows ?? [], tripWindow.startKey, tripWindow.endKey),
                assignmentRows ?? [],
              ),
              tripWindow.todayKey,
            ),
          }
        : {}),
    };

    return jsonWithUsageDebug(request, startedAt, payload);
  } catch (error) {
    const payload = {
      message: error instanceof Error ? error.message : "공개 홈 데이터를 불러오지 못했습니다.",
    };
    const status = error instanceof Error && error.message.includes("지연") ? 503 : 500;
    return jsonWithUsageDebug(request, startedAt, payload, { status });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    if (!hasSupabaseAdminEnv()) {
      return jsonWithUsageDebug(request, startedAt, { message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await withTimeout(supabase.auth.getUser(), "로그인 세션 확인이 지연되고 있습니다.");

    if (userError || !user) {
      return jsonWithUsageDebug(request, startedAt, { message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await withTimeout(
      admin
        .from("profiles")
        .select("id, name, role, approved")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>(),
      "프로필 확인이 지연되고 있습니다.",
    );

    if (profileError || !profile || !profile.approved) {
      return jsonWithUsageDebug(request, startedAt, { message: "승인된 계정이 필요합니다." }, { status: 403 });
    }

    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof payload?.action === "string" ? payload.action : "";
    const { data: noticeRow, error: noticeError } = await withTimeout(
      selectHomePopupNoticeRow(admin),
      "커뮤니티 게시글 조회가 지연되고 있습니다.",
    );

    if (noticeError) {
      throw new Error("커뮤니티 게시글 조회에 실패했습니다.");
    }

    const workspace = parseStorePayload(noticeRow ?? null);
    const now = new Date().toISOString();
    const authorName = profile.name?.trim() || user.email || "사용자";

    if (action === "createPost") {
      const input = validateCommunityPostInput(payload);
      if (!canWriteCommunityCategory(input.category, profile)) {
        return jsonWithUsageDebug(
          request,
          startedAt,
          {
            message: input.category === "notice"
              ? "공지 게시판은 DESK 또는 총괄팀장 권한자만 작성할 수 있습니다."
              : "Observer 등급은 커뮤니티 글을 작성할 수 없습니다.",
          },
          { status: 403 },
        );
      }

      const postId = crypto.randomUUID();
      const storedAttachment = await persistCommunityAttachmentToStorage(admin, postId, input.attachment, profile.id);
      const nextPost = normalizeCommunityBoardPost({
        id: postId,
        category: input.category,
        title: input.title,
        body: input.body,
        authorId: profile.id,
        authorName,
        attachment: storedAttachment,
        createdAt: now,
        updatedAt: now,
      });
      const nextNotices = input.category === "notice"
        ? sortNotices([
            normalizeHomeNotice({
              id: `shadow:${nextPost.id}`,
              title: input.title,
              body: input.body,
              kind: "general",
              tone: "normal",
              isActive: true,
              applicationEnabled: false,
              expiresAt: null,
              createdAt: now,
              updatedAt: now,
            }),
            ...workspace.notices,
          ])
        : workspace.notices;
      const nextWorkspace = await persistHomeWorkspace(
        admin,
        {
          notices: nextNotices,
          ddays: workspace.ddays,
          communityPosts: sortCommunityPosts([nextPost, ...workspace.communityPosts]),
          communityComments: workspace.communityComments,
        },
        profile.id,
      );

      return jsonWithUsageDebug(request, startedAt, {
        ...buildWorkspaceJson(nextWorkspace, [], false, profile),
        post: serializeCommunityPostForResponse(nextPost),
      });
    }

    if (action === "updatePost") {
      const postId = typeof payload?.postId === "string" ? payload.postId.trim() : "";
      const input = validateCommunityPostInput(payload);
      const preserveAttachment = Boolean(payload?.preserveAttachment);
      const targetPost = workspace.communityPosts.find((post) => post.id === postId) ?? null;
      if (!targetPost) {
        return jsonWithUsageDebug(request, startedAt, { message: "수정할 글을 찾지 못했습니다." }, { status: 404 });
      }
      const canManage =
        targetPost.category === "notice"
          ? isManagerRole(profile.role)
          : isManagerRole(profile.role) || targetPost.authorId === profile.id;
      if (!canManage || profile.role === "observer") {
        return jsonWithUsageDebug(request, startedAt, { message: "작성자 또는 DESK 권한이 필요합니다." }, { status: 403 });
      }

      const nextAttachment = targetPost.category === "resource"
        ? preserveAttachment
          ? targetPost.attachment ?? null
          : await persistCommunityAttachmentToStorage(admin, postId, input.attachment, profile.id)
        : null;
      const nextPosts = workspace.communityPosts.map((post) =>
        post.id === postId
          ? normalizeCommunityBoardPost({
              ...post,
              title: input.title,
              body: input.body,
              attachment: nextAttachment,
              updatedAt: now,
            })
          : post,
      );
      const nextNotices = workspace.notices.map((notice) =>
        notice.id === `shadow:${postId}`
          ? normalizeHomeNotice({
              ...notice,
              title: input.title,
              body: input.body,
              updatedAt: now,
            })
          : notice,
      );
      const nextWorkspace = await persistHomeWorkspace(
        admin,
        {
          notices: nextNotices,
          ddays: workspace.ddays,
          communityPosts: nextPosts,
          communityComments: workspace.communityComments,
        },
        profile.id,
      );

      return jsonWithUsageDebug(request, startedAt, buildWorkspaceJson(nextWorkspace, [], false, profile));
    }

    if (action === "deletePost") {
      const postId = typeof payload?.postId === "string" ? payload.postId.trim() : "";
      const targetPost = workspace.communityPosts.find((post) => post.id === postId) ?? null;
      if (!targetPost) {
        return jsonWithUsageDebug(request, startedAt, { message: "삭제할 글을 찾지 못했습니다." }, { status: 404 });
      }
      const canManage =
        targetPost.category === "notice"
          ? isManagerRole(profile.role)
          : isManagerRole(profile.role) || targetPost.authorId === profile.id;
      if (!canManage || profile.role === "observer") {
        return jsonWithUsageDebug(request, startedAt, { message: "작성자 또는 DESK 권한이 필요합니다." }, { status: 403 });
      }

      const nextWorkspace = await persistHomeWorkspace(
        admin,
        {
          notices: workspace.notices.filter((notice) => notice.id !== `shadow:${postId}`),
          ddays: workspace.ddays,
          communityPosts: workspace.communityPosts.filter((post) => post.id !== postId),
          communityComments: workspace.communityComments.filter((comment) => comment.targetKey !== `manual:${postId}`),
        },
        profile.id,
      );

      return jsonWithUsageDebug(request, startedAt, buildWorkspaceJson(nextWorkspace, [], false, profile));
    }

    if (action === "votePoll") {
      if (profile.role === "observer") {
        return jsonWithUsageDebug(request, startedAt, { message: "Observer 등급은 투표할 수 없습니다." }, { status: 403 });
      }

      const noticeId = typeof payload?.noticeId === "string" ? payload.noticeId.trim() : "";
      const optionId = typeof payload?.optionId === "string" ? payload.optionId.trim() : "";
      const targetNotice = workspace.notices.find((notice) => notice.id === noticeId) ?? null;
      const poll = targetNotice?.poll ?? null;
      const targetOption = poll?.options.find((option) => option.id === optionId) ?? null;

      if (!targetNotice || !poll) {
        return jsonWithUsageDebug(request, startedAt, { message: "투표할 공지를 찾지 못했습니다." }, { status: 404 });
      }
      if (!targetOption) {
        return jsonWithUsageDebug(request, startedAt, { message: "투표 항목을 찾지 못했습니다." }, { status: 404 });
      }

      const { data: existingVote, error: existingVoteError } = await withTimeout(
        admin
          .from("home_notice_poll_votes")
          .select("id")
          .eq("notice_id", targetNotice.id)
          .eq("poll_id", poll.id)
          .eq("voter_id", profile.id)
          .maybeSingle<{ id: string }>(),
        "투표 상태 확인이 지연되고 있습니다.",
      );

      if (existingVoteError) {
        if (isSupabaseSchemaMissingError(existingVoteError)) {
          return jsonWithUsageDebug(request, startedAt, { message: "투표 테이블 구조가 아직 적용되지 않았습니다." }, { status: 500 });
        }
        throw new Error("투표 상태 확인에 실패했습니다.");
      }
      if (existingVote?.id) {
        return jsonWithUsageDebug(request, startedAt, { message: "이미 투표했습니다." }, { status: 409 });
      }

      const { error: voteError } = await withTimeout(
        admin
          .from("home_notice_poll_votes")
          .insert({
            notice_id: targetNotice.id,
            poll_id: poll.id,
            option_id: optionId,
            voter_id: profile.id,
            voter_name: poll.voterMode === "named" ? authorName : null,
          } as never),
        "투표 반영이 지연되고 있습니다.",
      );

      if (voteError) {
        if (isUniqueViolationError(voteError)) {
          return jsonWithUsageDebug(request, startedAt, { message: "이미 투표했습니다." }, { status: 409 });
        }
        if (isSupabaseSchemaMissingError(voteError)) {
          return jsonWithUsageDebug(request, startedAt, { message: "투표 테이블 구조가 아직 적용되지 않았습니다." }, { status: 500 });
        }
        throw new Error("투표를 반영하지 못했습니다.");
      }

      const voteRows = await withTimeout(
        fetchHomeNoticePollVoteRows(admin, workspace.notices),
        "투표 결과 조회가 지연되고 있습니다.",
      );
      const workspaceWithVotes = mergePollVotesIntoWorkspace(workspace, voteRows, profile);

      return jsonWithUsageDebug(request, startedAt, buildWorkspaceJson(workspaceWithVotes, [], false, profile));
    }

    if (action === "createComment") {
      if (profile.role === "observer") {
        return jsonWithUsageDebug(request, startedAt, { message: "Observer 등급은 댓글을 등록할 수 없습니다." }, { status: 403 });
      }

      const input = validateCommunityCommentInput(payload);
      const targetExists =
        workspace.notices.some((notice) => `notice:${notice.id}` === input.targetKey) ||
        workspace.communityPosts.some((post) => `manual:${post.id}` === input.targetKey);

      if (!targetExists) {
        return jsonWithUsageDebug(request, startedAt, { message: "댓글을 남길 게시글을 찾지 못했습니다." }, { status: 404 });
      }

      const nextComment = normalizeCommunityBoardComment({
        id: crypto.randomUUID(),
        targetKey: input.targetKey,
        authorId: profile.id,
        authorName,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      });
      const nextWorkspace = await persistHomeWorkspace(
        admin,
        {
          notices: workspace.notices,
          ddays: workspace.ddays,
          communityPosts: workspace.communityPosts,
          communityComments: sortCommunityComments([nextComment, ...workspace.communityComments]),
        },
        profile.id,
      );

      return jsonWithUsageDebug(request, startedAt, {
        ...buildWorkspaceJson(nextWorkspace, [], false, profile),
        comment: nextComment,
      });
    }

    return jsonWithUsageDebug(request, startedAt, { message: "지원하지 않는 커뮤니티 작업입니다." }, { status: 400 });
  } catch (error) {
    const payload = {
      message: error instanceof Error ? error.message : "커뮤니티 작업을 처리하지 못했습니다.",
    };
    const status = error instanceof Error && error.message.includes("지연") ? 503 : 500;
    return jsonWithUsageDebug(request, startedAt, payload, { status });
  }
}
