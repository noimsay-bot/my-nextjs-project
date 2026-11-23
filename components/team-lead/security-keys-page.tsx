"use client";

import { useCallback, useEffect, useState } from "react";
import { printHtmlDocument } from "@/lib/print";
import { detectTeamLeadKeyStorageRisks, type TeamLeadKeyStorageRisks } from "@/lib/team-lead/e2e-browser-check";
import type { TeamLeadKeyHolderRow, TeamLeadKeyStatus } from "@/lib/team-lead/e2e-key-manager";
import { teamLeadE2eKeys } from "@/lib/team-lead/e2e-keys";

type Message = { tone: "ok" | "warn" | "note"; text: string } | null;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getDefaultDeviceLabel() {
  if (typeof navigator === "undefined") return "이 기기";
  const agent = navigator.userAgent;
  const browser = /Whale\//.test(agent)
    ? "웨일"
    : /Edg\//.test(agent)
      ? "Edge"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Firefox\//.test(agent)
          ? "Firefox"
          : /Safari\//.test(agent)
            ? "Safari"
            : "브라우저";
  const os = /iPhone|iPad/.test(agent)
    ? "iPhone/iPad"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "Mac"
        : /Windows/.test(agent)
          ? "Windows"
          : "기기";
  return `${os} · ${browser}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function formatFingerprint(value: string | null | undefined) {
  if (!value) return "------";
  return `${value.slice(0, 3)} ${value.slice(3)}`;
}

function getStatusLabel(holder: TeamLeadKeyHolderRow) {
  if (holder.status === "active") return "사용 중";
  if (holder.status === "pending") return "승인 대기";
  return "해제됨";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printRecoveryCode(recoveryCode: string) {
  const issuedAt = new Date().toLocaleString("ko-KR");
  return printHtmlDocument({
    title: "총괄팀장 보안 열쇠 복구 코드",
    pageSize: "A4 portrait",
    pageMargin: "18mm",
    bodyHtml: `
      <section style="font-family: sans-serif; display: grid; gap: 18px;">
        <h1 style="margin: 0; font-size: 22px;">총괄팀장 보안 열쇠 복구 코드</h1>
        <div style="font-size: 13px;">발급: ${escapeHtml(issuedAt)}</div>
        <div style="border: 2px solid #08111d; border-radius: 10px; padding: 20px; font-family: monospace; font-size: 26px; letter-spacing: 2px; text-align: center; word-break: break-all;">
          ${escapeHtml(recoveryCode)}
        </div>
        <ol style="font-size: 14px; line-height: 1.7; margin: 0; padding-left: 20px;">
          <li>이 종이를 봉투에 넣어 봉인하고, 팀 사무실 지정 장소에 보관합니다.</li>
          <li>사진을 찍거나 메신저·메일로 보내지 않습니다.</li>
          <li>총괄팀장이 바뀌어도 이 봉투는 그 자리에 그대로 둡니다.</li>
          <li>기존 팀장의 승인을 받을 수 없을 때만 포털 [총괄팀장 → 보안 열쇠 → 복구 코드로 열기]에 입력합니다.</li>
          <li>한 번 사용하면 포털이 새 복구 코드를 발급합니다. 새 코드를 다시 인쇄해 봉인하고 이 종이는 파쇄합니다.</li>
          <li>이 코드와 등록된 기기를 모두 잃으면 총괄팀장 데이터는 누구도(개발자 포함) 복구할 수 없습니다.</li>
        </ol>
      </section>`,
  });
}

function StorageRiskNotice({ risks }: { risks: TeamLeadKeyStorageRisks | null }) {
  if (!risks) return null;
  if (risks.inAppBrowser) {
    return (
      <div className="status warn" role="alert">
        지금 {risks.inAppBrowser} 안의 브라우저로 열려 있습니다. 여기서 등록한 열쇠는 크롬·사파리와 따로 저장되고 금방 사라질 수
        있습니다. 화면 메뉴(⋮ 또는 공유 버튼)에서 <strong>다른 브라우저로 열기</strong>를 눌러 크롬이나 사파리에서 다시 여세요.
      </div>
    );
  }
  if (risks.maybePrivateWindow) {
    return (
      <div className="status warn" role="alert">
        시크릿(개인정보 보호) 창으로 보입니다. 이 창을 닫으면 이 기기 열쇠가 사라집니다. 일반 창에서 다시 여세요. 시크릿 창이
        아니라면 이 안내는 무시하셔도 됩니다.
      </div>
    );
  }
  return null;
}

function RecoveryCodePanel({ recoveryCode, onDone }: { recoveryCode: string; onDone: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [printed, setPrinted] = useState(false);
  const lastFour = recoveryCode.replace(/-/g, "").slice(-4);
  const confirmed = confirmText.trim().toUpperCase() === lastFour;

  return (
    <article className="panel" style={{ border: "2px solid rgba(250,204,21,.6)" }}>
      <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
        <div className="chip">복구 코드 (이 화면에서 한 번만 보입니다)</div>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 22,
            letterSpacing: 1,
            padding: 16,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,.25)",
            // 좁은 휴대폰에서도 4자리 묶음 중간이 아니라 "-" 자리에서 줄이 바뀌게 한다.
            overflowWrap: "anywhere",
            textAlign: "center",
          }}
        >
          {recoveryCode}
        </div>
        <div className="status warn">
          인쇄해서 봉투에 봉인한 뒤 팀 사무실에 보관하세요. 화면을 닫으면 다시 볼 수 없습니다.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn white"
            onClick={() => {
              if (printRecoveryCode(recoveryCode)) setPrinted(true);
            }}
          >
            인쇄하기
          </button>
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            보관 확인: 인쇄한 종이에 적힌 코드의 마지막 4자리를 입력하세요.
          </span>
          <input
            className="field-input"
            value={confirmText}
            maxLength={4}
            onChange={(event) => setConfirmText(event.target.value)}
            style={{ width: 160, fontFamily: "monospace", textTransform: "uppercase" }}
          />
        </label>
        <div>
          <button type="button" className="btn" disabled={!confirmed} onClick={onDone}>
            {printed ? "봉인했습니다" : "보관했습니다"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function SecurityKeysPage() {
  const [status, setStatus] = useState<TeamLeadKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [approvalCodes, setApprovalCodes] = useState<Record<string, string>>({});
  const [recoveryInput, setRecoveryInput] = useState("");
  const [shownRecoveryCode, setShownRecoveryCode] = useState("");
  const [storageRisks, setStorageRisks] = useState<TeamLeadKeyStorageRisks | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      let next = await teamLeadE2eKeys.getStatus();
      if (next.meta && next.thisDevice.state === "active" && !next.unlocked) {
        try {
          await teamLeadE2eKeys.unlock();
          next = await teamLeadE2eKeys.getStatus();
        } catch (error) {
          setMessage({ tone: "warn", text: getErrorMessage(error, "이 기기 열쇠로 열지 못했습니다.") });
        }
      }
      setStatus(next);
    } catch (error) {
      setStatus(null);
      setMessage({ tone: "warn", text: getErrorMessage(error, "보안 열쇠 상태를 불러오지 못했습니다.") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDeviceLabel(getDefaultDeviceLabel());
    void refresh();
    void detectTeamLeadKeyStorageRisks().then(setStorageRisks, () => setStorageRisks(null));
  }, [refresh]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ tone: "warn", text: getErrorMessage(error, fallback) });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const meta = status?.meta ?? null;
  const deviceState = status?.thisDevice.state ?? "none";
  const needsRegistration = deviceState === "none" || deviceState === "missing" || deviceState === "revoked";
  const pendingDevices = (status?.holders ?? []).filter((row) => row.kind === "device" && row.status === "pending");
  const visibleHolders = (status?.holders ?? []).filter((row) => row.status !== "revoked");

  if (shownRecoveryCode) {
    return (
      <section style={{ display: "grid", gap: 16 }}>
        <RecoveryCodePanel
          recoveryCode={shownRecoveryCode}
          onDone={() => {
            setShownRecoveryCode("");
            setMessage({ tone: "ok", text: "복구 코드 보관을 확인했습니다." });
          }}
        />
      </section>
    );
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="chip">보안 열쇠</div>
            <button type="button" className="btn" disabled={loading || busy} onClick={() => void refresh()}>
              새로고침
            </button>
          </div>
          <div className="status note">
            총괄팀장 데이터(점수판·참고사항·기여도·분기 결과)는 이 열쇠가 있는 기기에서만 열 수 있게 됩니다. 서버와
            개발자는 내용을 볼 수 없습니다.
          </div>
          {meta?.enabled && status?.protectedData?.plaintext === 0 ? (
            <div className="status ok">
              데이터 보호 중입니다. 저장된 총괄팀장 데이터는 모두 암호문이라 이 열쇠가 있는 기기에서만 보입니다.
            </div>
          ) : null}
          <StorageRiskNotice risks={storageRisks} />
          {message ? <div className={`status ${message.tone}`}>{message.text}</div> : null}
          {loading && !status ? <div className="muted">불러오는 중…</div> : null}

          {status ? (
            <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
              <div>
                이 기기:{" "}
                <strong>
                  {deviceState === "active"
                    ? status.unlocked
                      ? "열림"
                      : "등록됨(잠김)"
                    : deviceState === "pending"
                      ? "승인 대기"
                      : "등록 안 됨"}
                </strong>
              </div>
              <div className="muted">
                사용 중인 기기 {status.activeDeviceCount}대 · 복구 코드 {status.activeRecoveryCount}개
              </div>
            </div>
          ) : null}
        </div>
      </article>

      {status && needsRegistration ? (
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
            <strong>1. 이 기기 등록</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              사무실 PC처럼 평소 쓰는 브라우저의 일반 창에서 등록하세요. 시크릿 창이나 브라우저 데이터를 지우면 다시
              등록해야 합니다.
            </span>
            <input
              className="field-input"
              value={deviceLabel}
              maxLength={120}
              onChange={(event) => setDeviceLabel(event.target.value)}
              placeholder="예: 사무실 PC · Chrome"
              style={{ maxWidth: 360 }}
            />
            <div>
              <button
                type="button"
                className="btn white"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await teamLeadE2eKeys.registerThisDevice(deviceLabel);
                  }, "이 기기를 등록하지 못했습니다.")
                }
              >
                이 기기 등록
              </button>
            </div>
          </div>
        </article>
      ) : null}

      {status && !meta && deviceState === "pending" ? (
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
            <strong>2. 보안 열쇠 처음 만들기</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              처음 한 번만 합니다. 만들고 나면 복구 코드가 표시되니 프린터를 준비하세요.
            </span>
            <div>
              <button
                type="button"
                className="btn white"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await teamLeadE2eKeys.setupKeys();
                    setShownRecoveryCode(result.recoveryCode);
                  }, "보안 열쇠를 만들지 못했습니다.")
                }
              >
                보안 열쇠 만들기
              </button>
            </div>
          </div>
        </article>
      ) : null}

      {status && meta && (deviceState === "pending" || (deviceState === "active" && !status.unlocked)) ? (
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
            <strong>{deviceState === "pending" ? "이 기기 승인 받기" : "이 기기 다시 열기"}</strong>
            {deviceState === "pending" ? (
              <>
                <span className="muted" style={{ fontSize: 13 }}>
                  이미 열쇠가 있는 총괄팀장(또는 내 다른 기기)에게 아래 6자리를 불러 주세요. 승인되면 새로고침을 누르세요.
                </span>
                <div style={{ fontFamily: "monospace", fontSize: 36, letterSpacing: 6 }}>
                  {formatFingerprint(status.thisDevice.fingerprint)}
                </div>
              </>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>
                이 기기는 등록되어 있지만 열쇠를 열지 못했습니다. 이 기기를 해제하고 다시 등록하거나 복구 코드로 여세요.
              </span>
            )}
            <details>
              <summary style={{ cursor: "pointer" }}>승인해 줄 사람이 없나요? 복구 코드로 열기</summary>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  팀 사무실에 봉인된 복구 코드를 입력하세요. 사용 후에는 새 복구 코드가 발급됩니다.
                </span>
                <input
                  className="field-input"
                  value={recoveryInput}
                  onChange={(event) => setRecoveryInput(event.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  style={{ fontFamily: "monospace", maxWidth: 520 }}
                />
                <div>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !recoveryInput.trim()}
                    onClick={() =>
                      void run(async () => {
                        await teamLeadE2eKeys.recoverWithCode(recoveryInput, deviceLabel);
                        setRecoveryInput("");
                        const reissued = await teamLeadE2eKeys.reissueRecoveryCode();
                        setShownRecoveryCode(reissued.recoveryCode);
                      }, "복구 코드로 열지 못했습니다.")
                    }
                  >
                    복구 코드로 열기
                  </button>
                </div>
              </div>
            </details>
          </div>
        </article>
      ) : null}

      {status?.unlocked && meta && (!meta.enabled || (status.protectedData?.plaintext ?? 0) > 0) ? (
        <article className="panel" style={{ border: "2px solid rgba(34,197,94,.55)" }}>
          <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
            <strong>{meta.enabled ? "남은 데이터 암호화 마치기" : "3. 데이터 잠그기 (암호화 시작)"}</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              점수판·참고사항·기여도·분기 결과를 암호문으로 바꿉니다. 바꾼 뒤에는 열쇠가 있는 기기에서만 보이고, 서버와
              개발자는 내용을 볼 수 없습니다. 몇 초면 끝나며 화면 내용은 그대로입니다.
            </span>
            {!meta.enabled ? (
              <div className="status warn">
                누르기 전에 복구 코드 봉투가 사무실에 보관되어 있는지 확인하세요. 한 번 시작하면 되돌릴 수 없습니다.
              </div>
            ) : null}
            <div>
              <button
                type="button"
                className="btn white"
                disabled={busy}
                onClick={() => {
                  if (
                    !meta.enabled &&
                    !window.confirm("복구 코드 봉투를 보관했나요? 데이터 암호화를 시작하면 되돌릴 수 없습니다.")
                  ) {
                    return;
                  }
                  void run(async () => {
                    await teamLeadE2eKeys.encryptProtectedData();
                    setMessage({ tone: "ok", text: "데이터를 잠갔습니다. 이제 이 열쇠가 있는 기기에서만 볼 수 있습니다." });
                  }, "데이터를 암호문으로 바꾸지 못했습니다.");
                }}
              >
                {meta.enabled ? "이어서 암호화" : "데이터 잠그기"}
              </button>
            </div>
          </div>
        </article>
      ) : null}

      {status?.unlocked && pendingDevices.length > 0 ? (
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
            <strong>승인 대기 중인 기기</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              그 기기 화면에 보이는 6자리를 직접 확인하고 입력하세요. 모르는 기기는 승인하지 말고 해제하세요.
            </span>
            {pendingDevices.map((holder) => (
              <div key={holder.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ minWidth: 220 }}>
                  {holder.owner_name ?? "알 수 없음"} · {holder.label}
                  <span className="muted" style={{ fontSize: 12 }}> ({formatDate(holder.created_at)})</span>
                </span>
                <input
                  className="field-input"
                  inputMode="numeric"
                  maxLength={7}
                  placeholder="6자리"
                  value={approvalCodes[holder.id] ?? ""}
                  onChange={(event) => setApprovalCodes((current) => ({ ...current, [holder.id]: event.target.value }))}
                  style={{ width: 120, fontFamily: "monospace" }}
                />
                <button
                  type="button"
                  className="btn white"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await teamLeadE2eKeys.approveDevice(holder.id, approvalCodes[holder.id] ?? "");
                      setApprovalCodes((current) => ({ ...current, [holder.id]: "" }));
                      setMessage({ tone: "ok", text: `${holder.owner_name ?? ""} 기기를 승인했습니다.` });
                    }, "기기를 승인하지 못했습니다.")
                  }
                >
                  승인
                </button>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {status && visibleHolders.length > 0 ? (
        <article className="panel">
          <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>등록된 열쇠</strong>
              {status.unlocked ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("새 복구 코드를 발급하면 기존 복구 코드는 더 이상 쓸 수 없습니다. 계속할까요?")) return;
                    void run(async () => {
                      const result = await teamLeadE2eKeys.reissueRecoveryCode();
                      setShownRecoveryCode(result.recoveryCode);
                    }, "복구 코드를 다시 발급하지 못했습니다.");
                  }}
                >
                  복구 코드 다시 발급
                </button>
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {visibleHolders.map((holder) => (
                <div
                  key={holder.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,.08)",
                  }}
                >
                  <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <span>
                      {holder.kind === "recovery" ? "복구 코드" : `${holder.owner_name ?? "알 수 없음"} · ${holder.label}`}
                      {status.thisDevice.holder?.id === holder.id ? " (이 기기)" : ""}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {getStatusLabel(holder)} · 등록 {formatDate(holder.created_at)}
                      {holder.approved_at ? ` · 승인 ${formatDate(holder.approved_at)}` : ""}
                    </span>
                  </div>
                  {holder.kind === "device" ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        const isThisDevice = status.thisDevice.holder?.id === holder.id;
                        const warning = isThisDevice
                          ? "이 기기의 열쇠를 해제하면 이 기기에서는 더 이상 데이터를 열 수 없습니다. 계속할까요?"
                          : `${holder.owner_name ?? ""} · ${holder.label} 기기를 해제할까요?`;
                        if (!window.confirm(warning)) return;
                        void run(async () => {
                          await teamLeadE2eKeys.revokeHolder(holder.id);
                          setMessage({ tone: "ok", text: "기기를 해제했습니다." });
                        }, "기기를 해제하지 못했습니다.");
                      }}
                    >
                      해제
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </article>
      ) : null}
    </section>
  );
}
