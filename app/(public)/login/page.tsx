"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSession,
  getSupabaseSetupMessage,
  initializeAuth,
  isEnglishLoginId,
  issueTemporaryPassword,
  loginUser,
  registerUser,
  subscribeToAuth,
  updatePassword,
} from "@/lib/auth/storage";
import { hasSupabaseEnv } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "forgot" | "reset-password";

function normalizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/")) {
    return "/";
  }

  return value;
}

function getMessageTone(message: string) {
  return /실패|오류|확인|없습니다|못했습니다/.test(message) ? "warn" : "ok";
}

export default function LoginPage() {
  const router = useRouter();
  const supabaseConfigured = hasSupabaseEnv();
  const [session, setSession] = useState(() => getSession());
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [queryState, setQueryState] = useState<{ mode: string | null; reason: string | null; next: string | null }>({
    mode: null,
    reason: null,
    next: null,
  });
  const [loginForm, setLoginForm] = useState({ loginId: "", password: "" });
  const [signupForm, setSignupForm] = useState({
    loginId: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [forgotLoginId, setForgotLoginId] = useState("");
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [submitting, setSubmitting] = useState(false);

  const forcedMode = useMemo(() => {
    return queryState.mode === "reset-password" ? "reset-password" : null;
  }, [queryState.mode]);
  const nextPath = useMemo(() => normalizeNextPath(queryState.next), [queryState.next]);
  const approvalReason = queryState.reason;
  const passwordResetLocked = forcedMode === "reset-password" || Boolean(session?.mustChangePassword);

  useEffect(() => {
    let mounted = true;

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setQueryState({
        mode: params.get("mode"),
        reason: params.get("reason"),
        next: params.get("next"),
      });
    }

    if (!supabaseConfigured) {
      setMessage(getSupabaseSetupMessage());
      setSession(null);
      return () => {
        mounted = false;
      };
    }

    void initializeAuth().then((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
    });

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [supabaseConfigured]);

  useEffect(() => {
    if (forcedMode === "reset-password") {
      setMode("reset-password");
      return;
    }

    if (session?.mustChangePassword) {
      setMode("reset-password");
      setMessage("임시 비밀번호로 로그인했습니다. 새 비밀번호를 입력해 주세요.");
      return;
    }

    if (approvalReason === "approval") {
      setMessage("계정이 아직 승인되지 않았습니다. 관리자 승인 후 다시 이용해 주세요.");
    }
  }, [approvalReason, forcedMode, session?.mustChangePassword]);

  useEffect(() => {
    if (passwordResetLocked) return;
    if (!session?.approved) return;
    if (!session) return;
    router.replace(nextPath);
  }, [nextPath, passwordResetLocked, router, session]);

  async function handleLoginSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setSubmitting(true);

    const result = await loginUser({
      loginId: loginForm.loginId,
      password: loginForm.password,
    });
    setSubmitting(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    if (!result.session?.approved) {
      setMessage("계정이 아직 승인되지 않았습니다. 관리자 승인 후 다시 이용해 주세요.");
      return;
    }

    setSession(result.session);
    if (result.session.mustChangePassword) {
      setMode("reset-password");
      setMessage("임시 비밀번호로 로그인했습니다. 새 비밀번호를 입력해 주세요.");
      return;
    }

    setMessage("");
    router.replace(nextPath);
  }

  async function handleSignupSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!isEnglishLoginId(signupForm.loginId)) {
      setMessage("아이디는 영문 소문자로 시작하고 4~20자 이내여야 합니다.");
      return;
    }

    if (signupForm.password !== signupForm.confirmPassword) {
      setMessage("비밀번호와 비밀번호 확인이 서로 일치하지 않습니다.");
      return;
    }

    setSubmitting(true);
    const result = await registerUser({
      loginId: signupForm.loginId,
      username: signupForm.username,
      email: signupForm.email,
      password: signupForm.password,
    });
    setSubmitting(false);
    setMessage(result.message);

    if (result.ok) {
      setMode("login");
      setLoginForm({ loginId: signupForm.loginId, password: "" });
      setSignupForm({
        loginId: "",
        username: "",
        email: "",
        password: "",
        confirmPassword: "",
      });
    }
  }

  async function handleForgotPassword() {
    setSubmitting(true);
    const result = await issueTemporaryPassword(forgotLoginId);
    setSubmitting(false);
    setMessage(result.message);

    if (result.ok) {
      setMode("login");
      setForgotLoginId("");
    }
  }

  async function handlePasswordReset() {
    if (!session) {
      setMessage("비밀번호를 재설정할 세션이 없습니다. 메일 링크를 다시 열어 주세요.");
      return;
    }

    if (passwordForm.password !== passwordForm.confirm) {
      setMessage("새 비밀번호와 확인 비밀번호가 서로 일치하지 않습니다.");
      return;
    }

    setSubmitting(true);
    const result = await updatePassword(passwordForm.password);
    setSubmitting(false);
    setMessage(result.message);

    if (result.ok) {
      router.replace(nextPath);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className="chip">로그인 / 회원가입 / 비밀번호 찾기</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["login", "signup", "forgot"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`btn ${mode === item ? "white" : ""}`}
              onClick={() => setMode(item)}
              disabled={passwordResetLocked || submitting || !supabaseConfigured}
            >
              {item === "login" ? "로그인" : item === "signup" ? "회원가입" : "비밀번호 찾기"}
            </button>
          ))}
          {passwordResetLocked ? (
            <button type="button" className="btn white" disabled>
              비밀번호 재설정
            </button>
          ) : null}
        </div>

        {mode === "login" ? (
          <form style={{ display: "grid", gap: 16 }} onSubmit={handleLoginSubmit}>
            <input
              className="field-input"
              type="text"
              placeholder="아이디"
              autoComplete="username"
              value={loginForm.loginId}
              onChange={(event) => setLoginForm({ ...loginForm, loginId: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <input
              className="field-input"
              type="password"
              placeholder="비밀번호"
              autoComplete="current-password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <button className="btn primary" type="submit" disabled={submitting || !supabaseConfigured}>
              로그인
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setMode("forgot")}
              disabled={submitting || !supabaseConfigured || passwordResetLocked}
            >
              비밀번호 찾기
            </button>
          </form>
        ) : null}

        {mode === "signup" ? (
          <form style={{ display: "grid", gap: 16 }} onSubmit={handleSignupSubmit}>
            <input
              className="field-input"
              placeholder="아이디"
              value={signupForm.loginId}
              onChange={(event) => setSignupForm({ ...signupForm, loginId: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <div className="muted" style={{ fontSize: 13 }}>
              아이디는 영문 소문자로 시작하고 4~20자 이내로 입력해 주세요.
            </div>
            <input
              className="field-input"
              type="password"
              placeholder="비밀번호"
              autoComplete="new-password"
              value={signupForm.password}
              onChange={(event) => setSignupForm({ ...signupForm, password: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <div className="muted" style={{ fontSize: 13 }}>
              비밀번호는 제한없이 입력하세요.
            </div>
            <input
              className="field-input"
              type="password"
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              value={signupForm.confirmPassword}
              onChange={(event) => setSignupForm({ ...signupForm, confirmPassword: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <input
              className="field-input"
              placeholder="이름"
              value={signupForm.username}
              onChange={(event) => setSignupForm({ ...signupForm, username: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <input
              className="field-input"
              type="email"
              placeholder="이메일"
              value={signupForm.email}
              onChange={(event) => setSignupForm({ ...signupForm, email: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <div className="muted" style={{ fontSize: 13 }}>
              이메일은 비밀번호 찾기와 재설정 메일 수신용으로 사용됩니다.
            </div>
            <button className="btn primary" type="submit" disabled={submitting || !supabaseConfigured}>
              회원가입
            </button>
          </form>
        ) : null}

        {mode === "forgot" ? (
          <>
            <div className="status note">아이디를 입력하면 가입된 이메일로 임시 비밀번호를 보내드립니다.</div>
            <input
              className="field-input"
              type="text"
              placeholder="아이디"
              value={forgotLoginId}
              onChange={(event) => setForgotLoginId(event.target.value)}
              disabled={!supabaseConfigured}
            />
            <button className="btn primary" onClick={handleForgotPassword} disabled={submitting || !supabaseConfigured}>
              임시 비밀번호 보내기
            </button>
          </>
        ) : null}

        {mode === "reset-password" ? (
          <>
            <div className="status note">
              {session?.mustChangePassword
                ? "임시 비밀번호로 로그인한 상태입니다. 새 비밀번호를 입력해 변경해 주세요."
                : "메일 링크를 통해 들어왔다면 새 비밀번호를 입력해 주세요."}
            </div>
            <input
              className="field-input"
              type="password"
              placeholder="새 비밀번호"
              autoComplete="new-password"
              value={passwordForm.password}
              onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <div className="muted" style={{ fontSize: 13 }}>
              비밀번호는 제한없이 입력하세요.
            </div>
            <input
              className="field-input"
              type="password"
              placeholder="새 비밀번호 확인"
              autoComplete="new-password"
              value={passwordForm.confirm}
              onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })}
              disabled={!supabaseConfigured}
            />
            <button className="btn primary" onClick={handlePasswordReset} disabled={submitting || !supabaseConfigured}>
              비밀번호 재설정
            </button>
          </>
        ) : null}

        {message ? <div className={`status ${getMessageTone(message)}`}>{message}</div> : null}
      </div>
    </section>
  );
}
