"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getTeamLeadReviewerRoleWorkspace,
  ReviewerRoleProfileItem,
  saveTeamLeadReviewerRoles,
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

export function ReviewerRolePage() {
  const [profiles, setProfiles] = useState<ReviewerRoleProfileItem[]>([]);
  const [nameChips, setNameChips] = useState<string[]>(DEFAULT_REVIEWER_NAME_CHIPS);
  const [savedSelectedNames, setSavedSelectedNames] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [editingNames, setEditingNames] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      const grantedReviewerNames = workspace.profiles
        .filter((profile) => workspace.grantedProfileIds.includes(profile.id))
        .map((profile) => profile.name);

      setProfiles(workspace.profiles);
      const sortedGrantedReviewerNames = normalizeNames(grantedReviewerNames).sort((left, right) => {
        const leftRank = nameChipOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = nameChipOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.localeCompare(right, "ko");
      });
      setSavedSelectedNames(sortedGrantedReviewerNames);
      setSelectedNames((current) => {
        const currentMissing = current.filter((name) => !workspace.profiles.some((profile) => profile.name === name));
        return normalizeNames([...sortedGrantedReviewerNames, ...currentMissing]).sort((left, right) => {
          const leftRank = nameChipOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
          const rightRank = nameChipOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
          if (leftRank !== rightRank) return leftRank - rightRank;
          return left.localeCompare(right, "ko");
        });
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
  }, [nameChipOrder]);

  useEffect(() => {
    writeNameChips(nameChips);
  }, [nameChips]);

  const selectedNameSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const initialSelectedNames = useMemo(
    () => [...savedSelectedNames].sort((left, right) => left.localeCompare(right, "ko")),
    [savedSelectedNames],
  );
  const draftSelectedNames = useMemo(() => [...selectedNames].sort((left, right) => left.localeCompare(right, "ko")), [selectedNames]);
  const dirty = initialSelectedNames.join(",") !== draftSelectedNames.join(",");

  const summary = useMemo(
    () => ({
      total: nameChips.length,
      reviewers: selectedNames.length,
      members: Math.max(nameChips.length - selectedNames.length, 0),
    }),
    [nameChips.length, selectedNames.length],
  );

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
    () =>
      nameChips.map((name) => ({
        name,
        selected: selectedNameSet.has(name),
        linked: profileByName.has(name),
      })),
    [nameChips, profileByName, selectedNameSet],
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
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn" onClick={() => setEditingNames((current) => !current)}>
              {editingNames ? "수정 완료" : "수정"}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || saving || loading}
              onClick={async () => {
                setSaving(true);
                const linkedSelectedIds = selectedNames
                  .map((name) => profileByName.get(name)?.id ?? null)
                  .filter((id): id is string => Boolean(id));
                const missingNames = selectedNames.filter((name) => !profileByName.has(name));
                const result = await saveTeamLeadReviewerRoles(linkedSelectedIds);
                const suffix = missingNames.length > 0
                  ? ` 연결된 계정이 없는 이름은 화면에서만 유지됩니다: ${missingNames.join(", ")}`
                  : "";
                setMessage({
                  tone: result.ok ? (missingNames.length > 0 ? "note" : "ok") : "warn",
                  text: `${result.message}${suffix}`,
                });
                if (result.ok) {
                  await refresh();
                }
                setSaving(false);
              }}
            >
              저장
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
                visibleNameChips.map(({ name, selected, linked }) => (
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
                      title={linked ? name : `${name} 연결된 계정 없음`}
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
                    </button>
                    {editingNames ? (
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
