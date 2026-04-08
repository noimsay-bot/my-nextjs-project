"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  formatNewsBriefingDateTime,
  getNewsBriefingCategoryLabel,
  NEWS_BRIEFING_PRIORITY_LABELS,
  NEWS_BRIEFING_SLOT_LABELS,
} from "@/lib/home-news/admin-types";
import {
  createNewsIssueSetDraft,
  ensureTodayNewsIssueSet,
  lockNewsIssueSet,
  publishNewsIssueSet,
  saveNewsIssueSetItems,
} from "@/lib/home-news/issue-set-actions";
import { getNewsIssueSetWorkspace } from "@/lib/home-news/issue-set-queries";
import { getNewsIssueSetStatusLabel, NewsIssueSetRecord, NewsIssueSetWorkspace } from "@/lib/home-news/issue-set-types";
import { NewsBriefingAdminRecord } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";
import { NewsIssueSetHistory } from "@/components/admin/news/NewsIssueSetHistory";

type NewsIssueSetManagerProps = {
  items: NewsBriefingAdminRecord[];
  onStatus: (tone: "ok" | "warn" | "note", text: string) => void;
};

type AddSelections = Record<HomeNewsBriefingSlot, string>;

const EMPTY_SELECTIONS: AddSelections = {
  morning_6: "",
  afternoon_3: "",
};

function getCurrentIds(issueSet: NewsIssueSetRecord | null) {
  return (issueSet?.items ?? []).map((item) => item.briefing_id);
}

function formatIssueSetSubtext(issueSet: NewsIssueSetRecord | null) {
  if (!issueSet) {
    return "아직 오늘 세트가 없습니다.";
  }

  if (issueSet.status === "draft") {
    return "최대 3개까지 담을 수 있고, 1개나 2개만으로도 발행할 수 있습니다.";
  }

  if (issueSet.status === "published") {
    return "공식 발행 상태입니다. 필요하면 잠금 처리로 고정할 수 있습니다.";
  }

  if (issueSet.status === "locked") {
    return "잠금된 공식 발행본입니다.";
  }

  return "보관된 발행 세트입니다.";
}

function getStatusChipLabel(issueSet: NewsIssueSetRecord | null) {
  return issueSet ? getNewsIssueSetStatusLabel(issueSet.status) : "미생성";
}

export function NewsIssueSetManager({
  items,
  onStatus,
}: NewsIssueSetManagerProps) {
  const [workspace, setWorkspace] = useState<NewsIssueSetWorkspace | null>(null);
  const [addSelections, setAddSelections] = useState<AddSelections>(EMPTY_SELECTIONS);
  const [isWorking, startTransition] = useTransition();

  const refreshWorkspace = async () => {
    try {
      const nextWorkspace = await getNewsIssueSetWorkspace();
      setWorkspace(nextWorkspace);
    } catch (error) {
      onStatus("warn", error instanceof Error ? error.message : "발행 세트 정보를 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  useEffect(() => {
    if (workspace) {
      void refreshWorkspace();
    }
  }, [items]);

  const availableBySlot = useMemo(() => {
    return {
      morning_6: items.filter((item) => item.is_active && item.briefing_slot === "morning_6"),
      afternoon_3: items.filter((item) => item.is_active && item.briefing_slot === "afternoon_3"),
    } satisfies Record<HomeNewsBriefingSlot, NewsBriefingAdminRecord[]>;
  }, [items]);

  const applyResult = (result: Awaited<ReturnType<typeof ensureTodayNewsIssueSet>>) => {
    onStatus(result.ok ? "ok" : "warn", result.message);
    if (result.ok && result.workspace) {
      setWorkspace(result.workspace);
    }
  };

  const handleCreate = (slot: HomeNewsBriefingSlot) => {
    startTransition(() => {
      void (async () => {
        applyResult(await ensureTodayNewsIssueSet(slot));
      })();
    });
  };

  const handleCreateNewDraft = (slot: HomeNewsBriefingSlot) => {
    startTransition(() => {
      void (async () => {
        applyResult(await createNewsIssueSetDraft(slot));
      })();
    });
  };

  const handleSaveIds = (issueSet: NewsIssueSetRecord, nextIds: string[]) => {
    startTransition(() => {
      void (async () => {
        applyResult(await saveNewsIssueSetItems({ issueSetId: issueSet.id, briefingIds: nextIds }));
      })();
    });
  };

  const handlePublish = (issueSet: NewsIssueSetRecord) => {
    startTransition(() => {
      void (async () => {
        applyResult(await publishNewsIssueSet(issueSet.id));
      })();
    });
  };

  const handleLock = (issueSet: NewsIssueSetRecord) => {
    startTransition(() => {
      void (async () => {
        applyResult(await lockNewsIssueSet(issueSet.id));
      })();
    });
  };

  const slotCards = (["morning_6", "afternoon_3"] as const).map((slot) => {
    const issueSet = workspace?.todayBySlot[slot] ?? null;
    const currentIds = getCurrentIds(issueSet);
    const availableOptions = availableBySlot[slot].filter((item) => !currentIds.includes(item.id));

    return (
      <article
        key={slot}
        style={{
          display: "grid",
          gap: 14,
          padding: 18,
          borderRadius: 20,
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,.03)",
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="chip">{NEWS_BRIEFING_SLOT_LABELS[slot]}</span>
              <span className="chip">{workspace?.todayKstDate ?? "-"}</span>
              <span className="chip">{getStatusChipLabel(issueSet)}</span>
            </div>
            {!issueSet ? (
              <button type="button" className="btn primary" disabled={isWorking} onClick={() => handleCreate(slot)}>
                오늘 세트 생성
              </button>
            ) : issueSet.status !== "draft" ? (
              <button type="button" className="btn" disabled={isWorking} onClick={() => handleCreateNewDraft(slot)}>
                새 draft 세트
              </button>
            ) : null}
          </div>

          <strong style={{ fontSize: 20 }}>
            {issueSet?.title ?? `${workspace?.todayKstDate ?? "오늘"} ${NEWS_BRIEFING_SLOT_LABELS[slot]}`}
          </strong>
          <span className="muted">{formatIssueSetSubtext(issueSet)}</span>
          <span className="muted">
            포함 뉴스 {issueSet?.items.length ?? 0}/3 · 발행 시각 {formatNewsBriefingDateTime(issueSet?.published_at)}
          </span>
        </div>

        {issueSet ? (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              {issueSet.items.length > 0 ? (
                issueSet.items.map((entry, index) => (
                  <article
                    key={entry.id}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 14,
                      borderRadius: 16,
                      border: "1px solid var(--line)",
                      background: "rgba(255,255,255,.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="chip">순서 {entry.display_order}</span>
                        {entry.briefing?.category ? (
                          <span className="chip">{getNewsBriefingCategoryLabel(entry.briefing.category)}</span>
                        ) : null}
                        {entry.briefing?.priority ? (
                          <span className="chip">우선순위 {NEWS_BRIEFING_PRIORITY_LABELS[entry.briefing.priority]}</span>
                        ) : null}
                      </div>
                      <span className="muted">실제 시각 {formatNewsBriefingDateTime(entry.briefing?.occurred_at)}</span>
                    </div>

                    <strong style={{ lineHeight: 1.5 }}>{entry.briefing?.title ?? "연결된 뉴스 없음"}</strong>

                    {issueSet.status === "draft" ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={isWorking || index === 0}
                          onClick={() => {
                            const nextIds = currentIds.slice();
                            [nextIds[index - 1], nextIds[index]] = [nextIds[index], nextIds[index - 1]];
                            handleSaveIds(issueSet, nextIds);
                          }}
                        >
                          위로
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={isWorking || index === issueSet.items.length - 1}
                          onClick={() => {
                            const nextIds = currentIds.slice();
                            [nextIds[index], nextIds[index + 1]] = [nextIds[index + 1], nextIds[index]];
                            handleSaveIds(issueSet, nextIds);
                          }}
                        >
                          아래로
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={isWorking}
                          onClick={() => handleSaveIds(issueSet, currentIds.filter((itemId) => itemId !== entry.briefing_id))}
                        >
                          제거
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="status note">아직 연결된 뉴스가 없습니다. 1개나 2개만 담아도 발행할 수 있습니다.</div>
              )}
            </div>

            {issueSet.status === "draft" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className="field-select"
                    value={addSelections[slot]}
                    onChange={(event) =>
                      setAddSelections((current) => ({
                        ...current,
                        [slot]: event.target.value,
                      }))
                    }
                    style={{ minWidth: 220, flex: "1 1 240px" }}
                  >
                    <option value="">세트에 추가할 활성 뉴스 선택</option>
                    {availableOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    disabled={isWorking || currentIds.length >= 3 || !addSelections[slot]}
                    onClick={() => {
                      if (!addSelections[slot]) return;
                      handleSaveIds(issueSet, [...currentIds, addSelections[slot]]);
                      setAddSelections((current) => ({ ...current, [slot]: "" }));
                    }}
                  >
                    세트에 추가
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={isWorking}
                    onClick={() => handlePublish(issueSet)}
                  >
                    발행
                  </button>
                </div>
              </div>
            ) : null}

            {issueSet.status === "published" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={isWorking}
                  onClick={() => handleLock(issueSet)}
                >
                  잠금
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="status note">오늘 이 슬롯의 공식 발행 세트를 아직 만들지 않았습니다.</div>
        )}
      </article>
    );
  });

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="chip">발행 세트 관리</div>
            <strong style={{ fontSize: 20 }}>오늘 오전판 / 오후판 운영</strong>
            <span className="muted">공식 반영본을 따로 관리하는 영역입니다. 홈 노출 구조를 바꾸지 않고, 어떤 세트가 발행됐는지 기록만 남깁니다.</span>
          </div>

          <div className="subgrid-2">
            {slotCards}
          </div>
        </div>
      </article>

      <NewsIssueSetHistory items={workspace?.history ?? []} />
    </section>
  );
}
