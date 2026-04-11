import "server-only";

import nodemailer from "nodemailer";

interface TemporaryPasswordMailInput {
  email: string;
  loginId: string;
  username: string;
  temporaryPassword: string;
}

function isMailLogOnly() {
  return process.env.MAIL_LOG_ONLY === "true";
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function getMailTransportConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null;
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !port || Number.isNaN(port)) {
    throw new Error(
      "임시 비밀번호 메일 발송을 위해 SMTP_HOST, SMTP_PORT, SMTP_SECURE, EMAIL_FROM 환경변수를 설정해 주세요.",
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

export function hasTemporaryPasswordMailEnv() {
  if (isMailLogOnly()) {
    return true;
  }

  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_SECURE &&
      process.env.EMAIL_FROM,
  );
}

export async function sendTemporaryPasswordMail(input: TemporaryPasswordMailInput) {
  const subject = "[JTBC NEWS CAMERA HUB] 임시 비밀번호 안내";
  const loginUrl = `${getSiteUrl()}/login`;
  const text = [
    `${input.username}님, 안녕하세요.`,
    "",
    "요청하신 임시 비밀번호를 안내드립니다.",
    `아이디: ${input.loginId}`,
    `임시 비밀번호: ${input.temporaryPassword}`,
    "",
    `${loginUrl} 에서 로그인하신 뒤 새 비밀번호로 반드시 변경해 주세요.`,
  ].join("\n");

  if (isMailLogOnly()) {
    return;
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("임시 비밀번호 메일 발송을 위해 EMAIL_FROM 환경변수를 설정해 주세요.");
  }

  const transporter = nodemailer.createTransport(getMailTransportConfig());
  await transporter.sendMail({
    from,
    to: input.email,
    subject,
    text,
  });
}
