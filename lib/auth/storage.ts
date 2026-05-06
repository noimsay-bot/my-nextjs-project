import type { User } from "@supabase/supabase-js";
import {
  createClient as createSupabaseBrowserClient,
  SUPABASE_ENV_ERROR_MESSAGE,
} from "@/lib/supabase/client";

export type UserRole = "member" | "outlet" | "reviewer" | "team_lead" | "admin" | "desk" | "observer";
export type UserStatus = "ACTIVE" | "DISABLED";

export interface UserAccount {
  id: string;
  loginId: string;
  username: string;
  password: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  loginId: string;
  username: string;
  role: UserRole;
  actualRole: UserRole;
  experienceRole: UserRole | null;
  approved: boolean;
  mustChangePassword: boolean;
  canReview: boolean;
  actualCanReview: boolean;
}

export interface ResetMailLog {
  loginId: string;
  username: string;
  email: string;
  tempPassword: string;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  email: string;
  login_id: string | null;
  name: string;
  role: UserRole;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

type AuthListener = (session: SessionUser | null) => void;
type BrowserSupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;
type BrowserRealtimeChannel = ReturnType<BrowserSupabaseClient["channel"]>;
type AuthCheckStatus = "idle" | "ok" | "missing_session" | "timeout" | "error";
type ProfileFetchStatus = "ok" | "empty" | "timeout" | "error";

const AUTH_CACHE_KEY = "j-special-force-auth-cache-v4";
const USERS_CACHE_KEY = "j-special-force-users-cache-v2";
const ROLE_EXPERIENCE_CACHE_KEY = "j-special-force-role-experience-v1";
const LOGIN_EMAIL_CACHE_KEY = "j-special-force-login-email-cache-v1";
const PROFILE_COLUMNS = "id, email, login_id, name, role, approved, created_at, updated_at";
const REVIEW_ACCESS_STATE_KEY = "review_access_v1";
const AUTH_REQUEST_TIMEOUT_MS = 4_000;
const AUTH_REFRESH_STALE_MS = 60_000;
const AUTH_FAILURE_COOLDOWN_MS = 10_000;
const APPROVAL_REQUIRED_MESSAGE = "승인되지 않은 계정입니다. 관리자에게 문의해 주세요.";
const PROFILE_SYNC_FAILED_MESSAGE = "계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.";
const AUTH_TIMEOUT = Symbol("auth-timeout");

let browserClient: ReturnType<typeof createSupabaseBrowserClient> | null = null;
let cachedExperienceRole = readStoredExperienceRole();
let cachedSession = normalizeStoredSession(readJson<SessionUser | null>(AUTH_CACHE_KEY, null));
let cachedUsers = readJson<UserAccount[]>(USERS_CACHE_KEY, []).map((user) => ({
  ...user,
  role: normalizeUserRole(user.role),
}));
let authInitialized = false;
let refreshPromise: Promise<SessionUser | null> | null = null;
let initializePromise: Promise<SessionUser | null> | null = null;
const listeners = new Set<AuthListener>();
let profileChannel: BrowserRealtimeChannel | null = null;
let profileSubscriptionUserId: string | null = null;
let reviewAccessChannel: BrowserRealtimeChannel | null = null;
let cachedReviewAccessProfileIds: string[] | null = null;
let lastAuthBlockReason: "approval" | "profile_sync" | null = null;
let realtimeChannelSequence = 0;
let lastAuthCheckStatus: AuthCheckStatus = cachedSession ? "ok" : "idle";
let lastAuthFailureAt = 0;
let lastAuthRefreshAt = cachedSession ? Date.now() : 0;
let sessionSyncPromise: Promise<SessionUser | null> | null = null;
let sessionSyncPromiseUserId: string | null = null;

function authLog(stage: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  if (details) {
    console.info(`[auth] ${stage}`, details);
    return;
  }

  console.info(`[auth] ${stage}`);
}

function setLastAuthCheckStatus(status: AuthCheckStatus) {
  lastAuthCheckStatus = status;
}

function markAuthCheckHealthy() {
  lastAuthFailureAt = 0;
  lastAuthRefreshAt = Date.now();
  setLastAuthCheckStatus("ok");
}

function markAuthCheckFailure(status: Exclude<AuthCheckStatus, "idle" | "ok">) {
  lastAuthFailureAt = Date.now();
  setLastAuthCheckStatus(status);
}

function shouldShortCircuitAuthRetry() {
  if (!lastAuthFailureAt) return false;
  return Date.now() - lastAuthFailureAt < AUTH_FAILURE_COOLDOWN_MS;
}

function canUseFreshCachedSession(force: boolean) {
  return (
    !force &&
    Boolean(cachedSession) &&
    hasSupabaseSessionCookie() &&
    lastAuthCheckStatus === "ok" &&
    Date.now() - lastAuthRefreshAt < AUTH_REFRESH_STALE_MS
  );
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearJson(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function readLoginEmailCache() {
  return readJson<Record<string, string>>(LOGIN_EMAIL_CACHE_KEY, {});
}

function writeLoginEmailCache(cache: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOGIN_EMAIL_CACHE_KEY, JSON.stringify(cache));
}

function rememberLoginEmail(loginId: string, email: string) {
  if (typeof window === "undefined") return;

  const normalizedLoginId = loginId.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedLoginId || !normalizedEmail) return;

  const cache = readLoginEmailCache();
  cache[normalizedLoginId] = normalizedEmail;
  writeLoginEmailCache(cache);
}

function lookupCachedLoginEmail(loginId: string) {
  const normalizedLoginId = loginId.trim().toLowerCase();
  if (!normalizedLoginId) return null;

  const cache = readLoginEmailCache();
  return cache[normalizedLoginId] ?? null;
}

function readStoredExperienceRole() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(ROLE_EXPERIENCE_CACHE_KEY);
  if (!raw) return null;

  try {
    return normalizeExperienceRole(JSON.parse(raw));
  } catch {
    return normalizeExperienceRole(raw);
  }
}

function getSupabaseClient() {
  if (typeof window === "undefined") {
    throw new Error("Supabase browser client can only be used in the browser.");
  }

  if (!browserClient) {
    browserClient = createSupabaseBrowserClient();
  }

  return browserClient;
}

export function hasSupabaseSessionCookie() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.cookie.split(";").some((cookie) => {
    const cookieName = cookie.trim().split("=")[0] ?? "";
    return cookieName.startsWith("sb-") && cookieName.includes("-auth-token");
  });
}

function promiseWithTimeout<T>(promise: PromiseLike<T>, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  return new Promise<T | typeof AUTH_TIMEOUT>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      resolve(AUTH_TIMEOUT);
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function clearProfileSubscription() {
  if (!browserClient || !profileChannel) return;
  void browserClient.removeChannel(profileChannel);
  profileChannel = null;
  profileSubscriptionUserId = null;
}

function clearReviewAccessSubscription() {
  if (!browserClient || !reviewAccessChannel) return;
  void browserClient.removeChannel(reviewAccessChannel);
  reviewAccessChannel = null;
}

function readMustChangePassword(user: Pick<User, "user_metadata"> | null | undefined) {
  const metadata = user?.user_metadata;
  return metadata?.must_change_password === true || metadata?.mustChangePassword === true;
}

function invalidateReviewAccessCache() {
  cachedReviewAccessProfileIds = null;
}

function createRealtimeChannelTopic(base: string) {
  realtimeChannelSequence += 1;
  return `${base}:${realtimeChannelSequence}`;
}

function syncProfileSubscription(userId: string) {
  if (typeof window === "undefined") return;
  if (profileSubscriptionUserId === userId && profileChannel) return;

  clearProfileSubscription();

  try {
    const supabase = getSupabaseClient();
    profileChannel = supabase
      .channel(createRealtimeChannelTopic(`profile-watch:${userId}`))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        () => {
          void refreshSession({ force: true });
        },
      )
      .subscribe();

    profileSubscriptionUserId = userId;
  } catch (error) {
    console.warn("프로필 실시간 구독을 시작하지 못했습니다.", error);
    clearProfileSubscription();
  }
}

function syncReviewAccessSubscription() {
  if (typeof window === "undefined") return;
  if (reviewAccessChannel) return;

  try {
    const supabase = getSupabaseClient();
    reviewAccessChannel = supabase
      .channel(createRealtimeChannelTopic("review-access-watch"))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_lead_state",
          filter: `key=eq.${REVIEW_ACCESS_STATE_KEY}`,
        },
        () => {
          invalidateReviewAccessCache();
          if (!cachedSession) return;
          void refreshSession({ force: true });
        },
      )
      .subscribe();
  } catch (error) {
    console.warn("평가 권한 실시간 구독을 시작하지 못했습니다.", error);
    clearReviewAccessSubscription();
  }
}

function isSupabaseEnvError(error: unknown) {
  return error instanceof Error && error.message.includes("Missing Supabase environment variables");
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError && error.message.includes("fetch");
}

function normalizeAuthMessage(message: unknown, fallback: string) {
  if (typeof message !== "string") {
    return fallback;
  }

  const trimmed = message.trim();
  if (
    !trimmed ||
    trimmed === "{}" ||
    trimmed === "[]" ||
    trimmed === "[object Object]" ||
    trimmed === "null" ||
    trimmed === "undefined"
  ) {
    return fallback;
  }

  return trimmed;
}

function getFriendlyAuthError(error: unknown, fallback = "인증 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.") {
  if (isSupabaseEnvError(error)) {
    return getSupabaseSetupMessage();
  }

  if (isNetworkError(error)) {
    return "Supabase에 연결하지 못했습니다. 브라우저 확장프로그램, 네트워크, 또는 Supabase URL/키를 확인해 주세요.";
  }

  if (error instanceof Error) {
    return normalizeAuthMessage(error.message, fallback);
  }

  return fallback;
}

export function getSupabaseSetupMessage() {
  return "Supabase 환경변수가 없습니다. `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정하고 개발 서버를 다시 시작해 주세요.";
}

export function normalizeUserRole(value: string | null | undefined): UserRole {
  return value === "reviewer" ||
    value === "outlet" ||
    value === "team_lead" ||
    value === "admin" ||
    value === "desk" ||
    value === "observer"
    ? value
    : "member";
}

function normalizeExperienceRole(value: unknown): UserRole | null {
  if (
    value === "member" ||
    value === "outlet" ||
    value === "reviewer" ||
    value === "desk" ||
    value === "team_lead" ||
    value === "admin" ||
    value === "observer"
  ) {
    return value;
  }
  return null;
}

function hasIntrinsicReviewAccess(role: UserRole) {
  return role === "reviewer" || role === "team_lead";
}

function buildSessionWithExperience(
  base: Omit<SessionUser, "role" | "experienceRole" | "canReview" | "actualRole" | "actualCanReview"> & {
    role: UserRole;
    canReview: boolean;
    actualRole?: UserRole;
    actualCanReview?: boolean;
  },
  requestedExperienceRole = cachedExperienceRole,
): SessionUser {
  const actualRole = normalizeUserRole(base.actualRole ?? base.role);
  const actualCanReview = base.actualCanReview ?? base.canReview;
  const experienceRole =
    hasTeamLeadAccess(actualRole)
      ? normalizeExperienceRole(requestedExperienceRole)
      : null;
  const effectiveExperienceRole =
    experienceRole && experienceRole !== actualRole ? experienceRole : null;
  const effectiveRole = effectiveExperienceRole ?? actualRole;

  return {
    ...base,
    role: effectiveRole,
    actualRole,
    experienceRole: effectiveExperienceRole,
    approved: base.approved,
    mustChangePassword: base.mustChangePassword,
    canReview: effectiveExperienceRole ? hasIntrinsicReviewAccess(effectiveRole) : actualCanReview,
    actualCanReview,
  };
}

function normalizeStoredSession(session: SessionUser | null) {
  if (!session) return null;

  return buildSessionWithExperience(
    {
      ...session,
      role: session.actualRole ?? session.role,
      actualRole: session.actualRole ?? session.role,
      canReview: session.actualCanReview ?? session.canReview,
      actualCanReview: session.actualCanReview ?? session.canReview,
    },
    session.experienceRole ?? cachedExperienceRole,
  );
}

function persistExperienceRole(role: UserRole | null) {
  cachedExperienceRole = normalizeExperienceRole(role);

  if (typeof window === "undefined") return;

  if (cachedExperienceRole) {
    writeJson(ROLE_EXPERIENCE_CACHE_KEY, cachedExperienceRole);
    return;
  }

  clearJson(ROLE_EXPERIENCE_CACHE_KEY);
}

function normalizeReviewAccessState(raw: unknown) {
  if (!raw || typeof raw !== "object") return [] as string[];
  const record = raw as { profileIds?: unknown };
  if (!Array.isArray(record.profileIds)) return [] as string[];
  return Array.from(
    new Set(
      record.profileIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );
}

async function fetchGrantedReviewAccessProfileIds(options?: { force?: boolean }) {
  if (!options?.force && cachedReviewAccessProfileIds) {
    return cachedReviewAccessProfileIds;
  }

  try {
    const supabase = getSupabaseClient();
    const result = await promiseWithTimeout(
      supabase
        .from("team_lead_state")
        .select("state")
        .eq("key", REVIEW_ACCESS_STATE_KEY)
        .maybeSingle<{ state: unknown }>(),
    );

    if (result === AUTH_TIMEOUT) {
      return cachedReviewAccessProfileIds ?? [];
    }

    const { data, error } = result;

    if (error || !data) {
      return cachedReviewAccessProfileIds ?? [];
    }

    cachedReviewAccessProfileIds = normalizeReviewAccessState(data.state);
    return cachedReviewAccessProfileIds;
  } catch {
    return cachedReviewAccessProfileIds ?? [];
  }
}

function profileToSession(profile: ProfileRow, canReview: boolean, mustChangePassword: boolean): SessionUser {
  const role = normalizeUserRole(profile.role);
  return buildSessionWithExperience({
    id: profile.id,
    email: profile.email,
    loginId: profile.login_id ?? "",
    username: profile.name,
    role,
    actualRole: role,
    approved: profile.approved,
    mustChangePassword,
    canReview,
    actualCanReview: canReview,
  });
}

function profileToAccount(profile: ProfileRow): UserAccount {
  return {
    id: profile.id,
    loginId: profile.login_id ?? "",
    username: profile.name,
    password: "",
    email: profile.email,
    phone: "",
    role: normalizeUserRole(profile.role),
    status: profile.approved ? "ACTIVE" : "DISABLED",
    mustChangePassword: false,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function notifySessionChange(session: SessionUser | null) {
  listeners.forEach((listener) => listener(session));
}

function setCachedSession(session: SessionUser | null) {
  cachedSession = normalizeStoredSession(session);

  if (!cachedSession) {
    clearJson(AUTH_CACHE_KEY);
  } else {
    writeJson(AUTH_CACHE_KEY, cachedSession);
  }

  notifySessionChange(cachedSession);
}

function setCachedUsers(users: UserAccount[]) {
  cachedUsers = users;
  writeJson(USERS_CACHE_KEY, users);
}

async function forceLogoutForUnapprovedUser() {
  clearProfileSubscription();
  clearReviewAccessSubscription();
  invalidateReviewAccessCache();
  persistExperienceRole(null);
  setCachedUsers([]);
  setCachedSession(null);

  try {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Best effort: local session has already been cleared.
  }
}

function getSiteUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

async function fetchProfileResult(userId: string): Promise<{ profile: ProfileRow | null; status: ProfileFetchStatus }> {
  authLog("profile.fetch.start", { userId });
  const supabase = getSupabaseClient();
  const result = await promiseWithTimeout(
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle<ProfileRow>(),
  );
  if (result === AUTH_TIMEOUT) {
    authLog("profile.fetch.complete", { userId, status: "timeout" });
    return { profile: null, status: "timeout" };
  }
  const { data, error } = result;

  if (error) {
    authLog("profile.fetch.complete", { userId, status: "error", message: error.message });
    return { profile: null, status: "error" };
  }

  authLog("profile.fetch.complete", { userId, status: data ? "ok" : "empty" });
  return { profile: data ?? null, status: data ? "ok" : "empty" };
}

async function fetchProfile(userId: string) {
  const result = await fetchProfileResult(userId);
  return result.profile;
}

function buildProfileInsertPayload(user: User) {
  return {
    id: user.id,
    email: user.email ?? "",
    login_id: typeof user.user_metadata.login_id === "string" ? user.user_metadata.login_id : null,
    name:
      typeof user.user_metadata.name === "string" && user.user_metadata.name.trim()
        ? user.user_metadata.name.trim()
        : user.email ?? "User",
    role: "member" as const,
    approved: true,
  };
}

async function insertOwnProfile(user: User) {
  const supabase = getSupabaseClient();
  const result = await promiseWithTimeout(
    supabase.from("profiles").insert(buildProfileInsertPayload(user)).select(PROFILE_COLUMNS).single<ProfileRow>(),
  );
  if (result === AUTH_TIMEOUT) return null;
  const { data, error } = result;

  if (error) {
    return null;
  }

  return data;
}

async function repairProfileViaApi() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    const response = await window.fetch("/api/auth/repair-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function ensureProfile(user: User) {
  const existing = await fetchProfileResult(user.id);
  if (existing.profile) return existing.profile;
  if (existing.status !== "empty") {
    return null;
  }

  const inserted = await insertOwnProfile(user);
  if (inserted) return inserted;

  const afterInsert = await fetchProfileResult(user.id);
  if (afterInsert.profile) {
    return afterInsert.profile;
  }
  if (afterInsert.status !== "empty") {
    return null;
  }

  const repaired = await repairProfileViaApi();
  if (!repaired) {
    return null;
  }

  return fetchProfile(user.id);
}

function canReuseCachedSession(user: User, force: boolean) {
  return !force && cachedSession && cachedSession.id === user.id;
}

async function syncSessionFromUser(user: User, options?: { force?: boolean }) {
  const force = options?.force ?? true;
  authLog("session.sync.start", {
    userId: user.id,
    force,
  });
  if (sessionSyncPromise && sessionSyncPromiseUserId === user.id) {
    return sessionSyncPromise;
  }

  if (canReuseCachedSession(user, force)) {
    syncReviewAccessSubscription();
    syncProfileSubscription(user.id);
    authLog("session.sync.complete", {
      userId: user.id,
      status: "reused-cache",
    });
    return cachedSession;
  }

  sessionSyncPromiseUserId = user.id;
  sessionSyncPromise = (async () => {
    const profile = await ensureProfile(user);
    if (profile && !profile.approved) {
      lastAuthBlockReason = "approval";
      authLog("session.sync.complete", {
        userId: user.id,
        status: "approval_required",
      });
      await forceLogoutForUnapprovedUser();
      return null;
    }
    if (!profile) {
      if (cachedSession?.id === user.id) {
        syncReviewAccessSubscription();
        syncProfileSubscription(user.id);
        authLog("session.sync.complete", {
          userId: user.id,
          status: "kept-cached-session",
        });
        return cachedSession;
      }

      lastAuthBlockReason = "profile_sync";
      authLog("session.sync.complete", {
        userId: user.id,
        status: "profile_sync_failed",
      });
      await forceLogoutForUnapprovedUser();
      return null;
    }

    const grantedProfileIds = await fetchGrantedReviewAccessProfileIds({ force });
    const mustChangePassword = readMustChangePassword(user);
    const nextSession = profileToSession(
      profile,
      hasIntrinsicReviewAccess(profile.role) || grantedProfileIds.includes(profile.id),
      mustChangePassword,
    );
    lastAuthBlockReason = null;
    setCachedSession(nextSession);
    markAuthCheckHealthy();
    syncReviewAccessSubscription();
    syncProfileSubscription(user.id);
    authLog("session.sync.complete", {
      userId: user.id,
      status: "ok",
      approved: nextSession.approved,
      role: nextSession.role,
    });
    return nextSession;
  })().finally(() => {
    sessionSyncPromise = null;
    sessionSyncPromiseUserId = null;
  });

  return sessionSyncPromise;
}

async function buildBlockedAuthMessage(userId: string) {
  if (lastAuthBlockReason === "approval") {
    lastAuthBlockReason = null;
    return APPROVAL_REQUIRED_MESSAGE;
  }

  if (lastAuthBlockReason === "profile_sync") {
    lastAuthBlockReason = null;
    return PROFILE_SYNC_FAILED_MESSAGE;
  }

  const profile = await fetchProfile(userId);
  if (profile && !profile.approved) {
    return APPROVAL_REQUIRED_MESSAGE;
  }

  return PROFILE_SYNC_FAILED_MESSAGE;
}

function initAuthListener() {
  if (authInitialized || typeof window === "undefined") return;

  const supabase = getSupabaseClient();
  supabase.auth.onAuthStateChange((event, session) => {
    authLog("listener.event", {
      event,
      hasUser: Boolean(session?.user),
    });

    if (!session?.user) {
      if (event === "INITIAL_SESSION") {
        clearProfileSubscription();
        clearReviewAccessSubscription();
        invalidateReviewAccessCache();
        setCachedSession(null);
        setCachedUsers([]);
        return;
      }
      if (event !== "SIGNED_OUT" && cachedSession) {
        return;
      }

      clearProfileSubscription();
      clearReviewAccessSubscription();
      invalidateReviewAccessCache();
      setCachedSession(null);
      setCachedUsers([]);
      return;
    }

    if (event === "INITIAL_SESSION" && cachedSession?.id === session.user.id) {
      void syncSessionFromUser(session.user, { force: false });
      return;
    }

    void syncSessionFromUser(session.user, { force: false });
  });

  authInitialized = true;
}

async function resolveLoginEmail(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("@")) {
    return normalized;
  }

  const cachedEmail = lookupCachedLoginEmail(normalized);
  if (cachedEmail) {
    return cachedEmail;
  }

  const cachedAccount = cachedUsers.find((user) => {
    const loginId = user.loginId.trim().toLowerCase();
    const email = user.email.trim().toLowerCase();
    return loginId === normalized || email === normalized;
  });
  if (cachedAccount?.email) {
    const nextEmail = cachedAccount.email.trim().toLowerCase();
    rememberLoginEmail(normalized, nextEmail);
    return nextEmail;
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    const response = await fetch("/api/auth/resolve-login-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ loginId: normalized }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; email?: string | null; message?: string }
      | null;

    if (response.ok && payload?.ok && typeof payload.email === "string" && payload.email.trim()) {
      const nextEmail = payload.email.trim().toLowerCase();
      rememberLoginEmail(normalized, nextEmail);
      return nextEmail;
    }

    const payloadMessage = normalizeAuthMessage(payload?.message, "");
    if (payloadMessage) {
      throw new Error(payloadMessage);
    }
  } catch (error) {
    const message = getFriendlyAuthError(error, "");
    if (/timeout|abort|fetch/i.test(message)) {
      throw new Error("로그인 아이디 조회를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    throw new Error(message || "로그인 아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  return null;
}

export async function initializeAuth() {
  try {
    authLog("session.check.start", {
      source: "initializeAuth",
      hasCachedSession: Boolean(cachedSession),
      hasSessionCookie: hasSupabaseSessionCookie(),
    });
    initAuthListener();
    if (cachedSession) {
      if (!hasSupabaseSessionCookie()) {
        clearProfileSubscription();
        clearReviewAccessSubscription();
        invalidateReviewAccessCache();
        setCachedSession(null);
        setCachedUsers([]);
        markAuthCheckFailure("missing_session");
        authLog("session.check.complete", {
          source: "initializeAuth",
          status: "missing-session-cookie-cleared-cache",
        });
        return null;
      }

      markAuthCheckHealthy();
      void refreshSession({ force: false });
      authLog("session.check.complete", {
        source: "initializeAuth",
        status: "cached-session",
      });
      return cachedSession;
    }

    if (!hasSupabaseSessionCookie()) {
      markAuthCheckFailure("missing_session");
      authLog("session.check.complete", {
        source: "initializeAuth",
        status: "missing-session-cookie",
      });
      return null;
    }

    if (shouldShortCircuitAuthRetry()) {
      authLog("session.check.complete", {
        source: "initializeAuth",
        status: lastAuthCheckStatus,
        reason: "recent-failure-cooldown",
      });
      return cachedSession;
    }

    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = refreshSession({ force: true }).finally(() => {
      initializePromise = null;
    });

    const nextSession = await initializePromise;
    authLog("session.check.complete", {
      source: "initializeAuth",
      status: nextSession ? "ok" : lastAuthCheckStatus,
    });
    return nextSession;
  } catch (error) {
    console.warn("인증 초기화에 실패했습니다.", error);
    markAuthCheckFailure("error");
    if (isSupabaseEnvError(error)) {
      setCachedSession(null);
      return null;
    }
    return cachedSession;
  }
}

export async function refreshSession(options?: { force?: boolean }) {
  if (typeof window === "undefined") return null;
  const force = options?.force ?? false;
  if (refreshPromise) return refreshPromise;
  if (canUseFreshCachedSession(force)) {
    return cachedSession;
  }
  if (shouldShortCircuitAuthRetry()) {
    authLog("session.check.complete", {
      source: "refreshSession",
      status: lastAuthCheckStatus,
      reason: "recent-failure-cooldown",
    });
    return cachedSession;
  }

  refreshPromise = (async () => {
    try {
      authLog("session.check.start", {
        source: "refreshSession",
        force,
        hasCachedSession: Boolean(cachedSession),
      });
      const supabase = getSupabaseClient();
      const sessionResult = await promiseWithTimeout(supabase.auth.getSession());
      if (sessionResult === AUTH_TIMEOUT) {
        markAuthCheckFailure("timeout");
        authLog("session.check.complete", {
          source: "refreshSession",
          status: "timeout",
        });
        return cachedSession;
      }
      const {
        data: { session },
        error,
      } = sessionResult;

      const user = session?.user ?? null;
      if (error) {
        markAuthCheckFailure("error");
        authLog("session.check.complete", {
          source: "refreshSession",
          status: "error",
          message: error.message,
        });
        return cachedSession;
      }

      if (!user) {
        markAuthCheckFailure("missing_session");
        authLog("session.check.complete", {
          source: "refreshSession",
          status: "missing_session",
        });
        return cachedSession;
      }

      const syncedSession = await promiseWithTimeout(syncSessionFromUser(user, { force: options?.force ?? true }));
      if (syncedSession === AUTH_TIMEOUT) {
        markAuthCheckFailure("timeout");
        authLog("session.check.complete", {
          source: "refreshSession",
          status: "timeout",
          stage: "profile-sync",
        });
        return cachedSession;
      }
      if (syncedSession) {
        markAuthCheckHealthy();
      } else {
        markAuthCheckFailure("error");
      }
      authLog("session.check.complete", {
        source: "refreshSession",
        status: syncedSession ? "ok" : "error",
      });
      return syncedSession;
    } catch (error) {
      console.warn("세션 확인에 실패했습니다.", error);
      markAuthCheckFailure("error");
      authLog("session.check.complete", {
        source: "refreshSession",
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      if (isSupabaseEnvError(error)) {
        setCachedSession(null);
      }
      return cachedSession;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export function subscribeToAuth(callback: AuthListener) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getSession() {
  return cachedSession;
}

export function getLastAuthCheckStatus() {
  return lastAuthCheckStatus;
}

export function primeSession(session: SessionUser | null) {
  setCachedSession(session);
  if (session) {
    markAuthCheckHealthy();
    return;
  }
  markAuthCheckFailure("missing_session");
}

export function setRoleExperience(role: UserRole | null) {
  if (!cachedSession || !hasTeamLeadAccess(cachedSession.actualRole)) {
    return cachedSession;
  }

  const nextExperienceRole =
    role && role !== cachedSession.actualRole ? normalizeExperienceRole(role) : null;
  persistExperienceRole(nextExperienceRole);

  const nextSession = buildSessionWithExperience(
    {
      ...cachedSession,
      role: cachedSession.actualRole,
      actualRole: cachedSession.actualRole,
      canReview: cachedSession.actualCanReview,
      actualCanReview: cachedSession.actualCanReview,
    },
    nextExperienceRole,
  );

  setCachedSession(nextSession);
  return nextSession;
}

export function clearRoleExperience() {
  return setRoleExperience(null);
}

export async function getSessionAsync() {
  return refreshSession();
}

export async function refreshUsers() {
  try {
    const session = cachedSession ?? (await refreshSession());
    if (!session) {
      setCachedUsers([]);
      return [];
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .order("created_at", { ascending: false });

    if (!hasAdminAccess(session.role)) {
      query = query.eq("approved", true);
    }

    const { data, error } = await query;
    if (error || !data) {
      return cachedUsers;
    }

    const nextUsers = data.map(profileToAccount);
    setCachedUsers(nextUsers);
    return nextUsers;
  } catch {
    return cachedUsers;
  }
}

export function getUsers() {
  return cachedUsers;
}

export async function registerUser(input: {
  loginId: string;
  email: string;
  password: string;
  username: string;
}) {
  try {
    const supabase = getSupabaseClient();
    const loginId = input.loginId.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    if (!loginId || !email || !username || !input.password) {
      return {
        ok: false as const,
        message: "이름, 아이디, 이메일, 비밀번호를 모두 입력해 주세요.",
      };
    }

    if (!isEnglishLoginId(loginId)) {
      return {
        ok: false as const,
        message: "아이디는 영문 소문자로 시작하고 4~20자 이내여야 합니다.",
      };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        data: {
          name: username,
          login_id: loginId,
        },
      },
    });

    if (error) {
      return {
        ok: false as const,
        message: normalizeAuthMessage(error.message, "회원가입에 실패했습니다. 입력값을 다시 확인해 주세요."),
      };
    }

    if (data.user) {
      rememberLoginEmail(loginId, data.user.email ?? email);
      const nextSession = await syncSessionFromUser(data.user);
      if (!nextSession) {
        return {
          ok: false as const,
          message: await buildBlockedAuthMessage(data.user.id),
        };
      }
    }

    if (!data.session) {
      return {
        ok: true as const,
        message: "회원가입은 완료되었지만 즉시 로그인되지 않았습니다. Supabase Auth에서 이메일 확인을 꺼 두었는지 확인해 주세요.",
      };
    }

    return {
      ok: true as const,
      message: "회원가입이 완료되었습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getFriendlyAuthError(error),
    };
  }
}

export async function loginUser(input: { loginId: string; password: string }) {
  try {
    const supabase = getSupabaseClient();
    const loginEmail = await resolveLoginEmail(input.loginId);

    if (!loginEmail) {
      return {
        ok: false as const,
        message: "일치하는 아이디를 찾지 못했습니다.",
      };
    }

    const signInResult = await promiseWithTimeout(
      supabase.auth.signInWithPassword({
        email: loginEmail,
        password: input.password,
      }),
    );

    if (signInResult === AUTH_TIMEOUT) {
      return {
        ok: false as const,
        message: "Supabase 로그인 응답이 지연되고 있습니다. 네트워크, VPN, 방화벽 또는 Supabase 프로젝트 상태를 확인한 뒤 다시 시도해 주세요.",
      };
    }

    const { data, error } = signInResult;

    if (error || !data.user) {
      return {
        ok: false as const,
        message: normalizeAuthMessage(
          error?.message,
          "로그인에 실패했습니다. 아이디 또는 비밀번호를 다시 확인해 주세요.",
        ),
      };
    }

    const session = await syncSessionFromUser(data.user);
    if (!session) {
      return {
        ok: false as const,
        message: await buildBlockedAuthMessage(data.user.id),
      };
    }

    rememberLoginEmail(input.loginId, data.user.email ?? session.email);

    return {
      ok: true as const,
      session,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getFriendlyAuthError(error),
    };
  }
}

export async function logoutUser() {
  const supabase = getSupabaseClient();
  await supabase.auth.signOut();
  persistExperienceRole(null);
  setCachedSession(null);
  setCachedUsers([]);
  setLastAuthCheckStatus("missing_session");
}

export async function requestPasswordReset(email: string) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/login?mode=reset-password`,
    });

    if (error) {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    return {
      ok: true as const,
      message: "비밀번호 재설정 메일을 보냈습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getFriendlyAuthError(error),
    };
  }
}

export async function issueTemporaryPassword(email: string) {
  try {
    const response = await fetch("/api/auth/temporary-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        loginId: email,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false as const,
        message: payload?.message ?? "임시 비밀번호 발급에 실패했습니다.",
      };
    }

    return {
      ok: true as const,
      message: payload.message ?? "가입된 이메일로 임시 비밀번호를 보냈습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getFriendlyAuthError(error),
    };
  }
}

export async function updatePassword(password: string) {
  try {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.auth.updateUser({
      password,
      data: {
        ...(user?.user_metadata ?? {}),
        must_change_password: false,
      },
    });

    if (error) {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    await refreshSession();

    return {
      ok: true as const,
      message: "비밀번호가 변경되었습니다.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getFriendlyAuthError(error),
    };
  }
}

export async function changePassword(_userId: string, password: string) {
  return updatePassword(password);
}

export function getResetLogs() {
  return [] as ResetMailLog[];
}

export function saveResetLogs(_logs: ResetMailLog[]) {}

export function isKoreanName(value: string) {
  return value.trim().length > 0;
}

export function isEnglishLoginId(value: string) {
  return /^[a-z][a-z0-9._-]{3,19}$/.test(value.trim().toLowerCase());
}

export function updateUserStatus(userId: string, status: UserStatus) {
  const approved = status === "ACTIVE";
  const nextUsers = cachedUsers.map((user) =>
    user.id === userId
      ? {
          ...user,
          status,
          updatedAt: new Date().toISOString(),
        }
      : user,
  );

  setCachedUsers(nextUsers);

  if (hasAdminAccess(cachedSession?.role)) {
    const supabase = getSupabaseClient();
    void supabase.from("profiles").update({ approved }).eq("id", userId);
  }

  return nextUsers;
}

export function updateUserRole(userId: string, role: UserRole) {
  const nextUsers = cachedUsers.map((user) =>
    user.id === userId
      ? {
          ...user,
          role,
          updatedAt: new Date().toISOString(),
        }
      : user,
  );

  setCachedUsers(nextUsers);

  if (hasTeamLeadAccess(cachedSession?.role)) {
    const supabase = getSupabaseClient();
    void supabase.from("profiles").update({ role }).eq("id", userId);
  }

  return nextUsers;
}

export function deleteUser(_userId: string) {
  return {
    ok: false as const,
    users: cachedUsers,
  };
}

export function hasDeskAccess(role: UserRole | null | undefined) {
  return role === "desk" || role === "admin" || role === "team_lead";
}

export function hasAdminAccess(role: UserRole | null | undefined) {
  return role === "admin" || role === "team_lead";
}

export function hasTeamLeadAccess(role: UserRole | null | undefined) {
  return role === "team_lead";
}

export function isReadOnlyPortalRole(role: UserRole | null | undefined) {
  return role === "observer";
}

export function hasMemberPortalAccess(role: UserRole | null | undefined) {
  return (
    role === "member" ||
    role === "outlet" ||
    role === "reviewer" ||
    role === "observer" ||
    hasDeskAccess(role)
  );
}

export function isTeamLeadEvaluationExcludedRole(role: UserRole | string | null | undefined) {
  return role === "team_lead" || role === "desk" || role === "outlet" || role === "observer";
}
