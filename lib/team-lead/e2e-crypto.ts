"use client";

// 총괄팀장 데이터 종단간 암호화(1차) 암호 모듈.
// 설계: docs/exec-plans/active/team-lead-e2e-encryption.md
//
// - 브라우저 WebCrypto만 사용한다. 서버 env, service role, 외부 라이브러리를 쓰지 않는다.
// - 이 모듈은 저장소(Supabase/IndexedDB)를 모른다. 순수 암호 연산만 담당한다.
// - 데이터 키(DEK)는 AES-GCM 256, 보관자(기기·복구 코드)는 RSA-OAEP 3072 공개키로 DEK를 감싼다.

export const TEAM_LEAD_E2E_ENVELOPE_FORMAT = "tl-e2e-v1";

export const TEAM_LEAD_E2E_PROTECTED_STATE_KEYS = [
  "scoreboard_v1",
  "reference_notes_v1",
  "contribution_manual_v1",
  "best_report_quarters_v1",
] as const;

export type TeamLeadE2eProtectedStateKey = (typeof TEAM_LEAD_E2E_PROTECTED_STATE_KEYS)[number];

export interface TeamLeadE2eEnvelope {
  enc: typeof TEAM_LEAD_E2E_ENVELOPE_FORMAT;
  keyVersion: number;
  iv: string;
  ct: string;
}

export interface TeamLeadE2eRecoveryKdf {
  alg: "PBKDF2-SHA256";
  salt: string;
  iterations: number;
  iv: string;
}

export interface TeamLeadE2eRecoveryHolderMaterial {
  /** 사용자에게 한 번만 보여 주고 인쇄하게 할 복구 코드. 저장하지 않는다. */
  recoveryCode: string;
  publicKey: string;
  fingerprint: string;
  wrappedPrivateKey: string;
  kdf: TeamLeadE2eRecoveryKdf;
}

export class TeamLeadE2eCryptoError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unsupported"
      | "invalid_envelope"
      | "key_version_mismatch"
      | "decrypt_failed"
      | "invalid_recovery_code"
      | "wrong_recovery_code"
      | "invalid_public_key",
  ) {
    super(message);
    this.name = "TeamLeadE2eCryptoError";
  }
}

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 3072,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  hash: "SHA-256",
};
const RSA_IMPORT_PARAMS: RsaHashedImportParams = { name: "RSA-OAEP", hash: "SHA-256" };
const AES_GCM_IV_BYTES = 12;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_SALT_BYTES = 16;
const RECOVERY_CODE_BYTES = 20; // 160-bit → Base32 32자
const RECOVERY_CODE_LENGTH = 32;
const RECOVERY_CODE_GROUP = 4;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function getSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new TeamLeadE2eCryptoError(
      "이 브라우저에서는 보안 열쇠 기능을 사용할 수 없습니다. 최신 브라우저에서 https 주소로 접속해 주세요.",
      "unsupported",
    );
  }
  return subtle;
}

function randomBytes(length: number) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 1) {
    binary += String.fromCharCode(view[index]);
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildAdditionalData(stateKey: string, keyVersion: number) {
  return new TextEncoder().encode(`${TEAM_LEAD_E2E_ENVELOPE_FORMAT}|${stateKey}|${keyVersion}`);
}

function assertKeyVersion(keyVersion: number) {
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new TeamLeadE2eCryptoError("열쇠 세대 번호가 올바르지 않습니다.", "key_version_mismatch");
  }
}

// ---------------------------------------------------------------------------
// 보호 대상 / envelope 판별
// ---------------------------------------------------------------------------

export function isTeamLeadE2eProtectedStateKey(key: string): key is TeamLeadE2eProtectedStateKey {
  return (TEAM_LEAD_E2E_PROTECTED_STATE_KEYS as readonly string[]).includes(key);
}

export function isTeamLeadE2eEnvelope(value: unknown): value is TeamLeadE2eEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.enc === TEAM_LEAD_E2E_ENVELOPE_FORMAT &&
    typeof candidate.keyVersion === "number" &&
    Number.isInteger(candidate.keyVersion) &&
    candidate.keyVersion >= 1 &&
    typeof candidate.iv === "string" &&
    typeof candidate.ct === "string"
  );
}

// ---------------------------------------------------------------------------
// 데이터 키(DEK)와 데이터 암호화
// ---------------------------------------------------------------------------

/**
 * 새 데이터 키. 새 보관자에게 감싸 줄 수 있어야 하므로 extractable로 만든다.
 * 메모리에만 두고 평문으로 저장하지 않는다.
 */
export async function generateTeamLeadDataKey() {
  return getSubtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptTeamLeadState(
  dataKey: CryptoKey,
  input: { stateKey: string; keyVersion: number; value: unknown },
): Promise<TeamLeadE2eEnvelope> {
  assertKeyVersion(input.keyVersion);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.value ?? null));
  const ciphertext = await getSubtle().encrypt(
    { name: "AES-GCM", iv, additionalData: buildAdditionalData(input.stateKey, input.keyVersion) },
    dataKey,
    plaintext,
  );
  return {
    enc: TEAM_LEAD_E2E_ENVELOPE_FORMAT,
    keyVersion: input.keyVersion,
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  };
}

export async function decryptTeamLeadState(
  dataKey: CryptoKey,
  input: { stateKey: string; keyVersion: number; envelope: unknown },
): Promise<unknown> {
  if (!isTeamLeadE2eEnvelope(input.envelope)) {
    throw new TeamLeadE2eCryptoError("암호화된 데이터 형식이 아닙니다.", "invalid_envelope");
  }
  if (input.envelope.keyVersion !== input.keyVersion) {
    throw new TeamLeadE2eCryptoError(
      "이 데이터는 다른 세대의 열쇠로 잠겨 있습니다. 화면을 새로고침해 주세요.",
      "key_version_mismatch",
    );
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await getSubtle().decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(input.envelope.iv),
        additionalData: buildAdditionalData(input.stateKey, input.envelope.keyVersion),
      },
      dataKey,
      fromBase64(input.envelope.ct),
    );
  } catch {
    throw new TeamLeadE2eCryptoError(
      "데이터를 열지 못했습니다. 열쇠가 맞지 않거나 데이터가 손상되었습니다.",
      "decrypt_failed",
    );
  }

  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

// ---------------------------------------------------------------------------
// 보관자 공개키 / DEK 감싸기
// ---------------------------------------------------------------------------

/** 기기 열쇠. 개인키는 추출 불가로 만들어 IndexedDB에만 보관한다. */
export async function generateTeamLeadDeviceKeyPair() {
  return getSubtle().generateKey(RSA_PARAMS, false, ["wrapKey", "unwrapKey"]);
}

export async function exportTeamLeadPublicKey(publicKey: CryptoKey) {
  return toBase64(await getSubtle().exportKey("spki", publicKey));
}

export async function importTeamLeadPublicKey(spkiBase64: string) {
  try {
    return await getSubtle().importKey("spki", fromBase64(spkiBase64), RSA_IMPORT_PARAMS, true, ["wrapKey"]);
  } catch {
    throw new TeamLeadE2eCryptoError("등록된 기기 공개키가 올바르지 않습니다.", "invalid_public_key");
  }
}

/**
 * 기기 확인 코드(6자리). 새 기기 화면에 보이는 값과 승인하는 쪽에서 DB 공개키로 계산한 값을
 * 비교해, 화면 없이 DB에만 넣은 가짜 기기를 승인하지 못하게 한다.
 */
export async function computeTeamLeadKeyFingerprint(spkiBase64: string) {
  const digest = new Uint8Array(await getSubtle().digest("SHA-256", fromBase64(spkiBase64)));
  const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return String(value % 1_000_000).padStart(6, "0");
}

export async function wrapTeamLeadDataKey(dataKey: CryptoKey, publicKey: CryptoKey) {
  return toBase64(await getSubtle().wrapKey("raw", dataKey, publicKey, { name: "RSA-OAEP" }));
}

export async function unwrapTeamLeadDataKey(wrappedDataKey: string, privateKey: CryptoKey) {
  try {
    return await getSubtle().unwrapKey(
      "raw",
      fromBase64(wrappedDataKey),
      privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new TeamLeadE2eCryptoError("이 기기의 열쇠로 데이터 키를 열지 못했습니다.", "decrypt_failed");
  }
}

// ---------------------------------------------------------------------------
// 복구 코드
// ---------------------------------------------------------------------------

function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return output;
}

function formatRecoveryCode(normalized: string) {
  const groups: string[] = [];
  for (let index = 0; index < normalized.length; index += RECOVERY_CODE_GROUP) {
    groups.push(normalized.slice(index, index + RECOVERY_CODE_GROUP));
  }
  return groups.join("-");
}

/**
 * 사람이 입력한 복구 코드를 정규화한다. 대소문자, 공백, 하이픈을 무시하고
 * Base32에 없는 숫자 0/1/8은 모양이 비슷한 O/I/B로 바꿔 받는다.
 */
export function normalizeTeamLeadRecoveryCode(input: string) {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B");

  if (normalized.length !== RECOVERY_CODE_LENGTH || ![...normalized].every((char) => BASE32_ALPHABET.includes(char))) {
    throw new TeamLeadE2eCryptoError(
      `복구 코드는 ${RECOVERY_CODE_LENGTH}자(4자씩 ${RECOVERY_CODE_LENGTH / RECOVERY_CODE_GROUP}묶음)입니다. 종이에 적힌 그대로 입력해 주세요.`,
      "invalid_recovery_code",
    );
  }
  return normalized;
}

async function deriveRecoveryWrappingKey(normalizedCode: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey("raw", new TextEncoder().encode(normalizedCode), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * 복구 코드 보관자를 만든다. 반환한 recoveryCode는 화면에 한 번 보여 주고 인쇄하게 한 뒤 버린다.
 * DB에는 publicKey, fingerprint, wrappedPrivateKey, kdf만 저장한다.
 */
export async function createTeamLeadRecoveryHolder(): Promise<TeamLeadE2eRecoveryHolderMaterial> {
  const subtle = getSubtle();
  const normalizedCode = encodeBase32(randomBytes(RECOVERY_CODE_BYTES)).slice(0, RECOVERY_CODE_LENGTH);
  // 개인키를 감싸 저장해야 하므로 이 순간에만 extractable로 만든다.
  const keyPair = await subtle.generateKey(RSA_PARAMS, true, ["wrapKey", "unwrapKey"]);
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const wrappingKey = await deriveRecoveryWrappingKey(normalizedCode, salt, PBKDF2_ITERATIONS);
  const wrappedPrivateKey = await subtle.wrapKey("pkcs8", keyPair.privateKey, wrappingKey, { name: "AES-GCM", iv });
  const publicKey = await exportTeamLeadPublicKey(keyPair.publicKey);

  return {
    recoveryCode: formatRecoveryCode(normalizedCode),
    publicKey,
    fingerprint: await computeTeamLeadKeyFingerprint(publicKey),
    wrappedPrivateKey: toBase64(wrappedPrivateKey),
    kdf: {
      alg: "PBKDF2-SHA256",
      salt: toBase64(salt),
      iterations: PBKDF2_ITERATIONS,
      iv: toBase64(iv),
    },
  };
}

/** 복구 코드로 복구용 개인키를 연다. 결과 키는 추출 불가다. */
export async function unlockTeamLeadRecoveryPrivateKey(
  recoveryCode: string,
  stored: { wrappedPrivateKey: string; kdf: TeamLeadE2eRecoveryKdf },
) {
  const normalizedCode = normalizeTeamLeadRecoveryCode(recoveryCode);
  if (stored.kdf.alg !== "PBKDF2-SHA256" || !Number.isInteger(stored.kdf.iterations) || stored.kdf.iterations < 100_000) {
    throw new TeamLeadE2eCryptoError("저장된 복구 정보 형식이 올바르지 않습니다.", "invalid_envelope");
  }

  const wrappingKey = await deriveRecoveryWrappingKey(
    normalizedCode,
    fromBase64(stored.kdf.salt),
    stored.kdf.iterations,
  );
  try {
    return await getSubtle().unwrapKey(
      "pkcs8",
      fromBase64(stored.wrappedPrivateKey),
      wrappingKey,
      { name: "AES-GCM", iv: fromBase64(stored.kdf.iv) },
      RSA_IMPORT_PARAMS,
      false,
      ["unwrapKey"],
    );
  } catch {
    throw new TeamLeadE2eCryptoError("복구 코드가 맞지 않습니다. 종이에 적힌 코드를 다시 확인해 주세요.", "wrong_recovery_code");
  }
}
