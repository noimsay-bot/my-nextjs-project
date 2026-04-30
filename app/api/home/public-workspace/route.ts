import { NextResponse } from "next/server";
import { getScheduleCategoryLabel } from "@/lib/schedule/constants";
import type { DaySchedule, GeneratedSchedule } from "@/lib/schedule/types";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

const HOME_PUBLIC_WORKSPACE_TIMEOUT_MS = 4_000;

type AppRole = "member" | "outlet" | "reviewer" | "team_lead" | "admin" | "desk" | "observer";
type AssignmentTravelType = "" | "국내출장" | "해외출장" | "당일출장";
type AssignmentTripTagPhase = "" | "departure" | "ongoing" | "return";

interface ProfileRow {
  id: string;
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

interface HomeNotice {
  id: string;
  title: string;
  body: string;
  kind: "general" | "popup";
  tone: "normal" | "urgent";
  isActive: boolean;
  applicationEnabled: boolean;
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
  dataUrl: string;
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
  draft_state: GeneratedSchedule | null;
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

function normalizeTone(value: unknown) {
  return value === "urgent" ? "urgent" : "normal";
}

function normalizeKind(value: unknown) {
  return value === "general" ? "general" : "popup";
}

function normalizeCommunityCategory(value: unknown) {
  if (value === "family" || value === "celebration" || value === "resource") return value;
  return "notice";
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
    const parsed = JSON.parse(raw) as Partial<HomeNoticeStorePayload>;
    if ((parsed?.version !== 2 && parsed?.version !== 3 && parsed?.version !== 4 && parsed?.version !== 5) || !Array.isArray(parsed.notices)) {
      return {
        notices: rowToLegacyNotice(row),
        ddays: [] as HomeDdayItem[],
        communityPosts: [] as CommunityBoardPost[],
        communityComments: [] as CommunityBoardComment[],
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
      schedule: row.published_state ?? row.draft_state,
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

function getMonthKeysAroundToday(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), 1);
  return [-1, 0, 1].map((offset) => {
    const current = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
  });
}

export async function GET(request: Request) {
  try {
    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json({ message: "Supabase 관리자 환경변수가 없습니다." }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const includeTrips = searchParams.get("includeTrips") !== "0";

    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await withTimeout(supabase.auth.getUser(), "로그인 세션 확인이 지연되고 있습니다.");

    if (userError || !user) {
      return NextResponse.json({ message: "로그인 세션을 확인하지 못했습니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const monthKeys = includeTrips ? getMonthKeysAroundToday() : [];
    const { data: profile, error: profileError } = await withTimeout(
      admin
        .from("profiles")
        .select("id, role, approved")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>(),
      "프로필 확인이 지연되고 있습니다.",
    );

    if (profileError || !profile || !profile.approved) {
      return NextResponse.json({ message: "승인된 계정이 필요합니다." }, { status: 403 });
    }

    const [{ data: noticeRow }, { data: scheduleRows }, { data: assignmentRows }] = await withTimeout(
      Promise.all([
        admin
          .from("home_popup_notice_state")
          .select("key, notice_id, title, body, is_active, expires_at, created_at, updated_at")
          .eq("key", "active")
          .maybeSingle<HomePopupNoticeStateRow>(),
        includeTrips
          ? admin
            .from("schedule_months")
            .select("month_key, draft_state, published_state")
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

    const workspace = parseStorePayload(noticeRow ?? null);
    const activePopup = getActivePopupNotice(workspace.notices);
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

    return NextResponse.json({
      notice: activePopup,
      notices: workspace.notices,
      ddays: workspace.ddays,
      communityPosts: workspace.communityPosts,
      communityComments: workspace.communityComments,
      applications,
      ownApplied,
      ...(includeTrips ? { tripCards: buildTripCards(scheduleRows ?? [], assignmentRows ?? []) } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "공개 홈 데이터를 불러오지 못했습니다.",
      },
      { status: error instanceof Error && error.message.includes("지연") ? 503 : 500 },
    );
  }
}
