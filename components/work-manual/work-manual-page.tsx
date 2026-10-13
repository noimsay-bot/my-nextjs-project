"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getSession } from "@/lib/auth/storage";
import {
  canManageWorkManualWebhards,
  createWorkManualWebhard,
  deleteWorkManualWebhard,
  listWorkManualWebhards,
  updateWorkManualWebhard,
  type WorkManualWebhard,
  type WorkManualWebhardDraft,
} from "@/lib/work-manual/webhards";

type ManualSectionId = "approval-line" | "receipt" | "account" | "webhard";

const MANUAL_SECTIONS: Array<{ id: ManualSectionId; label: string }> = [
  { id: "receipt", label: "실물증빙 입력방법" },
  { id: "account", label: "계정과목 및 부가세" },
  { id: "approval-line", label: "결재선 즐겨찾기" },
  { id: "webhard", label: "웹하드" },
];

const IMAGE_BASE = "/images/work-manual";

const EMPTY_WEBHARD_DRAFT: WorkManualWebhardDraft = {
  title: "",
  login_id: "",
  password: "",
  note: "",
  url: "",
};

function isManualSectionId(value: string): value is ManualSectionId {
  return MANUAL_SECTIONS.some((section) => section.id === value);
}

function ManualImage({ file, alt, maxWidth }: { file: string; alt: string; maxWidth?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${IMAGE_BASE}/${file}`}
      alt={alt}
      loading="lazy"
      style={{
        display: "block",
        width: "100%",
        maxWidth: maxWidth ?? "100%",
        height: "auto",
        border: "1px solid var(--line, #d9dee7)",
        borderRadius: 8,
        background: "#fff",
      }}
    />
  );
}

function ManualStep({ no, title, children }: { no: string; title: ReactNode; children?: ReactNode }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 999,
          background: "var(--accent)",
          color: "#15294a",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {no}
      </span>
      <div style={{ display: "grid", gap: 8, minWidth: 0, overflowWrap: "anywhere" }}>
        <strong style={{ lineHeight: 1.6 }}>{title}</strong>
        {children}
      </div>
    </li>
  );
}

function ManualSteps({ children }: { children: ReactNode }) {
  return <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 18 }}>{children}</ol>;
}

function Example({ children }: { children: ReactNode }) {
  return (
    <div
      className="muted"
      style={{
        fontSize: 13,
        lineHeight: 1.7,
        padding: "8px 12px",
        borderRadius: 8,
        background: "var(--status-note-bg)",
        border: "1px solid var(--line)",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </div>
  );
}

function ApprovalLineSection() {
  return (
    <ManualSteps>
      <ManualStep no="1" title="신제이빌 → 전자결재 → 결재선관리(즐겨찾기)" />
      <ManualStep no="2" title="왼쪽 아래 등록 버튼 클릭">
        <ManualImage file="approval-01-register-button.png" alt="등록 버튼" maxWidth={182} />
      </ManualStep>
      <ManualStep no="3" title="결재선명 지정">
        <ManualImage file="approval-02-line-name.png" alt="결재선명 입력 화면" maxWidth={397} />
      </ManualStep>
      <ManualStep
        no="4"
        title={
          <>
            사원: 파트장 이름 검색 후 더블클릭 → 본부장 이름 검색 후 더블클릭
            <br />
            아래와 같은 화면이 나오면 <u>저장</u> 버튼 클릭
          </>
        }
      >
        <ManualImage file="approval-03-saved-line.png" alt="결재선 등록 완료 화면" maxWidth={804} />
      </ManualStep>
    </ManualSteps>
  );
}

function ReceiptSection() {
  return (
    <ManualSteps>
      <ManualStep no="1" title="신제이빌 접속 → 비용처리 → 실물증빙 → 등록">
        <span className="muted" style={{ fontSize: 13 }}>등록 버튼을 클릭하면 아래와 같은 화면이 나옵니다.</span>
        <ManualImage file="receipt-01-register-dialog.png" alt="실물증빙 등록 화면" maxWidth={938} />
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, lineHeight: 1.7, fontWeight: 400 }}>
          <li>
            <b>증빙일자</b>: 입력한 날짜 또는 영수증 사용한 날짜. 한 달에 한 번씩 입력할 경우 말일 날짜
            <Example>예) 영수증 날짜 2024.05.20 → 증빙일자 2024.05.31</Example>
          </li>
          <li>
            <b>증빙서류</b>: 기타
          </li>
          <li>
            <b>거래처</b>: 본인 이름 (이름 옆에 사번이 나와야 함)
            <div style={{ marginTop: 6 }}>
              <ManualImage file="receipt-02-account.png" alt="거래처와 입금계좌 선택 예시" maxWidth={270} />
            </div>
          </li>
          <li>
            <b>입금계좌</b>: 신협계좌 (신협계좌만 가능하며, 빈 칸으로 나올 경우 경영지원팀 &apos;김태준&apos; 리더에게
            거래처 등록 요청)
          </li>
          <li>
            <b>공급가액</b>: 영수증 총 금액 작성, 부가세는 입력하지 않음
          </li>
          <li>
            <b>비고</b>: &quot;개인카드 사용&quot; 또는 &quot;국내출장비 일비&quot; 라고 적음 (두 가지 경우만 사용)
          </li>
        </ul>
      </ManualStep>
      <ManualStep no="2" title="등록 버튼 클릭">
        <ManualImage file="receipt-03-registered-row.png" alt="등록된 실물증빙 행" maxWidth={1107} />
      </ManualStep>
      <ManualStep no="3" title="위 화면이 나오면 해당 전표를 클릭 → 아래와 같은 화면이 나옴">
        <ManualImage file="receipt-08-voucher-detail.png" alt="전표 상세 입력 화면" maxWidth={1157} />
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, lineHeight: 1.7, fontWeight: 400 }}>
          <li>
            <b>사용/지급요청일자</b>와 <b>회계일자</b>는 동일하게 작성
          </li>
          <li>
            <b>발생부서 및 귀속부서</b>: 영상취재팀 (00017) — 따로 수정할 필요 없음
          </li>
          <li>
            <b>계정과목</b>: 출장일비 → 사)취재비(출장) / 취재비 → 사)취재비(보도) / 부서회의비 → 사)부서회의비
          </li>
          <li>
            <b>부가세구분</b>: X (없음) — 더블클릭하면 선택 화면 창이 나옴
          </li>
          <li>
            <b>적요</b>
            <Example>
              출장비 일비 예) 5.20-21대기환경연구소미세먼지측정(백령도)출장일비_최무룡*2일
              <br />
              형식: 날짜기간_일정(지역)출장일비_이름*일수
              <br />
              개인카드 취재비일 경우: 법인카드 입력 방법과 같음
            </Example>
          </li>
        </ul>
      </ManualStep>
      <ManualStep no="4" title="저장" />
      <ManualStep no="5" title="결재할 작성문서 선택">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontWeight: 400 }}>
          <span>숫자 옆 체크 버튼</span>
          <ManualImage file="receipt-09-checkbox.png" alt="체크 버튼" maxWidth={51} />
          <span>클릭 후 일괄즐겨찾기 클릭 → 지정한 결재선 클릭 후 저장</span>
        </div>
      </ManualStep>
      <ManualStep no="6" title="상신요청 클릭" />
    </ManualSteps>
  );
}

function AccountSection() {
  return (
    <div style={{ display: "grid", gap: 14, lineHeight: 1.7 }}>
      <strong style={{ fontSize: 16 }}>1. 국내출장비</strong>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
        <li>
          <b>일비</b>: CL 일당 30,000원 / EL 50,000원
        </li>
        <li>
          <b>계정과목</b>: 사)취재비(출장)
        </li>
        <li>
          <b>적요</b>
          <Example>
            예) 5.20-21대기환경연구소미세먼지측정(백령도)출장일비_최무룡*2일
            <br />
            출장숙박_최무룡ㅇㅇㅇㅇㅇㅇ (같이 간 오디오맨, 수송부 이름 입력)
            <br />
            출장교통_최무룡ㅇㅇㅇㅇㅇㅇ (같이 간 오디오맨, 수송부 이름 입력)
          </Example>
        </li>
        <li>
          <b>부가세</b>: 실물증빙에서 입력 시 무조건 <b>없음</b>
          <div className="status warn" style={{ marginTop: 6 }}>
            법인카드에서 입력 시 주의: 숙박비 부가세 <b>L 신용카드</b> / 교통비 부가세 <b>M 신용카드(불공제)</b>
          </div>
        </li>
      </ul>
      <div className="status note">* 적요는 상황에 맞게 법인카드와 실물증빙에서 같이 작성합니다.</div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  return (
    <button
      type="button"
      className="btn"
      style={{ padding: "4px 10px", minHeight: 0, fontSize: 12 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={`${label} 복사`}
    >
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

function WebhardField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
      <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
        {label}
      </span>
      <code style={{ fontSize: 15, overflowWrap: "anywhere", userSelect: "all" }}>{value || "-"}</code>
      <CopyButton value={value} label={label} />
    </div>
  );
}

function WebhardForm({
  initial,
  submitLabel,
  saving,
  onSubmit,
  onCancel,
}: {
  initial: WorkManualWebhardDraft;
  submitLabel: string;
  saving: boolean;
  onSubmit: (draft: WorkManualWebhardDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<WorkManualWebhardDraft>(initial);
  const update = (key: keyof WorkManualWebhardDraft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      style={{ display: "grid", gap: 8 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.title.trim()) return;
        onSubmit(draft);
      }}
    >
      <input className="field-input" placeholder="이름 (예: jtbcnow 관리자 로그인)" value={draft.title} onChange={update("title")} required />
      <input className="field-input" placeholder="ID" value={draft.login_id} onChange={update("login_id")} autoComplete="off" />
      <input className="field-input" placeholder="PW" value={draft.password} onChange={update("password")} autoComplete="off" />
      <input className="field-input" placeholder="메모 (예: 맨 앞 j 소문자)" value={draft.note} onChange={update("note")} />
      <input className="field-input" placeholder="접속 주소 (선택)" value={draft.url} onChange={update("url")} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            취소
          </button>
        ) : null}
        <button type="submit" className="btn primary" disabled={saving || !draft.title.trim()}>
          {saving ? "저장 중..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function WebhardSection() {
  const [items, setItems] = useState<WorkManualWebhard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "note"; text: string } | null>(null);
  const [canManage, setCanManage] = useState(false);

  async function refresh() {
    try {
      setItems(await listWorkManualWebhards());
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "웹하드 목록을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCanManage(canManageWorkManualWebhards(getSession()?.role));
    void refresh();
  }, []);

  async function run(action: () => Promise<void>, okText: string) {
    setSaving(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "ok", text: okText });
      setEditingId(null);
      setAdding(false);
      await refresh();
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : "저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
      {loading ? <div className="status note">불러오는 중입니다.</div> : null}
      {!loading && items.length === 0 ? <div className="status note">등록된 웹하드가 없습니다.</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
        {items.map((item, index) => (
          <article key={item.id} className="panel" style={{ alignSelf: "start" }}>
            <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
              {editingId === item.id ? (
                <WebhardForm
                  initial={{ title: item.title, login_id: item.login_id, password: item.password, note: item.note, url: item.url }}
                  submitLabel="수정 저장"
                  saving={saving}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(draft) => void run(() => updateWorkManualWebhard(item.id, draft), "웹하드를 수정했습니다.")}
                />
              ) : (
                <>
                  <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>
                    {index + 1}. {item.title}
                  </strong>
                  <WebhardField label="ID" value={item.login_id} />
                  <WebhardField label="PW" value={item.password} />
                  {item.note ? (
                    <span className="muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                      {item.note}
                    </span>
                  ) : null}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                      {item.url}
                    </a>
                  ) : null}
                  {canManage ? (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" className="btn" onClick={() => setEditingId(item.id)} disabled={saving}>
                        수정
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={saving}
                        onClick={() => {
                          if (!window.confirm(`'${item.title}' 웹하드를 삭제할까요?`)) return;
                          void run(() => deleteWorkManualWebhard(item.id), "웹하드를 삭제했습니다.");
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      {canManage ? (
        adding ? (
          <article className="panel">
            <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
              <strong>웹하드 추가</strong>
              <WebhardForm
                initial={EMPTY_WEBHARD_DRAFT}
                submitLabel="추가"
                saving={saving}
                onCancel={() => setAdding(false)}
                onSubmit={(draft) =>
                  void run(
                    () => createWorkManualWebhard(draft, (items.at(-1)?.sort_order ?? 0) + 1),
                    "웹하드를 추가했습니다.",
                  )
                }
              />
            </div>
          </article>
        ) : (
          <div>
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>
              + 웹하드 추가
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

export function WorkManualPage() {
  const [activeSection, setActiveSection] = useState<ManualSectionId>("receipt");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (isManualSectionId(hash)) setActiveSection(hash);
  }, []);

  function selectSection(id: ManualSectionId) {
    setActiveSection(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  const activeLabel = MANUAL_SECTIONS.find((section) => section.id === activeSection)?.label ?? "";

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div className="chip" style={{ justifySelf: "start" }}>
            Tips
          </div>
          <nav aria-label="Tips 목차" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MANUAL_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`btn ${activeSection === section.id ? "primary" : ""}`.trim()}
                aria-pressed={activeSection === section.id}
                onClick={() => selectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{activeLabel}</h2>
          {activeSection === "approval-line" ? <ApprovalLineSection /> : null}
          {activeSection === "receipt" ? <ReceiptSection /> : null}
          {activeSection === "account" ? <AccountSection /> : null}
          {activeSection === "webhard" ? <WebhardSection /> : null}
        </div>
      </article>
    </section>
  );
}
