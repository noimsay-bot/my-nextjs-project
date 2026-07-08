export interface TemporaryPasswordMailInput {
  email: string;
  loginId: string;
  username: string;
  temporaryPassword: string;
}

export type TemporaryPasswordMailSkipReason = "log_only";

export type TemporaryPasswordMailResult =
  | { sent: true }
  | { sent: false; reason: TemporaryPasswordMailSkipReason };

export interface TemporaryPasswordMailEnv {
  mailLogOnly: boolean;
  siteUrl: string;
  from: string | undefined;
}

export interface TemporaryPasswordMailDeps {
  sendMail: (message: { from: string; to: string; subject: string; text: string }) => Promise<void>;
  warn: (message: string) => void;
}

export interface ResolvedSmtpSecure {
  secure: boolean;
  inferredFromPort: boolean;
}

/**
 * SMTP_SECURE는 문자열 "true"/"false"만 신뢰한다.
 * 그 외 값(미설정 포함)은 포트 기준으로 추론한다(465=implicit TLS, 그 외 false).
 */
export function resolveSmtpSecure(rawSecure: string | undefined, port: number): ResolvedSmtpSecure {
  if (rawSecure === "true") {
    return { secure: true, inferredFromPort: false };
  }
  if (rawSecure === "false") {
    return { secure: false, inferredFromPort: false };
  }
  return { secure: port === 465, inferredFromPort: true };
}

/** 로그용 이메일 마스킹: ab***@domain */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "***";
  }
  return `${email.slice(0, Math.min(2, atIndex))}***@${email.slice(atIndex + 1)}`;
}

export function buildTemporaryPasswordMailText(input: TemporaryPasswordMailInput, siteUrl: string) {
  return [
    `${input.username}님, 안녕하세요.`,
    "",
    "요청하신 임시 비밀번호를 안내드립니다.",
    `아이디: ${input.loginId}`,
    `임시 비밀번호: ${input.temporaryPassword}`,
    "",
    `${siteUrl}/login 에서 로그인하신 뒤 새 비밀번호로 반드시 변경해 주세요.`,
  ].join("\n");
}

/**
 * 임시 비밀번호 메일 발송 코어 로직.
 * - MAIL_LOG_ONLY 모드에서는 실제 발송 없이 sent:false를 반환한다.
 *   호출부는 sent:false일 때 성공으로 처리하거나 비밀번호를 변경해서는 안 된다.
 * - SMTP 오류는 그대로 throw 한다.
 */
export async function deliverTemporaryPasswordMail(
  input: TemporaryPasswordMailInput,
  env: TemporaryPasswordMailEnv,
  deps: TemporaryPasswordMailDeps,
): Promise<TemporaryPasswordMailResult> {
  if (env.mailLogOnly) {
    deps.warn(
      `[mail] MAIL_LOG_ONLY 모드라 임시 비밀번호 메일을 실제로 보내지 않습니다. to=${input.email} loginId=${input.loginId} temporaryPassword=${input.temporaryPassword}`,
    );
    return { sent: false, reason: "log_only" };
  }

  if (!env.from) {
    throw new Error("임시 비밀번호 메일 발송을 위해 EMAIL_FROM 환경변수를 설정해 주세요.");
  }

  await deps.sendMail({
    from: env.from,
    to: input.email,
    subject: "[JTBC NEWS CAMERA HUB] 임시 비밀번호 안내",
    text: buildTemporaryPasswordMailText(input, env.siteUrl),
  });

  return { sent: true };
}
