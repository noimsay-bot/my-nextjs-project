// 총괄팀장 보안 관련 코드 변경 알림의 순수 로직. next.config.ts(빌드)와 서버 API가 함께 쓴다.
// 다른 모듈을 import하지 않는다(next.config.ts에서 바로 불러오기 위해).
//
// 동작
// - 빌드할 때 감시 대상 파일마다 SHA-256을 계산해 "지문 목록(manifest)"을 만들어 서버 코드에 넣는다.
// - 매일 서버 점검이 이 지문 목록을 DB에 저장된 지난 목록과 비교한다. 다르면 총괄팀장에게 메일을 보낸다.
// - Git을 거치지 않고 개발자 PC에서 바로 배포해도 빌드 결과가 바뀌므로 알림이 간다(커밋 정보 없음으로 표시).
//
// 한계: 개발자는 이 알림 코드 자체도 바꿀 수 있다. 그래서 이 파일과 알림 API도 감시 대상에 넣었다.
// 바꾸면 그 배포 때 마지막 알림이 가고, Git 기록에 남는다. 완전한 차단이 아니라 억지력이다.

export const TEAM_LEAD_SECURITY_MANIFEST_STATE_KEY = "security_code_manifest_v1";

/** 빌드할 때 파일을 찾을 폴더(프로젝트 루트 기준). 하위 폴더까지 본다. */
export const TEAM_LEAD_SECURITY_WATCH_ROOTS = [
  "lib/team-lead",
  "lib/supabase",
  "components/team-lead",
  "app/(portal)/team-lead/security",
  "app/api/internal/team-lead",
  "supabase",
] as const;

/** 루트에 있는 감시 대상 파일 */
export const TEAM_LEAD_SECURITY_WATCH_FILES = ["next.config.ts", "vercel.json", "package.json"] as const;

/**
 * 감시 대상인지 판단한다. 총괄팀장 데이터를 풀거나 다루는 코드, 모든 DB 요청이 지나가는 코드,
 * 보안 SQL, 배포 설정, 이 알림 자체만 본다. 일반 화면 수정으로 메일이 너무 자주 가지 않게 한다.
 */
export function isTeamLeadSecurityWatchedPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if ((TEAM_LEAD_SECURITY_WATCH_FILES as readonly string[]).includes(normalized)) return true;
  if (/^lib\/team-lead\/(e2e-[^/]+|security-[^/]+|storage|scoreboard)\.ts$/.test(normalized)) return true;
  if (/^lib\/supabase\/[^/]+\.ts$/.test(normalized)) return true;
  if (normalized === "components/team-lead/security-keys-page.tsx") return true;
  if (/^app\/\(portal\)\/team-lead\/security\/.+\.tsx?$/.test(normalized)) return true;
  if (/^app\/api\/internal\/team-lead\/security-change-alert\/.+\.ts$/.test(normalized)) return true;
  if (/^supabase\/[^/]*team_lead_e2e[^/]*\.sql$/.test(normalized)) return true;
  return false;
}

export interface TeamLeadSecurityManifest {
  version: 1;
  /** 경로 → SHA-256(hex). 줄바꿈은 LF로 맞춘 뒤 계산한다. */
  files: Record<string, string>;
  commit: {
    sha: string | null;
    message: string | null;
    author: string | null;
    ref: string | null;
  };
  builtAt: string;
}

export interface TeamLeadSecurityManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function parseTeamLeadSecurityManifest(value: unknown): TeamLeadSecurityManifest | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (record.version !== 1 || !record.files || typeof record.files !== "object" || Array.isArray(record.files)) {
    return null;
  }
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(record.files as Record<string, unknown>)) {
    if (typeof hash === "string") files[path] = hash;
  }
  const commit = (record.commit && typeof record.commit === "object" ? record.commit : {}) as Record<string, unknown>;
  const text = (input: unknown) => (typeof input === "string" && input.trim() ? input : null);
  return {
    version: 1,
    files,
    commit: { sha: text(commit.sha), message: text(commit.message), author: text(commit.author), ref: text(commit.ref) },
    builtAt: typeof record.builtAt === "string" ? record.builtAt : "",
  };
}

export function diffTeamLeadSecurityManifest(
  previous: TeamLeadSecurityManifest,
  next: TeamLeadSecurityManifest,
): TeamLeadSecurityManifestDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [path, hash] of Object.entries(next.files)) {
    if (!(path in previous.files)) added.push(path);
    else if (previous.files[path] !== hash) changed.push(path);
  }
  for (const path of Object.keys(previous.files)) {
    if (!(path in next.files)) removed.push(path);
  }
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

export function hasTeamLeadSecurityChanges(diff: TeamLeadSecurityManifestDiff) {
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}

function formatKoreanDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function describeCommit(manifest: TeamLeadSecurityManifest) {
  if (!manifest.commit.sha) {
    return [
      "※ 이번 배포에는 GitHub 커밋 기록이 없습니다. 개발자 PC에서 바로 배포했을 수 있습니다.",
      "   이런 배포는 기록이 남지 않으니 반드시 개발자에게 무엇을 바꿨는지 확인하세요.",
    ];
  }
  const firstLine = (manifest.commit.message ?? "").split(/\r?\n/)[0].trim().slice(0, 200);
  return [
    `개발자가 남긴 설명: ${firstLine || "(없음)"}`,
    `커밋: ${manifest.commit.sha.slice(0, 7)}${manifest.commit.author ? ` (작성: ${manifest.commit.author})` : ""}${
      manifest.commit.ref ? ` · 브랜치: ${manifest.commit.ref}` : ""
    }`,
  ];
}

const MAX_LISTED_FILES = 30;

function listFiles(title: string, paths: string[]) {
  if (paths.length === 0) return [];
  const shown = paths.slice(0, MAX_LISTED_FILES).map((path) => `  - ${path}`);
  if (paths.length > MAX_LISTED_FILES) shown.push(`  - 외 ${paths.length - MAX_LISTED_FILES}개`);
  return [`${title} ${paths.length}개`, ...shown];
}

export function buildTeamLeadSecurityChangeMail(input: {
  manifest: TeamLeadSecurityManifest;
  diff: TeamLeadSecurityManifestDiff;
  checkedAt: string;
  siteUrl: string;
}) {
  const subject = "[JTBC 카메라 허브] 총괄팀장 보안 관련 코드가 바뀌었습니다";
  const lines = [
    "총괄팀장님께,",
    "",
    "총괄팀장 데이터 보안(보안 열쇠·암호화)과 관련된 프로그램 코드가 바뀌어 사이트에 반영되었습니다.",
    "",
    `확인 시각: ${formatKoreanDateTime(input.checkedAt)}`,
    `배포 시각: ${input.manifest.builtAt ? formatKoreanDateTime(input.manifest.builtAt) : "알 수 없음"}`,
    ...describeCommit(input.manifest),
    "",
    ...listFiles("바뀐 파일", input.diff.changed),
    ...listFiles("새로 생긴 파일", input.diff.added),
    ...listFiles("없어진 파일", input.diff.removed),
    "",
    "이 메일은 자동으로 보내집니다. 보안 기능을 고치거나 개선할 때도 옵니다.",
    "미리 설명을 듣지 못한 변경이라면 개발자에게 무엇을 왜 바꿨는지 물어보세요.",
    "설명이 납득되지 않으면 보안 열쇠 화면을 쓰지 말고 회사에 알리세요.",
    "",
    input.siteUrl,
  ];
  return { subject, text: lines.join("\n") };
}

export function buildTeamLeadSecurityAlertStartMail(input: { manifest: TeamLeadSecurityManifest; siteUrl: string }) {
  const subject = "[JTBC 카메라 허브] 총괄팀장 보안 코드 변경 알림이 시작되었습니다";
  const lines = [
    "총괄팀장님께,",
    "",
    "앞으로 총괄팀장 데이터 보안(보안 열쇠·암호화)과 관련된 프로그램 코드가 바뀌어 사이트에 반영되면",
    "이 메일 주소로 알림을 보내 드립니다. 하루 한 번(오전) 확인합니다.",
    "",
    `지금 감시 중인 파일: ${Object.keys(input.manifest.files).length}개`,
    ...describeCommit(input.manifest),
    "",
    "따로 하실 일은 없습니다. 이 메일을 받으셨다면 알림이 잘 동작하는 것입니다.",
    "",
    input.siteUrl,
  ];
  return { subject, text: lines.join("\n") };
}

export interface TeamLeadSecurityAlertDeps {
  manifest: TeamLeadSecurityManifest | null;
  loadPrevious(): Promise<unknown>;
  savePrevious(manifest: TeamLeadSecurityManifest): Promise<void>;
  listRecipients(): Promise<string[]>;
  sendMail(input: { to: string[]; subject: string; text: string }): Promise<{ sent: boolean }>;
  now(): string;
  siteUrl: string;
}

export type TeamLeadSecurityAlertResult =
  | { status: "no_manifest" }
  | { status: "no_recipients" }
  | { status: "unchanged" }
  | { status: "mail_not_sent"; kind: "start" | "change" }
  | { status: "started"; recipients: number }
  | { status: "alerted"; recipients: number; diff: TeamLeadSecurityManifestDiff };

/**
 * 매일 점검 한 번. 처음이면 "알림 시작" 메일을 보내고 기준을 저장한다.
 * 바뀌었으면 변경 알림을 보내고, 메일이 실제로 나간 뒤에만 기준을 새 목록으로 바꾼다
 * (메일이 실패하면 다음 점검 때 다시 보낸다).
 */
export async function runTeamLeadSecurityAlertCheck(deps: TeamLeadSecurityAlertDeps): Promise<TeamLeadSecurityAlertResult> {
  const manifest = deps.manifest;
  if (!manifest || Object.keys(manifest.files).length === 0) return { status: "no_manifest" };

  const previous = parseTeamLeadSecurityManifest(await deps.loadPrevious());
  if (previous) {
    const diff = diffTeamLeadSecurityManifest(previous, manifest);
    if (!hasTeamLeadSecurityChanges(diff)) return { status: "unchanged" };
    const recipients = await deps.listRecipients();
    if (recipients.length === 0) return { status: "no_recipients" };
    const mail = buildTeamLeadSecurityChangeMail({ manifest, diff, checkedAt: deps.now(), siteUrl: deps.siteUrl });
    const result = await deps.sendMail({ to: recipients, ...mail });
    if (!result.sent) return { status: "mail_not_sent", kind: "change" };
    await deps.savePrevious(manifest);
    return { status: "alerted", recipients: recipients.length, diff };
  }

  const recipients = await deps.listRecipients();
  if (recipients.length === 0) return { status: "no_recipients" };
  const result = await deps.sendMail({
    to: recipients,
    ...buildTeamLeadSecurityAlertStartMail({ manifest, siteUrl: deps.siteUrl }),
  });
  if (!result.sent) return { status: "mail_not_sent", kind: "start" };
  await deps.savePrevious(manifest);
  return { status: "started", recipients: recipients.length };
}
