import type { User } from "@supabase/supabase-js";
import {
  createClient as createSupabaseBrowserClient,
  SUPABASE_ENV_ERROR_MESSAGE,
} from "@/lib/supabase/client";

export type UserRole = "member" | "reviewer" | "team_lead" | "admin" | "desk";
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

const AUTH_CACHE_KEY = "j-special-force-auth-cache-v3";
const USERS_CACHE_KEY = "j-special-force-users-cache-v2";
const ROLE_EXPERIENCE_CACHE_KEY = "j-special-force-role-experience-v1";
const PROFILE_COLUMNS = "id, email, login_id, name, role, approved, created_at, updated_at";
const REVIEW_ACCESS_STATE_KEY = "review_access_v1";

let browserClient: ReturnType<typeof createSupabaseBrowserClient> | null = null;
let cachedExperienceRole = readStoredExperienceRole();
let cachedSession = normalizeStoredSession(readJson<SessionUser | null>(AUTH_CACHE_KEY, null));
let cachedUsers = readJson<UserAccount[]>(USERS_CACHE_KEY, []);
let authInitialized = false;
let refreshPromise: Promise<SessionUser | null> | null = null;
let initializePromise: Promise<SessionUser | null> | null = null;
const listeners = new Set<AuthListener>();
let profileChannel: BrowserRealtimeChannel | null = null;
let profileSubscriptionUserId: string | null = null;
let reviewAccessChannel: BrowserRealtimeChannel | null = null;
let sessionRefreshListenersInitialized = false;

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

function syncProfileSubscription(userId: string) {
  if (typeof window === "undefined") return;
  if (profileSubscriptionUserId === userId && profileChannel) return;

  clearProfileSubscription();

  const supabase = getSupabaseClient();
  profileChannel = supabase
    .channel(`profile-watch:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      },
      () => {
        void refreshSession();
      },
    )
    .subscribe();

  profileSubscriptionUserId = userId;
}

function syncReviewAccessSubscription() {
  if (typeof window === "undefined") return;
  if (reviewAccessChannel) return;

  const supabase = getSupabaseClient();
  reviewAccessChannel = supabase
    .channel("review-access-watch")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "team_lead_state",
        filter: `key=eq.${REVIEW_ACCESS_STATE_KEY}`,
      },
      () => {
        if (!cachedSession) return;
        void refreshSession();
      },
    )
    .subscribe();
}

function initSessionRefreshListeners() {
  if (sessionRefreshListenersInitialized || typeof window === "undefined") return;

  const refreshIfSignedIn = () => {
    if (!cachedSession) return;
    void refreshSession();
  };

  window.addEventListener("focus", refreshIfSignedIn);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshIfSignedIn();
    }
  });

  sessionRefreshListenersInitialized = true;
}

function isSupabaseEnvError(error: unknown) {
  return error instanceof Error && error.message.includes("Missing Supabase environment variables");
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError && error.message.includes("fetch");
}

function getFriendlyAuthError(error: unknown) {
  if (isSupabaseEnvError(error)) {
    return getSupabaseSetupMessage();
  }

  if (isNetworkError(error)) {
    return "Supabase에 연결하지 못했습니다. 브라우저 확장프로그램, 네트워크, 또는 Supabase URL/키를 확인해 주세요.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return SUPABASE_ENV_ERROR_MESSAGE;
}

export function getSupabaseSetupMessage() {
  return "Supabase 환경변수가 없습니다. `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정하고 개발 서버를 다시 시작해 주세요.";
}

function normalizeRole(value: string | null | undefined): UserRole {
  return value === "reviewer" ||
    value === "team_lead" ||
    value === "admin" ||
    value === "desk"
    ? value
    : "member";
}

function normalizeExperienceRole(value: unknown): UserRole | null {
  if (
    value === "member" ||
    value === "reviewer" ||
    value === "desk" ||
    value === "team_lead" ||
    value === "admin"
  ) {
    return value;
  }
  return null;
}

function hasIntrinsicReviewAccess(role: UserRole) {
  return role === "reviewer" || role === "team_lead" || role === "admin";
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
  const actualRole = base.actualRole ?? base.role;
  const actualCanReview = base.actualCanReview ?? base.canReview;
  const experienceRole =
    actualRole === "admin"
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

async function fetchGrantedReviewAccessProfileIds() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("team_lead_state")
      .select("state")
      .eq("key", REVIEW_ACCESS_STATE_KEY)
      .maybeSingle<{ state: unknown }>();

    if (error || !data) {
      return [] as string[];
    }

    return normalizeReviewAccessState(data.state);
  } catch {
    return [] as string[];
  }
}

function profileToSession(profile: ProfileRow, canReview: boolean): SessionUser {
  return buildSessionWithExperience({
    id: profile.id,
    email: profile.email,
    loginId: profile.login_id ?? "",
    username: profile.name,
    role: profile.role,
    actualRole: profile.role,
    approved: profile.approved,
    mustChangePassword: false,
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
    role: profile.role,
    status: profile.approved ? "ACTIVE" : "DISABLED",
    mustChangePassword: false,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function fallbackSessionFromUser(user: User): SessionUser {
  const role = normalizeRole(
    typeof user.user_metadata.role === "string" ? user.user_metadata.role : "member",
  );
  return buildSessionWithExperience({
    id: user.id,
    email: user.email ?? "",
    loginId: typeof user.user_metadata.login_id === "string" ? user.user_metadata.login_id : "",
    username:
      typeof user.user_metadata.name === "string" && user.user_metadata.name.trim()
        ? user.user_metadata.name.trim()
        : user.email ?? "User",
    role,
    actualRole: role,
    approved: true,
    mustChangePassword: false,
    canReview: hasIntrinsicReviewAccess(role),
    actualCanReview: hasIntrinsicReviewAccess(role),
  });
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

async function fetchProfile(userId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    return null;
  }

  return data;
}

async function ensureProfile(user: User) {
  const existing = await fetchProfile(user.id);
  if (existing) return existing;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? "",
        login_id: typeof user.user_metadata.login_id === "string" ? user.user_metadata.login_id : null,
        name:
          typeof user.user_metadata.name === "string" && user.user_metadata.name.trim()
            ? user.user_metadata.name.trim()
            : user.email ?? "User",
      },
      {
        onConflict: "id",
        ignoreDuplicates: false,
      },
    )
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (error) {
    return null;
  }

  return data;
}

async function syncSessionFromUser(user: User) {
  const profile = await ensureProfile(user);
  if (profile && !profile.approved) {
    await forceLogoutForUnapprovedUser();
    return null;
  }

  const grantedProfileIds = await fetchGrantedReviewAccessProfileIds();
  const nextSession = profile
    ? profileToSession(
        profile,
        hasIntrinsicReviewAccess(profile.role) || grantedProfileIds.includes(profile.id),
      )
    : fallbackSessionFromUser(user);
  setCachedSession(nextSession);
  syncReviewAccessSubscription();
  syncProfileSubscription(user.id);
  return nextSession;
}

function initAuthListener() {
  if (authInitialized || typeof window === "undefined") return;

  const supabase = getSupabaseClient();
  initSessionRefreshListeners();
  syncReviewAccessSubscription();
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session?.user) {
      if (event === "INITIAL_SESSION" && cachedSession) {
        return;
      }

      clearProfileSubscription();
      clearReviewAccessSubscription();
      setCachedSession(null);
      setCachedUsers([]);
      return;
    }

    void syncSessionFromUser(session.user);
  });

  authInitialized = true;
}

async function resolveLoginEmail(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("@")) {
    return normalized;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("find_email_by_login_id", {
    input_login_id: normalized,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data) && typeof data[0] === "string") {
    return data[0];
  }

  return null;
}

export async function initializeAuth() {
  try {
    initAuthListener();
    if (cachedSession) {
      if (!refreshPromise && !initializePromise) {
        initializePromise = refreshSession().finally(() => {
          initializePromise = null;
        });
      }
      return cachedSession;
    }

    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = refreshSession().finally(() => {
      initializePromise = null;
    });

    return await initializePromise;
  } catch (error) {
    if (isSupabaseEnvError(error)) {
      setCachedSession(null);
      return null;
    }

    throw error;
  }
}

export async function refreshSession() {
  if (typeof window === "undefined") return null;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const supabase = getSupabaseClient();
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      const user = session?.user ?? null;
      if (error || !user) {
        setCachedSession(null);
        return null;
      }

      return syncSessionFromUser(user);
    } catch (error) {
      if (isSupabaseEnvError(error)) {
        setCachedSession(null);
        return null;
      }

      throw error;
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

export function setRoleExperience(role: UserRole | null) {
  if (!cachedSession || cachedSession.actualRole !== "admin") {
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
        message: error.message,
      };
    }

    if (data.user) {
      const nextSession = await syncSessionFromUser(data.user);
      if (!nextSession) {
        return {
          ok: false as const,
          message: "승인되지 않은 계정입니다. 관리자에게 문의해 주세요.",
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: input.password,
    });

    if (error || !data.user) {
      return {
        ok: false as const,
        message: error?.message ?? "로그인에 실패했습니다.",
      };
    }

    const session = await syncSessionFromUser(data.user);
    if (!session) {
      return {
        ok: false as const,
        message: "승인되지 않은 계정입니다. 관리자에게 문의해 주세요.",
      };
    }

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
  return requestPasswordReset(email);
}

export async function updatePassword(password: string) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.updateUser({
      password,
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

  if (hasAdminAccess(cachedSession?.role)) {
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
