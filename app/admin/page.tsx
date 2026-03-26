"use client";

import { useEffect, useMemo, useState } from "react";
import { getResetLogs, getUsers, updateUserRole, updateUserStatus, UserAccount, UserRole } from "@/lib/auth/storage";

const roles: UserRole[] = ["member", "reviewer", "team_lead", "desk", "admin"];
const roleLabels: Record<UserRole, string> = {
  member: "멤버",
  reviewer: "평가자",
  team_lead: "팀장",
  desk: "데스크",
  admin: "관리자",
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [logs, setLogs] = useState(getResetLogs());
  const [query, setQuery] = useState("");

  useEffect(() => {
    setUsers(getUsers());
    setLogs(getResetLogs());
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim();
    if (!keyword) return users;
    return users.filter((user) =>
      [user.username, user.email, user.phone, user.role, user.status].some((value) => value.includes(keyword)),
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
              placeholder="이름, 메일, 전화번호 검색"
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
                  <td>{user.id}</td>
                  <td>{user.email}</td>
                  <td>{user.phone}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong>{roleLabels[user.role]}</strong>
                      <select
                        className="field-select"
                        value={user.role}
                        onChange={(e) => setUsers(updateUserRole(user.id, e.target.value as UserRole))}
                      >
                        {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                      </select>
                    </div>
                  </td>
                  <td>
                    {user.status === "ACTIVE" ? "활성" : "정지"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => setUsers(updateUserStatus(user.id, "ACTIVE"))}>활성</button>
                      <button className="btn" onClick={() => setUsers(updateUserStatus(user.id, "DISABLED"))}>계정 정지</button>
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
                <th>아이디</th>
                <th>메일</th>
                <th>임시비밀번호</th>
                <th>발급시각</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={`${log.username}-${index}`}>
                  <td>{log.username}</td>
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
