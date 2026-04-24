"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSession, hasDeskAccess, isReadOnlyPortalRole, subscribeToAuth } from "@/lib/auth/storage";
import {
  CommunityBoardCategory,
  CommunityBoardAttachment,
  CommunityBoardComment,
  CommunityBoardPost,
  deleteCommunityBoardPost,
  deleteHomeDday,
  deleteHomeNotice,
  getCommunityBoardComments,
  getCommunityBoardPosts,
  getHomeDdays,
  getHomeNotices,
  HOME_POPUP_NOTICE_EVENT,
  refreshHomePopupNoticeWorkspace,
  saveHomeDday,
  saveCommunityBoardComment,
  saveCommunityBoardPost,
  updateCommunityBoardPost,
  updateHomeNotice,
  type HomeDdayItem,
  type HomeNotice,
} from "@/lib/home-popup/storage";

const COMMUNITY_CATEGORIES: CommunityBoardCategory[] = ["notice", "family", "celebration", "resource"];
const BOARD_PAGE_SIZE = 5;

const communityCategoryLabels: Record<CommunityBoardCategory, string> = {
  notice: "공지",
  family: "경조사",
  celebration: "축하합니다",
  resource: "자료실",
};

type CommunityListItem =
  | {
      id: string;
      source: "notice";
      category: "notice";
      title: string;
      body: string;
      authorName: string;
      createdAt: string;
      updatedAt: string;
      tone: HomeNotice["tone"];
      kind: HomeNotice["kind"];
      isActive: boolean;
      applicationEnabled: boolean;
    }
  | {
      id: string;
      source: "manual";
      category: CommunityBoardCategory;
      title: string;
      body: string;
      authorId: string;
      authorName: string;
      attachment?: CommunityBoardAttachment | null;
      createdAt: string;
      updatedAt: string;
    };

type CommunityEditorState = {
  mode: "create" | "edit";
  category: CommunityBoardCategory;
  item: CommunityListItem | null;
};

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function toAutomaticNoticeItem(notice: HomeNotice): CommunityListItem {
  return {
    id: `notice:${notice.id}`,
    source: "notice",
    category: "notice",
    title: notice.title,
    body: notice.body,
    authorName: "DESK",
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
    tone: notice.tone,
    kind: notice.kind,
    isActive: notice.isActive,
    applicationEnabled: notice.applicationEnabled,
  };
}

function toManualPostItem(post: CommunityBoardPost): CommunityListItem {
  return {
    id: `manual:${post.id}`,
    source: "manual",
    category: post.category,
    title: post.title,
    body: post.body,
    authorId: post.authorId,
    authorName: post.authorName,
    attachment: post.attachment ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

async function readFileAsAttachment(file: File): Promise<CommunityBoardAttachment> {
  if (file.size > 6 * 1024 * 1024) {
    throw new Error("첨부 파일은 6MB 이내로 업로드해 주세요.");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("파일을 읽지 못했습니다."));
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });

  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    dataUrl,
  };
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }
  return `${sizeBytes}B`;
}

function getToneBadgeStyle(tone: HomeNotice["tone"]) {
  if (tone === "urgent") {
    return {
      border: "1px solid rgba(248,113,113,.34)",
      background: "rgba(127,29,29,.18)",
      color: "#fee2e2",
    };
  }

  return {
    border: "1px solid rgba(74,222,128,.26)",
    background: "rgba(20,83,45,.16)",
    color: "#dcfce7",
  };
}

export default function HomeNoticeBoardPage() {
  const [session, setSession] = useState(() => getSession());
  const [notices, setNotices] = useState<HomeNotice[]>(() => getHomeNotices());
  const [ddays, setDdays] = useState<HomeDdayItem[]>(() => getHomeDdays());
  const [communityPosts, setCommunityPosts] = useState<CommunityBoardPost[]>(() => getCommunityBoardPosts());
  const [communityComments, setCommunityComments] = useState<CommunityBoardComment[]>(() => getCommunityBoardComments());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ddayTitle, setDdayTitle] = useState("");
  const [ddayTargetDate, setDdayTargetDate] = useState("");
  const [attachment, setAttachment] = useState<CommunityBoardAttachment | null>(null);
  const [editor, setEditor] = useState<CommunityEditorState | null>(null);
  const [pageByCategory, setPageByCategory] = useState<Record<CommunityBoardCategory, number>>({
    notice: 1,
    family: 1,
    celebration: 1,
    resource: 1,
  });
  const [saving, setSaving] = useState(false);
  const [ddaySaving, setDdaySaving] = useState(false);
  const [deletingDdayId, setDeletingDdayId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [commentDraftByTarget, setCommentDraftByTarget] = useState<Record<string, string>>({});
  const [commentSavingTargetKey, setCommentSavingTargetKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const canManageNotices = Boolean(session?.approved && hasDeskAccess(session.role));
  const isReadOnlyUser = Boolean(session?.approved && isReadOnlyPortalRole(session.role));
  const canWrite = Boolean(session?.approved && !isReadOnlyUser);

  const syncFromCache = useCallback(() => {
    setNotices(getHomeNotices());
    setDdays(getHomeDdays());
    setCommunityPosts(getCommunityBoardPosts());
    setCommunityComments(getCommunityBoardComments());
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      await refreshHomePopupNoticeWorkspace({ includeTrips: false });
      syncFromCache();
      setMessage(null);
    } catch (error) {
      setMessage({
        tone: "warn",
        text: error instanceof Error ? error.message : "커뮤니티 데이터를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, [syncFromCache]);

  useEffect(() => {
    if (session?.approved) {
      void loadWorkspace();
    } else if (session) {
      // 세션은 있으나 승인되지 않은 경우 로딩을 멈추고 빈 목록을 표시
      setLoading(false);
    }
  }, [loadWorkspace, session?.approved, session]);

  useEffect(() => {
    const onFocus = () => void loadWorkspace();
    const onStorageUpdate = () => syncFromCache();

    window.addEventListener("focus", onFocus);
    window.addEventListener(HOME_POPUP_NOTICE_EVENT, onStorageUpdate);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(HOME_POPUP_NOTICE_EVENT, onStorageUpdate);
    };
  }, [loadWorkspace, syncFromCache]);

  useEffect(() => {
    return subscribeToAuth((nextSession) => {
      setSession(nextSession);
    });
  }, []);

  const boardItemsByCategory = useMemo<Record<CommunityBoardCategory, CommunityListItem[]>>(() => {
    const autoNoticeItems = notices
      .filter((n) => !n.id.startsWith("shadow:"))
      .map(toAutomaticNoticeItem);
    const manualItems = communityPosts.map(toManualPostItem);
    return {
      notice: [...autoNoticeItems, ...manualItems.filter((item) => item.category === "notice")].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
      family: manualItems.filter((item) => item.category === "family"),
      celebration: manualItems.filter((item) => item.category === "celebration"),
      resource: manualItems.filter((item) => item.category === "resource"),
    };
  }, [communityPosts, notices]);

  const filteredBoardItemsByCategory = useMemo<Record<CommunityBoardCategory, CommunityListItem[]>>(() => {
    const keyword = query.trim().toLowerCase();
    const filterBoard = (items: CommunityListItem[]) =>
      items.filter((item) => {
        if (!keyword) return true;
        return [item.title, item.body, item.authorName].join(" ").toLowerCase().includes(keyword);
      });

    return {
      notice: filterBoard(boardItemsByCategory.notice),
      family: filterBoard(boardItemsByCategory.family),
      celebration: filterBoard(boardItemsByCategory.celebration),
      resource: filterBoard(boardItemsByCategory.resource),
    };
  }, [boardItemsByCategory, query]);

  const categoryCounts = useMemo(
    () => ({
      notice: boardItemsByCategory.notice.length,
      family: boardItemsByCategory.family.length,
      celebration: boardItemsByCategory.celebration.length,
      resource: boardItemsByCategory.resource.length,
    }),
    [boardItemsByCategory],
  );

  const pageCountByCategory = useMemo<Record<CommunityBoardCategory, number>>(
    () => ({
      notice: Math.max(1, Math.ceil(filteredBoardItemsByCategory.notice.length / BOARD_PAGE_SIZE)),
      family: Math.max(1, Math.ceil(filteredBoardItemsByCategory.family.length / BOARD_PAGE_SIZE)),
      celebration: Math.max(1, Math.ceil(filteredBoardItemsByCategory.celebration.length / BOARD_PAGE_SIZE)),
      resource: Math.max(1, Math.ceil(filteredBoardItemsByCategory.resource.length / BOARD_PAGE_SIZE)),
    }),
    [filteredBoardItemsByCategory],
  );

  const pagedBoardItemsByCategory = useMemo<Record<CommunityBoardCategory, CommunityListItem[]>>(
    () => ({
      notice: filteredBoardItemsByCategory.notice.slice((pageByCategory.notice - 1) * BOARD_PAGE_SIZE, pageByCategory.notice * BOARD_PAGE_SIZE),
      family: filteredBoardItemsByCategory.family.slice((pageByCategory.family - 1) * BOARD_PAGE_SIZE, pageByCategory.family * BOARD_PAGE_SIZE),
      celebration: filteredBoardItemsByCategory.celebration.slice(
        (pageByCategory.celebration - 1) * BOARD_PAGE_SIZE,
        pageByCategory.celebration * BOARD_PAGE_SIZE,
      ),
      resource: filteredBoardItemsByCategory.resource.slice((pageByCategory.resource - 1) * BOARD_PAGE_SIZE, pageByCategory.resource * BOARD_PAGE_SIZE),
    }),
    [filteredBoardItemsByCategory, pageByCategory],
  );

  const commentsByTarget = useMemo(() => {
    return communityComments.reduce<Record<string, CommunityBoardComment[]>>((acc, comment) => {
      const current = acc[comment.targetKey] ?? [];
      acc[comment.targetKey] = [...current, comment];
      return acc;
    }, {});
  }, [communityComments]);

  useEffect(() => {
    setPageByCategory((current) => ({
      notice: Math.min(current.notice, pageCountByCategory.notice),
      family: Math.min(current.family, pageCountByCategory.family),
      celebration: Math.min(current.celebration, pageCountByCategory.celebration),
      resource: Math.min(current.resource, pageCountByCategory.resource),
    }));
  }, [pageCountByCategory]);

  const resetEditor = useCallback(() => {
    setEditor(null);
    setTitle("");
    setBody("");
    setAttachment(null);
  }, []);

  const resetDdayEditor = useCallback(() => {
    setDdayTitle("");
    setDdayTargetDate("");
  }, []);

  const startCreate = useCallback((category: CommunityBoardCategory) => {
    setEditor({ mode: "create", category, item: null });
    setTitle("");
    setBody("");
    setAttachment(null);
    setMessage(null);
  }, []);

  const startEdit = useCallback((item: CommunityListItem) => {
    setEditor({ mode: "edit", category: item.category, item });
    setTitle(item.title);
    setBody(item.body);
    setAttachment(item.source === "manual" ? item.attachment ?? null : null);
    setExpandedItemId(item.id);
    setMessage(null);
  }, []);

  const canEditItem = useCallback((item: CommunityListItem) => {
    if (isReadOnlyUser) return false;
    if (item.source === "notice" || item.category === "notice") {
      return canManageNotices;
    }
    return Boolean(session?.approved && (hasDeskAccess(session.role) || item.authorId === session.id));
  }, [canManageNotices, isReadOnlyUser, session]);

  const canDeleteItem = useCallback((item: CommunityListItem) => {
    if (isReadOnlyUser) return false;
    if (item.source === "notice" || item.category === "notice") {
      return canManageNotices;
    }
    return Boolean(session?.approved && (hasDeskAccess(session.role) || item.authorId === session.id));
  }, [canManageNotices, isReadOnlyUser, session]);

  const canCreateInCategory = useCallback((category: CommunityBoardCategory) => {
    return category === "notice" ? canManageNotices : canWrite;
  }, [canManageNotices, canWrite]);

  const getBoardHelpText = useCallback((category: CommunityBoardCategory) => {
    return category === "notice"
      ? "공지 게시판의 쓰기, 수정, 삭제는 DESK와 팀장 권한자만 가능합니다."
      : isReadOnlyUser
        ? "Advisor와 Observer는 게시글과 댓글을 조회만 할 수 있습니다."
        : "승인된 멤버는 글을 쓰고 자기 글을 수정하거나 삭제할 수 있습니다.";
  }, [isReadOnlyUser]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div className="chip">커뮤니티</div>
                <span className="muted">전체 글 {Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}건</span>
              </div>
              <strong style={{ fontSize: 24, lineHeight: 1.2 }}>커뮤니티</strong>
              <span className="muted">공지, 경조사, 축하합니다, 자료실 게시판을 한 화면에서 함께 봅니다.</span>
            </div>
            <input
              className="field-input"
              style={{ width: 280, maxWidth: "100%" }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="제목, 내용, 작성자 검색"
            />
          </div>

          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {isReadOnlyUser ? <div className="status note">현재 계정은 조회 전용입니다. 글 작성, 수정, 삭제, 댓글 등록은 할 수 없습니다.</div> : null}
        </div>
      </section>

      <section className="panel">
        <div
          className="panel-pad community-board-grid"
        >
          {COMMUNITY_CATEGORIES.map((category) => {
            const items = pagedBoardItemsByCategory[category];
            const pageCount = pageCountByCategory[category];
            const currentPage = pageByCategory[category];
            const canCreate = canCreateInCategory(category);
            const isEditingThisCategory = editor?.category === category;

            return (
              <section
                key={category}
                style={{
                  display: "grid",
                  gap: 14,
                  minHeight: 420,
                  padding: 18,
                  borderRadius: 20,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: "rgba(255,255,255,.03)",
                  alignContent: "start",
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 20, lineHeight: 1.2 }}>{communityCategoryLabels[category]}</strong>
                      <span className="chip">{categoryCounts[category]}</span>
                    </div>
                    {canCreate ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => startCreate(category)}
                        disabled={saving && isEditingThisCategory}
                      >
                        글쓰기
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>읽기 전용</span>
                    )}
                  </div>
                  <span className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>{getBoardHelpText(category)}</span>
                </div>

                {isEditingThisCategory ? (
                  <section
                    style={{
                      display: "grid",
                      gap: 12,
                      padding: 14,
                      borderRadius: 18,
                      border: "1px solid rgba(255,255,255,.08)",
                      background: "rgba(255,255,255,.03)",
                    }}
                  >
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong>
                        {editor.mode === "edit"
                          ? `${communityCategoryLabels[category]} 글 수정`
                          : `${communityCategoryLabels[category]} 글쓰기`}
                      </strong>
                      <span className="muted" style={{ fontSize: 13 }}>
                        {category === "notice"
                          ? "데스크 공지는 이 게시판에 자동으로 함께 표시됩니다. 직접 올리는 공지도 같이 누적됩니다."
                          : "현재 게시판에 새 글을 등록합니다."}
                      </span>
                    </div>
                    <input
                      className="field-input"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="제목"
                    />
                    <textarea
                      className="field-textarea"
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      placeholder="내용"
                    />
                    {category === "notice" ? (
                      <section
                        style={{
                          display: "grid",
                          gap: 12,
                          padding: 12,
                          borderRadius: 16,
                          border: "1px solid rgba(255,255,255,.08)",
                          background: "rgba(255,255,255,.025)",
                        }}
                      >
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong style={{ fontSize: 14 }}>홈 디데이</strong>
                          <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                            홈 뉴스 상단 우측에 노출됩니다. 이름과 목표 날짜를 정해 최대 3개까지 등록할 수 있습니다.
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 10,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <input
                            className="field-input"
                            style={{ flex: "1 1 220px" }}
                            value={ddayTitle}
                            onChange={(event) => setDdayTitle(event.target.value)}
                            placeholder="예: 창립기념행사"
                            disabled={ddaySaving || ddays.length >= 3}
                          />
                          <input
                            className="field-input"
                            type="date"
                            style={{ flex: "1 1 180px" }}
                            value={ddayTargetDate}
                            onChange={(event) => setDdayTargetDate(event.target.value)}
                            disabled={ddaySaving || ddays.length >= 3}
                          />
                          <button
                            type="button"
                            className="btn white"
                            disabled={ddaySaving || ddays.length >= 3}
                            onClick={async () => {
                              setDdaySaving(true);
                              try {
                                await saveHomeDday({ title: ddayTitle, targetDate: ddayTargetDate });
                                syncFromCache();
                                resetDdayEditor();
                                setMessage({ tone: "ok", text: "디데이를 등록했습니다." });
                              } catch (error) {
                                setMessage({
                                  tone: "warn",
                                  text: error instanceof Error ? error.message : "디데이를 등록하지 못했습니다.",
                                });
                              } finally {
                                setDdaySaving(false);
                              }
                            }}
                          >
                            {ddaySaving ? "등록 중..." : "디데이 생성"}
                          </button>
                        </div>
                        <span className="muted" style={{ fontSize: 12 }}>
                          등록됨 {ddays.length}/3
                        </span>
                        {ddays.length > 0 ? (
                          <div style={{ display: "grid", gap: 8 }}>
                            {ddays.map((dday) => (
                              <div
                                key={dday.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  padding: "10px 12px",
                                  borderRadius: 14,
                                  border: "1px solid rgba(255,255,255,.08)",
                                  background: "rgba(255,255,255,.04)",
                                }}
                              >
                                <div style={{ display: "grid", gap: 4 }}>
                                  <strong style={{ fontSize: 13 }}>{dday.title}</strong>
                                  <span className="muted" style={{ fontSize: 12 }}>{dday.targetDate}</span>
                                </div>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={deletingDdayId === dday.id}
                                  onClick={async () => {
                                    setDeletingDdayId(dday.id);
                                    try {
                                      await deleteHomeDday(dday.id);
                                      syncFromCache();
                                      setMessage({ tone: "ok", text: "디데이를 삭제했습니다." });
                                    } catch (error) {
                                      setMessage({
                                        tone: "warn",
                                        text: error instanceof Error ? error.message : "디데이를 삭제하지 못했습니다.",
                                      });
                                    } finally {
                                      setDeletingDdayId(null);
                                    }
                                  }}
                                >
                                  {deletingDdayId === dday.id ? "삭제 중..." : "삭제"}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>
                            아직 등록된 디데이가 없습니다.
                          </span>
                        )}
                      </section>
                    ) : null}
                    {category === "resource" ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <label style={{ display: "grid", gap: 8 }}>
                          <span>첨부 문서</span>
                          <input
                            className="field-input"
                            type="file"
                            onChange={(event) => {
                              const nextFile = event.target.files?.[0] ?? null;
                              if (!nextFile) return;
                              void readFileAsAttachment(nextFile)
                                .then((nextAttachment) => {
                                  setAttachment(nextAttachment);
                                  setMessage(null);
                                })
                                .catch((error) => {
                                  setMessage({
                                    tone: "warn",
                                    text: error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
                                  });
                                })
                                .finally(() => {
                                  event.currentTarget.value = "";
                                });
                            }}
                            disabled={saving}
                          />
                        </label>
                        {attachment ? (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "center",
                              flexWrap: "wrap",
                              padding: "10px 12px",
                              borderRadius: 14,
                              border: "1px solid rgba(255,255,255,.08)",
                              background: "rgba(255,255,255,.04)",
                            }}
                          >
                            <div style={{ display: "grid", gap: 4 }}>
                              <strong style={{ fontSize: 13 }}>{attachment.fileName}</strong>
                              <span className="muted" style={{ fontSize: 12 }}>{formatFileSize(attachment.sizeBytes)}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <a className="btn white" href={attachment.dataUrl} download={attachment.fileName}>
                                다운로드 확인
                              </a>
                              <button type="button" className="btn" onClick={() => setAttachment(null)} disabled={saving}>
                                첨부 제거
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>
                            자료실 글에는 문서 파일을 하나 첨부할 수 있습니다.
                          </span>
                        )}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={resetEditor} disabled={saving}>
                        취소
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={saving}
                        onClick={async () => {
                          setSaving(true);
                          try {
                            if (editor.mode === "edit" && editor.item) {
                              if (editor.item.source === "notice") {
                                await updateHomeNotice({
                                  noticeId: editor.item.id.replace("notice:", ""),
                                  title,
                                  body,
                                });
                              } else {
                              await updateCommunityBoardPost({
                                postId: editor.item.id.replace("manual:", ""),
                                title,
                                body,
                                attachment: category === "resource" ? attachment : null,
                              });
                            }
                              setMessage({ tone: "ok", text: "글을 수정했습니다." });
                            } else {
                              await saveCommunityBoardPost({
                                category,
                                title,
                                body,
                                attachment: category === "resource" ? attachment : null,
                              });
                              setPageByCategory((current) => ({ ...current, [category]: 1 }));
                              setMessage({ tone: "ok", text: `${communityCategoryLabels[category]} 게시판에 글을 등록했습니다.` });
                            }
                            syncFromCache();
                            resetEditor();
                          } catch (error) {
                            setMessage({
                              tone: "warn",
                              text: error instanceof Error ? error.message : "글을 저장하지 못했습니다.",
                            });
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        {saving
                          ? editor.mode === "edit"
                            ? "수정 중..."
                            : "등록 중..."
                          : editor.mode === "edit"
                            ? "수정 저장"
                            : "글 등록"}
                      </button>
                    </div>
                  </section>
                ) : null}

                {loading ? (
                  <div className="status note">커뮤니티 목록을 불러오는 중입니다.</div>
                ) : items.length > 0 ? (
                  <>
                    <div style={{ display: "grid", gap: 12 }}>
                      {items.map((item) => {
                        const expanded = expandedItemId === item.id;
                        const canEdit = canEditItem(item);
                        const canDelete = canDeleteItem(item);
                        const comments = commentsByTarget[item.id] ?? [];
                        const commentDraft = commentDraftByTarget[item.id] ?? "";

                        return (
                          <article
                            key={item.id}
                            style={{
                              display: "grid",
                              gap: 0,
                              borderRadius: 18,
                              border: "1px solid rgba(255,255,255,.08)",
                              background: "rgba(255,255,255,.03)",
                              overflow: "hidden",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => setExpandedItemId((current) => (current === item.id ? null : item.id))}
                              aria-expanded={expanded}
                              style={{
                                display: "grid",
                                gap: 0,
                                width: "100%",
                                padding: 16,
                                border: 0,
                                background: "transparent",
                                color: "inherit",
                                textAlign: "left",
                                cursor: "pointer",
                              }}
                            >
                              <strong style={{ fontSize: 18, lineHeight: 1.35 }}>{item.title}</strong>
                            </button>

                            {expanded ? (
                              <div style={{ display: "grid", gap: 14, padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                    {item.source === "notice" ? (
                                      <>
                                        <span
                                          style={{
                                            display: "inline-flex",
                                            padding: "5px 10px",
                                            borderRadius: 999,
                                            fontSize: 12,
                                            fontWeight: 800,
                                            ...getToneBadgeStyle(item.tone),
                                          }}
                                        >
                                          {item.tone === "urgent" ? "긴급" : "일반"}
                                        </span>
                                        <span
                                          style={{
                                            display: "inline-flex",
                                            padding: "5px 10px",
                                            borderRadius: 999,
                                            fontSize: 12,
                                            fontWeight: 800,
                                            border: "1px solid rgba(255,255,255,.12)",
                                            background: "rgba(255,255,255,.06)",
                                          }}
                                        >
                                          {item.kind === "popup" ? "데스크 팝업 공지" : "데스크 공지"}
                                        </span>
                                        {item.isActive ? (
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              padding: "5px 10px",
                                              borderRadius: 999,
                                              fontSize: 12,
                                              fontWeight: 800,
                                              border: "1px solid rgba(96,165,250,.32)",
                                              background: "rgba(59,130,246,.18)",
                                              color: "#dbeafe",
                                            }}
                                          >
                                            게시중
                                          </span>
                                        ) : null}
                                      </>
                                    ) : (
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          padding: "5px 10px",
                                          borderRadius: 999,
                                          fontSize: 12,
                                          fontWeight: 800,
                                          border: "1px solid rgba(255,255,255,.12)",
                                          background: "rgba(255,255,255,.06)",
                                        }}
                                      >
                                        일반 글
                                      </span>
                                    )}
                                  </div>
                                  <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(item.updatedAt)}</span>
                                </div>
                                {canEdit || canDelete ? (
                                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                                    {canEdit ? (
                                      <button type="button" className="btn" onClick={() => startEdit(item)}>
                                        수정
                                      </button>
                                    ) : null}
                                    {canDelete ? (
                                      <button
                                        type="button"
                                        className="btn"
                                        disabled={deletingId === item.id}
                                        onClick={async () => {
                                          if (!window.confirm("이 글을 삭제하시겠습니까?")) return;
                                          setDeletingId(item.id);
                                          try {
                                            if (item.source === "notice") {
                                              await deleteHomeNotice(item.id.replace("notice:", ""));
                                            } else {
                                              await deleteCommunityBoardPost(item.id.replace("manual:", ""));
                                            }
                                            syncFromCache();
                                            resetEditor();
                                            setExpandedItemId((current) => (current === item.id ? null : current));
                                            setMessage({ tone: "ok", text: "글을 삭제했습니다." });
                                          } catch (error) {
                                            setMessage({
                                              tone: "warn",
                                              text: error instanceof Error ? error.message : "글을 삭제하지 못했습니다.",
                                            });
                                          } finally {
                                            setDeletingId(null);
                                          }
                                        }}
                                      >
                                        {deletingId === item.id ? "삭제 중..." : "삭제"}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}

                                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "#f8fbff", fontSize: 14 }}>{item.body}</div>
                                {item.source === "manual" && item.category === "resource" && item.attachment ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      alignItems: "center",
                                      flexWrap: "wrap",
                                      padding: "10px 12px",
                                      borderRadius: 14,
                                      border: "1px solid rgba(255,255,255,.08)",
                                      background: "rgba(255,255,255,.04)",
                                    }}
                                  >
                                    <div style={{ display: "grid", gap: 4 }}>
                                      <strong style={{ fontSize: 13 }}>{item.attachment.fileName}</strong>
                                      <span className="muted" style={{ fontSize: 12 }}>{formatFileSize(item.attachment.sizeBytes)}</span>
                                    </div>
                                    <a className="btn white" href={item.attachment.dataUrl} download={item.attachment.fileName}>
                                      다운로드
                                    </a>
                                  </div>
                                ) : null}
                                <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                                  작성 {item.authorName} · 생성 {formatDateTime(item.createdAt)} · 수정 {formatDateTime(item.updatedAt)}
                                </div>

                                <div
                                  style={{
                                    display: "grid",
                                    gap: 12,
                                    paddingTop: 2,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                    <strong style={{ fontSize: 15 }}>댓글 {comments.length}</strong>
                                    {!session?.approved ? (
                                      <span className="muted" style={{ fontSize: 12 }}>승인된 사용자만 댓글을 작성할 수 있습니다.</span>
                                    ) : isReadOnlyUser ? (
                                      <span className="muted" style={{ fontSize: 12 }}>현재 계정은 댓글 조회만 가능합니다.</span>
                                    ) : null}
                                  </div>

                                  {comments.length > 0 ? (
                                    <div style={{ display: "grid", gap: 10 }}>
                                      {comments.map((comment) => (
                                        <div
                                          key={comment.id}
                                          style={{
                                            display: "grid",
                                            gap: 6,
                                            padding: "10px 12px",
                                            borderRadius: 14,
                                            border: "1px solid rgba(255,255,255,.08)",
                                            background: "rgba(255,255,255,.04)",
                                          }}
                                        >
                                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                            <strong style={{ fontSize: 13 }}>{comment.authorName}</strong>
                                            <span className="muted" style={{ fontSize: 11 }}>{formatDateTime(comment.createdAt)}</span>
                                          </div>
                                          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 13 }}>{comment.content}</div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="muted" style={{ fontSize: 13 }}>아직 댓글이 없습니다.</div>
                                  )}

                                  {session?.approved && !isReadOnlyUser ? (
                                    <div style={{ display: "grid", gap: 10 }}>
                                      <textarea
                                        className="field-textarea"
                                        value={commentDraft}
                                        onChange={(event) => {
                                          const nextValue = event.target.value.slice(0, 300);
                                          setCommentDraftByTarget((current) => ({
                                            ...current,
                                            [item.id]: nextValue,
                                          }));
                                        }}
                                        placeholder="댓글을 남겨 주세요."
                                        rows={3}
                                        disabled={commentSavingTargetKey === item.id}
                                      />
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                        <span className="muted" style={{ fontSize: 12 }}>{commentDraft.length}/300</span>
                                        <button
                                          type="button"
                                          className="btn primary"
                                          disabled={commentSavingTargetKey === item.id}
                                          onClick={async () => {
                                            setCommentSavingTargetKey(item.id);
                                            try {
                                              await saveCommunityBoardComment({
                                                targetKey: item.id,
                                                content: commentDraft,
                                              });
                                              setCommentDraftByTarget((current) => ({
                                                ...current,
                                                [item.id]: "",
                                              }));
                                              syncFromCache();
                                              setMessage({ tone: "ok", text: "댓글을 등록했습니다." });
                                            } catch (error) {
                                              setMessage({
                                                tone: "warn",
                                                text: error instanceof Error ? error.message : "댓글을 등록하지 못했습니다.",
                                              });
                                            } finally {
                                              setCommentSavingTargetKey(null);
                                            }
                                          }}
                                        >
                                          {commentSavingTargetKey === item.id ? "등록 중..." : "댓글 등록"}
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>

                    {pageCount > 1 ? (
                      <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                        {Array.from({ length: pageCount }, (_, index) => {
                          const pageNumber = index + 1;
                          const selected = currentPage === pageNumber;
                          return (
                            <button
                              key={`${category}-page-${pageNumber}`}
                              type="button"
                              className={`btn ${selected ? "white" : ""}`}
                              style={{ minWidth: 42 }}
                              onClick={() => {
                                setPageByCategory((current) => ({ ...current, [category]: pageNumber }));
                                setExpandedItemId(null);
                              }}
                            >
                              {pageNumber}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="status note">
                    {query.trim()
                      ? `${communityCategoryLabels[category]} 게시판에서 검색 결과가 없습니다.`
                      : `${communityCategoryLabels[category]} 게시판에 아직 글이 없습니다.`}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
