"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closeTeamLeadSubmissionAndOpenReviewAccess,
  closeTeamLeadReviewAccess,
  getTeamLeadReviewerRoleWorkspace,
  isTeamLeadSubmissionAccessOpen,
  refreshTeamLeadSubmissionAccessState,
  ReviewerRoleProfileItem,
  saveCurrentBestReportResultsAsNextQuarter,
  saveTeamLeadReviewerRoles,
  setTeamLeadSubmissionAccessOpen,
  TEAM_LEAD_SUBMISSION_ACCESS_EVENT,
} from "@/lib/team-lead/storage";

const REVIEWER_NAME_CHIP_STORAGE_KEY = "j-special-force-reviewer-role-name-chips";
const DEFAULT_REVIEWER_NAME_CHIPS = [
  "주수영",
  "이동현",
  "반일훈",
  "박재현",
  "이주현",
  "김재식",
  "신동환",
  "구본준",
  "이학진",
  "장후원",
  "황현우",
  "김미란",
  "유규열",
  "김준택",
  "방극철",
  "이주원",
  "이경",
  "공영수",
  "신승규",
  "정상원",
  "최무룡",
  "정철원",
  "김진광",
  "조용희",
  "이완근",
  "박대권",
  "이지수",
  "김대호",
  "이현일",
  "유연경",
  "정재우",
];

function normalizeNames(names: string[]) {
  return Array.from(
    new Set(
      names
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );
}

function readNameChips() {
  if (typeof window === "undefined") return DEFAULT_REVIEWER_NAME_CHIPS;
  try {
    const raw = window.localStorage.getItem(REVIEWER_NAME_CHIP_STORAGE_KEY);
    if (!raw) return DEFAULT_REVIEWER_NAME_CHIPS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_REVIEWER_NAME_CHIPS;
    const normalized = normalizeNames(parsed);
    return normalized.length > 0 ? normalized : DEFAULT_REVIEWER_NAME_CHIPS;
  } catch {
    return DEFAULT_REVIEWER_NAME_CHIPS;
  }
}

function writeNameChips(names: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVIEWER_NAME_CHIP_STORAGE_KEY, JSON.stringify(normalizeNames(names)));
}

function sortNamesByChipOrder(names: string[], order: Map<string, number>) {
  return normalizeNames(names).sort((left, right) => {
    const leftRank = order.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = order.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right, "ko");
  });
}

function getProfileRoleLabel(role: ReviewerRoleProfileItem["role"]) {
  if (role === "outlet") return "출입처";
  if (role === "reviewer") return "평가자";
  if (role === "desk") return "데스크";
  if (role === "admin") return "관리자";
  return "팀원";
}

export function ReviewerRolePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ReviewerRoleProfileItem[]>([]);
  const [nameChips, setNameChips] = useState<string[]>(DEFAULT_REVIEWER_NAME_CHIPS);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [editingNames, setEditingNames] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(() => isTeamLeadSubmissionAccessOpen());
  const [activeReviewerCount, setActiveReviewerCount] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  const nameChipOrder = useMemo(() => new Map(nameChips.map((name, index) => [name, index] as const)), [nameChips]);
  const profileByName = useMemo(() => {
    const map = new Map<string, ReviewerRoleProfileItem>();
    [...profiles]
      .sort((left, right) => left.name.localeCompare(right.name, "ko"))
      .forEach((profile) => {
        if (!map.has(profile.name)) {
          map.set(profile.name, profile);
        }
      });
    return map;
  }, [profiles]);

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getTeamLeadReviewerRoleWorkspace();
      const selectedReviewerNames = workspace.profiles
        .filter((profile) => workspace.selectedProfileIds.includes(profile.id))
        .map((profile) => profile.name);

      setProfiles(workspace.profiles);
      setActiveReviewerCount(workspace.activeProfileIds.length);
      const sortedSelectedReviewerNames = sortNamesByChipOrder(selectedReviewerNames, nameChipOrder);
      setSelectedNames((current) => {
        const currentMissing = current.filter((name) => !workspace.profiles.some((profile) => profile.name === name));
        return sortNamesByChipOrder([...sortedSelectedReviewerNames, ...currentMissing], nameChipOrder);
      });
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
    setNameChips(readNameChips());
  }, []);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const syncSubmissionOpen = () => {
      setSubmissionOpen(isTeamLeadSubmissionAccessOpen());
    };

    void refreshTeamLeadSubmissionAccessState().then(() => {
      const nextOpen = isTeamLeadSubmissionAccessOpen();
      setSubmissionOpen(nextOpen);
      void refresh();
    });
    window.addEventListener(TEAM_LEAD_SUBMISSION_ACCESS_EVENT, syncSubmissionOpen);
    return () => {
      window.removeEventListener(TEAM_LEAD_SUBMISSION_ACCESS_EVENT, syncSubmissionOpen);
    };
  }, []);

  useEffect(() => {
    writeNameChips(nameChips);
  }, [nameChips]);

  const selectedNameSet = useMemo(() => new Set(selectedNames), [selectedNames]);

  const selectedDisplayNames = useMemo(
    () =>
      [...selectedNames].sort((left, right) => {
        const leftRank = nameChipOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = nameChipOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.localeCompare(right, "ko");
      }),
    [nameChipOrder, selectedNames],
  );

  const visibleNameChips = useMemo(
    () => {
      const profileNames = profiles.map((profile) => profile.name);
      return normalizeNames([...nameChips, ...profileNames]).map((name) => ({
        name,
        custom: nameChips.includes(name),
        selected: selectedNameSet.has(name),
        profile: profileByName.get(name) ?? null,
      }));
    },
    [nameChips, profileByName, profiles, selectedNameSet],
  );

  const summary = useMemo(
    () => ({
      total: visibleNameChips.length,
      reviewers: selectedNames.length,
      activeReviewers: activeReviewerCount,
    }),
    [activeReviewerCount, selectedNames.length, visibleNameChips.length],
  );

  const toggleName = (name: string) => {
    setSelectedNames((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  const handleAddName = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setMessage({ tone: "warn", text: "추가할 이름을 입력해 주세요." });
      return;
    }
    if (nameChips.includes(trimmed)) {
      setMessage({ tone: "note", text: "이미 목록에 있는 이름입니다." });
      return;
    }
    setNameChips((current) => [...current, trimmed]);
    setNewName("");
    setMessage({ tone: "ok", text: `${trimmed} 이름칩을 추가했습니다.` });
  };

  const handleDeleteName = (name: string) => {
    const ok = window.confirm("삭제하시겠습니까?");
    if (!ok) return;

    setNameChips((current) => current.filter((item) => item !== name));
    setSelectedNames((current) => current.filter((item) => item !== name));
    setMessage({ tone: "note", text: `${name} 이름칩을 삭제했습니다.` });
  };

  const handleAssignReviewers = async () => {
    const linkedSelectedIds = selectedNames
      .map((name) => profileByName.get(name)?.id ?? null)
      .filter((id): id is string => Boolean(id));
    const missingNames = selectedNames.filter((name) => !profileByName.has(name));

    if (linkedSelectedIds.length === 0) {
      setMessage({ tone: "warn", text: "평가자로 지정할 이름을 먼저 선택해 주세요." });
      return;
    }

    const confirmed = window.confirm("선택한 인원을 평가자로 지정하시겠습니까?");
    if (!confirmed) return;

    setSaving(true);
    const saveResult = await saveTeamLeadReviewerRoles(linkedSelectedIds);
    setSaving(false);

    if (saveResult.ok) {
      await refresh();
    }

    setMessage({
      tone: saveResult.ok ? (missingNames.length > 0 ? "note" : "ok") : "warn",
      text: saveResult.ok
        ? `평가자 명단을 저장했습니다. 제출 마감 때 평가 페이지가 열립니다.${missingNames.length > 0 ? ` 연결된 계정이 없는 이름은 저장되지 않았습니다: ${missingNames.join(", ")}` : ""}`
        : saveResult.message,
    });
  };

  const handleOpenSubmissions = async () => {
    const confirmed = window.confirm("베스트리포트 제출 페이지를 오픈하시겠습니까?");
    if (!confirmed) return;

    setSaving(true);
    const result = await setTeamLeadSubmissionAccessOpen(true);
    setSaving(false);

    if (!result.ok) {
      setMessage({ tone: "warn", text: result.message });
      return;
    }

    await refreshTeamLeadSubmissionAccessState();
    setSubmissionOpen(result.isOpen);
    setMessage({ tone: "ok", text: result.message });
  };

  const handleCloseSubmissions = async () => {
    const linkedSelectedIds = selectedNames
      .map((name) => profileByName.get(name)?.id ?? null)
      .filter((id): id is string => Boolean(id));
    const missingNames = selectedNames.filter((name) => !profileByName.has(name));

    if (linkedSelectedIds.length === 0) {
      setMessage({ tone: "warn", text: "제출 마감 전에 평가자를 먼저 지정해 주세요." });
      return;
    }

    const confirmed = window.confirm("베스트리포트 제출을 마감하고 선택한 평가자에게 평가 페이지를 오픈하시겠습니까?");
    if (!confirmed) return;

    setSaving(true);
    const saveResult = await saveTeamLeadReviewerRoles(linkedSelectedIds);
    const result = saveResult.ok ? await closeTeamLeadSubmissionAndOpenReviewAccess() : saveResult;
    setSaving(false);

    if (!result.ok) {
      setMessage({ tone: "warn", text: result.message });
      return;
    }

    await refreshTeamLeadSubmissionAccessState();
    setSubmissionOpen(result.isOpen);
    await refresh();
    setMessage({
      tone: missingNames.length > 0 ? "note" : "ok",
      text: `${result.message}${missingNames.length > 0 ? ` 연결된 계정이 없는 이름은 제외했습니다: ${missingNames.join(", ")}` : ""}`,
    });
  };

  const handleCancelSubmissionOpen = async () => {
    const confirmed = window.confirm("베스트리포트 제출 오픈을 취소하고 제출 페이지를 닫으시겠습니까?");
    if (!confirmed) return;

    setSaving(true);
    const result = await setTeamLeadSubmissionAccessOpen(false);
    setSaving(false);

    if (!result.ok) {
      setMessage({ tone: "warn", text: result.message });
      return;
    }

    await refreshTeamLeadSubmissionAccessState();
    setSubmissionOpen(result.isOpen);
    setMessage({ tone: "ok", text: "베스트리포트 제출 오픈을 취소했습니다." });
  };

  const handleCancelReviewOpen = async () => {
    const confirmed = window.confirm("영상평가 평가자 오픈을 닫으시겠습니까? 저장된 평가 데이터는 삭제되지 않습니다.");
    if (!confirmed) return;

    setSaving(true);
    const result = await closeTeamLeadReviewAccess();
    setSaving(false);

    if (!result.ok) {
      setMessage({ tone: "warn", text: result.message });
      return;
    }

    await refresh();
    setActiveReviewerCount(0);
    setMessage({ tone: "ok", text: result.message });
  };

  const handleCloseEvaluation = async () => {
    if (activeReviewerCount === 0) {
      setMessage({ tone: "note", text: "현재 오픈된 평가 페이지가 없습니다." });
      return;
    }

    const confirmed = window.confirm("현재 베스트리포트 평가 결과를 분기 저장하고 평가 페이지를 닫으시겠습니까?");
    if (!confirmed) return;

    setSaving(true);
    const result = await saveCurrentBestReportResultsAsNextQuarter();
    setSaving(false);

    if (!result.ok) {
      setMessage({ tone: "warn", text: result.message });
      return;
    }

    await refresh();
    setSelectedNames([]);
    setActiveReviewerCount(0);
    setMessage({ tone: "ok", text: `${result.message} 평가 페이지를 닫았습니다.` });
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
          <div className="kpi-label">평가 오픈</div>
          <div className="kpi-value">{summary.activeReviewers}</div>
        </article>
      </section>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">영상평가 관리</div>
          <strong style={{ fontSize: 24 }}>영상평가 권한 관리</strong>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {submissionOpen ? (
              <>
                <button type="button" className="btn white" onClick={handleCancelSubmissionOpen} disabled={saving}>
                  오픈중 · 다시 누르면 취소
                </button>
                <button type="button" className="btn" onClick={() => router.push("/submissions")} disabled={saving}>
                  제출 페이지 열기
                </button>
                <button type="button" className="btn" onClick={handleCloseSubmissions} disabled={saving}>
                  제출 마감
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={handleOpenSubmissions}
                disabled={saving}
              >
                베스트리포트 제출 오픈
              </button>
            )}
            <button type="button" className="btn" onClick={handleAssignReviewers} disabled={saving || selectedNames.length === 0}>
              평가자 지정
            </button>
            {activeReviewerCount > 0 ? (
              <button type="button" className="btn white" onClick={handleCancelReviewOpen} disabled={saving}>
                평가 오픈중 · 다시 누르면 닫기
              </button>
            ) : null}
            <button type="button" className="btn" onClick={handleCloseEvaluation} disabled={saving || activeReviewerCount === 0}>
              평가 마감
            </button>
            <button type="button" className="btn" onClick={() => setEditingNames((current) => !current)}>
              {editingNames ? "수정 완료" : "수정"}
            </button>
          </div>

          {editingNames ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="field-input"
                style={{ width: 240 }}
                placeholder="이름 추가"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddName();
                  }
                }}
              />
              <button type="button" className="btn" onClick={handleAddName}>
                인원 추가
              </button>
            </div>
          ) : null}

          <section style={{ display: "grid", gap: 10 }}>
            <div className="chip">선택된 평가자</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start" }}>
              {selectedDisplayNames.length > 0 ? (
                selectedDisplayNames.map((name) => (
                  <button
                    key={`selected-${name}`}
                    type="button"
                    className="btn"
                    title={profileByName.has(name) ? name : `${name} 연결된 계정 없음`}
                    onClick={() => toggleName(name)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      lineHeight: 1.2,
                      borderColor: "rgba(250,204,21,.52)",
                      background: "rgba(250,204,21,.2)",
                      color: "#fff1bf",
                    }}
                  >
                    {name}
                  </button>
                ))
              ) : (
                <span className="muted">선택된 평가자가 없습니다.</span>
              )}
            </div>
          </section>

          <section style={{ display: "grid", gap: 10 }}>
            <div className="chip">전체 인원</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {visibleNameChips.length > 0 ? (
                visibleNameChips.map(({ name, custom, selected, profile }) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      padding: editingNames ? "4px 6px 4px 4px" : 0,
                      borderRadius: 999,
                      border: editingNames ? "1px solid rgba(255,255,255,.08)" : "none",
                      background: editingNames ? "rgba(255,255,255,.03)" : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      title={profile ? `${name} · ${getProfileRoleLabel(profile.role)}` : `${name} 연결된 계정 없음`}
                      onClick={() => toggleName(name)}
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        lineHeight: 1.2,
                        borderColor: selected ? "rgba(250,204,21,.52)" : undefined,
                        background: selected ? "rgba(250,204,21,.2)" : undefined,
                        color: selected ? "#fff1bf" : undefined,
                      }}
                    >
                      {name}
                      {profile?.role === "outlet" ? " · 출입처" : null}
                    </button>
                    {editingNames && custom ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleDeleteName(name)}
                        aria-label={`${name} 삭제`}
                        style={{
                          minWidth: 30,
                          width: 30,
                          height: 30,
                          padding: 0,
                          borderRadius: 999,
                          fontSize: 18,
                          lineHeight: 1,
                        }}
                      >
                        -
                      </button>
                    ) : null}
                  </div>
                ))
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
