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
  loginId: string;
  username: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface ResetMailLog {
  loginId: string;
  username: string;
  email: string;
  tempPassword: string;
  createdAt: string;
}

const USERS_KEY = "j-special-force-users-v1";
const SESSION_KEY = "j-special-force-session-v1";
const RESET_LOG_KEY = "j-special-force-reset-mails-v1";
const FORCED_ADMIN_LOGIN_IDS = new Set(["noimsay"]);
const REMOVED_USER_EMAILS = new Set(["jung@example.com"]);

const seedUsers: UserAccount[] = [
  {
    id: "seed-kim-youngmuk",
    loginId: "kimyoungmuk",
    username: "김영묵",
    password: "1",
    email: "kimym@example.com",
    phone: "010-2222-2222",
    role: "member",
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: "2026-03-25T00:00:00+09:00",
    updatedAt: "2026-03-25T00:00:00+09:00",
  },
  {
    id: "seed-lee-gyeong",
    loginId: "leegyeong",
    username: "이경",
    password: "1",
    email: "leeg@example.com",
    phone: "010-3333-3333",
    role: "member",
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: "2026-03-25T00:00:00+09:00",
    updatedAt: "2026-03-25T00:00:00+09:00",
  },
  {
    id: "seed-kim-jingwang",
    loginId: "kimjingwang",
    username: "김진광",
    password: "1",
    email: "kimjg@example.com",
    phone: "010-4444-4444",
    role: "member",
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: "2026-03-25T00:00:00+09:00",
    updatedAt: "2026-03-25T00:00:00+09:00",
  },
];

function now() {
  return new Date().toISOString();
}

function normalizeLoginId(value: string) {
  return value.trim().toLowerCase();
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

function normalizeResetLog(log: Partial<ResetMailLog>): ResetMailLog | null {
  const username = typeof log.username === "string" ? log.username.trim() : "";
  const loginId = typeof log.loginId === "string" && log.loginId.trim()
    ? normalizeLoginId(log.loginId)
    : username;
  const email = typeof log.email === "string" ? log.email.trim() : "";
  const tempPassword = typeof log.tempPassword === "string" ? log.tempPassword : "";
  const createdAt = typeof log.createdAt === "string" ? log.createdAt : now();

  if (!username || !email || !tempPassword) return null;

  return {
    loginId,
    username,
    email,
    tempPassword,
    createdAt,
  };
}

function normalizeRole(value: unknown, fallback: UserRole = "member"): UserRole {
  return value === "member" || value === "reviewer" || value === "team_lead" || value === "admin" || value === "desk"
    ? value
    : fallback;
}

function getForcedRole(loginId: string, role: UserRole) {
  return FORCED_ADMIN_LOGIN_IDS.has(loginId) ? "admin" : role;
}

function normalizeStatus(value: unknown, fallback: UserStatus = "ACTIVE"): UserStatus {
  return value === "DISABLED" ? "DISABLED" : fallback;
}

type StoredUserAccount = Partial<UserAccount> & Pick<UserAccount, "id">;

function isDeprecatedDefaultAdmin(user: StoredUserAccount) {
  return user.id === "admin-seed" || (user.username?.trim() === "관리자" && user.password === "admin1234");
}

function isRemovedUser(user: StoredUserAccount) {
  return typeof user.email === "string" && REMOVED_USER_EMAILS.has(user.email.trim().toLowerCase());
}

function findSeedUser(user: StoredUserAccount) {
  return seedUsers.find((seed) =>
    seed.id === user.id ||
    (typeof user.loginId === "string" && normalizeLoginId(user.loginId) === seed.loginId) ||
    (typeof user.username === "string" && user.username.trim() === seed.username),
  );
}

function normalizeStoredUser(user: StoredUserAccount, seed?: UserAccount): UserAccount | null {
  const username = typeof user.username === "string" && user.username.trim()
    ? user.username.trim()
    : seed?.username ?? "";
  const loginId = typeof user.loginId === "string" && user.loginId.trim()
    ? normalizeLoginId(user.loginId)
    : seed?.loginId ?? username.trim();
  const password = typeof user.password === "string" && user.password
    ? user.password
    : seed?.password ?? "";

  if (!username || !loginId || !password) return null;

  return {
    id: seed?.id ?? user.id,
    loginId,
    username,
    password,
    email: typeof user.email === "string" ? user.email.trim() : seed?.email ?? "",
    phone: typeof user.phone === "string" ? user.phone.trim() : seed?.phone ?? "",
    role: getForcedRole(loginId, normalizeRole(user.role, seed?.role ?? "member")),
    status: normalizeStatus(user.status, seed?.status ?? "ACTIVE"),
    mustChangePassword: typeof user.mustChangePassword === "boolean" ? user.mustChangePassword : seed?.mustChangePassword ?? false,
    createdAt: typeof user.createdAt === "string" ? user.createdAt : seed?.createdAt ?? now(),
    updatedAt: typeof user.updatedAt === "string" ? user.updatedAt : seed?.updatedAt ?? now(),
  };
}

export function ensureUsers() {
  const users = readJson<StoredUserAccount[]>(USERS_KEY, []).filter((user) => !isDeprecatedDefaultAdmin(user) && !isRemovedUser(user));
  const next: UserAccount[] = [];
  const usedIds = new Set<string>();
  const handledSeedIds = new Set<string>();

  users.forEach((user) => {
    const seed = findSeedUser(user);
    if (seed && !handledSeedIds.has(seed.id)) {
      const normalized = normalizeStoredUser(user, seed);
      if (!normalized) return;
      next.push(normalized);
      usedIds.add(seed.id);
      handledSeedIds.add(seed.id);
      return;
    }

    if (!usedIds.has(user.id)) {
      const normalized = normalizeStoredUser(user);
      if (!normalized) return;
      next.push(normalized);
      usedIds.add(normalized.id);
    }
  });

  seedUsers.forEach((seed) => {
    if (usedIds.has(seed.id) || handledSeedIds.has(seed.id)) return;
    next.push(seed);
    usedIds.add(seed.id);
    handledSeedIds.add(seed.id);
  });

  const changed =
    users.length !== next.length ||
    JSON.stringify(users) !== JSON.stringify(next);
  if (!changed) return next;
  writeJson(USERS_KEY, next);
  return next;
}

export function getUsers() {
  return ensureUsers();
}

export function saveUsers(users: UserAccount[]) {
  writeJson(USERS_KEY, users);
}

export function getSession() {
  const session = readJson<SessionUser | null>(SESSION_KEY, null);
  if (!session) return null;
  const users = ensureUsers();
  const matched = users.find((user) => user.id === session.id);
  if (!matched || matched.status !== "ACTIVE") {
    setSession(null);
    return null;
  }
  const synced: SessionUser = {
    id: matched.id,
    loginId: matched.loginId,
    username: matched.username,
    role: matched.role,
    mustChangePassword: matched.mustChangePassword,
  };
  if (JSON.stringify(session) !== JSON.stringify(synced)) {
    setSession(synced);
  }
  return synced;
}

export function setSession(user: SessionUser | null) {
  if (typeof window === "undefined") return;
  if (!user) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  writeJson(SESSION_KEY, user);
}

export function getResetLogs() {
  return readJson<Partial<ResetMailLog>[]>(RESET_LOG_KEY, [])
    .map((log) => normalizeResetLog(log))
    .filter((log): log is ResetMailLog => Boolean(log));
}

export function saveResetLogs(logs: ResetMailLog[]) {
  writeJson(RESET_LOG_KEY, logs);
}

export function isKoreanName(value: string) {
  return /^[가-힣\s]+$/.test(value.trim());
}

export function isEnglishLoginId(value: string) {
  return /^[a-z][a-z0-9._-]{3,19}$/.test(normalizeLoginId(value));
}

export function registerUser(input: { loginId: string; username: string; password: string; email: string }) {
  const users = ensureUsers();
  const loginId = normalizeLoginId(input.loginId);
  const username = input.username.trim();
  if (!loginId || !isEnglishLoginId(loginId)) {
    return { ok: false as const, message: "아이디는 영문 소문자, 숫자, 점, 하이픈, 밑줄로 4~20자 입력해 주세요." };
  }
  if (!username || !isKoreanName(username)) {
    return { ok: false as const, message: "이름은 한글 이름으로 입력해 주세요." };
  }
  if (users.some((user) => user.loginId === loginId)) {
    return { ok: false as const, message: "이미 사용 중인 아이디입니다." };
  }
  const user: UserAccount = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    loginId,
    username,
    password: input.password,
    email: input.email.trim(),
    phone: "",
    role: getForcedRole(loginId, "member"),
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: now(),
    updatedAt: now(),
  };
  const next = [...users, user];
  saveUsers(next);
  return { ok: true as const, message: "회원가입이 완료되었습니다. 바로 로그인할 수 있습니다." };
}

export function loginUser(input: { loginId: string; password: string }) {
  const users = ensureUsers();
  const found = users.find((user) => user.loginId === normalizeLoginId(input.loginId));
  if (!found) return { ok: false as const, message: "등록된 아이디가 없습니다." };
  if (found.status !== "ACTIVE") return { ok: false as const, message: "정지된 계정입니다." };
  if (found.password !== input.password) return { ok: false as const, message: "비밀번호가 일치하지 않습니다." };
  const session: SessionUser = {
    id: found.id,
    loginId: found.loginId,
    username: found.username,
    role: found.role,
    mustChangePassword: found.mustChangePassword,
  };
  setSession(session);
  return { ok: true as const, session };
}

export function logoutUser() {
  setSession(null);
}

export function issueTemporaryPassword(loginId: string) {
  const users = ensureUsers();
  const target = users.find((user) => user.loginId === normalizeLoginId(loginId));
  if (!target) return { ok: false as const, message: "등록된 아이디가 없습니다." };
  const tempPassword = Math.random().toString(36).slice(-8);
  const nextUsers = users.map((user) =>
    user.id === target.id
      ? { ...user, password: tempPassword, mustChangePassword: true, updatedAt: now() }
      : user,
  );
  saveUsers(nextUsers);
  const nextLogs = [{ loginId: target.loginId, username: target.username, email: target.email, tempPassword, createdAt: now() }, ...getResetLogs()];
  saveResetLogs(nextLogs);
  return {
    ok: true as const,
    message: `${target.email}로 임시비밀번호 발송 처리를 했습니다. 로그인 후 비밀번호를 바꿔야 합니다.`,
  };
}

export function changePassword(userId: string, password: string) {
  const users = ensureUsers();
  const target = users.find((user) => user.id === userId);
  if (!target) return { ok: false as const, message: "사용자를 찾을 수 없습니다." };
  const nextUsers = users.map((user) =>
    user.id === userId ? { ...user, password, mustChangePassword: false, updatedAt: now() } : user,
  );
  saveUsers(nextUsers);
  setSession({
    id: target.id,
    loginId: target.loginId,
    username: target.username,
    role: target.role,
    mustChangePassword: false,
  });
  return { ok: true as const, message: "비밀번호를 변경했습니다." };
}

export function updateUserStatus(userId: string, status: UserStatus) {
  const users = ensureUsers();
  const nextUsers = users.map((user) =>
    user.id === userId ? { ...user, status, updatedAt: now() } : user,
  );
  saveUsers(nextUsers);
  const session = getSession();
  if (session?.id === userId) {
    const target = nextUsers.find((user) => user.id === userId);
    if (!target || target.status !== "ACTIVE") {
      setSession(null);
    } else {
      setSession({
        id: target.id,
        loginId: target.loginId,
        username: target.username,
        role: target.role,
        mustChangePassword: target.mustChangePassword,
      });
    }
  }
  return nextUsers;
}

export function updateUserRole(userId: string, role: UserRole) {
  const users = ensureUsers();
  const nextUsers = users.map((user) =>
    user.id === userId ? { ...user, role, updatedAt: now() } : user,
  );
  saveUsers(nextUsers);
  const session = getSession();
  if (session?.id === userId) {
    const target = nextUsers.find((user) => user.id === userId);
    if (target) {
      setSession({
        id: target.id,
        loginId: target.loginId,
        username: target.username,
        role: target.role,
        mustChangePassword: target.mustChangePassword,
      });
    }
  }
  return nextUsers;
}

export function deleteUser(userId: string) {
  const users = ensureUsers();
  const nextUsers = users.filter((user) => user.id !== userId);
  if (nextUsers.length === users.length) {
    return { ok: false as const, users };
  }
  saveUsers(nextUsers);
  const session = getSession();
  if (session?.id === userId) {
    setSession(null);
  }
  return { ok: true as const, users: nextUsers };
}

export function hasDeskAccess(role: UserRole | null | undefined) {
  return role === "desk" || role === "admin";
}
