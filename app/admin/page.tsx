"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { deleteUser, getResetLogs, getUsers, updateUserRole, updateUserStatus, UserAccount, UserRole } from "@/lib/auth/storage";

const roles: UserRole[] = ["member", "reviewer", "team_lead", "desk", "admin"];
const roleLabels: Record<UserRole, string> = {
  member: "멤버",
  reviewer: "평가자",
  team_lead: "팀장",
  desk: "데스크",
  admin: "관리자",
};

const roleToneStyles: Partial<Record<UserRole, CSSProperties>> = {
  reviewer: {
    color: "#fff1bf",
    border: "1px solid rgba(250,204,21,.45)",
    background: "rgba(250,204,21,.16)",
  },
  team_lead: {
    color: "#fbcfe8",
    border: "1px solid rgba(244,114,182,.42)",
    background: "rgba(244,114,182,.14)",
  },
  desk: {
    color: "#bfdbfe",
    border: "1px solid rgba(96,165,250,.45)",
    background: "rgba(59,130,246,.14)",
  },
};

const smallButtonStyle: CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  lineHeight: 1.2,
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [logs, setLogs] = useState(getResetLogs());
  const [query, setQuery] = useState("");
  const [draftRoles, setDraftRoles] = useState<Record<string, UserRole>>({});

  useEffect(() => {
    setUsers(getUsers());
    setLogs(getResetLogs());
    setDraftRoles({});
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim();
    if (!keyword) return users;
    return users.filter((user) =>
      [user.username, user.loginId, user.email, user.phone, user.role, user.status].some((value) => value.includes(keyword)),
    );
  }, [users, query]);

  const summary = useMemo(() => {
    return {
      total: users.length,
      active: users.filter((user) => user.status === "ACTIVE").length,
      disabled: users.filter((user) => user.status === "DISABLED").length,
      admins: users.filter((user) => user.role === "admin").length,
    };
  }, [users]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section className="subgrid-4">
        <article className="kpi">
          <div className="kpi-label">회원 수</div>
          <div className="kpi-value">{summary.total}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">활성</div>
          <div className="kpi-value">{summary.active}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">정지</div>
          <div className="kpi-value">{summary.disabled}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">관리자</div>
          <div className="kpi-value">{summary.admins}</div>
        </article>
      </section>

      <section className="subgrid-2">
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">회원 관리</div>
            <input
              className="field-input"
              style={{ width: 240 }}
              placeholder="이름, 아이디, 메일 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <table className="table-like">
            <thead>
              <tr>
                <th>이름</th>
                <th>아이디</th>
                <th>이메일</th>
                <th>전화번호</th>
                <th>멤버 등급</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.loginId}</td>
                  <td>{user.email}</td>
                  <td>{user.phone}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8 }}>
                      {(() => {
                        const draftRole = draftRoles[user.id];
                        const nextRole = draftRole ?? user.role;
                        const hasPendingRoleChange = nextRole !== user.role;
                        return (
                          <>
                      <strong
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "fit-content",
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 800,
                          lineHeight: 1.2,
                          color: "#f8fbff",
                          border: "1px solid rgba(255,255,255,.14)",
                          background: "rgba(255,255,255,.06)",
                          ...(roleToneStyles[nextRole] ?? {}),
                        }}
                      >
                        {roleLabels[nextRole]}
                      </strong>
                      <select
                        className="field-select"
                        value={nextRole}
                        onChange={(e) => {
                          const value = e.target.value as UserRole;
                          setDraftRoles((current) => {
                            if (value === user.role) {
                              const next = { ...current };
                              delete next[user.id];
                              return next;
                            }
                            return { ...current, [user.id]: value };
                          });
                        }}
                      >
                        {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                      </select>
                      {hasPendingRoleChange ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          style={smallButtonStyle}
                          onClick={() => {
                            setUsers(updateUserRole(user.id, nextRole));
                            setDraftRoles((current) => {
                              const next = { ...current };
                              delete next[user.id];
                              return next;
                            });
                          }}
                        >
                          확인
                        </button>
                        <button
                          className="btn"
                          style={smallButtonStyle}
                          onClick={() => setDraftRoles((current) => {
                            const next = { ...current };
                            delete next[user.id];
                            return next;
                          })}
                        >
                          취소
                        </button>
                      </div>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td>
                    {user.status === "ACTIVE" ? "활성" : "정지"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" style={smallButtonStyle} onClick={() => setUsers(updateUserStatus(user.id, "ACTIVE"))}>활성</button>
                      <button className="btn" style={smallButtonStyle} onClick={() => setUsers(updateUserStatus(user.id, "DISABLED"))}>계정 정지</button>
                      <button
                        className="btn"
                        style={{
                          ...smallButtonStyle,
                          color: "#ffd7d7",
                          borderColor: "rgba(239,68,68,.38)",
                          background: "rgba(239,68,68,.18)",
                        }}
                        onClick={() => {
                          const ok = window.confirm(`${user.username} 계정을 삭제하시겠습니까?`);
                          if (!ok) return;
                          const result = deleteUser(user.id);
                          if (!result.ok) return;
                          setUsers(result.users);
                          setDraftRoles((current) => {
                            const next = { ...current };
                            delete next[user.id];
                            return next;
                          });
                        }}
                      >
                        계정 삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div className="chip">비밀번호 찾기 메일 로그</div>
          <table className="table-like">
            <thead>
              <tr>
                <th>이름</th>
                <th>아이디</th>
                <th>메일</th>
                <th>임시비밀번호</th>
                <th>발급시각</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={`${log.loginId}-${index}`}>
                  <td>{log.username}</td>
                  <td>{log.loginId}</td>
                  <td>{log.email}</td>
                  <td>{log.tempPassword}</td>
                  <td>{log.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      </section>
    </section>
  );
}
