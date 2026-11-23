# 총괄팀장 데이터 종단간 암호화 설계 (1차)

상태: 설계안. 구현 전 검토와 승인이 필요하다. 운영 DB 적용, 배포, 커밋은 하지 않았다.

## 1. 목표와 범위

### 목표
- 개발자(Supabase/Vercel/GitHub 소유자 포함)가 SQL Editor, 테이블 편집기, service role 키, DB 백업 파일로 총괄팀장 데이터를 **읽을 수 없게** 한다.
- 개발자는 총괄팀장 페이지를 포함한 모든 코드를 **승인 없이** 계속 수정·배포할 수 있다.
- 총괄팀장 교체는 **앱 안에서만** 끝난다. 회사 공용 메일, 외부 계정, 개인 계정 인수인계가 필요 없다.
- 총괄팀장은 개발·운영 지식이 없어도 된다.

### 1차 암호화 대상 (`public.team_lead_state`의 4개 key)

| key | 내용 | 쓰는 화면 | 코드 |
| --- | --- | --- | --- |
| `scoreboard_v1` | 방송사고·라이브안전 수동 점수판 | `/team-lead/broadcast-accident`, `/team-lead/live-safety`, 종합점수 | `lib/team-lead/scoreboard.ts` |
| `reference_notes_v1` | 인원별 참고사항 메모 | `/team-lead/reference-notes`, 참고사항 인쇄 | `lib/team-lead/storage.ts` (`getTeamLeadReferenceNotesWorkspace`, `saveTeamLeadReferenceNotes`) |
| `contribution_manual_v1` | 기여도 수동 점수 | `/team-lead/contribution`, 종합점수 | `lib/team-lead/storage.ts` (`refreshTeamLeadMetaState`, `saveContributionManualStore`) |
| `best_report_quarters_v1` | 분기별 베스트리포트 확정 결과 | 베스트리포트 결과, 종합점수, 인쇄 | `lib/team-lead/storage.ts` (`getSavedBestReportQuarterSnapshots`, `saveCurrentBestReportResultsAsNextQuarter`) |

### 범위 밖 (이번 설계에서 바꾸지 않음)
- `reviews`, `submissions`(평가 원본), `review_access_v1`, `reviewer_selection_v1`, `submission_access_v1`, `best_report_current_v1`, `final_cut_v1`, `reviewer_name_chips_v1`.
- DESK 데이터 전체. 이미 적용한 RLS(`incremental_restrict_admin_privilege_escalation.sql`)로 유지한다.

## 2. 현재 구조에서 확인한 사실

- 4개 key의 읽기와 쓰기는 **모두 브라우저**(`"use client"` 모듈)에서 Supabase 클라이언트로 직접 한다. 서버 API와 서버 렌더링에서 이 값을 읽는 곳은 없다. 그래서 브라우저에서만 복호화하는 구조와 잘 맞는다.
- 4개 key에 대한 Realtime 구독과 localStorage 캐시는 없다(`review_access_v1` Realtime만 있음).
- `team_lead_state.state`는 `jsonb`다. 암호문 envelope도 jsonb로 저장할 수 있어 **테이블 구조 변경이 필요 없다**.
- DESK 최종컷 화면(`components/schedule/final-cut-page.tsx`)이 `refreshTeamLeadMetaState()`를 통해 `contribution_manual_v1`도 함께 읽지만, 화면에는 쓰지 않는다. 기여도 카드(`getContributionCards`)는 기여도 페이지와 점수판에서만 쓴다.
- RLS상 DESK도 `team_lead_state` 전체를 SELECT할 수 있다. 암호화 후 DESK에게는 암호문만 보인다. DESK 화면은 이 4개를 표시하지 않으므로 영향이 없어야 한다(구현 시 확인).
- 기여도와 분기 결과 저장은 **저장소 전체를 덮어쓰는 방식**이다. 잠긴 상태(복호화 전)에서 저장하면 빈 값으로 암호문을 덮을 위험이 있다. 6절의 쓰기 차단 규칙으로 막는다.

## 3. 핵심 아이디어

- 데이터는 **데이터 키(DEK, AES-GCM 256)** 하나로 암호화한다.
- DEK는 DB에 절대 평문으로 저장하지 않는다. 대신 **열쇠 보관자(holder)** 마다 그 보관자의 공개키로 감싼(wrap) 사본을 저장한다.
- 보관자는 두 종류다.
  1. **기기**: 총괄팀장이 쓰는 브라우저. 개인키는 그 브라우저의 IndexedDB에 **추출 불가(non-extractable)** 로 저장한다. 개인키가 DB에 없으므로 개발자가 DB를 가져가도 열 수 없고, PIN을 외울 필요도 없다.
  2. **복구 코드**: 처음 설정할 때 한 번 출력하는 긴 코드. 봉투에 넣어 팀 사무실에 보관한다. 코드로 복구용 개인키를 풀 수 있다.
- 복호화는 언제나 **총괄팀장 브라우저 안에서만** 일어난다. 서버, DB, 개발자는 암호문만 본다.

```
데이터 ──AES-GCM(DEK)──> 암호문(team_lead_state.state)
DEK ──RSA-OAEP(기기 A 공개키)──> 감싼 DEK #A   ┐
DEK ──RSA-OAEP(기기 B 공개키)──> 감싼 DEK #B   ├ team_lead_key_envelopes
DEK ──RSA-OAEP(복구 공개키)────> 감싼 DEK #R   ┘
복구 개인키 ──AES-GCM(PBKDF2(복구 코드))──> team_lead_key_holders.wrapped_private_key
```

## 4. 암호 방식 (WebCrypto만 사용, 외부 라이브러리 없음)

| 용도 | 알고리즘 | 비고 |
| --- | --- | --- |
| 데이터 암호화 | AES-GCM 256, 96-bit 무작위 IV | AAD에 `key 이름 + keyVersion`을 넣어 다른 행의 암호문을 바꿔치기해도 풀리지 않게 한다. |
| DEK 감싸기 | RSA-OAEP 3072, SHA-256 (`wrapKey`/`unwrapKey`) | 감싸는 쪽은 상대의 공개키만 있으면 된다. 인수인계 때 기존 팀장이 새 팀장 기기용 사본을 만들 수 있다. |
| 기기 개인키 보관 | IndexedDB, `extractable: false` | JS로도 원본을 꺼낼 수 없다. 사용(복호화)만 가능하다. |
| 복구 코드 | 무작위 160-bit, Base32 32자(4자씩 8묶음) | 엔트로피가 충분해 DB를 가져가도 대입 공격이 불가능하다. 사람이 고르는 PIN은 쓰지 않는다. |
| 복구 코드 → 키 | PBKDF2-SHA256 600,000회 + 무작위 salt → AES-GCM으로 복구 개인키 감싸기 | 복구 개인키는 감싼 상태로 DB에 저장한다. |
| 기기 확인 코드 | SHA-256(공개키 SPKI)의 앞부분 → 숫자 6자리 | 새 기기 승인 때 화면에 보이는 코드와 비교하는 데 쓴다(7.3절). |

암호문 envelope 형식(`team_lead_state.state`):

```json
{ "enc": "tl-e2e-v1", "keyVersion": 1, "iv": "<base64>", "ct": "<base64>" }
```

## 5. DB 변경 (별도 SQL 파일, 사람 승인 후 적용)

새 SQL 파일 `supabase/incremental_team_lead_e2e_keys.sql`(가칭)에 아래 내용을 담는다.

### 5.1 `public.team_lead_key_holders`
| 컬럼 | 설명 |
| --- | --- |
| `id uuid pk` | |
| `kind text` | `'device'` 또는 `'recovery'` |
| `profile_id uuid null` | 기기 소유 팀장. 복구 코드는 null |
| `label text` | 예: "사무실 PC · Chrome", "복구 코드(2026-11 발급)" |
| `public_key text` | SPKI base64 |
| `fingerprint text` | 6자리 확인 코드 |
| `wrapped_private_key text null` | 복구 코드일 때만. PBKDF2 키로 감싼 복구 개인키 |
| `kdf jsonb null` | 복구 코드일 때만. `{ salt, iterations }` |
| `status text` | `'pending'`, `'active'`, `'revoked'` |
| `created_at`, `approved_by`, `approved_at`, `revoked_at` | 감사 기록 |

### 5.2 `public.team_lead_key_envelopes`
| 컬럼 | 설명 |
| --- | --- |
| `holder_id uuid` | `team_lead_key_holders.id` |
| `key_version int` | DEK 세대 |
| `wrapped_dek text` | 보관자 공개키로 감싼 DEK |
| `created_by`, `created_at` | |
| PK `(holder_id, key_version)` | |

### 5.3 암호화 활성 상태
- `team_lead_state`에 `key = 'crypto_meta_v1'`을 추가한다. `state = { enabled, currentKeyVersion, protectedKeys: [...], enabledAt }`. 비밀값은 없다.

### 5.4 RLS
- 두 새 테이블은 **승인된 `team_lead`만** select·insert·update·delete할 수 있다. `admin`, `desk`, 그 밖의 역할은 접근할 수 없다.
- 기기 등록(insert, `status='pending'`)은 `profile_id = auth.uid()`이고 본인이 `team_lead`일 때만 허용한다.
- 이 RLS는 **보안 경계가 아니라 실수 방지용**이다. 보안은 암호에 달려 있다. 개발자가 RLS를 우회해도 감싼 DEK를 풀 개인키가 없다.

### 5.5 평문 덮어쓰기 방지 트리거
- `crypto_meta_v1.enabled = true`이면, 보호 대상 4개 key에 envelope 형식(`enc = 'tl-e2e-v1'`)이 아닌 값을 쓰는 것을 거부한다.
- 잠긴 브라우저나 예전 코드가 평문 또는 빈 값으로 암호문을 덮어 데이터가 사라지는 사고를 막는다. 보안 장치가 아니라 데이터 보호 장치다.

## 6. 앱 변경

### 6.1 새 모듈 `lib/team-lead/e2e-crypto.ts` (client 전용)
- 기기 키 생성·IndexedDB 저장·조회, DEK 생성, wrap/unwrap, envelope 암호화·복호화, 복구 코드 생성·검증, fingerprint 계산.
- 서버 전용 env나 service role 키는 쓰지 않는다. `harness:boundaries` 규칙을 지킨다.

### 6.2 잠금 상태 모델
- `locked`: 이 브라우저에 활성 기기 키가 없거나 아직 풀지 않았다.
- `unlocked`: DEK를 메모리에 non-extractable `CryptoKey`로 갖고 있다. 탭을 닫으면 사라지고, 다음 방문 때 기기 키로 자동으로 다시 푼다.
- `disabled`: 암호화 전환 전. 지금처럼 평문으로 동작한다(전환 기간 호환).

### 6.3 저장소 연결 지점
| 위치 | 변경 |
| --- | --- |
| `applyTeamLeadMetaStateRows` (기여도) | envelope이면 복호화해서 캐시에 넣는다. 잠겨 있으면 빈 값과 함께 "잠김" 상태를 내보낸다. |
| `saveContributionManualStore` | 잠겨 있으면 저장을 거부하고 안내를 띄운다. 저장할 때는 암호화한 envelope을 쓴다. |
| `refreshScoreboardState` / 점수판 저장 | 같은 규칙 |
| `getTeamLeadReferenceNotesWorkspace` / `saveTeamLeadReferenceNotes` | 같은 규칙 |
| `getSavedBestReportQuarterSnapshots` / `saveCurrentBestReportResultsAsNextQuarter` | 같은 규칙. 분기 저장 실패 롤백 경로도 envelope으로 다시 쓴다. |
| `persistTeamLeadState` | 보호 대상 key는 envelope만 받도록 검사한다(트리거와 이중 확인). |

- DESK 최종컷 화면은 `contribution_manual_v1`을 복호화하지 않는다. 잠김을 오류로 표시하지 않고 조용히 무시한다.

### 6.4 새 화면 `/team-lead/security` ("보안 열쇠")
- 이 기기 상태(잠김/열림), 등록된 기기 목록(이름·등록일·승인자), 복구 코드 발급일
- 버튼: "이 기기 등록", "새 기기 승인", "기기 해제", "복구 코드로 열기", "복구 코드 다시 발급"
- 총괄팀장 메뉴에 추가하고, `/team-lead` 기존 접근 규칙(`hasTeamLeadAccess`)을 그대로 따른다.

## 7. 사용자 흐름

### 7.1 최초 설정 (현재 총괄팀장, 한 번)
1. 보안 열쇠 화면에서 "암호화 시작"을 누른다.
2. 앱이 이 기기 키를 만들고, 복구 코드를 화면에 보여 준다. 사용자는 "인쇄"를 누른다.
3. 인쇄한 코드의 마지막 4자리를 입력해 보관을 확인한다.
4. 앱이 DEK를 만들어 기기와 복구 코드용으로 감싸 저장한다. 그리고 기존 4개 평문 값을 읽어 암호화한 뒤 덮어쓴다. 마지막으로 `crypto_meta_v1.enabled = true`로 바꾼다.
5. 복구 코드 종이는 봉투에 봉인해 팀 사무실 지정 장소에 둔다.

### 7.2 팀장 교체 (앱 안에서만)
1. 현재 팀장이 새 팀장의 등급을 `team_lead`로 바꾼다. 지금과 같다.
2. 새 팀장이 자기 PC에서 로그인한 뒤 보안 열쇠 화면에서 "이 기기 등록"을 누른다. 화면에 **6자리 확인 코드**가 뜬다.
3. 현재 팀장이 자기 화면에서 "새 기기 승인"을 누르고 새 팀장이 불러 주는 6자리를 입력한다. 코드가 맞으면 그 기기용 DEK 사본이 만들어진다.
4. 새 팀장이 기존 팀장을 `member`로 내린다. 등급이 내려가는 순간 기존 팀장의 기기는 자동으로 `revoked` 처리된다. 기존 팀장 기기용 사본도 삭제한다.
5. (권장) 새 팀장 화면에 "열쇠 새로 고치기"를 띄운다. 새 DEK를 만들어 4개 값을 다시 암호화하고, 남은 기기와 복구 코드에만 다시 감싼다. 데이터가 작아 몇 초면 끝난다. 복구 공개키는 DB에 있으므로 복구 코드를 다시 입력할 필요가 없다.

기존 팀장이 갑자기 떠나 승인해 줄 수 없으면, 새 팀장이 사무실 봉투의 **복구 코드로 열기**를 한다. 연 뒤에는 앱이 복구 코드를 새로 발급하게 하고, 새 코드를 다시 봉인한다.

### 7.3 같은 팀장의 새 기기·브라우저
- 이미 등록된 다른 기기에서 6자리 확인 코드로 승인한다. 그런 기기가 없으면 복구 코드로 연다.
- 브라우저 데이터를 지우거나, 시크릿 창을 쓰거나, PC를 바꾸면 그 기기 키는 사라진다. 이 경우도 위 방법으로 다시 연다.

### 7.4 6자리 확인 코드가 필요한 이유
개발자는 DB에 "팀장 이름으로 된 가짜 기기"를 직접 넣을 수 있다. 확인 코드는 **실제 그 기기 화면을 보고 있는 사람만** 알 수 있으므로, 화면 없이 DB에만 넣은 기기는 승인할 수 없다.

## 8. 남는 위험 (숨기지 않음)

1. **악성 코드 배포는 막지 못한다.** 개발자가 "팀장 화면에서 복호화된 내용을 몰래 전송하는" 코드를 배포하면 팀장이 화면을 열 때 유출된다. 개발자가 인프라 소유자라서 그 기록도 지울 수 있다. 대응은 제도(보안서약서)뿐이다. 다만 SQL 조회 한 번으로 보던 지금보다 훨씬 고의적이고 눈에 띄는 행위가 필요해진다.
2. **평가 원본은 평문으로 남는다.** `reviews`가 평문이라 분기 결과는 SQL로 다시 계산해 낼 수 있다. 분기 결과 암호화의 효과는 2차(평가 원본 암호화) 전까지 제한적이다.
3. **과거 백업에는 평문이 남는다.** 전환 전 Supabase 백업(보존 기간 동안)에는 평문이 있다. 보존 기간이 지나면 사라진다.
4. **복구 코드 봉투가 유일한 비상 수단이다.** 봉투를 잃어버렸는데 활성 기기도 모두 사라지면 4개 데이터는 **누구도 복구할 수 없다.** 개발자도 마찬가지다.
5. **브라우저 의존.** 팀장이 시크릿 창만 쓰거나 브라우저 데이터를 자주 지우면 매번 복구 절차가 필요하다. 사무실 PC의 일반 창 사용을 안내해야 한다.
6. **동시 편집.** 지금처럼 전체 덮어쓰기 저장이라, 두 팀장이 인수인계 기간에 동시에 저장하면 마지막 저장이 이긴다. 기존 동작과 같다.

## 9. 구현 단계 (작은 PR로 나눔)

| 단계 | 내용 | 기존 동작 영향 |
| --- | --- | --- |
| P1 | `e2e-crypto.ts`와 단위 테스트(`tests/team-lead-e2e-crypto.test.mjs`). 암호화·복호화, wrap, 복구 코드, fingerprint, AAD 바꿔치기 거부 | 없음 |
| P2 | SQL: 두 테이블 + RLS + 등급 강등 시 기기 열쇠 자동 해제 트리거(`supabase/incremental_team_lead_e2e_keys.sql`). `schema.sql` 동기화. PGlite 테스트 `tests/team-lead-e2e-keys-rls.test.mjs` | 없음(테이블만 추가) |
| P3 | 보안 열쇠 화면(`/team-lead/security`): 기기 등록, 최초 열쇠 만들기(데이터 키 생성, 데이터 전환은 P5), 확인 코드 승인, 목록, 해제, 복구 코드 발급·인쇄·열기. 로직 `lib/team-lead/e2e-key-manager.ts`(테스트 `tests/team-lead-e2e-key-manager.test.mjs`), 저장소 연결 `lib/team-lead/e2e-keys.ts` | 총괄팀장 메뉴에 1개 추가 |
| P4 | 4개 key 읽기·쓰기에 envelope 처리 연결(`lib/team-lead/e2e-state-core.ts`, `e2e-state.ts`, 테스트 `tests/team-lead-e2e-state.test.mjs`). 평문이면 지금과 똑같이 동작. `storage.ts`는 암호문·보호 key를 만날 때만 암호 모듈을 동적으로 불러와 일반 화면 번들 크기를 유지 | 전환 전에는 없음 |
| P5 | 보안 열쇠 화면의 "데이터 잠그기" 버튼(`encryptProtectedData`: 암호화를 먼저 켜고, 행마다 암호화 → 왕복 확인 → `updated_at`이 같을 때만 덮어쓰기)과 평문 덮어쓰기 방지 트리거 `supabase/incremental_team_lead_e2e_plaintext_guard.sql`(켠 암호화 설정은 끄거나 지울 수 없음). 테스트 `tests/team-lead-e2e-plaintext-guard.test.mjs`, `tests/team-lead-e2e-key-manager.test.mjs` | 전환 후 잠긴 기기에서 4개 화면 편집 불가 |
| P6 | 열쇠 새로 고치기(`rotateDataKey`: 새 세대 사본을 활성 보관자 모두에게 먼저 만들고 → 세대를 올리고 → 4개 행을 다시 암호화 → 모두 바뀐 뒤 이전 세대 사본 삭제). 중간에 멈추면 이전 세대 사본으로 읽고 "이어서 암호화"로 마침. 승인됐던 기기가 마지막 새로 고치기 뒤 해제되면 화면이 새로 고치기를 권함. 보안 열쇠 화면에 교체 순서 안내, 관리자 화면에서 총괄팀장 등급을 내릴 때 확인 창. 세대 검사 트리거 `supabase/incremental_team_lead_e2e_key_version_guard.sql`(현재 세대 암호문만 저장, 세대 감소 금지). 기기 자동 해제는 P2 트리거가 이미 한다 | 관리자 화면 등급 저장 시 확인 창 1개 추가 |
| 알림 | 보안 관련 코드 변경 알림 메일. 빌드할 때 `next.config.ts`가 감시 대상 파일(`lib/team-lead/security-alert-core.ts`의 `isTeamLeadSecurityWatchedPath`) 지문을 서버 코드에 넣고, 매일 09:30(KST) Vercel Cron `/api/internal/team-lead/security-change-alert`가 지난 지문(`team_lead_state.security_code_manifest_v1`)과 비교해 바뀌면 승인된 총괄팀장 이메일로 알림. 처음 한 번은 "알림 시작" 메일. Git 커밋 정보 없이 배포되면 메일에 경고. 메일이 나간 뒤에만 기준 갱신. 남는 위험 1(악성 코드 배포)의 억지력일 뿐 차단은 아니다(알림 코드도 개발자가 바꿀 수 있지만, 바꾸는 배포 자체가 알림 대상이다) | 새 Cron 1개, 메일 발송 |
| 보강 | 비밀번호만 털린 총괄팀장 계정으로 데이터를 지우거나 망가뜨리는 것을 DB에서 거부(`supabase/incremental_team_lead_e2e_delete_guard.sql`): 잠근 뒤 보호 4개 행 삭제 금지, 마지막 활성 복구 코드와 현재 세대 사본 삭제·해제·바꿔치기 금지, 열쇠 값 변경·해제 열쇠 재사용 금지, 복구 코드 사본 없는 세대로 올리기 금지. 같은 매일 Cron이 암호문·설정·활성 복구 사본을 `team_lead_protected_backups`에 백업(35일 보관, service role 전용)하고, 총괄팀장·DESK·admin 계정(등급·승인·Auth 이메일)과 보안 열쇠 변화를 이전·현재 총괄팀장에게 메일로 알림(`lib/team-lead/security-watch-core.ts`, `team_lead_state.security_watch_snapshot_v1`). 알림은 하루 늦다 | SQL 1개, 메일 발송 |
| 2차 | `reviews` 평가 점수를 팀장 공개키로 암호화(평가자는 쓰기만 가능) | 별도 설계 |

## 10. 검증 계획

- `npm run test:regression`: 새 암호 단위 테스트 포함
- `npm run lint`, `npm run build`, `npm run harness:all`
- SQL: `harness:supabase`, `harness:supabase-grants`, `harness:env`, `harness:boundaries`
- e2e: `tests/team-lead-reference-notes-print.spec.ts`, `tests/print.spec.ts`(참고사항·분기 인쇄)
- 수동 확인(운영 전 테스트 계정):
  - 기기 2대 등록과 승인
  - 복구 코드로 열기
  - 등급을 내린 팀장의 기기가 잠기는지
  - DESK 최종컷 화면이 정상인지
  - SQL Editor에서 4개 key가 암호문인지
  - 잠긴 기기에서 저장 시도가 거부되는지

## 11. 결정이 필요한 항목

1. 복구 코드 봉투 보관 장소와 책임자(예: 팀 사무실 잠금 서랍)
2. 팀장 교체 시 "열쇠 새로 고치기"(DEK 교체)를 필수로 할지, 권장으로 둘지
3. 2차(평가 원본 암호화)를 언제 진행할지
