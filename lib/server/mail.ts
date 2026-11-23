import "server-only";

import nodemailer from "nodemailer";
import {
  deliverTemporaryPasswordMail,
  maskEmail,
  resolveSmtpSecure,
  type TemporaryPasswordMailInput,
  type TemporaryPasswordMailResult,
} from "@/lib/server/mail-core";

export type { TemporaryPasswordMailResult } from "@/lib/server/mail-core";

function isMailLogOnly() {
  return process.env.MAIL_LOG_ONLY === "true";
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function getMailTransportConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null;

  if (!host || !port || Number.isNaN(port)) {
    throw new Error(
      "임시 비밀번호 메일 발송을 위해 SMTP_HOST, SMTP_PORT, EMAIL_FROM 환경변수를 설정해 주세요.",
    );
  }

  const { secure, inferredFromPort } = resolveSmtpSecure(process.env.SMTP_SECURE, port);
  if (inferredFromPort) {
    console.warn(
      `[mail] SMTP_SECURE 값이 "true"/"false"가 아니어서 포트(${port}) 기준으로 secure=${secure}를 사용합니다.`,
    );
  }

  return {
    host,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  };
}

function getRecipientAddress(recipient: string | { address: string }) {
  return typeof recipient === "string" ? recipient : recipient.address;
}

export function hasTemporaryPasswordMailEnv() {
  if (isMailLogOnly()) {
    return true;
  }

  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.EMAIL_FROM,
  );
}

/**
 * 안내 메일(일반 텍스트)을 보낸다. MAIL_LOG_ONLY면 보내지 않고 sent:false를 돌려준다.
 * 받는 사람 주소는 로그에 가려서 남긴다.
 */
export async function sendPortalNoticeMail(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<{ sent: boolean }> {
  const recipients = input.to.filter(Boolean);
  if (recipients.length === 0) {
    return { sent: false };
  }
  if (isMailLogOnly()) {
    console.log(`[mail] MAIL_LOG_ONLY: 안내 메일을 보내지 않았습니다. to=${recipients.map(maskEmail).join(", ")}`);
    return { sent: false };
  }
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("안내 메일 발송을 위해 EMAIL_FROM 환경변수를 설정해 주세요.");
  }

  const transporter = nodemailer.createTransport(getMailTransportConfig());
  const info = await transporter.sendMail({ from, to: recipients, subject: input.subject, text: input.text });
  if (info.rejected.length > 0) {
    throw new Error(
      `SMTP rejected recipients: ${info.rejected
        .map((recipient) => maskEmail(getRecipientAddress(recipient)))
        .join(", ")}`,
    );
  }
  console.log(
    `[mail] 안내 메일 SMTP 접수 완료 to=${recipients.map(maskEmail).join(", ")} messageId=${info.messageId ?? "unknown"}`,
  );
  return { sent: true };
}

/**
 * 임시 비밀번호 메일을 발송하고 결과를 반환한다.
 * sent:false(MAIL_LOG_ONLY 등)면 실제 메일이 나가지 않은 것이므로
 * 호출부는 성공 응답을 반환하거나 비밀번호를 변경해서는 안 된다.
 */
export async function sendTemporaryPasswordMail(
  input: TemporaryPasswordMailInput,
): Promise<TemporaryPasswordMailResult> {
  return deliverTemporaryPasswordMail(
    input,
    {
      mailLogOnly: isMailLogOnly(),
      siteUrl: getSiteUrl(),
      from: process.env.EMAIL_FROM,
    },
    {
      sendMail: async (message) => {
        const transporter = nodemailer.createTransport(getMailTransportConfig());
        const info = await transporter.sendMail(message);
        if (info.rejected.length > 0) {
          throw new Error(
            `SMTP rejected recipients: ${info.rejected
              .map((recipient) => maskEmail(getRecipientAddress(recipient)))
              .join(", ")}`,
          );
        }
        console.log(
          `[mail] 임시 비밀번호 메일 SMTP 접수 완료 to=${maskEmail(message.to)} messageId=${info.messageId ?? "unknown"}`,
        );
      },
      warn: (message) => console.warn(message),
    },
  );
}
