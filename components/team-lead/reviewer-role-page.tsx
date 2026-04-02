"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getTeamLeadReviewerRoleWorkspace,
  ReviewerRoleProfileItem,
  saveTeamLeadReviewerRoles,
} from "@/lib/team-lead/storage";

export function ReviewerRolePage() {
  const [profiles, setProfiles] = useState<ReviewerRoleProfileItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getTeamLeadReviewerRoleWorkspace();
      setProfiles(workspace.profiles);
      setSelectedIds(
        workspace.profiles
          .filter((profile) => profile.role === "reviewer")
          .map((profile) => profile.id),
      );
      setMessage(null);
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "평가자 목록을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filteredProfiles = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return profiles;
    return profiles.filter((profile) =>
      [profile.name, profile.loginId, profile.email].join(" ").toLowerCase().includes(keyword),
    );
  }, [profiles, query]);

  const initialSelectedIds = useMemo(
    () => profiles.filter((profile) => profile.role === "reviewer").map((profile) => profile.id).sort(),
    [profiles],
  );
  const draftSelectedIds = useMemo(() => [...selectedIds].sort(), [selectedIds]);
  const dirty = initialSelectedIds.join(",") !== draftSelectedIds.join(",");

  const summary = useMemo(
    () => ({
      total: profiles.length,
      reviewers: selectedIds.length,
      members: Math.max(profiles.length - selectedIds.length, 0),
    }),
    [profiles.length, selectedIds.length],
  );
  const selectedProfiles = useMemo(
    () =>
      profiles
        .filter((profile) => selectedSet.has(profile.id))
        .sort((left, right) => left.name.localeCompare(right.name, "ko")),
    [profiles, selectedSet],
  );

  const toggleProfile = (profileId: string) => {
    setSelectedIds((current) =>
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId],
    );
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <section className="subgrid-3">
        <article className="kpi">
          <div className="kpi-label">전체 인원</div>
          <div className="kpi-value">{summary.total}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">선택된 평가자</div>
          <div className="kpi-value">{summary.reviewers}</div>
        </article>
        <article className="kpi">
          <div className="kpi-label">일반 인원</div>
          <div className="kpi-value">{summary.members}</div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">평가자 지정</div>
          <strong style={{ fontSize: 24 }}>평가자 권한 관리</strong>
          <div className="status note">
            승인된 일반 인원만 표시합니다. 이름을 눌러 평가자에 추가하고, 다시 누르거나 위 목록에서 빼면 저장 시 `member`로 돌아갑니다.
          </div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="chip">이름 선택</div>
              <span className="muted">기본 오프 인원처럼 이름을 눌러 추가/삭제합니다.</span>
            </div>
            <input
              className="field-input"
              style={{ width: 280 }}
              placeholder="이름, 아이디, 이메일 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || saving || loading}
              onClick={async () => {
                setSaving(true);
                const result = await saveTeamLeadReviewerRoles(selectedIds);
                setMessage({ tone: result.ok ? "ok" : "warn", text: result.message });
                if (result.ok) {
                  await refresh();
                }
                setSaving(false);
              }}
            >
              저장
            </button>
            <button
              type="button"
              className="btn"
              disabled={!dirty || saving || loading}
              onClick={() => setSelectedIds(initialSelectedIds)}
            >
              선택 되돌리기
            </button>
          </div>

          <section style={{ display: "grid", gap: 10 }}>
            <div className="chip">선택된 평가자</div>
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(255,255,255,.04)",
                color: "#e5edf7",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.55,
              }}
            >
              위 이름들은 저장 시 평가자 권한이 됩니다. 이름을 누르면 바로 목록에서 빠집니다.
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignContent: "flex-start",
              }}
            >
              {selectedProfiles.length > 0 ? (
                selectedProfiles.map((profile) => (
                  <button
                    key={`selected-${profile.id}`}
                    type="button"
                    className="btn"
                    title={`${profile.name} / ${profile.loginId || "-"} / ${profile.email}`}
                    onClick={() => toggleProfile(profile.id)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      lineHeight: 1.2,
                      borderColor: "rgba(250,204,21,.52)",
                      background: "rgba(250,204,21,.2)",
                      color: "#fff1bf",
                    }}
                  >
                    {profile.name} 삭제
                  </button>
                ))
              ) : (
                <span className="muted">선택된 평가자가 없습니다.</span>
              )}
            </div>
          </section>

          <section style={{ display: "grid", gap: 10 }}>
            <div className="chip">전체 인원</div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignContent: "flex-start",
              }}
            >
              {filteredProfiles.length > 0 ? (
                filteredProfiles.map((profile) => {
                  const selected = selectedSet.has(profile.id);
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className="btn"
                      title={`${profile.name} / ${profile.loginId || "-"} / ${profile.email}`}
                      onClick={() => toggleProfile(profile.id)}
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        lineHeight: 1.2,
                        borderColor: selected ? "rgba(250,204,21,.52)" : undefined,
                        background: selected ? "rgba(250,204,21,.2)" : undefined,
                        color: selected ? "#fff1bf" : undefined,
                      }}
                    >
                      {profile.name}
                    </button>
                  );
                })
              ) : (
                <span className="muted">{loading ? "불러오는 중입니다." : "표시할 인원이 없습니다."}</span>
              )}
            </div>
          </section>
        </div>
      </article>
    </section>
  );
}
