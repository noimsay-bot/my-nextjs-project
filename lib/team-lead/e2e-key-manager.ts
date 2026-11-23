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
  exportTeamLeadPublicKey,
  generateTeamLeadDataKey,
  generateTeamLeadDeviceKeyPair,
  importTeamLeadPublicKey,
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
  /** P5에서 데이터를 암호문으로 전환한 뒤 true가 된다. P3에서는 false. */
  enabled: boolean;
  currentKeyVersion: number;
  setupAt: string;
  setupBy: string;
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

  async function requireTeamLeadSession() {
    const session = await backend.getSession();
    if (!session || !session.approved || session.role !== "team_lead") {
      fail("총괄팀장 계정으로 로그인해야 보안 열쇠를 관리할 수 있습니다.");
    }
    if (unlocked && unlocked.profileId !== session.id) {
      unlocked = null;
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
    return {
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

  function lock() {
    unlocked = null;
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
    lock,
    getUnlockedDataKey,
  };
}

export type TeamLeadE2eKeyManager = ReturnType<typeof createTeamLeadE2eKeyManager>;
