import {
  getPortalSession,
  getPortalSupabaseClient,
} from "@/lib/supabase/portal";

export type ReportType = "일반리포트" | "기획리포트" | "인터뷰리포트" | "LIVE";

export interface SubmissionCard {
  id: string;
  type: ReportType;
  title: string;
  link: string;
  date: string;
  comment: string;
}

interface ReviewRow {
  id: string;
  submission_id: string;
  reviewer_id: string;
  scores: {
    checked?: string[];
    bonusScore?: number;
    bonusComment?: string;
  } | null;
  comment: string | null;
  total: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewAssignmentRow {
  id: string;
  submission_id: string;
  reviewer_id: string;
  assigned_by: string | null;
  assigned_at: string;
  reset_at: string | null;
  created_at: string;
}

interface ProfileNameRow {
  id: string;
  name: string;
}

export interface ReviewWorkspaceResult {
  entries: SubmissionEntry[];
  reviewState: ReviewStateStore;
  canEdit: boolean;
  readOnlyReason: string | null;
  reviewerId: string | null;
}

const REVIEW_SUBMISSION_LOCK_STORAGE_PREFIX = "j-review-submission-lock-v1";
export const REVIEW_SUBMISSION_LOCK_EVENT = "j-review-submission-lock-updated";

function getReviewSubmissionLockStorageKey(userId: string) {
  return `${REVIEW_SUBMISSION_LOCK_STORAGE_PREFIX}:${userId}`;
}

export function hasSubmittedReviewLock(userId: string | null | undefined) {
  if (typeof window === "undefined" || !userId) return false;
  return window.localStorage.getItem(getReviewSubmissionLockStorageKey(userId)) === "1";
}

export function setSubmittedReviewLock(userId: string, locked: boolean) {
  if (typeof window === "undefined" || !userId) return;
  const key = getReviewSubmissionLockStorageKey(userId);
  if (locked) {
    window.localStorage.setItem(key, "1");
  } else {
    window.localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event(REVIEW_SUBMISSION_LOCK_EVENT));
}

export async function subscribeToReviewWorkspaceChanges(onChange: () => void | Promise<void>) {
  const session = await getPortalSession();
  if (!session || (session.role === "member" && !session.canReview)) {
    return () => {};
  }

  const supabase = await getPortalSupabaseClient();
  const channels: Array<ReturnType<typeof supabase.channel>> = [];
  const subscribe = (name: string, table: "submissions" | "reviews", filter?: string) => {
    const channelName = `${name}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter,
        },
        () => {
          void onChange();
        },
      )
      .subscribe();

    channels.push(channel);
  };

  subscribe(`submissions:${session.id}`, "submissions");

  const shouldFilterReviewerRows =
    session.canReview && session.role !== "team_lead" && session.role !== "admin";

  if (shouldFilterReviewerRows) {
    subscribe(`reviews:${session.id}`, "reviews", `reviewer_id=eq.${session.id}`);
  } else {
    subscribe(`reviews:${session.id}`, "reviews");
  }

  return () => {
    channels.forEach((channel) => {
      void supabase.removeChannel(channel);
    });
  };
}

function reviewRowToCardState(row: ReviewRow | undefined): ReviewCardState {
  if (!row) return createEmptyReviewCardState();
  return {
    checked: Array.isArray(row.scores?.checked)
      ? row.scores.checked.filter((item): item is string => typeof item === "string")
      : [],
    bonusScore: Number(row.scores?.bonusScore) || 0,
    bonusComment:
      typeof row.scores?.bonusComment === "string"
        ? row.scores.bonusComment
        : typeof row.comment === "string"
          ? row.comment
          : "",
  };
}

function buildReviewRowsMap(rows: ReviewRow[]) {
  return new Map(rows.map((row) => [`${row.submission_id}::${row.reviewer_id}`, row] as const));
}

function buildLatestReviewRowsMap(rows: ReviewRow[]) {
  const latestRows = new Map<string, ReviewRow>();
  rows.forEach((row) => {
    const current = latestRows.get(row.submission_id);
    if (!current || row.updated_at > current.updated_at) {
      latestRows.set(row.submission_id, row);
    }
  });
  return latestRows;
}

function formatEntryUpdatedAt(rows: SubmissionRow[]) {
  const latestUpdatedAt = rows.reduce((latest, row) => {
    if (!latest || row.updated_at > latest) return row.updated_at;
    return latest;
  }, "");

  return formatSubmissionUpdatedAt(latestUpdatedAt);
}

export async function getReviewWorkspace(): Promise<ReviewWorkspaceResult> {
  const session = await getPortalSession();
  if (!session) {
    return {
      entries: [],
      reviewState: {},
      canEdit: false,
      readOnlyReason: "로그인이 필요합니다.",
      reviewerId: null,
    };
  }

  const role = session.role;
  if (role === "member" && !session.canReview) {
    return {
      entries: [],
      reviewState: {},
      canEdit: false,
      readOnlyReason: "review 권한이 없습니다.",
      reviewerId: session.id,
    };
  }

  const canEdit = session.canReview;
  const readOnlyReason =
    canEdit
      ? null
      : role === "desk"
        ? "DESK 권한은 현재 조회 전용입니다."
        : "현재 권한은 조회 전용입니다.";

  const supabase = await getPortalSupabaseClient();
  const { data: submissionRows, error: submissionError } = await supabase
    .from("submissions")
    .select(SUBMISSION_COLUMNS)
    .order("updated_at", { ascending: false })
    .returns<SubmissionRow[]>();

  if (submissionError) {
    throw new Error(submissionError.message);
  }

  if (!submissionRows || submissionRows.length === 0) {
    return {
      entries: [],
      reviewState: {},
      canEdit,
      readOnlyReason,
      reviewerId: session.id,
    };
  }

  const submissionIds = Array.from(new Set(submissionRows.map((row) => row.id)));

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, name")
    .in(
      "id",
      Array.from(
        new Set([
          ...submissionRows.map((row) => row.author_id),
          session.id,
        ]),
      ),
    )
    .returns<ProfileNameRow[]>();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { data: reviewRows, error: reviewError } = await supabase
    .from("reviews")
    .select("id, submission_id, reviewer_id, scores, comment, total, completed_at, created_at, updated_at")
    .in("submission_id", submissionIds)
    .returns<ReviewRow[]>();

  if (reviewError) {
    throw new Error(reviewError.message);
  }

  const profileMap = new Map((profiles ?? []).map((row) => [row.id, row.name] as const));
  const reviewMap = buildReviewRowsMap(reviewRows ?? []);
  const latestReviewMap = buildLatestReviewRowsMap(reviewRows ?? []);
  const grouped = new Map<string, { entry: SubmissionEntry; rows: SubmissionRow[] }>();
  submissionRows.forEach((submission) => {
    const authorName = profileMap.get(submission.author_id) ?? submission.author_id;
    const groupKey = submission.author_id;
    const current = grouped.get(groupKey);

    if (current) {
      current.entry.cards.push(rowToSubmissionCard(submission));
      current.entry.submissionIds = [...(current.entry.submissionIds ?? []), submission.id];
      current.rows.push(submission);
      return;
    }

    grouped.set(groupKey, {
      rows: [submission],
      entry: {
        groupKey,
        submitter: authorName,
        submissionIds: [submission.id],
        reviewerId: canEdit ? session.id : undefined,
        reviewerName: canEdit ? (profileMap.get(session.id) ?? session.username) : undefined,
        readOnly: !canEdit,
        cards: [rowToSubmissionCard(submission)],
        updatedAt: formatSubmissionUpdatedAt(submission.updated_at),
      },
    });
  });

  const entries = Array.from(grouped.values())
    .map((group) => ({
      ...group.entry,
      cards: [...group.entry.cards],
      updatedAt: formatEntryUpdatedAt(group.rows),
    }))
    .sort((left, right) => left.submitter.localeCompare(right.submitter, "ko"));

  const reviewState = Object.fromEntries(
    entries.map((entry) => {
      const cards = Object.fromEntries(
        entry.cards.map((card) => {
          const row = canEdit ? reviewMap.get(`${card.id}::${session.id}`) : latestReviewMap.get(card.id);
          return [card.id, reviewRowToCardState(row)];
        }),
      );
      const done =
        entry.cards.length > 0 &&
        entry.cards.every((card) => {
          const row = canEdit ? reviewMap.get(`${card.id}::${session.id}`) : latestReviewMap.get(card.id);
          return Boolean(row?.completed_at);
        });

      return [
        getSubmissionEntryKey(entry),
        {
          cards,
          done,
        } satisfies ReviewStateEntry,
      ];
    }),
  ) satisfies ReviewStateStore;

  return {
    entries,
    reviewState,
    canEdit,
    readOnlyReason,
    reviewerId: session.id,
  };
}

export async function saveReviewEntry(entry: SubmissionEntry, state: ReviewStateEntry) {
  const session = await getPortalSession();
  if (!session) {
    return { ok: false as const, message: "로그인이 필요합니다." };
  }

  if (!session.canReview) {
    return { ok: false as const, message: "현재 권한은 review 저장이 불가능합니다." };
  }

  const reviewerId = session.id;

  const supabase = await getPortalSupabaseClient();
  const payload = entry.cards.map((card) => {
    const cardState = state.cards[card.id] ?? createEmptyReviewCardState();
    return {
      submission_id: card.id,
      reviewer_id: reviewerId,
      scores: {
        checked: cardState.checked,
        bonusScore: cardState.bonusScore,
        bonusComment: cardState.bonusComment,
      },
      comment: cardState.bonusComment || null,
      total: getReviewCardScore(card, cardState),
      completed_at: state.done ? new Date().toISOString() : null,
    };
  });

  const { error } = await supabase.from("reviews").upsert(payload, { onConflict: "submission_id,reviewer_id" });

  if (error) {
    return { ok: false as const, message: error.message };
  }

  return {
    ok: true as const,
    message: state.done ? "평가를 팀장 페이지로 전송했습니다." : "평가가 저장되었습니다.",
  };
}

export interface SubmissionEntry {
  groupKey?: string;
  submitter: string;
  submissionIds?: string[];
  reviewerId?: string;
  reviewerName?: string;
  readOnly?: boolean;
  cards: SubmissionCard[];
  updatedAt: string;
}

export interface ScoreCriterion {
  id: string;
  label: string;
  score: number;
}

export interface ScoreSection {
  title: string;
  criteria: ScoreCriterion[];
  isBonus?: boolean;
}

export interface ReviewCardState {
  checked: string[];
  bonusScore: number;
  bonusComment: string;
}

export interface ReviewStateEntry {
  cards: Record<string, ReviewCardState>;
  done: boolean;
}

export type ReviewStateStore = Record<string, ReviewStateEntry>;

export const additionalBonusOptions = [1, 2, 3, 4, 5] as const;

export function getSubmissionEntryKey(entry: SubmissionEntry) {
  return entry.groupKey ?? entry.submitter;
}

export const reportTemplates: Record<ReportType, ScoreSection[]> = {
  일반리포트: [
    {
      title: "기사 주제와의 정합성",
      criteria: [
        { id: "general-topic-1", label: "영상이 기사 핵심 내용과 직관적으로 매칭되는가", score: 3 },
        { id: "general-topic-2", label: "전개 흐름에 맞는 컷 구성과 연결이 자연스러운가", score: 3 },
      ],
    },
    {
      title: "기술적 완성도 및 기본기",
      criteria: [
        { id: "general-tech-1", label: "수평·수직·사이즈·헤드룸 등이 안정적인가", score: 2 },
        { id: "general-tech-2", label: "화이트밸런스·노출·초점이 정확하고 현장 오디오가 명료한가", score: 3 },
      ],
    },
    {
      title: "기본 영상 확보 및 현장 커버리지",
      criteria: [
        { id: "general-coverage-1", label: "기사 구성에 필요한 사이즈별 영상이 충분한가", score: 3 },
        { id: "general-coverage-2", label: "인서트 및 상황 설명 화면을 적절히 확보했는가", score: 3 },
      ],
    },
    {
      title: "현장 활용 및 대응력",
      criteria: [
        { id: "general-response-1", label: "제한된 환경 속에서 최적의 앵글과 배경을 선택했는가", score: 3 },
      ],
    },
    {
      title: "(가점) 플랫폼 확장성 / 대응",
      isBonus: true,
      criteria: [
        { id: "general-bonus-1", label: "모바일 라이브 또는 콘텐츠 제작에 선제 대응했는가", score: 1 },
        { id: "general-bonus-2", label: "현장 돌발 상황에 유연하게 대응했는가", score: 1 },
      ],
    },
  ],
  기획리포트: [
    {
      title: "메시지 전달력 및 스토리텔링",
      criteria: [
        { id: "plan-message-1", label: "영상이 기획 의도와 핵심 메시지를 명확히 전달하는가", score: 3 },
        { id: "plan-message-2", label: "화면 호흡과 흐름이 자연스럽고 몰입도가 있는가", score: 3 },
      ],
    },
    {
      title: "영상 표현력",
      criteria: [
        { id: "plan-visual-1", label: "심도·프레이밍·카메라 무빙이 의도적으로 설계되었는가", score: 3 },
        { id: "plan-visual-2", label: "인물 심리와 현장 상황을 고려한 프레임 구성인가", score: 3 },
      ],
    },
    {
      title: "빛, 공간 해석 능력",
      criteria: [
        { id: "plan-space-1", label: "자연광·조명을 전략적으로 활용했는가", score: 3 },
        { id: "plan-space-2", label: "공간을 입체적으로 활용해 주제를 강화했는가", score: 3 },
      ],
    },
    {
      title: "오디오·현장감 완성도",
      criteria: [
        { id: "plan-audio-1", label: "인터뷰이 오디오가 선명하고 현장 음향을 의도적으로 컨트롤했는가", score: 2 },
      ],
    },
    {
      title: "(가점) 차별성 / 창의성 / 확장성",
      isBonus: true,
      criteria: [
        { id: "plan-bonus-1", label: "동일 사안 대비 독창적인 영상 접근이 있는가", score: 1 },
        { id: "plan-bonus-2", label: "확장성 있는 추가 콘텐츠 제작을 고려해 구성했는가", score: 1 },
      ],
    },
  ],
  인터뷰리포트: [
    {
      title: "구도 안정성",
      criteria: [{ id: "interview-frame-1", label: "주제와 어울리는 사이즈와 배경을 선정했는가", score: 5 }],
    },
    {
      title: "인물 부각 및 배경 선택",
      criteria: [{ id: "interview-frame-2", label: "조명·자연광을 활용해 인물을 효과적으로 부각했는가", score: 5 }],
    },
    {
      title: "오디오 완성도",
      criteria: [{ id: "interview-audio-1", label: "목소리를 노이즈 없이 명료하게 수음했는가", score: 5 }],
    },
    {
      title: "내용 보완 화면 확보",
      criteria: [{ id: "interview-insert-1", label: "제스처·반응 컷 등 인서트를 충분히 확보했는가", score: 5 }],
    },
    {
      title: "(가점) 진행 완성도",
      isBonus: true,
      criteria: [
        { id: "interview-bonus-1", label: "로드 인터뷰·돌발 상황에서도 구도 유지와 피벗팅이 매끄러운가", score: 1 },
        { id: "interview-bonus-2", label: "다인 인터뷰 시 균형이 유지되는가", score: 1 },
      ],
    },
  ],
  LIVE: [
    {
      title: "시각적 현장성",
      criteria: [
        { id: "live-visual-1", label: "보도 주제를 가장 잘 설명하는 배경을 선택했는가", score: 4 },
        { id: "live-visual-2", label: "주·야간 환경에서 주요 피사체가 선명하게 표현되는가", score: 3 },
      ],
    },
    {
      title: "기술 안정성",
      criteria: [
        { id: "live-tech-1", label: "화면 수평과 구도가 안정적인가", score: 3 },
        { id: "live-tech-2", label: "송출 신호와 화질이 안정적인가", score: 3 },
      ],
    },
    {
      title: "오디오 명료성",
      criteria: [{ id: "live-audio-1", label: "기자 또는 출연자의 음성과 현장음이 혼선 없이 전달되는가", score: 3 }],
    },
    {
      title: "카메라 운용 능력",
      criteria: [{ id: "live-camera-1", label: "현장의 지형·지물을 효율적으로 활용했는가", score: 4 }],
    },
    {
      title: "(가점) 디지털 확장성 / 대응",
      isBonus: true,
      criteria: [
        { id: "live-bonus-1", label: "워크앤토크·이동 동선에 맞는 매끄러운 무빙인가", score: 1 },
        { id: "live-bonus-2", label: "현장 돌발 상황에 즉각 대응했는가", score: 1 },
      ],
    },
  ],
};

const LEGACY_REPORT_TYPE_ALIASES: Record<string, ReportType> = {
  "?쇰컲由ы룷??": "일반리포트",
  "湲고쉷由ы룷??": "기획리포트",
  "?명꽣酉곕━?ы듃": "인터뷰리포트",
};

export function createEmptyReviewCardState(): ReviewCardState {
  return {
    checked: [],
    bonusScore: 0,
    bonusComment: "",
  };
}

export function getCardSections(card: SubmissionCard) {
  return reportTemplates[card.type] ?? [];
}

export function getCardCriterionIds(card: SubmissionCard) {
  return getCardSections(card).flatMap((section) => section.criteria.map((criterion) => criterion.id));
}

export function getBonusCriterionIds(card: SubmissionCard) {
  return getCardSections(card)
    .filter((section) => section.isBonus)
    .flatMap((section) => section.criteria.map((criterion) => criterion.id));
}

export function createEmptyReviewStateEntry(entry?: SubmissionEntry): ReviewStateEntry {
  return {
    cards: Object.fromEntries((entry?.cards ?? []).map((card) => [card.id, createEmptyReviewCardState()])),
    done: false,
  };
}

function normalizeCheckedIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeCardState(value: unknown) {
  const base = createEmptyReviewCardState();
  if (!value || typeof value !== "object") return base;

  const record = value as Partial<ReviewCardState>;
  return {
    checked: normalizeCheckedIds(record.checked),
    bonusScore: Number(record.bonusScore) || 0,
    bonusComment: typeof record.bonusComment === "string" ? record.bonusComment : "",
  } satisfies ReviewCardState;
}

export function normalizeReviewStateEntry(raw: unknown, entry?: SubmissionEntry): ReviewStateEntry {
  const base = createEmptyReviewStateEntry(entry);
  if (!raw || typeof raw !== "object") return base;

  const record = raw as {
    checked?: unknown;
    cards?: Record<string, unknown>;
    bonus?: unknown;
    bonusComment?: unknown;
    done?: unknown;
  };

  const legacyChecked = normalizeCheckedIds(record.checked);
  const legacyBonus = Number(record.bonus) || 0;
  const legacyBonusComment = typeof record.bonusComment === "string" ? record.bonusComment : "";

  const normalizedCards = Object.fromEntries(
    (entry?.cards ?? []).map((card, index) => {
      const directCardState = normalizeCardState(record.cards?.[card.id]);
      const criterionIds = new Set(getCardCriterionIds(card));
      const mergedChecked = Array.from(
        new Set([
          ...directCardState.checked.filter((item) => criterionIds.has(item)),
          ...legacyChecked.filter((item) => criterionIds.has(item)),
        ]),
      );

      const migratedBonusScore = directCardState.bonusScore || (index === 0 ? legacyBonus : 0);
      const migratedBonusComment = directCardState.bonusComment || (index === 0 ? legacyBonusComment : "");

      return [
        card.id,
        {
          checked: mergedChecked,
          bonusScore: migratedBonusScore,
          bonusComment: migratedBonusComment,
        } satisfies ReviewCardState,
      ];
    }),
  );

  return {
    cards: normalizedCards,
    done: Boolean(record.done),
  };
}

export function normalizeReviewStateStore(raw: unknown, submissions: SubmissionEntry[]): ReviewStateStore {
  if (!raw || typeof raw !== "object") {
    return Object.fromEntries(
      submissions.map((entry) => [getSubmissionEntryKey(entry), createEmptyReviewStateEntry(entry)]),
    );
  }

  const record = raw as Record<string, unknown>;
  return Object.fromEntries(
    submissions.map((entry) => {
      const key = getSubmissionEntryKey(entry);
      return [key, normalizeReviewStateEntry(record[key] ?? record[entry.submitter], entry)];
    }),
  );
}

export function getSelectedCriteriaScore(card: SubmissionCard, state?: ReviewCardState) {
  if (!state) return 0;

  const checked = new Set(state.checked);
  return getCardSections(card)
    .flatMap((section) => section.criteria)
    .filter((criterion) => checked.has(criterion.id))
    .reduce((sum, criterion) => sum + criterion.score, 0);
}

export function hasSelectedBonusCriteria(card: SubmissionCard, state?: ReviewCardState) {
  if (!state) return false;
  const bonusIds = new Set(getBonusCriterionIds(card));
  return state.checked.some((id) => bonusIds.has(id));
}

export function cardNeedsBonusComment(card: SubmissionCard, state?: ReviewCardState) {
  if (!state) return false;
  return hasSelectedBonusCriteria(card, state) || state.bonusScore > 0;
}

export function getReviewCardScore(card: SubmissionCard, state?: ReviewCardState) {
  if (!state) return 0;
  return getSelectedCriteriaScore(card, state) + state.bonusScore;
}

export function getReviewEntryScore(entry: SubmissionEntry, state?: ReviewStateEntry) {
  if (!state) return 0;
  return entry.cards.reduce((sum, card) => sum + getReviewCardScore(card, state.cards[card.id]), 0);
}

interface SubmissionRow {
  id: string;
  author_id: string;
  type: string;
  title: string;
  link: string;
  date: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const SUBMISSION_COLUMNS = "id, author_id, type, title, link, date, notes, status, created_at, updated_at";

export const submissionReportTypes = Object.keys(reportTemplates) as ReportType[];

export function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createEmptySubmissionCard(): SubmissionCard {
  return {
    id: crypto.randomUUID(),
    type: submissionReportTypes[0],
    title: "",
    link: "",
    date: toDateInputValue(new Date()),
    comment: "",
  };
}

function normalizeReportType(value: string): ReportType {
  if (Object.prototype.hasOwnProperty.call(reportTemplates, value)) {
    return value as ReportType;
  }

  return LEGACY_REPORT_TYPE_ALIASES[value] ?? submissionReportTypes[0];
}

function rowToSubmissionCard(row: SubmissionRow): SubmissionCard {
  return {
    id: row.id,
    type: normalizeReportType(row.type),
    title: row.title ?? "",
    link: row.link ?? "",
    date: row.date ?? "",
    comment: row.notes ?? "",
  };
}

function formatSubmissionUpdatedAt(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR");
}

export async function getMySubmissionEntry() {
  const session = await getPortalSession();
  if (!session) return null;

  const supabase = await getPortalSupabaseClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("author_id", session.id)
    .order("updated_at", { ascending: false })
    .returns<SubmissionRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return null;
  }

  const latestUpdatedAt = data.reduce((latest, row) => {
    if (!latest || row.updated_at > latest) return row.updated_at;
    return latest;
  }, "");

  const entry: SubmissionEntry = {
    submitter: session.username,
    cards: data.map(rowToSubmissionCard),
    updatedAt: formatSubmissionUpdatedAt(latestUpdatedAt),
  };

  return entry;
}

export async function saveMySubmissionEntry(cards: SubmissionCard[]) {
  const session = await getPortalSession();
  if (!session) {
    return { ok: false as const, message: "로그인이 필요합니다." };
  }

  const sanitizedCards = cards
    .map((card) => ({
      id: card.id || crypto.randomUUID(),
      type: normalizeReportType(card.type),
      title: card.title.trim(),
      link: card.link.trim(),
      date: card.date.trim(),
      comment: card.comment.trim(),
    }))
    .filter((card) => card.title || card.link || card.comment || card.date);

  const supabase = await getPortalSupabaseClient();
  const { data: existingRows, error: existingError } = await supabase
    .from("submissions")
    .select("id")
    .eq("author_id", session.id)
    .returns<Array<{ id: string }>>();

  if (existingError) {
    return { ok: false as const, message: existingError.message };
  }

  const currentIds = sanitizedCards.map((card) => card.id);
  const staleIds = (existingRows ?? []).map((row) => row.id).filter((id) => !currentIds.includes(id));

  if (sanitizedCards.length > 0) {
    const payload = sanitizedCards.map((card) => ({
      id: card.id,
      author_id: session.id,
      type: card.type,
      title: card.title,
      link: card.link,
      date: card.date || null,
      notes: card.comment || null,
      status: "submitted",
    }));

    const { error: upsertError } = await supabase.from("submissions").upsert(payload, { onConflict: "id" });

    if (upsertError) {
      return { ok: false as const, message: upsertError.message };
    }
  }

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase.from("submissions").delete().eq("author_id", session.id).in("id", staleIds);

    if (deleteError) {
      return { ok: false as const, message: deleteError.message };
    }
  }

  const entry = await getMySubmissionEntry();
  return {
    ok: true as const,
    message: "제출 내용을 저장했습니다.",
    entry,
  };
}
