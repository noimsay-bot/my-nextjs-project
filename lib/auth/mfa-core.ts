// 총괄팀장 · DESK · admin 2단계 인증(인증 앱 6자리) 판단 로직. 화면 코드와 테스트가 함께 쓴다.
//
// - 대상 등급은 새로 로그인할 때마다 인증 앱의 6자리를 한 번 확인한다. 확인한 로그인은 로그아웃 전까지 유지된다.
// - 아직 등록하지 않았으면: 유예 기간에는 등록을 권하고("나중에 하기" 가능), 유예가 끝나면 등록해야 쓸 수 있다.
// - 화면 쪽 판단은 사용 편의용이다. 실제 차단은 DB(supabase/incremental_privileged_roles_require_mfa.sql)가 한다.

export const MFA_ROLES = ["team_lead", "desk", "admin"] as const;

/** 이 시각부터 대상 등급은 2단계 인증을 등록해야 포털을 쓸 수 있다(한국 시간 2026-12-01 0시). */
export const MFA_REQUIRED_FROM = "2026-12-01T00:00:00+09:00";

export type MfaAssuranceLevel = "aal1" | "aal2" | null | undefined;

export type MfaGateDecision =
  /** 통과 */
  | "ok"
  /** 등록은 되어 있고 이번 로그인에서 6자리 확인이 필요 */
  | "challenge"
  /** 등록 필요(유예 끝남) */
  | "enroll-required"
  /** 등록 권유(유예 중, 나중에 하기 가능) */
  | "enroll-suggested";

export function isMfaRole(role: string | null | undefined) {
  return Boolean(role) && (MFA_ROLES as readonly string[]).includes(role as string);
}

export function decideMfaGate(input: {
  role: string | null | undefined;
  currentLevel: MfaAssuranceLevel;
  nextLevel: MfaAssuranceLevel;
  now: Date;
  requiredFrom?: string;
}): MfaGateDecision {
  if (!isMfaRole(input.role)) return "ok";
  if (input.currentLevel === "aal2") return "ok";
  if (input.nextLevel === "aal2") return "challenge";
  const requiredFrom = new Date(input.requiredFrom ?? MFA_REQUIRED_FROM).getTime();
  return input.now.getTime() >= requiredFrom ? "enroll-required" : "enroll-suggested";
}

/** 로그인 뒤 돌아갈 주소. 다른 사이트로 보내는 주소는 받지 않는다. */
export function sanitizeMfaNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/mfa") || value.startsWith("/login")) return "/";
  return value;
}

/** 6자리 숫자만 남긴다(공백 · 하이픈 붙여 넣기 허용). */
export function normalizeMfaCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function formatMfaRequiredDate(requiredFrom = MFA_REQUIRED_FROM) {
  const date = new Date(requiredFrom);
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
}
