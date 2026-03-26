export type UserRole = "member" | "reviewer" | "team_lead" | "admin" | "desk";
export type UserStatus = "ACTIVE" | "DISABLED";

export interface UserAccount {
  id: string;
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
  username: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface ResetMailLog {
  username: string;
  email: string;
  tempPassword: string;
  createdAt: string;
}

const USERS_KEY = "j-special-force-users-v1";
const SESSION_KEY = "j-special-force-session-v1";
const RESET_LOG_KEY = "j-special-force-reset-mails-v1";

const seedAdmin: UserAccount = {
  id: "admin-seed",
  username: "관리자",
  password: "admin1234",
  email: "admin@example.com",
  phone: "010-0000-0000",
  role: "admin",
  status: "ACTIVE",
  mustChangePassword: false,
  createdAt: "2026-03-25T00:00:00+09:00",
  updatedAt: "2026-03-25T00:00:00+09:00",
};

const seedUsers: UserAccount[] = [
  seedAdmin,
  {
    id: "seed-jung-cheolwon",
    username: "정철원",
    password: "1",
    email: "jung@example.com",
    phone: "010-1111-1111",
    role: "admin",
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: "2026-03-25T00:00:00+09:00",
    updatedAt: "2026-03-25T00:00:00+09:00",
  },
  {
    id: "seed-kim-youngmuk",
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

export function ensureUsers() {
  const users = readJson<UserAccount[]>(USERS_KEY, []);
  const seedMapByUsername = new Map(seedUsers.map((seed) => [seed.username, seed]));
  const next: UserAccount[] = [];
  const usedIds = new Set<string>();
  const handledSeedUsernames = new Set<string>();

  users.forEach((user) => {
    const seed = seedMapByUsername.get(user.username);
    if (seed && !handledSeedUsernames.has(seed.username)) {
      next.push({
        ...user,
        id: seed.id,
        username: seed.username,
        email: user.email || seed.email,
        phone: user.phone || seed.phone,
      });
      usedIds.add(seed.id);
      handledSeedUsernames.add(seed.username);
      return;
    }

    if (!usedIds.has(user.id)) {
      next.push(user);
      usedIds.add(user.id);
    }
  });

  seedUsers.forEach((seed) => {
    if (usedIds.has(seed.id) || handledSeedUsernames.has(seed.username)) return;
    next.push(seed);
    usedIds.add(seed.id);
    handledSeedUsernames.add(seed.username);
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
  return readJson<ResetMailLog[]>(RESET_LOG_KEY, []);
}

export function saveResetLogs(logs: ResetMailLog[]) {
  writeJson(RESET_LOG_KEY, logs);
}

export function isKoreanName(value: string) {
  return /^[가-힣\s]+$/.test(value.trim());
}

export function registerUser(input: { username: string; password: string; email: string; phone: string }) {
  const users = ensureUsers();
  const username = input.username.trim();
  if (!username || !isKoreanName(username)) {
    return { ok: false as const, message: "아이디는 한글 이름으로만 등록해야 합니다." };
  }
  if (users.some((user) => user.username === username)) {
    return { ok: false as const, message: "이미 등록된 이름입니다." };
  }
  const user: UserAccount = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username,
    password: input.password,
    email: input.email.trim(),
    phone: input.phone.trim(),
    role: "member",
    status: "ACTIVE",
    mustChangePassword: false,
    createdAt: now(),
    updatedAt: now(),
  };
  const next = [...users, user];
  saveUsers(next);
  return { ok: true as const, message: "회원가입이 완료되었습니다. 바로 로그인할 수 있습니다." };
}

export function loginUser(input: { username: string; password: string }) {
  const users = ensureUsers();
  const found = users.find((user) => user.username === input.username.trim());
  if (!found) return { ok: false as const, message: "등록된 아이디가 없습니다." };
  if (found.status !== "ACTIVE") return { ok: false as const, message: "정지된 계정입니다." };
  if (found.password !== input.password) return { ok: false as const, message: "비밀번호가 일치하지 않습니다." };
  const session: SessionUser = {
    id: found.id,
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

export function issueTemporaryPassword(username: string) {
  const users = ensureUsers();
  const target = users.find((user) => user.username === username.trim());
  if (!target) return { ok: false as const, message: "등록된 아이디가 없습니다." };
  const tempPassword = Math.random().toString(36).slice(-8);
  const nextUsers = users.map((user) =>
    user.id === target.id
      ? { ...user, password: tempPassword, mustChangePassword: true, updatedAt: now() }
      : user,
  );
  saveUsers(nextUsers);
  const nextLogs = [{ username: target.username, email: target.email, tempPassword, createdAt: now() }, ...getResetLogs()];
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
        username: target.username,
        role: target.role,
        mustChangePassword: target.mustChangePassword,
      });
    }
  }
  return nextUsers;
}

export function hasDeskAccess(role: UserRole | null | undefined) {
  return role === "desk" || role === "admin";
}
