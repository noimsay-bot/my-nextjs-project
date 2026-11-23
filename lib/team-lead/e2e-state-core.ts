"use client";

// 총괄팀장 보호 데이터(team_lead_state 4개 key)를 읽고 쓸 때 암호문을 처리한다(P4).
// 설계: docs/exec-plans/active/team-lead-e2e-encryption.md (6.2, 6.3절)
//
// 동작 규칙
// - 읽기: 평문이면 그대로 돌려준다(전환 전 호환). 암호문이면 열린 데이터 키로 복호화한다.
//         열쇠가 없으면 locked로 돌려주고 값은 null이다. 총괄팀장이 아니면 열기를 시도하지 않는다.
// - 쓰기: 암호화가 켜져 있거나(crypto_meta_v1.enabled) 이 탭에서 암호문을 본 적이 있으면 반드시 암호화한다.
//         그때 열쇠가 없으면 저장을 거부한다. 잠긴 화면의 빈 값으로 암호문을 덮어쓰는 사고를 막는다.
//         둘 다 아니면 지금처럼 평문으로 저장한다.

import {
  decryptTeamLeadState,
  encryptTeamLeadState,
  isTeamLeadE2eEnvelope,
  isTeamLeadE2eProtectedStateKey,
} from "@/lib/team-lead/e2e-crypto";

export interface TeamLeadProtectedStateDeps {
  getSession(): Promise<{ id: string; role: string; approved: boolean } | null>;
  loadCryptoMeta(): Promise<{ enabled: boolean; currentKeyVersion: number } | null>;
  getUnlockedDataKey(profileId: string): { keyVersion: number; dataKey: CryptoKey } | null;
  unlock(): Promise<boolean>;
  onLocked?(stateKey: string): void;
}

export type TeamLeadProtectedReadResult =
  | { locked: false; encrypted: boolean; state: unknown }
  | { locked: true; encrypted: true; state: null; reason: "not_team_lead" | "no_key" | "key_version" | "decrypt_failed" };

export class TeamLeadProtectedStateLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamLeadProtectedStateLockedError";
  }
}

const LOCKED_WRITE_MESSAGE =
  "이 기기는 보안 열쇠가 잠겨 있어 저장할 수 없습니다. 총괄팀장 → 보안 열쇠 화면에서 이 기기를 연 뒤 다시 시도해 주세요.";

export function createTeamLeadProtectedState(deps: TeamLeadProtectedStateDeps) {
  let encounteredEnvelope = false;

  async function getDataKeyForSession(session: { id: string; role: string; approved: boolean } | null) {
    if (!session || !session.approved || session.role !== "team_lead") return null;
    const current = deps.getUnlockedDataKey(session.id);
    if (current) return current;
    try {
      await deps.unlock();
    } catch {
      return null;
    }
    return deps.getUnlockedDataKey(session.id);
  }

  async function read(stateKey: string, rawState: unknown): Promise<TeamLeadProtectedReadResult> {
    if (!isTeamLeadE2eEnvelope(rawState)) {
      return { locked: false, encrypted: false, state: rawState };
    }
    encounteredEnvelope = true;

    const session = await deps.getSession();
    if (!session || !session.approved || session.role !== "team_lead") {
      return { locked: true, encrypted: true, state: null, reason: "not_team_lead" };
    }

    const key = await getDataKeyForSession(session);
    if (!key) {
      deps.onLocked?.(stateKey);
      return { locked: true, encrypted: true, state: null, reason: "no_key" };
    }
    if (key.keyVersion !== rawState.keyVersion) {
      deps.onLocked?.(stateKey);
      return { locked: true, encrypted: true, state: null, reason: "key_version" };
    }

    try {
      const state = await decryptTeamLeadState(key.dataKey, { stateKey, keyVersion: key.keyVersion, envelope: rawState });
      return { locked: false, encrypted: true, state };
    } catch {
      deps.onLocked?.(stateKey);
      return { locked: true, encrypted: true, state: null, reason: "decrypt_failed" };
    }
  }

  /** 저장 직전에 호출한다. 보호 대상이 아니거나 암호화 전이면 값을 그대로 돌려준다. */
  async function prepareForWrite(stateKey: string, value: unknown): Promise<unknown> {
    if (!isTeamLeadE2eProtectedStateKey(stateKey)) return value;

    const meta = await deps.loadCryptoMeta();
    const mustEncrypt = Boolean(meta?.enabled) || encounteredEnvelope;
    if (!mustEncrypt) return value;

    const session = await deps.getSession();
    const key = await getDataKeyForSession(session);
    if (!key || (meta && key.keyVersion !== meta.currentKeyVersion)) {
      throw new TeamLeadProtectedStateLockedError(LOCKED_WRITE_MESSAGE);
    }
    return encryptTeamLeadState(key.dataKey, { stateKey, keyVersion: key.keyVersion, value });
  }

  return { read, prepareForWrite };
}

export type TeamLeadProtectedState = ReturnType<typeof createTeamLeadProtectedState>;
