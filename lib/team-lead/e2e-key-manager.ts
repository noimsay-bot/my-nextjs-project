"use client";

// 총괄팀장 보안 열쇠 관리 로직(P3). 저장소는 backend로 주입받아 테스트할 수 있게 한다.
// 설계: docs/exec-plans/active/team-lead-e2e-encryption.md (7절 사용자 흐름)
//
// 지켜야 할 원칙
// - 평문 데이터 키(DEK)는 메모리에만 둔다. DB·IndexedDB·로그에 남기지 않는다.
// - 새 기기 승인은 그 기기 화면의 6자리 확인 코드를 입력해야만 한다.
// - 활성 보관자(기기·복구 코드)가 하나도 남지 않게 만드는 해제는 거부한다.

import {
  computeTeamLeadKeyFingerprint,
  createTeamLeadRecoveryHolder,
  decryptTeamLeadState,
  encryptTeamLeadState,
  exportTeamLeadPublicKey,
  generateTeamLeadDataKey,
  generateTeamLeadDeviceKeyPair,
  importTeamLeadPublicKey,
  isTeamLeadE2eEnvelope,
  TEAM_LEAD_E2E_PROTECTED_STATE_KEYS,
  type TeamLeadE2eRecoveryKdf,
  unlockTeamLeadRecoveryPrivateKey,
  unwrapTeamLeadDataKey,
  wrapTeamLeadDataKey,
} from "@/lib/team-lead/e2e-crypto";

export const TEAM_LEAD_CRYPTO_META_STATE_KEY = "crypto_meta_v1";

export type TeamLeadKeyHolderKind = "device" | "recovery";
export type TeamLeadKeyHolderStatus = "pending" | "active" | "revoked";

export interface TeamLeadKeyHolderRow {
  id: string;
  kind: TeamLeadKeyHolderKind;
  profile_id: string | null;
  owner_name?: string | null;
  label: string;
  public_key: string;
  fingerprint: string;
  wrapped_private_key: string | null;
  kdf: TeamLeadE2eRecoveryKdf | null;
  status: TeamLeadKeyHolderStatus;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  revoked_at: string | null;
}

export interface TeamLeadKeyEnvelopeRow {
  holder_id: string;
  key_version: number;
  wrapped_dek: string;
}

export interface TeamLeadCryptoMeta {
  /** 총괄팀장이 "데이터 암호화 시작"을 누른 뒤 true가 된다. 한 번 켜면 DB 트리거가 끄지 못하게 막는다. */
  enabled: boolean;
  currentKeyVersion: number;
  setupAt: string;
  setupBy: string;
  enabledAt?: string;
  /** 마지막으로 열쇠 새로 고치기를 한 시각. */
  rotatedAt?: string;
}

/** 보호 대상 team_lead_state 행. 전환·상태 확인에만 쓴다. */
export interface TeamLeadProtectedStateRow {
  key: string;
  state: unknown;
  updated_at: string;
}

export interface TeamLeadProtectedDataStatus {
  /** 현재 세대 열쇠로 잠긴 행 수 */
  encrypted: number;
  plaintext: number;
  /** 이전 세대 열쇠로 잠긴 행 수(열쇠 새로 고치기를 마치지 못한 경우) */
  outdated: number;
}

export interface TeamLeadLocalDeviceKey {
  profileId: string;
  holderId: string | null;
  privateKey: CryptoKey;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface TeamLeadE2eSession {
  id: string;
  name: string;
  role: string;
  approved: boolean;
}

export interface TeamLeadE2eKeyBackend {
  getSession(): Promise<TeamLeadE2eSession | null>;
  loadCryptoMeta(): Promise<TeamLeadCryptoMeta | null>;
  saveCryptoMeta(meta: TeamLeadCryptoMeta): Promise<void>;
  listHolders(): Promise<TeamLeadKeyHolderRow[]>;
  insertHolder(input: {
    kind: TeamLeadKeyHolderKind;
    profile_id: string | null;
    label: string;
    public_key: string;
    fingerprint: string;
    wrapped_private_key: string | null;
    kdf: TeamLeadE2eRecoveryKdf | null;
    status: TeamLeadKeyHolderStatus;
  }): Promise<TeamLeadKeyHolderRow>;
  updateHolder(
    id: string,
    patch: Partial<Pick<TeamLeadKeyHolderRow, "status" | "approved_by" | "approved_at" | "revoked_at" | "label">>,
  ): Promise<void>;
  deleteHolder(id: string): Promise<void>;
  getEnvelope(holderId: string, keyVersion: number): Promise<TeamLeadKeyEnvelopeRow | null>;
  upsertEnvelope(input: TeamLeadKeyEnvelopeRow): Promise<void>;
  deleteEnvelopesForHolder(holderId: string): Promise<void>;
  /** keyVersion보다 이전 세대의 감싼 데이터 키 사본을 모두 지운다. */
  deleteEnvelopesBelowVersion(keyVersion: number): Promise<void>;
  loadProtectedStateRows(keys: readonly string[]): Promise<TeamLeadProtectedStateRow[]>;
  /** 읽은 뒤 아무도 바꾸지 않았을 때만(updated_at 일치) 바꾼다. 바꿨으면 true. */
  replaceProtectedState(key: string, expectedUpdatedAt: string, state: unknown): Promise<boolean>;
  getDeviceKey(profileId: string): Promise<TeamLeadLocalDeviceKey | null>;
  saveDeviceKey(record: TeamLeadLocalDeviceKey): Promise<void>;
  deleteDeviceKey(profileId: string): Promise<void>;
  now(): string;
}

export type TeamLeadThisDeviceState = "none" | "pending" | "active" | "revoked" | "missing";

export interface TeamLeadKeyStatus {
  session: TeamLeadE2eSession;
  meta: TeamLeadCryptoMeta | null;
  holders: TeamLeadKeyHolderRow[];
  thisDevice: {
    state: TeamLeadThisDeviceState;
    holder: TeamLeadKeyHolderRow | null;
    fingerprint: string | null;
  };
  unlocked: boolean;
  activeDeviceCount: number;
  activeRecoveryCount: number;
  /** 열쇠를 만든 뒤에만 채운다. 형식만 보고 세며 내용은 풀지 않는다. */
  protectedData: TeamLeadProtectedDataStatus | null;
  /**
   * 마지막 열쇠 생성·새로 고치기 뒤에 해제된 기기가 있으면 true.
   * 이전 팀장 기기 등 해제된 기기가 예전 데이터 키를 알고 있으므로 새로 고치기를 권한다.
   */
  rotationRecommended: boolean;
}

export class TeamLeadKeyManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamLeadKeyManagerError";
  }
}

function fail(message: string): never {
  throw new TeamLeadKeyManagerError(message);
}

function normalizeConfirmationCode(value: string) {
  return value.replace(/\D/g, "");
}

export function createTeamLeadE2eKeyManager(backend: TeamLeadE2eKeyBackend) {
  let unlocked: { profileId: string; keyVersion: number; dataKey: CryptoKey } | null = null;
  /** 열쇠 새로 고치기 도중·직후에 이전 세대 데이터를 읽기 위한 키. 이 탭 메모리에만 둔다. */
  const previousKeys = new Map<number, CryptoKey>();

  async function requireTeamLeadSession() {
    const session = await backend.getSession();
    if (!session || !session.approved || session.role !== "team_lead") {
      fail("총괄팀장 계정으로 로그인해야 보안 열쇠를 관리할 수 있습니다.");
    }
    if (unlocked && unlocked.profileId !== session.id) {
      unlocked = null;
      previousKeys.clear();
    }
    return session;
  }

  function isUnlockedFor(session: TeamLeadE2eSession, meta: TeamLeadCryptoMeta | null) {
    return Boolean(
      unlocked && meta && unlocked.profileId === session.id && unlocked.keyVersion === meta.currentKeyVersion,
    );
  }

  async function resolveThisDevice(session: TeamLeadE2eSession, holders: TeamLeadKeyHolderRow[]) {
    const local = await backend.getDeviceKey(session.id);
    if (!local) {
      return { local: null, holder: null, state: "none" as TeamLeadThisDeviceState };
    }
    const holder = holders.find((row) => row.id === local.holderId && row.kind === "device") ?? null;
    if (!holder || holder.public_key !== local.publicKey) {
      return { local, holder: null, state: "missing" as TeamLeadThisDeviceState };
    }
    return { local, holder, state: holder.status as TeamLeadThisDeviceState };
  }

  async function getStatus(): Promise<TeamLeadKeyStatus> {
    const session = await requireTeamLeadSession();
    const [meta, holders] = await Promise.all([backend.loadCryptoMeta(), backend.listHolders()]);
    const thisDevice = await resolveThisDevice(session, holders);
    let protectedData: TeamLeadProtectedDataStatus | null = null;
    let rotationRecommended = false;
    if (meta) {
      const rows = await backend.loadProtectedStateRows(TEAM_LEAD_E2E_PROTECTED_STATE_KEYS);
      const envelopes = rows.filter((row) => isTeamLeadE2eEnvelope(row.state));
      const encrypted = envelopes.filter(
        (row) => (row.state as { keyVersion: number }).keyVersion === meta.currentKeyVersion,
      ).length;
      protectedData = { encrypted, plaintext: rows.length - envelopes.length, outdated: envelopes.length - encrypted };

      const since = Date.parse(meta.rotatedAt || meta.setupAt);
      rotationRecommended =
        meta.enabled &&
        holders.some(
          (row) =>
            row.kind === "device" &&
            row.status === "revoked" &&
            Boolean(row.approved_at) &&
            Date.parse(row.revoked_at ?? "") > (Number.isNaN(since) ? 0 : since),
        );
    }
    return {
      protectedData,
      rotationRecommended,
      session,
      meta,
      holders,
      thisDevice: {
        state: thisDevice.state,
        holder: thisDevice.holder,
        fingerprint: thisDevice.local?.fingerprint ?? null,
      },
      unlocked: isUnlockedFor(session, meta),
      activeDeviceCount: holders.filter((row) => row.kind === "device" && row.status === "active").length,
      activeRecoveryCount: holders.filter((row) => row.kind === "recovery" && row.status === "active").length,
    };
  }

  /** 이 브라우저를 기기로 등록한다(승인 대기). 이미 등록되어 있으면 그대로 둔다. */
  async function registerThisDevice(label: string) {
    const session = await requireTeamLeadSession();
    const holders = await backend.listHolders();
    const current = await resolveThisDevice(session, holders);
    if (current.state === "pending" || current.state === "active") {
      return current.holder as TeamLeadKeyHolderRow;
    }
    if (current.local) {
      await backend.deleteDeviceKey(session.id);
    }

    const keyPair = await generateTeamLeadDeviceKeyPair();
    const publicKey = await exportTeamLeadPublicKey(keyPair.publicKey);
    const fingerprint = await computeTeamLeadKeyFingerprint(publicKey);
    const createdAt = backend.now();
    // DB보다 먼저 로컬에 저장해, DB 등록 후 브라우저 저장이 실패해 주인 없는 기기가 생기는 일을 줄인다.
    await backend.saveDeviceKey({
      profileId: session.id,
      holderId: null,
      privateKey: keyPair.privateKey,
      publicKey,
      fingerprint,
      createdAt,
    });
    const holder = await backend.insertHolder({
      kind: "device",
      profile_id: session.id,
      label: label.trim().slice(0, 120) || "이름 없는 기기",
      public_key: publicKey,
      fingerprint,
      wrapped_private_key: null,
      kdf: null,
      status: "pending",
    });
    await backend.saveDeviceKey({
      profileId: session.id,
      holderId: holder.id,
      privateKey: keyPair.privateKey,
      publicKey,
      fingerprint,
      createdAt,
    });
    return holder;
  }

  async function createRecoveryHolder(dataKey: CryptoKey, keyVersion: number, createdAt: string) {
    const material = await createTeamLeadRecoveryHolder();
    const holder = await backend.insertHolder({
      kind: "recovery",
      profile_id: null,
      label: `복구 코드 (${createdAt.slice(0, 10)} 발급)`,
      public_key: material.publicKey,
      fingerprint: material.fingerprint,
      wrapped_private_key: material.wrappedPrivateKey,
      kdf: material.kdf,
      status: "active",
    });
    try {
      await backend.upsertEnvelope({
        holder_id: holder.id,
        key_version: keyVersion,
        wrapped_dek: await wrapTeamLeadDataKey(dataKey, await importTeamLeadPublicKey(material.publicKey)),
      });
    } catch (error) {
      await backend.deleteHolder(holder.id).catch(() => undefined);
      throw error;
    }
    return { holder, recoveryCode: material.recoveryCode };
  }

  /**
   * 최초 설정: 데이터 키를 만들고 이 기기와 복구 코드에 감싸 저장한다.
   * 반환한 복구 코드는 화면에 한 번만 보여 주고 인쇄하게 한다.
   */
  async function setupKeys() {
    const session = await requireTeamLeadSession();
    if (await backend.loadCryptoMeta()) {
      fail("이미 보안 열쇠가 설정되어 있습니다. 새 기기는 기존 기기에서 승인받거나 복구 코드로 열어 주세요.");
    }
    const holders = await backend.listHolders();
    const thisDevice = await resolveThisDevice(session, holders);
    if (!thisDevice.local || !thisDevice.holder || thisDevice.state !== "pending") {
      fail("먼저 이 기기를 등록해 주세요.");
    }

    const keyVersion = 1;
    const now = backend.now();
    const dataKey = await generateTeamLeadDataKey();
    let recoveryHolderId: string | null = null;
    try {
      await backend.upsertEnvelope({
        holder_id: thisDevice.holder.id,
        key_version: keyVersion,
        wrapped_dek: await wrapTeamLeadDataKey(dataKey, await importTeamLeadPublicKey(thisDevice.holder.public_key)),
      });
      await backend.updateHolder(thisDevice.holder.id, { status: "active", approved_by: session.id, approved_at: now });
      const recovery = await createRecoveryHolder(dataKey, keyVersion, now);
      recoveryHolderId = recovery.holder.id;
      await backend.saveCryptoMeta({ enabled: false, currentKeyVersion: keyVersion, setupAt: now, setupBy: session.id });
      unlocked = { profileId: session.id, keyVersion, dataKey };
      return { recoveryCode: recovery.recoveryCode };
    } catch (error) {
      // 설정이 중간에 실패하면 다시 시도할 수 있게 되돌린다.
      await backend.deleteEnvelopesForHolder(thisDevice.holder.id).catch(() => undefined);
      await backend.updateHolder(thisDevice.holder.id, { status: "pending", approved_by: null, approved_at: null }).catch(
        () => undefined,
      );
      if (recoveryHolderId) {
        await backend.deleteHolder(recoveryHolderId).catch(() => undefined);
      }
      throw error;
    }
  }

  /** 이 기기 열쇠로 데이터 키를 연다. 열 수 없으면 false. */
  async function unlock() {
    const session = await requireTeamLeadSession();
    const meta = await backend.loadCryptoMeta();
    if (!meta) return false;
    if (isUnlockedFor(session, meta)) return true;

    const holders = await backend.listHolders();
    const thisDevice = await resolveThisDevice(session, holders);
    if (!thisDevice.local || !thisDevice.holder || thisDevice.state !== "active") return false;

    const envelope = await backend.getEnvelope(thisDevice.holder.id, meta.currentKeyVersion);
    if (!envelope) return false;

    const dataKey = await unwrapTeamLeadDataKey(envelope.wrapped_dek, thisDevice.local.privateKey);
    unlocked = { profileId: session.id, keyVersion: meta.currentKeyVersion, dataKey };
    return true;
  }

  async function requireUnlocked() {
    const session = await requireTeamLeadSession();
    const meta = await backend.loadCryptoMeta();
    if (!meta) fail("아직 보안 열쇠가 설정되지 않았습니다.");
    if (!isUnlockedFor(session, meta) && !(await unlock())) {
      fail("이 기기는 아직 잠겨 있습니다. 먼저 이 기기를 열어 주세요.");
    }
    return { session, meta, dataKey: (unlocked as NonNullable<typeof unlocked>).dataKey };
  }

  /** 승인 대기 기기를 승인한다. 그 기기 화면의 6자리 확인 코드가 맞아야 한다. */
  async function approveDevice(holderId: string, confirmationCode: string) {
    const { session, meta, dataKey } = await requireUnlocked();
    const holder = (await backend.listHolders()).find((row) => row.id === holderId);
    if (!holder || holder.kind !== "device" || holder.status !== "pending") {
      fail("승인할 수 있는 기기가 아닙니다. 목록을 새로고침해 주세요.");
    }

    const typed = normalizeConfirmationCode(confirmationCode);
    const computed = await computeTeamLeadKeyFingerprint(holder.public_key);
    if (typed.length !== 6 || typed !== computed || holder.fingerprint !== computed) {
      fail("확인 코드가 맞지 않습니다. 새 기기 화면에 보이는 6자리를 다시 확인해 주세요.");
    }

    await backend.upsertEnvelope({
      holder_id: holder.id,
      key_version: meta.currentKeyVersion,
      wrapped_dek: await wrapTeamLeadDataKey(dataKey, await importTeamLeadPublicKey(holder.public_key)),
    });
    await backend.updateHolder(holder.id, { status: "active", approved_by: session.id, approved_at: backend.now() });
  }

  /** 기기나 복구 코드를 해제한다. 마지막 남은 열쇠는 해제할 수 없다. */
  async function revokeHolder(holderId: string) {
    await requireTeamLeadSession();
    const holders = await backend.listHolders();
    const holder = holders.find((row) => row.id === holderId);
    if (!holder || holder.status === "revoked") {
      fail("해제할 수 있는 열쇠가 아닙니다. 목록을 새로고침해 주세요.");
    }
    if (holder.status === "active") {
      const remainingActive = holders.filter((row) => row.status === "active" && row.id !== holder.id);
      if (remainingActive.length === 0) {
        fail("마지막 남은 열쇠는 해제할 수 없습니다. 해제하면 데이터를 영영 열 수 없게 됩니다.");
      }
      if (holder.kind === "recovery" && !remainingActive.some((row) => row.kind === "recovery")) {
        fail("복구 코드는 새 복구 코드를 발급하면 자동으로 해제됩니다. '복구 코드 다시 발급'을 이용해 주세요.");
      }
    }

    await backend.deleteEnvelopesForHolder(holder.id);
    await backend.updateHolder(holder.id, { status: "revoked", revoked_at: backend.now() });
    if (unlocked && holder.kind === "device") {
      const session = await backend.getSession();
      const local = session ? await backend.getDeviceKey(session.id) : null;
      if (local?.holderId === holder.id) {
        unlocked = null;
      }
    }
  }

  /** 새 복구 코드를 발급하고 기존 복구 코드는 해제한다. */
  async function reissueRecoveryCode() {
    const { meta, dataKey } = await requireUnlocked();
    const previous = (await backend.listHolders()).filter((row) => row.kind === "recovery" && row.status === "active");
    const now = backend.now();
    const recovery = await createRecoveryHolder(dataKey, meta.currentKeyVersion, now);
    for (const holder of previous) {
      await backend.deleteEnvelopesForHolder(holder.id);
      await backend.updateHolder(holder.id, { status: "revoked", revoked_at: now });
    }
    return { recoveryCode: recovery.recoveryCode };
  }

  /**
   * 복구 코드로 데이터 키를 열고 이 기기를 바로 활성화한다.
   * 복구 코드를 본 사람이 생겼으므로 호출한 화면은 곧바로 새 복구 코드를 발급하게 해야 한다.
   */
  async function recoverWithCode(recoveryCode: string, deviceLabel: string) {
    const session = await requireTeamLeadSession();
    const meta = await backend.loadCryptoMeta();
    if (!meta) fail("아직 보안 열쇠가 설정되지 않았습니다.");

    const recoveryHolders = (await backend.listHolders()).filter(
      (row) => row.kind === "recovery" && row.status === "active" && row.wrapped_private_key && row.kdf,
    );
    if (recoveryHolders.length === 0) fail("사용할 수 있는 복구 코드가 없습니다.");

    let dataKey: CryptoKey | null = null;
    let lastError: unknown = null;
    for (const holder of recoveryHolders) {
      try {
        const privateKey = await unlockTeamLeadRecoveryPrivateKey(recoveryCode, {
          wrappedPrivateKey: holder.wrapped_private_key as string,
          kdf: holder.kdf as TeamLeadE2eRecoveryKdf,
        });
        const envelope = await backend.getEnvelope(holder.id, meta.currentKeyVersion);
        if (!envelope) continue;
        dataKey = await unwrapTeamLeadDataKey(envelope.wrapped_dek, privateKey);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!dataKey) {
      throw lastError instanceof Error ? lastError : new TeamLeadKeyManagerError("복구 코드로 열지 못했습니다.");
    }

    const device = await registerThisDevice(deviceLabel);
    // 활성 기기라도 현재 세대 사본이 없어 잠겼을 수 있으므로 사본은 항상 다시 만든다.
    await backend.upsertEnvelope({
      holder_id: device.id,
      key_version: meta.currentKeyVersion,
      wrapped_dek: await wrapTeamLeadDataKey(dataKey, await importTeamLeadPublicKey(device.public_key)),
    });
    if (device.status !== "active") {
      await backend.updateHolder(device.id, { status: "active", approved_by: session.id, approved_at: backend.now() });
    }
    unlocked = { profileId: session.id, keyVersion: meta.currentKeyVersion, dataKey };
    return { mustReissueRecoveryCode: true as const };
  }

  /**
   * 데이터 암호화 시작(P5): 암호화를 켜고, 남아 있는 평문 보호 데이터를 암호문으로 바꾼다.
   * - 먼저 켠다. 그 뒤로는 어느 탭에서 저장해도 암호문으로만 저장되므로 새 평문이 생기지 않는다.
   * - 행마다 "암호화 → 이 탭에서 다시 풀어 원본과 같은지 확인 → 읽은 뒤 아무도 안 바꿨을 때만 덮어쓰기" 순서로 한다.
   * - 중간에 실패해도 남은 평문은 그대로 읽히고, 다시 누르면 남은 것만 이어서 바꾼다.
   */
  async function encryptProtectedData() {
    const { session, meta, dataKey } = await requireUnlocked();
    if (!meta.enabled) {
      await backend.saveCryptoMeta({ ...meta, enabled: true, enabledAt: backend.now() });
    }
    return migrateProtectedRows(session, meta.currentKeyVersion, dataKey);
  }

  /**
   * 보호 데이터 4개를 모두 현재 세대 암호문으로 맞춘다. 평문은 암호화하고, 이전 세대 암호문은 다시 암호화한다.
   * 모두 현재 세대가 된 뒤에만 이전 세대의 감싼 데이터 키 사본을 지운다.
   */
  async function migrateProtectedRows(session: TeamLeadE2eSession, keyVersion: number, dataKey: CryptoKey) {
    let converted = 0;
    for (const stateKey of TEAM_LEAD_E2E_PROTECTED_STATE_KEYS) {
      for (let attempt = 0; ; attempt += 1) {
        const [row] = await backend.loadProtectedStateRows([stateKey]);
        if (!row) break;
        const stored = row.state;
        const storedEnvelope = isTeamLeadE2eEnvelope(stored) ? stored : null;
        if (storedEnvelope && storedEnvelope.keyVersion === keyVersion) break;

        let value: unknown = stored;
        if (storedEnvelope) {
          const previousKey = await openDataKeyVersion(session, storedEnvelope.keyVersion);
          if (!previousKey) {
            fail("이전 열쇠로 잠긴 데이터를 이 기기에서 열 수 없습니다. 이전 열쇠를 가진 기기에서 다시 시도해 주세요.");
          }
          value = await decryptTeamLeadState(previousKey, {
            stateKey,
            keyVersion: storedEnvelope.keyVersion,
            envelope: storedEnvelope,
          });
        }

        const envelope = await encryptTeamLeadState(dataKey, { stateKey, keyVersion, value });
        const roundTrip = await decryptTeamLeadState(dataKey, { stateKey, keyVersion, envelope });
        if (JSON.stringify(roundTrip) !== JSON.stringify(value ?? null)) {
          fail("암호화 확인에 실패해 이 데이터는 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.");
        }
        if (await backend.replaceProtectedState(stateKey, row.updated_at, envelope)) {
          converted += 1;
          break;
        }
        if (attempt >= 2) {
          fail("다른 화면에서 같은 데이터를 저장하고 있어 바꾸지 못했습니다. 잠시 후 다시 눌러 주세요.");
        }
      }
    }

    const rows = await backend.loadProtectedStateRows(TEAM_LEAD_E2E_PROTECTED_STATE_KEYS);
    const allCurrent = rows.every((row) => isTeamLeadE2eEnvelope(row.state) && row.state.keyVersion === keyVersion);
    if (allCurrent) {
      await backend.deleteEnvelopesBelowVersion(keyVersion);
      previousKeys.clear();
    }
    return { converted };
  }

  /**
   * 열쇠 새로 고치기(P6): 새 데이터 키를 만들어 활성 기기·복구 코드에 감싸 두고, 세대를 올린 뒤
   * 보호 데이터 4개를 새 열쇠로 다시 암호화한다. 이전 팀장 기기처럼 해제된 열쇠가 예전에 알던
   * 데이터 키로는 이후 데이터를 열 수 없게 한다. 복구 코드는 다시 입력할 필요가 없다(공개키로 감싼다).
   */
  async function rotateDataKey() {
    const { session, meta, dataKey: currentKey } = await requireUnlocked();
    if (!meta.enabled) fail("데이터 잠그기를 먼저 해 주세요.");

    const activeHolders = (await backend.listHolders()).filter((row) => row.status === "active");
    if (!activeHolders.some((row) => row.kind === "recovery")) {
      fail("사용 중인 복구 코드가 없습니다. 복구 코드를 먼저 다시 발급해 주세요.");
    }

    const oldVersion = meta.currentKeyVersion;
    const newVersion = oldVersion + 1;
    const newKey = await generateTeamLeadDataKey();
    // 1) 새 세대 사본을 먼저 모든 활성 보관자에게 만든다. 여기서 실패하면 아무것도 바뀌지 않는다.
    for (const holder of activeHolders) {
      await backend.upsertEnvelope({
        holder_id: holder.id,
        key_version: newVersion,
        wrapped_dek: await wrapTeamLeadDataKey(newKey, await importTeamLeadPublicKey(holder.public_key)),
      });
    }
    // 2) 세대를 올린다. 이후 어느 탭에서 저장해도 새 열쇠로 저장된다.
    await backend.saveCryptoMeta({ ...meta, currentKeyVersion: newVersion, rotatedAt: backend.now() });
    previousKeys.set(oldVersion, currentKey);
    unlocked = { profileId: session.id, keyVersion: newVersion, dataKey: newKey };
    // 3) 데이터를 새 열쇠로 다시 암호화하고, 다 바뀌면 이전 세대 사본을 지운다.
    //    중간에 실패해도 이전 세대 사본이 남아 있어 읽을 수 있고, "이어서 암호화"로 마저 할 수 있다.
    const result = await migrateProtectedRows(session, newVersion, newKey);
    return { keyVersion: newVersion, converted: result.converted };
  }

  /** 이 기기에 있는 감싼 사본으로 특정 세대의 데이터 키를 연다. 없으면 null. */
  async function openDataKeyVersion(session: TeamLeadE2eSession, keyVersion: number) {
    if (unlocked && unlocked.profileId === session.id && unlocked.keyVersion === keyVersion) return unlocked.dataKey;
    const cached = previousKeys.get(keyVersion);
    if (cached) return cached;

    const holders = await backend.listHolders();
    const thisDevice = await resolveThisDevice(session, holders);
    if (!thisDevice.local || !thisDevice.holder || thisDevice.state !== "active") return null;
    const envelope = await backend.getEnvelope(thisDevice.holder.id, keyVersion);
    if (!envelope) return null;
    const dataKey = await unwrapTeamLeadDataKey(envelope.wrapped_dek, thisDevice.local.privateKey);
    previousKeys.set(keyVersion, dataKey);
    return dataKey;
  }

  /** 다른 세대로 저장된 데이터를 읽을 때 쓴다(새로 고치기 도중이거나 다른 탭에서 새로 고친 경우). */
  async function getDataKeyForVersion(profileId: string, keyVersion: number) {
    const session = await backend.getSession();
    if (!session || !session.approved || session.role !== "team_lead" || session.id !== profileId) return null;
    try {
      return await openDataKeyVersion(session, keyVersion);
    } catch {
      return null;
    }
  }

  function lock() {
    unlocked = null;
    previousKeys.clear();
  }

  /** P4에서 데이터 암호화·복호화에 사용한다. 잠겨 있으면 null. */
  function getUnlockedDataKey(profileId: string) {
    if (!unlocked || unlocked.profileId !== profileId) return null;
    return { keyVersion: unlocked.keyVersion, dataKey: unlocked.dataKey };
  }

  return {
    getStatus,
    registerThisDevice,
    setupKeys,
    unlock,
    approveDevice,
    revokeHolder,
    reissueRecoveryCode,
    recoverWithCode,
    encryptProtectedData,
    rotateDataKey,
    lock,
    getUnlockedDataKey,
    getDataKeyForVersion,
  };
}

export type TeamLeadE2eKeyManager = ReturnType<typeof createTeamLeadE2eKeyManager>;
