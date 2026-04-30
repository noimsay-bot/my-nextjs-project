"use client";

import { useEffect, useMemo, useState } from "react";
import { useTeamLeadEvaluationYear } from "@/components/team-lead/use-team-lead-evaluation-year";
import {
  getTeamLeadReferenceNotesWorkspace,
  saveTeamLeadReferenceNotes,
  TeamLeadReferenceNoteCard,
  TeamLeadReferenceNoteItem,
} from "@/lib/team-lead/storage";

function createEmptyReferenceItem(): TeamLeadReferenceNoteItem {
  return {
    id: crypto.randomUUID(),
    text: "",
  };
}

function serializeReferenceItems(items: TeamLeadReferenceNoteItem[]) {
  return items.map((item) => item.text.trim()).filter(Boolean).join("\n");
}

function getRoleLabel(role: TeamLeadReferenceNoteCard["role"]) {
  if (role === "reviewer") return "평가자";
  if (role === "outlet") return "출입처";
  if (role === "desk") return "데스크";
  if (role === "admin") return "관리자";
  return "팀원";
}

export function ReferenceNotesPage() {
  const evaluationYear = useTeamLeadEvaluationYear();
  const [cards, setCards] = useState<TeamLeadReferenceNoteCard[]>([]);
  const [draftItems, setDraftItems] = useState<Record<string, TeamLeadReferenceNoteItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const workspace = await getTeamLeadReferenceNotesWorkspace(evaluationYear);
      setCards(workspace.cards);
      setDraftItems(
        Object.fromEntries(
          workspace.cards.map((card) => [
            card.profileId,
            card.items.length > 0 ? card.items.map((item) => ({ ...item })) : [],
          ]),
        ),
      );
      setMessage(null);
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "참고사항을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [evaluationYear]);

  const cardsWithDrafts = useMemo(
    () =>
      cards.map((card) => {
        const items = draftItems[card.profileId] ?? [];
        return {
          ...card,
          draftItems: items,
          dirty: serializeReferenceItems(items) !== serializeReferenceItems(card.items),
        };
      }),
    [cards, draftItems],
  );

  const updateItem = (profileId: string, itemId: string, text: string) => {
    setDraftItems((current) => ({
      ...current,
      [profileId]: (current[profileId] ?? []).map((item) =>
        item.id === itemId ? { ...item, text } : item,
      ),
    }));
  };

  const addItem = (profileId: string) => {
    setDraftItems((current) => ({
      ...current,
      [profileId]: [...(current[profileId] ?? [createEmptyReferenceItem()]), createEmptyReferenceItem()],
    }));
  };

  const removeItem = (profileId: string, itemId: string) => {
    const ok = window.confirm("삭제하시겠습니까?");
    if (!ok) return;

    setDraftItems((current) => {
      const nextItems = (current[profileId] ?? []).filter((item) => item.id !== itemId);
      return {
        ...current,
        [profileId]: nextItems,
      };
    });
  };

  const saveCard = async (profileId: string) => {
    setSavingProfileId(profileId);
    const result = await saveTeamLeadReferenceNotes(profileId, draftItems[profileId] ?? [], evaluationYear);
    setMessage({
      tone: result.ok ? "ok" : "warn",
      text: result.message,
    });
    if (result.ok) {
      await refresh();
    }
    setSavingProfileId("");
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip">참고사항</div>
          <strong style={{ fontSize: 24 }}>참고사항</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            {evaluationYear - 1}년 12월 ~ {evaluationYear}년 11월 기준
          </span>
          <div className="status note">팀장 평가 대상 기준 사람카드입니다. 옵저버는 참고사항과 점수 관리 대상에서 제외됩니다.</div>
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
        </div>
      </article>

      <section
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "start",
        }}
      >
        {cardsWithDrafts.length > 0 ? (
          cardsWithDrafts.map((card) => (
            <article key={card.profileId} className="panel" style={{ alignSelf: "start" }}>
              <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 20 }}>{card.name}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{getRoleLabel(card.role)}</span>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {card.draftItems.length > 0 ? (
                    card.draftItems.map((item, index) => (
                      <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          className="field-input"
                          placeholder={`항목 ${index + 1}`}
                          value={item.text}
                          onChange={(event) => updateItem(card.profileId, item.id, event.target.value)}
                        />
                        <button
                          type="button"
                          className="btn"
                          onClick={() => removeItem(card.profileId, item.id)}
                          style={{
                            minWidth: 34,
                            width: 34,
                            height: 34,
                            padding: 0,
                            fontSize: 11,
                            lineHeight: 1,
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="muted" style={{ fontSize: 13 }}>추가된 항목이 없습니다.</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => addItem(card.profileId)}>
                    항목 추가
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!card.dirty || savingProfileId === card.profileId}
                    onClick={() => {
                      void saveCard(card.profileId);
                    }}
                  >
                    {savingProfileId === card.profileId ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="status note">{loading ? "불러오는 중입니다." : "표시할 참고사항 카드가 없습니다."}</div>
        )}
      </section>
    </section>
  );
}
