// 총괄팀장 · DESK 계정과 보안 열쇠 변화 알림의 순수 로직. 서버 API(매일 cron)가 쓴다.
//
// 매일 한 번 아래 상태를 찍어 지난번과 비교하고, 바뀐 점이 있으면 총괄팀장(이전 · 현재 모두)에게 메일을 보낸다.
//   - 총괄팀장 · DESK · admin 계정: 등급, 승인 여부, 로그인 이메일(Supabase Auth 기준)
//   - 2단계 인증(인증 앱) 등록 · 해제(개발자가 초기화한 경우 포함)
//   - 보안 열쇠: 새 기기 등록(승인 대기), 승인, 해제, 복구 코드 발급, 기록 삭제
// 비밀번호가 털려 누군가 등급을 바꾸거나 몰래 기기를 올려도 다음 날 아침에는 알 수 있게 하는 장치다.
// 막는 장치는 아니다(하루 늦게 안다).

export const SECURITY_WATCH_SNAPSHOT_STATE_KEY = "security_watch_snapshot_v1";
export const SECURITY_WATCH_ROLES = ["team_lead", "desk", "admin"] as const;

export interface SecurityWatchAccount {
  name: string;
  role: string;
  approved: boolean;
  email: string;
  /** 확인 끝난 2단계 인증(인증 앱) 수. 예전 기록에는 없을 수 있다. */
  mfaFactors?: number;
}

export interface SecurityWatchHolder {
  kind: string;
  label: string;
  status: string;
  profileId: string | null;
}

export interface SecurityWatchSnapshot {
  version: 1;
  accounts: Record<string, SecurityWatchAccount>;
  holders: Record<string, SecurityWatchHolder>;
  takenAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  team_lead: "총괄팀장",
  desk: "DESK",
  admin: "관리자",
};

function roleLabel(role: string | undefined) {
  if (!role) return "일반 등급";
  return ROLE_LABELS[role] ?? "일반 등급";
}

export function parseSecurityWatchSnapshot(value: unknown): SecurityWatchSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SecurityWatchSnapshot>;
  if (record.version !== 1 || !record.accounts || typeof record.accounts !== "object") return null;
  if (!record.holders || typeof record.holders !== "object") return null;
  return record as SecurityWatchSnapshot;
}

function holderOwner(snapshot: SecurityWatchSnapshot, holder: SecurityWatchHolder) {
  if (holder.kind === "recovery") return "복구 코드";
  const owner = holder.profileId ? snapshot.accounts[holder.profileId]?.name : undefined;
  return `${holder.label || "이름 없는 기기"}${owner ? ` (${owner})` : ""}`;
}

/** 지난번과 지금을 비교해 사람이 읽을 문장 목록을 만든다. 바뀐 게 없으면 빈 배열. */
export function diffSecurityWatchSnapshot(previous: SecurityWatchSnapshot, next: SecurityWatchSnapshot) {
  const events: string[] = [];
  const accountIds = [...new Set([...Object.keys(previous.accounts), ...Object.keys(next.accounts)])].sort();
  for (const id of accountIds) {
    const before = previous.accounts[id];
    const after = next.accounts[id];
    if (!before && after) {
      events.push(`등급 부여: ${after.name} → ${roleLabel(after.role)}`);
      continue;
    }
    if (before && !after) {
      events.push(`등급 해제: ${before.name} (${roleLabel(before.role)} → 일반 등급 또는 삭제)`);
      continue;
    }
    if (!before || !after) continue;
    if (before.role !== after.role) {
      events.push(`등급 변경: ${after.name} (${roleLabel(before.role)} → ${roleLabel(after.role)})`);
    }
    if (before.approved !== after.approved) {
      events.push(`승인 상태 변경: ${after.name} (${after.approved ? "사용 가능" : "사용 중지"})`);
    }
    if (before.email !== after.email) {
      events.push(`로그인 이메일 변경: ${after.name} (${maskAddress(before.email)} → ${maskAddress(after.email)})`);
    }
    if (typeof before.mfaFactors === "number" && typeof after.mfaFactors === "number" && before.mfaFactors !== after.mfaFactors) {
      events.push(
        after.mfaFactors > before.mfaFactors
          ? `2단계 인증 등록: ${after.name}`
          : after.mfaFactors === 0
            ? `2단계 인증 해제(초기화): ${after.name}`
            : `2단계 인증 일부 해제: ${after.name}`,
      );
    }
  }

  const holderIds = [...new Set([...Object.keys(previous.holders), ...Object.keys(next.holders)])].sort();
  for (const id of holderIds) {
    const before = previous.holders[id];
    const after = next.holders[id];
    if (!before && after) {
      if (after.kind === "recovery") events.push("보안 열쇠: 새 복구 코드 발급");
      else if (after.status === "pending") events.push(`보안 열쇠: 새 기기 승인 대기 - ${holderOwner(next, after)}`);
      else if (after.status === "active") events.push(`보안 열쇠: 새 기기 등록 · 승인 - ${holderOwner(next, after)}`);
      else events.push(`보안 열쇠: 기기 등록 후 해제 - ${holderOwner(next, after)}`);
      continue;
    }
    if (before && !after) {
      if (before.status !== "revoked") events.push(`보안 열쇠: 기록 삭제 - ${holderOwner(previous, before)}`);
      continue;
    }
    if (!before || !after || before.status === after.status) continue;
    const label = holderOwner(next, after);
    if (after.status === "active") events.push(`보안 열쇠: 기기 승인 - ${label}`);
    else if (after.status === "revoked") events.push(`보안 열쇠: 해제 - ${label}`);
    else events.push(`보안 열쇠: 상태 변경(${after.status}) - ${label}`);
  }

  return events;
}

function maskAddress(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email ? "***" : "(없음)";
  return `${local.slice(0, 2)}***@${domain}`;
}

/** 받을 사람: 지난번 또는 지금 총괄팀장이었던 승인된 계정의 로그인 이메일. 강등된 팀장도 알 수 있게 한다. */
export function listSecurityWatchRecipients(previous: SecurityWatchSnapshot | null, next: SecurityWatchSnapshot) {
  const emails = new Set<string>();
  for (const snapshot of [previous, next]) {
    if (!snapshot) continue;
    for (const account of Object.values(snapshot.accounts)) {
      if (account.role === "team_lead" && account.approved && account.email.includes("@")) {
        emails.add(account.email.trim().toLowerCase());
      }
    }
  }
  return [...emails].sort();
}

function formatKoreanDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function buildSecurityWatchMail(input: { events: string[]; previousAt: string; checkedAt: string; siteUrl: string }) {
  const subject = "[JTBC 카메라 허브] 총괄팀장 · DESK 계정 또는 보안 열쇠에 변화가 있었습니다";
  const lines = [
    "총괄팀장님께,",
    "",
    `지난 확인(${formatKoreanDateTime(input.previousAt)}) 이후 아래 변화가 있었습니다.`,
    "",
    ...input.events.map((event) => `  - ${event}`),
    "",
    "직접 하신 일이거나 미리 들은 일이면 괜찮습니다.",
    "모르는 변화라면: 보안 열쇠 화면에서 모르는 기기를 해제하고, 비밀번호를 바꾼 뒤 개발자와 회사에 알리세요.",
    "",
    `확인 시각: ${formatKoreanDateTime(input.checkedAt)}`,
    input.siteUrl,
  ];
  return { subject, text: lines.join("\n") };
}

export interface SecurityWatchDeps {
  takeSnapshot(): Promise<SecurityWatchSnapshot>;
  loadPrevious(): Promise<unknown>;
  savePrevious(snapshot: SecurityWatchSnapshot): Promise<void>;
  sendMail(input: { to: string[]; subject: string; text: string }): Promise<{ sent: boolean }>;
  now(): string;
  siteUrl: string;
}

export type SecurityWatchResult =
  | { status: "baseline" }
  | { status: "unchanged" }
  | { status: "no_recipients"; events: number }
  | { status: "mail_not_sent"; events: number }
  | { status: "alerted"; events: number; recipients: number };

/**
 * 처음에는 기준만 저장한다(메일 없음). 바뀌었으면 메일을 보내고, 실제로 나간 뒤에만 기준을 바꾼다.
 * 받을 총괄팀장이 없으면 기준을 바꾸지 않아 다음 점검 때 다시 시도한다.
 */
export async function runSecurityWatchCheck(deps: SecurityWatchDeps): Promise<SecurityWatchResult> {
  const next = await deps.takeSnapshot();
  const previous = parseSecurityWatchSnapshot(await deps.loadPrevious());
  if (!previous) {
    await deps.savePrevious(next);
    return { status: "baseline" };
  }
  const events = diffSecurityWatchSnapshot(previous, next);
  if (events.length === 0) {
    return { status: "unchanged" };
  }
  const recipients = listSecurityWatchRecipients(previous, next);
  if (recipients.length === 0) return { status: "no_recipients", events: events.length };
  const mail = buildSecurityWatchMail({ events, previousAt: previous.takenAt, checkedAt: deps.now(), siteUrl: deps.siteUrl });
  const result = await deps.sendMail({ to: recipients, ...mail });
  if (!result.sent) return { status: "mail_not_sent", events: events.length };
  await deps.savePrevious(next);
  return { status: "alerted", events: events.length, recipients: recipients.length };
}
