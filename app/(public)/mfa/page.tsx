"use client";

import type { FormEvent } from "react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSessionAsync, logoutUser } from "@/lib/auth/storage";
import {
  getMfaGateDecision,
  getVerifiedTotpFactor,
  rememberMfaLater,
  startTotpEnrollment,
  verifyTotpCode,
} from "@/lib/auth/mfa";
import { formatMfaRequiredDate, normalizeMfaCode, sanitizeMfaNextPath, type MfaGateDecision } from "@/lib/auth/mfa-core";

// 총괄팀장 · DESK · admin 2단계 인증(인증 앱 6자리) 화면. 등록과 로그인 확인을 함께 한다.

type Enrollment = { factorId: string; qrCode: string; secret: string };

function MfaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeMfaNextPath(searchParams.get("next"));
  const [decision, setDecision] = useState<MfaGateDecision | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSessionAsync();
      if (cancelled) return;
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }
      const nextDecision = await getMfaGateDecision(session.actualRole ?? session.role);
      if (cancelled) return;
      if (nextDecision === "ok") {
        router.replace(nextPath);
        return;
      }
      if (nextDecision === "challenge") {
        try {
          const factor = await getVerifiedTotpFactor();
          if (!cancelled) setFactorId(factor?.id ?? null);
        } catch (error) {
          if (!cancelled) setMessage(error instanceof Error ? error.message : "인증 정보를 불러오지 못했습니다.");
        }
      }
      setDecision(nextDecision);
    })();
    return () => {
      cancelled = true;
    };
  }, [nextPath, router]);

  async function handleStartEnrollment() {
    setBusy(true);
    setMessage("");
    try {
      setEnrollment(await startTotpEnrollment());
      setCode("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증 앱 등록을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetFactorId = enrollment?.factorId ?? factorId;
    const normalized = normalizeMfaCode(code);
    if (!targetFactorId) {
      setMessage("등록된 인증 앱을 찾지 못했습니다. 개발 담당자에게 알려 주세요.");
      return;
    }
    if (normalized.length !== 6) {
      setMessage("인증 앱에 보이는 숫자 6자리를 넣어 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await verifyTotpCode(targetFactorId, normalized);
      setMessage(enrollment ? "등록했습니다. 다음 로그인부터는 6자리만 넣으면 됩니다." : "확인했습니다.");
      router.replace(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "확인하지 못했습니다.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    await logoutUser();
    router.replace("/login");
  }

  const isEnroll = decision === "enroll-required" || decision === "enroll-suggested";
  const codeForm = (
    <form onSubmit={handleVerify} style={{ display: "grid", gap: 12 }}>
      <input
        className="field-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6자리 숫자"
        value={code}
        onChange={(event) => setCode(normalizeMfaCode(event.target.value))}
        style={{ fontSize: 22, letterSpacing: 6, textAlign: "center", maxWidth: 260 }}
        autoFocus
        disabled={busy}
      />
      <div>
        <button className="btn primary" type="submit" disabled={busy || code.length !== 6}>
          확인
        </button>
      </div>
    </form>
  );

  return (
    <section className="panel" style={{ maxWidth: 640, margin: "0 auto" }}>
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className="chip">2단계 인증</div>

        {decision === null ? <div className="status note">확인하는 중입니다.</div> : null}

        {decision === "challenge" ? (
          <>
            <p style={{ margin: 0 }}>
              휴대폰의 <strong>인증 앱</strong>을 열고, <strong>카메라 허브</strong> 항목에 보이는 숫자 6자리를 넣어 주세요.
            </p>
            {codeForm}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              휴대폰을 바꿨거나 잃어버렸으면 개발 담당자에게 2단계 인증 초기화를 요청해 주세요.
            </p>
          </>
        ) : null}

        {isEnroll && !enrollment ? (
          <>
            <p style={{ margin: 0 }}>
              총괄팀장 · DESK 계정은 비밀번호가 새어 나가도 남이 들어오지 못하도록 <strong>휴대폰 인증 앱</strong>으로 한 번 더
              확인합니다. 처음 한 번만 등록하면, 이후에는 새로 로그인할 때만 숫자 6자리를 넣으면 됩니다.
            </p>
            <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
              <li>
                휴대폰에 <strong>Google Authenticator</strong> 또는 <strong>Microsoft Authenticator</strong> 앱을 설치합니다.
              </li>
              <li>아래 버튼을 누르면 QR 코드가 나옵니다. 앱에서 QR 코드를 찍습니다.</li>
              <li>앱에 나온 숫자 6자리를 넣으면 끝입니다.</li>
            </ol>
            {decision === "enroll-suggested" ? (
              <div className="status note">
                {formatMfaRequiredDate()}부터는 등록해야 포털을 쓸 수 있습니다. 지금 등록하시길 권합니다.
              </div>
            ) : (
              <div className="status warn">2단계 인증을 등록해야 포털을 쓸 수 있습니다.</div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" onClick={handleStartEnrollment} disabled={busy}>
                등록 시작
              </button>
              {decision === "enroll-suggested" ? (
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    rememberMfaLater();
                    router.replace(nextPath);
                  }}
                >
                  나중에 하기
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {enrollment ? (
          <>
            <p style={{ margin: 0 }}>인증 앱에서 <strong>QR 코드 스캔</strong>을 누르고 아래 그림을 찍어 주세요.</p>
            {/* Supabase가 만들어 준 QR(SVG 데이터 주소)이다. 외부로 나가지 않는다. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrCode}
              alt="인증 앱 등록용 QR 코드"
              width={200}
              height={200}
              style={{ background: "#fff", padding: 8, borderRadius: 8 }}
            />
            <div>
              <button className="btn" type="button" onClick={() => setShowSecret((value) => !value)}>
                {showSecret ? "설정 키 숨기기" : "QR을 찍을 수 없나요? 설정 키 보기"}
              </button>
              {showSecret ? (
                <p className="muted" style={{ margin: "8px 0 0", fontSize: 13, overflowWrap: "anywhere" }}>
                  인증 앱에서 &lsquo;설정 키 입력&rsquo;을 고르고 이 값을 넣으세요: <code>{enrollment.secret}</code>
                </p>
              ) : null}
            </div>
            <p style={{ margin: 0 }}>앱에 <strong>카메라 허브</strong> 항목이 생기면, 거기 보이는 숫자 6자리를 넣어 주세요.</p>
            {codeForm}
          </>
        ) : null}

        {message ? <div className="status note">{message}</div> : null}

        {decision !== null ? (
          <div>
            <button className="btn" type="button" onClick={handleLogout} disabled={busy}>
              로그아웃
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function MfaPage() {
  return (
    <Suspense fallback={<div className="status note">확인하는 중입니다.</div>}>
      <MfaPageInner />
    </Suspense>
  );
}
