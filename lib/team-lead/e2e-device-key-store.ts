"use client";

// 총괄팀장 기기 열쇠(추출 불가 RSA 개인키)를 이 브라우저의 IndexedDB에 보관한다.
// 설계: docs/exec-plans/active/team-lead-e2e-encryption.md
//
// - CryptoKey는 structured clone으로 저장되며 extractable:false 속성이 그대로 유지된다.
//   JS로도 개인키 원본을 꺼낼 수 없고, 복호화(unwrapKey)에만 쓸 수 있다.
// - 브라우저 데이터 삭제, 시크릿 창, 다른 PC에서는 열쇠가 없으므로 복구 절차가 필요하다.

const DB_NAME = "j-team-lead-e2e";
const DB_VERSION = 1;
const STORE_NAME = "device-keys";

export interface TeamLeadDeviceKeyRecord {
  /** 이 열쇠의 주인(총괄팀장) profiles.id. 같은 브라우저를 여러 계정이 써도 섞이지 않게 한다. */
  profileId: string;
  /** team_lead_key_holders.id. DB 등록 전이면 null. */
  holderId: string | null;
  privateKey: CryptoKey;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

function openDeviceKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("이 브라우저에서는 기기 열쇠를 저장할 수 없습니다. 일반 창(시크릿 창이 아닌)에서 열어 주세요."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "profileId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("기기 열쇠 저장소를 열지 못했습니다."));
    request.onblocked = () => reject(new Error("다른 탭이 기기 열쇠 저장소를 사용 중입니다. 다른 탭을 닫고 다시 시도해 주세요."));
  });
}

async function runDeviceKeyTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDeviceKeyDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("기기 열쇠 저장소 작업에 실패했습니다."));
      transaction.onabort = () => reject(transaction.error ?? new Error("기기 열쇠 저장소 작업이 취소되었습니다."));
    });
  } finally {
    database.close();
  }
}

export async function getTeamLeadDeviceKey(profileId: string) {
  const record = await runDeviceKeyTransaction<TeamLeadDeviceKeyRecord | undefined>("readonly", (store) =>
    store.get(profileId),
  );
  return record ?? null;
}

export async function saveTeamLeadDeviceKey(record: TeamLeadDeviceKeyRecord) {
  if (record.privateKey.extractable) {
    throw new Error("기기 열쇠는 추출 불가 개인키만 저장할 수 있습니다.");
  }
  await runDeviceKeyTransaction("readwrite", (store) => store.put(record));
}

export async function setTeamLeadDeviceKeyHolderId(profileId: string, holderId: string) {
  const current = await getTeamLeadDeviceKey(profileId);
  if (!current) {
    throw new Error("이 브라우저에 등록된 기기 열쇠가 없습니다.");
  }
  await saveTeamLeadDeviceKey({ ...current, holderId });
}

export async function deleteTeamLeadDeviceKey(profileId: string) {
  await runDeviceKeyTransaction("readwrite", (store) => store.delete(profileId));
}
