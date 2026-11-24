"use client";

import { createClient } from "@/lib/supabase/client";
import { decideMfaGate, type MfaGateDecision } from "@/lib/auth/mfa-core";

// Supabase Auth 기본 TOTP(인증 앱) 2단계 인증을 화면에서 쓰는 도우미. 판단 규칙은 mfa-core.ts.

const MFA_LATER_STORAGE_KEY = "portal-mfa-later-v1";

function getClient() {
  return createClient();
}

/**
 * 지금 로그인이 2단계 인증 기준을 채우는지 본다.
 * 토큰을 읽지 못하는 등 오류가 나면 화면은 막지 않는다(실제 차단은 DB가 한다).
 */
export async function getMfaGateDecision(role: string | null | undefined): Promise<MfaGateDecision> {
  try {
    const { data, error } = await getClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return "ok";
    return decideMfaGate({ role, currentLevel: data.currentLevel, nextLevel: data.nextLevel, now: new Date() });
  } catch {
    return "ok";
  }
}

/** 등록된(확인 끝난) 인증 앱. 없으면 null. */
export async function getVerifiedTotpFactor() {
  const { data, error } = await getClient().auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data.totp.find((factor) => factor.status === "verified") ?? null;
}

/**
 * 인증 앱 등록을 시작한다. 예전에 하다 만 등록은 지우고 새로 만든다.
 * 반환한 QR(이미지 주소)과 비밀값을 화면에 보여 주고, 사용자가 앱의 6자리를 넣으면 verifyTotpCode로 끝낸다.
 */
export async function startTotpEnrollment() {
  const client = getClient();
  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError) throw new Error(listError.message);
  for (const factor of factors.all) {
    if (factor.factor_type === "totp" && factor.status !== "verified") {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `카메라 허브 ${stamp}` });
  if (error || !data) throw new Error(error?.message ?? "인증 앱 등록을 시작하지 못했습니다.");
  return { factorId: data.id, qrCode: toSafeSvgDataUrl(data.totp.qr_code), secret: data.totp.secret };
}

/**
 * Supabase는 QR을 "data:image/svg+xml;utf-8,<svg …>"처럼 인코딩하지 않은 SVG로 준다.
 * 브라우저마다 그대로는 못 그리는 경우가 있어 표준 형식(charset + URL 인코딩)으로 바꾼다.
 */
export function toSafeSvgDataUrl(qrCode: string) {
  const match = /^data:image\/svg\+xml(?:;charset=utf-8|;utf-8|;utf8)?,(.*)$/is.exec(qrCode);
  if (!match || match[1].startsWith("%3C") || match[1].startsWith("%3c")) return qrCode;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(match[1])}`;
}

/** 인증 앱 6자리를 확인한다. 성공하면 이번 로그인이 2단계 인증 완료 상태가 된다. */
export async function verifyTotpCode(factorId: string, code: string) {
  const { error } = await getClient().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("invalid") || message.includes("expired")) {
      throw new Error("6자리가 맞지 않습니다. 인증 앱에 지금 보이는 숫자를 다시 넣어 주세요.");
    }
    throw new Error(error.message);
  }
}

/** 유예 기간의 "나중에 하기"는 이 브라우저 창을 닫을 때까지만 기억한다. */
export function rememberMfaLater() {
  try {
    window.sessionStorage.setItem(MFA_LATER_STORAGE_KEY, "1");
  } catch {
    // 저장소를 못 써도 다음 화면 이동은 막지 않는다.
  }
}

export function hasChosenMfaLater() {
  try {
    return window.sessionStorage.getItem(MFA_LATER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
