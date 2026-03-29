"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  changePassword,
  getSession,
  issueTemporaryPassword,
  loginUser,
  registerUser,
} from "@/lib/auth/storage";

type Mode = "login" | "signup" | "reset" | "change";

function getMessageTone(message: string) {
  return message.includes("없습니다") || message.includes("대기") || message.includes("않")
    ? "warn"
    : "ok";
}

export default function LoginPage() {
  const router = useRouter();
  const session = getSession();
  const [forcedMode, setForcedMode] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [loginForm, setLoginForm] = useState({ loginId: "", password: "" });
  const [signupForm, setSignupForm] = useState({ loginId: "", username: "", password: "", email: "" });
  const [resetLoginId, setResetLoginId] = useState("");
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setForcedMode(params.get("mode"));
    }
  }, []);

  useEffect(() => {
    if (forcedMode === "change") setMode("change");
  }, [forcedMode]);

  function handleLoginSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const result = loginUser(loginForm);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("");
    router.replace(result.session.mustChangePassword ? "/login?mode=change" : "/");
  }

  function handleSignupSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const result = registerUser(signupForm);
    setMessage(result.message);
    if (result.ok) {
      setMode("login");
      setLoginForm({ loginId: signupForm.loginId, password: "" });
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className="chip">로그인 / 회원가입</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["login", "signup", "reset"] as Mode[]).map((item) => (
            <button key={item} type="button" className={`btn ${mode === item ? "white" : ""}`} onClick={() => setMode(item)} disabled={forcedMode === "change"}>
              {item === "login" ? "로그인" : item === "signup" ? "회원가입" : "비밀번호 찾기"}
            </button>
          ))}
          {forcedMode === "change" ? <button type="button" className="btn white">비밀번호 변경</button> : null}
        </div>

        {mode === "login" ? (
          <form style={{ display: "grid", gap: 16 }} onSubmit={handleLoginSubmit}>
            <input className="field-input" placeholder="아이디(영문)" value={loginForm.loginId} onChange={(e) => setLoginForm({ ...loginForm, loginId: e.target.value })} />
            <input className="field-input" type="password" placeholder="비밀번호" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            <button className="btn primary" type="submit">
              로그인
            </button>
            <button type="button" className="btn" onClick={() => setMode("reset")}>비밀번호 찾기</button>
          </form>
        ) : null}

        {mode === "signup" ? (
          <form style={{ display: "grid", gap: 16 }} onSubmit={handleSignupSubmit}>
            <input className="field-input" placeholder="아이디(영문, 예: honggildong)" value={signupForm.loginId} onChange={(e) => setSignupForm({ ...signupForm, loginId: e.target.value })} />
            <input className="field-input" placeholder="이름(한글)" value={signupForm.username} onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })} />
            <input className="field-input" type="password" placeholder="비밀번호" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })} />
            <input className="field-input" placeholder="이메일 (비밀번호 찾기에 활용됩니다)" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} />
            <button className="btn primary" type="submit">
              회원가입 신청
            </button>
          </form>
        ) : null}

        {mode === "reset" ? (
          <>
            <input className="field-input" placeholder="아이디(영문)" value={resetLoginId} onChange={(e) => setResetLoginId(e.target.value)} />
            <button className="btn primary" onClick={() => {
              const result = issueTemporaryPassword(resetLoginId);
              setMessage(result.message);
              if (result.ok) setMode("login");
            }}>
              임시비밀번호 발송
            </button>
          </>
        ) : null}

        {mode === "change" ? (
          <>
            <input className="field-input" type="password" placeholder="새 비밀번호" value={passwordForm.password} onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })} />
            <input className="field-input" type="password" placeholder="새 비밀번호 확인" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} />
            <button className="btn primary" onClick={() => {
              if (!session) {
                setMessage("로그인 세션이 없습니다.");
                return;
              }
              if (passwordForm.password !== passwordForm.confirm) {
                setMessage("새 비밀번호가 일치하지 않습니다.");
                return;
              }
              const result = changePassword(session.id, passwordForm.password);
              setMessage(result.message);
              if (result.ok) router.replace("/");
            }}>
              비밀번호 변경
            </button>
          </>
        ) : null}

        {message ? <div className={`status ${getMessageTone(message)}`}>{message}</div> : null}
      </div>
    </section>
  );
}
