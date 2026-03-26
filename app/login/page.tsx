"use client";

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

export default function LoginPage() {
  const router = useRouter();
  const session = getSession();
  const [forcedMode, setForcedMode] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [signupForm, setSignupForm] = useState({ username: "", password: "", email: "", phone: "" });
  const [resetUser, setResetUser] = useState("");
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

  return (
    <section className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
        <div className="chip">로그인 / 회원가입</div>
        <div className="status note">
          회원가입 아이디는 반드시 한글 본인이름입니다. 비밀번호는 제한 없이 입력할 수 있고, 이메일과 전화번호를 함께 등록합니다.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["login", "signup", "reset"] as Mode[]).map((item) => (
            <button key={item} className={`btn ${mode === item ? "white" : ""}`} onClick={() => setMode(item)} disabled={forcedMode === "change"}>
              {item === "login" ? "로그인" : item === "signup" ? "회원가입" : "비밀번호 찾기"}
            </button>
          ))}
          {forcedMode === "change" ? <button className="btn white">비밀번호 변경</button> : null}
        </div>

        {mode === "login" ? (
          <>
            <input className="field-input" placeholder="아이디(한글 이름)" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
            <input className="field-input" type="password" placeholder="비밀번호" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            <button
              className="btn primary"
              onClick={() => {
                const result = loginUser(loginForm);
                if (!result.ok) {
                  setMessage(result.message);
                  return;
                }
                setMessage("");
                router.replace(result.session.mustChangePassword ? "/login?mode=change" : "/");
              }}
            >
              로그인
            </button>
            <button className="btn" onClick={() => setMode("reset")}>비밀번호 찾기</button>
          </>
        ) : null}

        {mode === "signup" ? (
          <>
            <input className="field-input" placeholder="아이디(한글 이름)" value={signupForm.username} onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })} />
            <input className="field-input" type="password" placeholder="비밀번호" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })} />
            <input className="field-input" placeholder="이메일" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} />
            <input className="field-input" placeholder="전화번호" value={signupForm.phone} onChange={(e) => setSignupForm({ ...signupForm, phone: e.target.value })} />
            <button className="btn primary" onClick={() => {
              const result = registerUser(signupForm);
              setMessage(result.message);
              if (result.ok) setMode("login");
            }}>
              회원가입 신청
            </button>
          </>
        ) : null}

        {mode === "reset" ? (
          <>
            <input className="field-input" placeholder="아이디(한글 이름)" value={resetUser} onChange={(e) => setResetUser(e.target.value)} />
            <button className="btn primary" onClick={() => {
              const result = issueTemporaryPassword(resetUser);
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

        {message ? <div className={`status ${message.includes("없습니다") || message.includes("대기") || message.includes("않") ? "warn" : "ok"}`}>{message}</div> : null}
        <div className="status note">
          기본 관리자 계정: 아이디 `관리자`, 비밀번호 `admin1234`
        </div>
      </div>
    </section>
  );
}
