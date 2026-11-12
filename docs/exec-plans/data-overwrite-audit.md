# 데이터 덮어쓰기 버그 감사 보고서

- 작성일: 2026-10-13
- 범위: `lib/**` 저장 모듈(모듈 전역 캐시 + DB 쓰기), 이를 호출하는 `components/**`, `app/(portal)/**`, `app/api/**/route.ts`
- 방법: 코드 정적 추적만 했다. 코드 수정, DB 접근(SELECT 포함), `.env.local` 열람은 하지 않았다.
- 기준 사고: 커밋 `a18c61a`(휴가 당첨내역 덮어쓰기 방지). `lib/vacation/storage.ts`에 `vacationStoreLoaded` 가드와 "바뀐 달만 upsert"가 들어간 상태를 기준으로 본다.

판정 기준

- **CONFIRMED**: 코드 경로만으로 재현 순서가 성립한다. 네트워크 실패나 타이밍처럼 외부 조건이 필요하면 그 조건을 시나리오에 적었다.
- **PLAUSIBLE**: 경로는 있지만 동시 사용, 다중 기기, 특정 데이터 형태 등이 겹쳐야 한다.
- 심각도: **데이터 손실** > **덮어쓰기** > **표시 오류**

---

## 1. 모듈별 캐시 / refresh / write 정리

| 모듈 | 캐시 변수 (초기값) | refresh | write / persist | 로드 가드 | 저장 단위 | 낙관적 잠금 | 주요 호출 화면 |
|---|---|---|---|---|---|---|---|
| `lib/schedule/storage.ts` | `scheduleStateCache` (`defaultScheduleState`), `scheduleMonthKeyCache` (빈 Set) | `refreshScheduleState` | `saveScheduleState` → `persistScheduleStateNow` | **없음** | `schedule_settings.global`은 **매번 전체 upsert**, `schedule_months`는 바뀐 달만 | 월: 있음(`updated_at`) / settings: **없음** | `schedule-app.tsx`(자동저장), 휴가 관리 `근무 반영`, 추가휴가 `얹기`, 변경요청 승인/롤백 |
| `lib/schedule/published.ts` | `publishedSchedulesCache` (`[]`) | `refreshPublishedSchedules({monthKeys, repair})` | `persistPublishedItem`, `savePublishedSchedules`, `publishSchedule`, repair 시 자동 저장 | 부분(바뀐 항목만) | 월 단위 | 있음 | DESK 근무표, 홈 `PublishedSchedulesPanel`(DESK면 repair) |
| `lib/schedule/desk-records.ts` | `deskRecordCache` (`null` → localStorage/seed) | `refreshDeskRecordStore` | `saveDeskRecordStore` → `persistDeskRecordStoreNow` + `cleanupDeskPriorityScheduleArtifacts` | **없음** | settings 행 전체 + **모든 달** `schedule_months` upsert | **없음** | `desk-records-page.tsx`, `schedule-app.tsx`(휴가칸 삭제/복원) |
| `lib/schedule/change-requests.ts` | `requestCache` (`[]`) | `refreshScheduleChangeRequests` | insert / update / delete, 승인 시 근무표 반영 | 쓰기 직전 DB 재조회 | 요청 1건 + 관련 월 | 요청 상태 조건 **없음** | DESK 근무표, 게시 근무표 패널 |
| `lib/vacation/storage.ts` | `vacationStoreCache` (빈 store), `vacationStoreLoaded` | `refreshVacationStore` | `writeStore` → `persistVacationStore` | 있음(`a18c61a`) | 바뀐 달만 / 본인 신청 전체 | **없음** | `/vacation`, `/schedule/vacations`, `schedule-app.tsx` |
| `lib/vacation/extra-storage.ts` | `extraStoreCache` (`{units:[],requests:[]}`) | `refreshExtraStore` | 단위별 update / insert / delete | **없음** | 단위 행 1개 | **없음** | `/schedule/vacations`, `/vacation` |
| `lib/team-lead/storage.ts` (일정배정) | `assignmentStoreCache`, `assignmentLoadedMonthKeys` | `refreshTeamLeadAssignmentMonth(s)` | `saveScheduleAssignmentStore` | 있음(로드 안 된 달 저장 보류) | 월 단위 | 있음 | 팀장 일정배정 |
| `lib/team-lead/storage.ts` (기여도/정제본) | `contributionManualCache` (`{}`), `finalCutCache` (`{}`) | `refreshTeamLeadMetaState` | `saveContributionManualStore` / 정제본은 RPC | 기여도: **없음** | 기여도: **전 연도 JSON 전체** | 기여도: **없음** / 정제본: 있음 | `contribution-page.tsx`, `final-cut-page.tsx` |
| `lib/team-lead/scoreboard.ts` | `scoreboardCache` (빈 store) | `refreshScoreboardState` | `saveScoreboardStore` | **없음** | **전 카테고리, 전 연도 JSON 전체** | **없음** | `manual-score-board-page.tsx` |
| `lib/team-lead/storage.ts` (평가자 이름칩) | 컴포넌트 state | `loadTeamLeadReviewerNameChips` | `saveTeamLeadReviewerNameChips` | 화면 플래그(실패 시에도 true) | 행 전체 | **없음** | `reviewer-role-page.tsx` |
| `lib/home-popup/storage.ts` + `app/api/home/public-workspace` | `noticeListCache` 등 | `refreshHomePopupNoticeWorkspace` | `persistNotices` / 서버 `persistHomeWorkspace` | 쓰기 직전 DB 재조회 | 공지·디데이·커뮤니티 글·댓글이 **한 행의 JSON** | **없음** | 홈, 공지/커뮤니티 |
| `lib/election/storage.ts` | (컴포넌트 draft) | `fetchElectionWorkspace` | `saveElectionWorkspace` | 화면 `canManage` | 이벤트의 **전체 포인트 delete → insert** | **없음** | `election-page.tsx`(자동저장) |
| `lib/my-page/work-calendar-custom-texts.ts` | 컴포넌트 state (`{}`) | `loadMyWorkCalendarCustomTexts` | `saveMyWorkCalendarCustomTexts` | **없음** | 본인 설정 행 전체 | 없음 | `my-work-calendar-page.tsx` |
| `lib/equipment/storage.ts` | – | – | 전부 RPC | – | 항목 단위 | RPC 내부 | 장비 (**안전**) |
| `lib/corporate-card/storage.ts` | – | – | 항목 단위 upsert / RPC | – | 항목 단위 | – | 법인카드 (**안전**) |
| `lib/schedule/assembly-sync.ts` | – (서버) | – | `schedule_months` update | – | 월 | 있음(재시도) | 국회 연동 (**안전**) |
| `lib/auth/storage.ts` | `cachedUsers` (localStorage) | `refreshUsers` | `profiles.update` 단일 컬럼 | – | 컬럼 단위 | – | 관리자 (오류 무시만 있음) |

---

## 2. 발견 사항 (심각도 순)

### [데이터 손실]

#### L-1. DESK 기록(근속휴가/건강검진) 화면이 로드 전에 편집 가능하고, 저장 시 모든 달 근무표의 휴가칸을 지운다 — CONFIRMED

- 위치
  - `components/schedule/desk-records-page.tsx:34-56`: `syncFromCache()`가 `refreshDeskRecordStore()`보다 먼저 실행되어 `setLoaded(true)`가 된다. refresh가 실패해도 `catch`에서 `setLoaded(true)`가 된다.
  - `lib/schedule/desk-records.ts:264` `ensureDeskRecordCache()`: 캐시가 없으면 **이 브라우저의 localStorage, 그것도 없으면 하드코딩된 seed**로 채운다.
  - `lib/schedule/desk-records.ts:558` `saveDeskRecordStore` → `:418` `persistDeskRecordStoreNow`: 두 종류(long-service-leave, health-check) 전체를 `schedule_settings`의 desk-records 행에 upsert한다.
  - `lib/schedule/desk-records.ts:436-505` `cleanupDeskPriorityScheduleArtifacts`: 위 store에 없는 `근속휴가:이름`, `건강검진:이름` 항목을 `schedule_settings.global.state.vacations`(`:473`)와 **모든 달의 `draft_state`·`published_state`**(`:503`)에서 지운다. 잠금 없이 upsert한다.
- 재현 시나리오
  1. DESK A가 새 PC(또는 localStorage가 오래된 브라우저)에서 `/schedule/…` 근속휴가 기록 페이지를 연다.
  2. 화면이 곧바로 seed나 오래된 localStorage 목록으로 그려진다. refresh 응답이 느리거나 실패하면 그 목록이 그대로 남는다.
  3. A가 "행 추가"나 셀 하나를 수정한다(`updateEntries`, `:66-70`).
  4. 180ms 뒤 `schedule_settings`의 desk-records 행이 seed/로컬 목록 전체로 덮어써진다. 다른 종류(건강검진)도 함께 덮인다.
  5. 이어서 cleanup이 모든 달 초안·게시 근무표에서 DB 목록에만 있던 사람의 `근속휴가:`·`건강검진:` 휴가 항목을 지운다.
- 영향: `schedule_settings`(desk-records 키) `state` 전체, `schedule_settings.global.state.vacations`, `schedule_months.draft_state/published_state`의 `days[].assignments.휴가`, `days[].vacations`
- 최소 수정 방향
  - 페이지에서 refresh가 성공한 뒤에만 `loaded=true`로 바꾸고, 실패하면 편집을 막는다.
  - 모듈에 `deskRecordLoaded` 플래그를 두고 `saveDeskRecordStore`에서 로드 전 저장을 막는다. vacation의 `writeStore` 가드와 같은 방식이다.
  - 수정한 kind만 저장한다. cleanup은 바뀐 항목(이전 store와 다음 store의 차이)만 스크럽하고, `schedule_months`는 `updated_at` 조건으로 update한다.

#### L-2. 근무표 load 실패 후 `schedule_settings.global`이 기본값으로 덮어써진다 — CONFIRMED (load 실패가 조건)

- 위치
  - `lib/schedule/storage.ts:33`: 캐시 초기값이 `defaultScheduleState`다(orders는 seed, pointers는 기본값, vacations는 `""`, snapshots는 `{}`).
  - `lib/schedule/storage.ts:209-213`: `persistScheduleStateNow`는 바뀐 달이 없어도 **항상** settings 전체를 upsert한다.
  - `lib/schedule/storage.ts:360` `saveScheduleState`: 로드 여부를 확인하지 않는다.
  - 경로 A, `components/schedule/schedule-app.tsx:803-812`: `refreshRouteData`의 `catch`가 `readStoredScheduleState()`(최초면 기본값)를 state로 넣는다. `:829-833` `finally`에서 `setLoaded(true)`가 되고, `:841-845` 자동저장 effect가 곧바로 `saveScheduleState(state)`를 호출한다.
  - 경로 B, `app/(portal)/schedule/vacations/page.tsx:302-313`: `loadMonth`가 `refreshScheduleState()` 실패를 삼킨다. `:519` "근무 반영" → `lib/vacation/storage.ts:1540` `applyVacationMonthToSchedule`가 `readStoredScheduleState()`(기본값)를 바탕으로 `:1605` `saveScheduleState`를 호출한다.
  - 경로 C, `lib/vacation/extra-storage.ts:945-981` `applyExtraUnitToSchedule`: 경로 B와 같다. refresh 없이 캐시를 쓴다.
- 재현 시나리오(경로 B)
  1. DESK가 새 탭에서 `/schedule/vacations`를 바로 연다.
  2. `refreshScheduleState()`는 모든 달 `draft_state`와 desk-records를 읽어서 가장 무겁다. 이 요청만 타임아웃이나 오류로 실패하고 published·vacation 조회는 성공한다. 경고 메시지만 뜨고 버튼은 활성 상태로 남는다.
  3. "근무 반영"을 누르면 `vacations`가 그 달 당첨자만 담긴 상태가 되고, 나머지 settings는 기본값이 된다. 이 값이 `schedule_settings.global`에 upsert된다.
  4. 다른 달의 휴가 텍스트, `orders`, `pointers`, `monthStartPointers`, `offPeople`, `generalTeamPeople`, `snapshots`가 모두 초기값으로 바뀐다. 다음 근무표 생성 순번이 깨진다.
- 영향: `schedule_settings`(key=`global`) `state` 전체
- 최소 수정 방향
  - `scheduleStateLoaded` 플래그를 두고, 로드 전에는 `saveScheduleState`를 거부한다.
  - `applyVacationMonthToSchedule`과 `applyExtraUnitToSchedule`은 시작할 때 `await refreshScheduleState()`를 하고, 실패하면 중단한다.
  - settings는 바뀐 경우에만 쓰고, 낙관적 잠금을 적용한다(O-1 참고).

#### L-3. 팀장 수동 점수판(방송사고/생방안전 등)이 로드 전에 빈 store로 전체 덮어써진다 — CONFIRMED (타이밍)

- 위치
  - `lib/team-lead/scoreboard.ts:119`: 초기값이 빈 store다. 로드 플래그가 없다.
  - `lib/team-lead/scoreboard.ts:217-258` `saveScoreboardStore`: **전 카테고리, 전 연도**를 `team_lead_state`(scoreboard 키)에 upsert한다(`:235`). `updated_at` 조건이 없다.
  - `components/team-lead/manual-score-board-page.tsx:130-157`: 카드가 `SCHEDULE_STATE_EVENT` 등 이벤트로도 그려진다. `refreshScheduleState()`가 먼저 끝나면 `refreshScoreboardState()`가 끝나기 전에 빈 점수 카드가 노출된다. `refreshScoreboardState`는 meta 조회와 베스트리포트 workspace를 모두 기다려서 느리고, 실패하면 빈 상태로 남는다.
  - `:208`, `:231` `updateTeamLeadManualScoreItems` → 저장
- 재현 시나리오: 팀장이 점수판에 들어간다 → 근무표 로드가 끝나 카드가 모두 "기본 100점"으로 보인다 → 아직 scoreboard 로드가 안 됐거나 실패한 상태에서 한 사람에게 항목을 추가한다 → `team_lead_state.scoreboard`가 `{그 연도/그 카테고리/그 사람}`만 남은 JSON으로 덮인다. 다른 사람, 다른 카테고리, 다른 연도, `selectedFinalCutQuarterKeys`가 사라진다.
- 영향: `team_lead_state`(scoreboard 키) `state` 전체
- 최소 수정 방향: `scoreboardLoaded` 가드를 둔다. 로드 전에는 카드를 그리지 않거나 편집을 막는다. 저장은 `updated_at` 조건 update로 바꾸고, 충돌하면 최신 행에 바뀐 부분(카테고리/연도/이름 단위)만 다시 병합한다. `persistFinalCutState` 패턴을 그대로 쓰면 된다.

#### L-4. 기여도 수동 점수가 로드 전에 빈 캐시로 전체 덮어써진다 — CONFIRMED (타이밍/실패)

- 위치
  - `lib/team-lead/storage.ts:260`: `contributionManualCache = {}`
  - `lib/team-lead/storage.ts:1745-1770` `saveContributionManualStore`: 캐시 전체(모든 연도)를 `persistTeamLeadState`(`:1137-1150`, 무조건 upsert)로 쓴다.
  - `components/team-lead/contribution-page.tsx:170-199`: `Promise.all` 중 하나가 실패해도 `SCHEDULE_STATE_EVENT`/`TEAM_LEAD_SCHEDULE_ASSIGNMENT_EVENT` 리스너가 카드를 그린다. meta 로드 전이나 실패 상태에서 `:249` `updateContributionManualItems`가 가능하다.
- 재현 시나리오: `refreshTeamLeadMetaState()`만 실패하거나 늦은 상태 → 카드에서 한 사람의 수동 점수를 저장 → `team_lead_state`(contribution 키)가 그 사람 1명분만 남는다. 다른 사람과 다른 연도가 사라진다.
- 영향: `team_lead_state`(contribution 키) `state` 전체
- 최소 수정 방향: meta 로드 플래그 가드를 두고, 저장을 `updated_at` 조건 + 이름 단위 병합으로 바꾼다.

#### L-5. 근무 변경 요청 "롤백"이 그 달 근무표 전체를 승인 당시 스냅샷으로 되돌린다 — CONFIRMED (설계)

- 위치: `lib/schedule/change-requests.ts:578-595` `restoreScheduleStateSnapshots`, `:597-612` `restorePublishedScheduleSnapshots`. 월 단위 `GeneratedSchedule` 통째로 교체한다. 직전에 refresh해서 최신 `updated_at`을 받으므로 낙관적 잠금이 이 덮어쓰기를 막지 못한다.
- 재현 시나리오: 3월 2일 요청 A 승인 → 이후 같은 달에 휴가 반영, 다른 변경 요청 B 승인, DESK 수기 수정 → 3월 10일 A 롤백 → 그 달 초안과 게시본이 3월 2일 상태로 돌아가서 B와 휴가 반영, 수기 수정이 모두 사라진다. 롤백된 A의 스냅샷 기준으로 B의 상태도 맞지 않게 된다.
- 영향: `schedule_months.draft_state`, `published_state`(요청이 걸친 달 전체)
- 최소 수정 방향: 롤백은 스냅샷 전체 복원이 아니라 요청 route의 역회전(`rotateAssignmentsAcrossSchedules`를 역순 route로)으로 처리한다. 또는 롤백 전에 "승인 이후 그 달이 바뀌었는지(`updated_at` 비교)"를 확인하고, 바뀌었으면 거부하거나 경고한다.

#### L-6. 선거 중계표 저장이 포인트 전체 delete 후 insert이고 비원자적이다 — PLAUSIBLE

- 위치: `lib/election/storage.ts:580-600`. delete(`:580`)가 성공하고 insert(`:595`)가 실패하면 그 이벤트의 포인트가 0개가 된다. 자동저장(`components/election/election-page.tsx` `runAutoSave`)이라 사용자가 인지하기 어렵다.
- 재현 시나리오: 관리자가 편집 중 네트워크가 끊기거나, 컬럼/제약 오류로 insert가 실패한다 → DB에는 빈 표만 남는다. 관리자 두 명이 동시에 편집하면 늦게 저장한 쪽의 draft가 상대 편집을 통째로 덮는다.
- 영향: `election_points`(event_id 단위 전체)
- 최소 수정 방향: 서버 RPC 한 트랜잭션에서 delete와 insert를 처리한다. `election_events.updated_at`으로 낙관적 잠금을 건다.

#### L-7. 휴가 신청: 오래된 캐시 기준 "stale" 판정으로 본인의 다른 기기 신청이 삭제된다 — PLAUSIBLE

- 위치: `lib/vacation/storage.ts:319-336`(캐시의 본인 신청 전체를 upsert), `:380-391`(DB에 있는데 캐시에 없는 본인 신청을 delete). `vacationStoreLoaded`는 한 번 true가 되면 내려가지 않는다. 타임아웃 폴백(`:498-509`)은 이전 캐시를 그대로 쓴다.
- 재현 시나리오: 사용자가 PC 탭을 열어둔 채 휴대폰으로 다른 달 휴가를 신청한다 → PC 탭에서 refresh가 타임아웃 폴백되거나 focus refresh 전에 신청을 수정·재제출한다 → 휴대폰에서 만든 `vacation_requests` 행이 "stale"로 삭제된다. DESK 계정이 추첨을 돌릴 때도 같은 함수가 DESK 본인 신청에 대해 실행된다.
- 영향: `vacation_requests`(본인 행)
- 최소 수정 방향: 차집합 삭제를 없애고, 이번 제출에서 대체한 `(month_key, requester_id, type)` 행만 지운다. upsert도 이번에 바뀐 신청만 한다.

#### L-8. 내 일정 직접입력이 로드 전/실패 시 빈 맵으로 덮어써진다 — CONFIRMED (실패 조건, 본인 데이터)

- 위치: `components/my-page/my-work-calendar-page.tsx:230-251`(`setCustomTexts({})` 후 비동기 로드, 실패해도 편집 가능), `:318` `persistCustomTexts` → `lib/my-page/work-calendar-custom-texts.ts:90-110`(맵 전체 upsert)
- 재현 시나리오: 로드가 실패하거나 아직 응답 전일 때 한 날짜에 문구를 입력한다 → `portal_user_settings`(custom texts 키)가 그 날짜 1건만 남는다. 다른 달 입력이 모두 사라진다.
- 최소 수정 방향: 로드 성공 플래그 전에는 입력을 막는다.

### [덮어쓰기]

#### O-1. `schedule_settings.global`에 버전 체크가 없고, 월 충돌 검사보다 먼저 써진다 — CONFIRMED

- 위치: `lib/schedule/storage.ts:209-213`(settings upsert) → `:233-258`(월 update와 충돌 검사). 월 충돌로 throw돼도 settings는 **이미 덮어써진 뒤**다. `components/schedule/schedule-app.tsx:841-845`는 state가 바뀔 때마다(셀 하나 수정도) settings 전체를 쓴다.
- 재현 시나리오: DESK A가 순번(orders/pointers)이나 휴가 텍스트를 수정한다 → 오전부터 근무표 탭을 열어둔 DESK B가 아무 날짜 셀이나 수정한다 → B의 오래된 settings가 A의 수정을 덮는다. 월 데이터는 충돌로 거부되지만 settings 덮어쓰기는 이미 일어났다. 같은 방식으로 `applyVacationMonthToSchedule`이 쓴 `vacations`가 다른 DESK의 오래된 탭에 의해 되돌려진다. 페이지를 여는 것만으로도 load 직후 자동저장 effect가 한 번 settings를 다시 쓴다(패턴 5).
- 영향: `schedule_settings`(global) `state` 전체
- 최소 수정 방향: settings는 이전 캐시와 비교해 바뀐 경우에만 쓴다. `updated_at` 조건 update로 바꾸고, 월 update가 모두 성공한 뒤에 쓰거나 RPC 한 트랜잭션으로 묶는다.

#### O-2. desk-records cleanup이 모든 달의 `draft_state`와 `published_state`를 잠금 없이 upsert한다 — CONFIRMED

- 위치: `lib/schedule/desk-records.ts:445-505`. 모든 `schedule_months`를 읽어서 바뀐 행을 `upsert`한다. `updated_at` 조건이 없고 `published_state`도 함께 다시 쓴다. `month-version` 캐시를 갱신하지 않는다.
- 재현 시나리오: DESK A가 근속휴가 날짜 하나를 삭제한다 → 그 사이 DESK B가 같은 달을 게시하거나 근무표를 수정한다 → A의 cleanup이 읽은 시점의 published/draft로 B의 변경을 덮는다. 또 A 본인의 근무표 탭은 `draftMonthVersions`가 낡아서 다음 저장이 "다른 곳에서 변경" 오류로 실패한다(표시 오류).
- 최소 수정 방향: 월별로 `.eq("updated_at", 읽은값)` update를 하고, 충돌 시 재시도한다. 바뀐 경우에만 `published_state`를 쓴다.

#### O-3. 휴가 추첨, 정원 저장이 `vacation_months`를 잠금 없이 upsert한다 — PLAUSIBLE

- 위치: `lib/vacation/storage.ts:362`(`vacation_months.upsert`), `:1523-1538` `runVacationLottery`(이미 추첨했는지를 **캐시 기준**으로 판단, `:1528`), `:1464` `setVacationCapacity`
- 재현 시나리오: DESK A, B가 둘 다 휴가관리 화면을 열어둔다 → A가 추첨한다 → B는 focus refresh 전에 추첨 버튼을 누른다 → B의 캐시에는 결과가 없으므로 다시 랜덤 추첨되어 A의 당첨 결과를 덮는다. 정원 수정도 같다.
- 영향: `vacation_months.annual_winners/compensatory_winners/limits/applied_at`
- 최소 수정 방향: `vacation_months.updated_at` 조건 update. 추첨은 서버 RPC에서 "winners가 비어 있을 때만" 쓰도록 조건부로 처리한다.

#### O-4. `syncVacationMonthSheetFromGeneratedSchedule`가 refresh 실패 후에도 이전 캐시로 쓴다 — PLAUSIBLE

- 위치: `lib/vacation/storage.ts:1226-1237`. refresh 실패를 무시하고, `vacationStoreLoaded`가 이전 방문으로 이미 true면 오래된 캐시를 바탕으로 그 달 행을 upsert한다. `a18c61a`의 가드는 "한 번도 로드하지 않은 경우"만 막는다.
- 재현 시나리오: DESK가 휴가관리 화면을 본 뒤 근무표 화면으로 이동한다 → 다른 DESK가 추첨한다 → 근무표 생성 시 refresh가 실패한다 → 이전 캐시(당첨자 없음)로 managed dates가 바뀌어 그 달 행이 upsert되고, 당첨 결과가 사라진다.
- 최소 수정 방향: refresh가 실패하면 저장하지 않는다(`catch`에서 return). 또는 "마지막 refresh 성공" 플래그를 refresh 시작 시 false로 내린다.

#### O-5. 휴가 관리 시트가 부분 로드된 게시 근무표 캐시로 managed dates를 다시 계산해서 쓴다 — PLAUSIBLE

- 위치: `lib/vacation/storage.ts:592-608`(`getEffectiveScheduleDateKeys`가 이전 달 게시본의 `nextStartDate`에 의존), `:782` `syncMonthStateToPublishedSchedule`. 조회 함수인 `getVacationMonthState`(`:1249`), `getVacationApplicantsOverview`(`:1423`), `getVacationWinnersByType`도 changed면 `writeStore`한다(패턴 5).
- 재현 시나리오: 게시 근무표 캐시가 `monthKeys` 한정으로 일부만 로드된 상태(`applyPublishedItemsToCache`는 병합 방식)이거나, `refreshPublishedSchedules`가 실패해 이전 캐시가 남은 상태에서 휴가관리 화면을 연다 → 이전 달이 없으면 시작일이 달라져 `managedDateKeys`가 바뀐 것으로 판정된다 → `applied_at=null`로 초기화되고, managed에서 빠진 날짜의 정원과 당첨자가 제거된 채 upsert된다.
- 최소 수정 방향: 조회 함수에서는 쓰지 않는다(시트 동기화는 명시적 버튼이나 근무표 생성 시점에만 한다). 계산에 필요한 이전 달 게시본이 캐시에 없으면 동기화를 건너뛴다.

#### O-6. 추가 휴가 단위의 정원·추첨을 오래된 캐시 기준으로 쓴다 — PLAUSIBLE

- 위치: `lib/vacation/extra-storage.ts:444-466` `setExtraUnitLimit`(`{...unit.limits}` 캐시 전체를 기록), `:706-737` `runExtraLottery`(캐시 기준 중복 추첨 판단, 캐시의 신청 목록으로 추첨), `:515-529` `submitExtraRequest`(캐시 기준 기존 신청 삭제, 삭제 오류 무시), `:258-277` 타임아웃 시 이전 캐시 유지
- 재현 시나리오: DESK 두 명이 동시에 다른 날짜의 정원을 바꾸면 늦게 저장한 쪽이 상대 변경을 되돌린다. 추첨은 B 화면 캐시에 없는 최근 신청자를 빠뜨리고 결과를 확정한다.
- 영향: `vacation_extra_units.limits/annual_winners/compensatory_winners`
- 최소 수정 방향: limits는 jsonb 키 단위 RPC로 갱신한다. 추첨 직전 `refreshExtraStore()` + `updated_at` 조건 update를 한다.

#### O-7. 평가자 이름칩: 로드가 실패해도 legacy/기본값을 자동저장한다 — CONFIRMED (실패 조건)

- 위치: `components/team-lead/reviewer-role-page.tsx:186-196`(`catch`에서 `setNameChipsLoaded(true)`, nameChips는 localStorage legacy 또는 초기값) → `:224-231` effect가 즉시 `saveTeamLeadReviewerNameChips`를 호출한다. 성공한 경우에도 화면을 열 때마다 1회 저장한다.
- 영향: `team_lead_state`(reviewer name chips 키)
- 최소 수정 방향: `catch`에서는 loaded를 true로 바꾸지 않는다(편집 차단). 자동저장은 사용자가 변경했을 때만 한다.

#### O-8. 게시 근무표 repair가 화면 열기만으로 초안을 게시본에 덮어쓴다(홈 포함) — PLAUSIBLE

- 위치: `lib/schedule/published.ts:288-322` `repairPublishedItems`, `:395-407` repair 결과 자동 저장. `canRepairPublishedGeneralAssignments`(`:271`)는 "일반/휴가 외 배정이 같으면" 게시본을 **초안 전체로 교체**한다. 호출처는 `components/schedule/schedule-app.tsx:782`, `components/schedule/published-schedules-panel.tsx:1249-1251`(DESK면 `repair: true`)이고, 이 패널은 홈(`components/home/home-deferred-widgets.tsx:71`, `mode="home"`)에서도 로드된다.
- 재현 시나리오: DESK가 초안에서 휴가칸이나 메모 등을 수정만 하고 아직 게시하지 않는다 → 그 DESK(또는 다른 DESK)가 홈을 연다 → repair가 그 초안을 게시본으로 저장한다. 미게시 초안이 의도치 않게 노출된다. 낙관적 잠금이 있어 동시 수정 손실은 막지만, 의도하지 않은 게시가 일어난다.
- 추가: 홈 초기 로드에서 DESK는 모든 달 `published_state`, 모든 달 `draft_state`, desk-records를 읽는다. CLAUDE.md의 "홈 초기 로드에 full-month fetch 금지"에 어긋난다(performance).
- 최소 수정 방향: 홈 패널은 `repair: false`로 둔다. repair는 명시적 게시나 버튼에서만 하고, 교체 범위를 `일반` 배정만으로 제한한다.

#### O-9. 홈 공지·디데이·커뮤니티가 한 행 JSON을 잠금 없이 read-modify-write한다 — PLAUSIBLE

- 위치: `lib/home-popup/storage.ts:1547-1560`(`getHomeWorkspaceForWrite`가 매번 재조회하는 점은 좋다), `:1562-1622` `persistNotices`(upsert), `app/api/home/public-workspace/route.ts:1040-1080` `persistHomeWorkspace`(서버도 같은 행에 upsert)
- 재현 시나리오: 직원 두 명이 거의 동시에 댓글을 단다. 또는 DESK가 공지를 수정하는 순간 직원이 댓글을 단다 → 두 요청이 같은 버전을 읽고 각자 쓴다 → 나중에 쓴 쪽이 먼저 쓴 댓글이나 공지 변경을 지운다.
- 영향: `home_popup_notice_state`(key=`active`) `body` 전체
- 최소 수정 방향: `updated_at` 조건 update와 재시도를 한다(서버·클라이언트 공통). 중장기로는 댓글과 글을 별도 테이블로 분리한다.

#### O-10. 근무 변경 요청 승인 update에 상태 조건이 없다 — PLAUSIBLE

- 위치: `lib/schedule/change-requests.ts:768-800`(DB 재조회 후 `status === "pending"` 확인), `:880-885`(`.update().eq("id")`만 사용하고 `.eq("status","pending")` 없음)
- 재현 시나리오: DESK 두 명이 같은 요청을 거의 동시에 승인한다 → 둘 다 pending을 읽고 각자 근무표를 회전한다. 각 저장 전 refresh로 버전이 맞아 잠금에 걸리지 않는다 → 두 번 교환되어 원상태가 되거나 엉킨다. 요청은 accepted로 기록되지만 근무표에는 반영되지 않은 상태가 된다.
- 최소 수정 방향: 근무표 반영 전에 `update ... where id=? and status='pending'`로 먼저 선점(claim)하고, 실패하면 중단한다.

### [표시 오류 / 경미]

| ID | 위치 | 내용 |
|---|---|---|
| D-1 | `lib/auth/storage.ts:1419-1460` | `profiles.update({approved/role})`를 `void`로 호출해 오류를 무시한다. 캐시와 화면은 성공으로 보이지만 DB는 그대로일 수 있다. |
| D-2 | `lib/team-lead/storage.ts:1500-1509` | 로드되지 않은 달의 편집은 저장하지 않고 refresh로 덮는다. 데이터 손실은 아니지만 사용자의 입력이 조용히 사라진다. |
| D-3 | `lib/schedule/desk-records.ts:503` | cleanup이 `month-version` 캐시를 갱신하지 않는다. 같은 사용자의 다음 근무표 저장이 거짓 충돌 오류로 실패한다(O-2와 같은 원인). |
| D-4 | `lib/vacation/storage.ts:448-453` | 미승인 세션이면 캐시만 비우고 `vacationStoreLoaded`를 내리지 않는다. 같은 SPA에서 계정을 바꾸는 경우 첫 refresh 전 짧은 창이 생긴다(실제 위험은 낮음). |
| D-5 | `lib/team-lead/storage.ts:827-870` | 일정배정 daily 백업이 같은 날짜 백업을 현재 상태로 upsert한다. 오늘 잘못된 상태가 저장되면 오늘 아침의 정상 백업이 덮인다(백업 테이블 한정). |

### 확인했지만 안전한 것

- `lib/equipment/storage.ts`: 쓰기가 모두 RPC다.
- `lib/corporate-card/storage.ts`: `schedule_item_id` 단위 upsert와 RPC를 쓴다.
- 일정배정(`saveScheduleAssignmentStore`): 로드 가드, 바뀐 달만, `updated_at` 잠금이 있다.
- 정제본(`persistFinalCutState`, `update_team_lead_final_cut_decision` RPC): 잠금과 재병합이 있다.
- 국회 연동(`lib/schedule/assembly-sync.ts:460-491`): 잠금과 재시도가 있다.
- 참고사항(`saveTeamLeadReferenceNotes`): 쓰기 직전 재조회 후 1명분만 바꾼다. 잠금은 없지만 경쟁 창이 짧다.
- `schedule_months` 월 단위 저장(`persistScheduleStateNow`의 월 부분, `persistPublishedItem`): 잠금이 있다.
- 서버 API 중 클라이언트가 보낸 전체 상태를 그대로 덮어쓰는 엔드포인트는 찾지 못했다. `home/public-workspace`는 action 단위로 받아 서버가 read-modify-write한다(O-9의 경쟁 문제만 있다).

---

## 3. 패턴별 요약

| 패턴 | 해당 항목 |
|---|---|
| 1. 로드 전 저장 | L-1, L-2, L-3, L-4, L-8, O-7 |
| 2. 전체 upsert | L-1(두 kind와 모든 달), L-3, L-4, O-1(settings), O-9 |
| 3. 차집합 삭제 | L-6(포인트 전체 delete), L-7(stale 신청 삭제), L-1(cleanup 스크럽) |
| 4. 실패/타임아웃 폴백 후 저장 | L-2, L-7, O-4, O-6, O-7, L-8 |
| 5. 화면 열기만으로 쓰기 | O-1(schedule-app load 직후 자동저장), O-5(휴가 조회 함수), O-7, O-8(홈 repair) |
| 6. 부분 로드 캐시 기반 저장 | O-5(published 부분 캐시) |
| 7. 낙관적 잠금 부재 | O-1, O-2, O-3, O-6, O-9, O-10, L-3, L-4, L-6 |
| 8. 서버 API 전체 덮어쓰기 | 없음(O-9는 서버 read-modify-write 경쟁) |

---

## 4. 우선 수정 상위 5개

1. **L-1 + O-2 DESK 기록(근속휴가/건강검진)**: 페이지가 refresh 전에 seed/localStorage로 편집 가능하고, 저장하면 기록 전체를 덮은 뒤 **모든 달 초안·게시 근무표의 휴가칸을 잠금 없이 지운다**. 로드 플래그 가드, 페이지 `loaded` 처리 수정, cleanup을 변경분과 `updated_at` 조건으로 바꾸는 것이 필요하다.
2. **L-2 + O-1 `schedule_settings.global`**: load 실패 후 기본값으로 저장되는 경로가 3곳(근무표 자동저장, 휴가 `근무 반영`, 추가휴가 `얹기`) 있다. 또 settings는 버전 없이 매 편집마다 통째로, 월 충돌 검사보다 먼저 써진다. `scheduleStateLoaded` 가드, 반영 함수 시작 시 refresh 필수화, settings 변경 감지와 잠금, 쓰기 순서 조정이 필요하다.
3. **L-3 + L-4 팀장 점수판·기여도 수동점수**: 빈 캐시 상태로 카드가 먼저 보이고, 저장하면 전 연도·전 인원 JSON을 덮어쓴다. 로드 가드와 `persistFinalCutState`식 잠금·재병합으로 바꾼다.
4. **O-3 + L-7 + O-4 휴가 저장 잔여 위험**: `vacation_months` 잠금 부재로 동시 추첨 시 결과가 재추첨되어 덮이고, 차집합 삭제로 다른 기기 신청이 지워지며, refresh 실패 후에도 이전 캐시로 저장된다. `updated_at` 조건 update, 조건부 추첨, 차집합 삭제 제거, refresh 실패 시 저장 금지가 필요하다.
5. **L-5 근무 변경 요청 롤백**: 월 전체 스냅샷 복원으로 승인 이후의 모든 수정(다른 요청, 휴가 반영)을 지운다. 역회전 방식으로 바꾸거나, 승인 이후 변경이 있으면 롤백을 차단한다. O-10(승인 선점 조건)도 같은 PR에서 처리하면 좋다.

## 5. 운영 DB 확인 결과 (2026-10-13, 읽기 전용 SELECT 1회)

사용자 승인을 받고 SELECT만 실행했다. 이름 목록은 출력하지 않고 건수만 봤다. 같은 날 후속 조회(DESK 기록 월별 분포, 휴가 신청 시점)는 권한 정책으로 막혀 실행하지 못했다.

### 5-1. `vacation_months`: 피해 흔적 있음

| 월 | updated_at (KST) | 관리일 | 정원 | 연차 당첨 | 대휴 당첨 | applied_at | 신청(연차/대휴) |
|---|---|---|---|---|---|---|---|
| 2026-04 | 10-03 18:26:41 | 19 | 0 | 0 | 0 | - | 0/0 |
| 2026-05 | 10-03 18:26:41 | 18 | 0 | 0 | 0 | - | 3/1 |
| 2026-06 | 10-03 18:26:41 | 25 | 25 | 18 | 36 | - | 10/19 |
| 2026-07 | 10-03 18:26:41 | 19 | 18 | 23 | 29 | - | 12/23 |
| 2026-08 | 10-03 18:26:41 | 24 | 21 | 42 | 51 | - | 16/26 |
| 2026-09 | 10-06 09:03:22 | 18 | 0 | 0 | 0 | - | 11/26 |
| 2026-10 | 10-13 09:23:53 | 18 | 0 | 0 | 0 | - | 15/26 |
| 2026-11 | 10-13 09:33:51 | 25 | 0 | 0 | 0 | - | 13/25 |
| 2026-12 | 10-08 13:42:39 | 19 | 0 | 0 | 0 | - | 0/0 |

- 4~8월 다섯 행의 `updated_at`이 **같은 초(10-03 18:26:41)**다. 수정 전 코드의 "모든 달 upsert"(배경 사고의 패턴 2)와 일치한다.
- 6~8월은 당첨자가 남아 있는데 **`applied_at`이 모두 비어 있다**. 근무 반영을 했다면 값이 있어야 하므로, 전체 upsert 과정에서 `syncMonthStateToManagedDates`가 `appliedAt=null`로 초기화한 것으로 보인다(O-5 경로).
- **9·10·11월은 신청이 각각 37·41·38건 있는데 정원과 당첨자가 모두 0**이다. 10월과 11월은 오늘(10-13) 09시대에 갱신됐다. `a18c61a` 수정 직전에 빈 캐시로 덮어쓴 배경 사고의 피해로 추정된다. 9월이 정말 추첨을 안 한 달인지는 DESK 확인이 필요하다.
- 복구 단서: 근무 반영을 했던 달은 `schedule_months.published_state`의 `휴가` 칸에 당첨자가 남아 있을 수 있다. 10월 게시본에 휴가 항목 100건이 있다(아래 5-3). 이것으로 당첨자를 역산할 수 있는지 추가 조회가 필요하다.

### 5-2. `schedule_settings`: 기본값 덮어쓰기 흔적은 없음

- `global`(10-13 10:15:53, DESK): orders 9개 카테고리 각 30명, pointers 비기본값, `vacations` 164줄(2026-04~12), `monthStartPointers` 2026-04~2027-01. 기본값(L-2)으로 덮인 흔적은 없다. `snapshots`는 비어 있다(정상 여부는 확인 필요).
- `desk_records_v1`(09-28 17:32:40, DESK): 근속휴가 35건(날짜 603개), 건강검진 36건(날짜 29개). seed는 날짜가 비어 있으므로 seed로 덮인 상태는 아니다.

### 5-3. `schedule_months`: 9월에 DESK 우선 휴가가 0건

| 월 | 초안 휴가 / 우선(근속·검진) | 게시 휴가 / 우선 |
|---|---|---|
| 2026-04 | 123 / 28 | 123 / 28 |
| 2026-05 | 120 / 30 | 120 / 30 |
| 2026-06 | 109 / 36 | 109 / 36 |
| 2026-07 | 169 / 43 | 139 / 36 |
| 2026-08 | 216 / 43 | 176 / 31 |
| **2026-09** | **100 / 0** | **100 / 0** |
| 2026-10 | 100 / 19 | 100 / 19 |
| 2026-11 | 83 / 12 | 83 / 12 |
| 2026-12 | 2 / 2 | 없음 |

- 9월만 근속휴가·건강검진 항목이 0건이다. DESK 기록에 9월 날짜가 있다면 L-1/O-2의 cleanup 스크럽이나 다른 덮어쓰기 피해일 수 있다. DESK 기록의 월별 날짜 분포 조회가 막혀서 확정하지 못했다.
- 7·8월은 초안과 게시본이 다르다(미게시 초안 편집). O-8(홈 repair)이 이 초안을 게시본으로 밀어 넣을 수 있는 상태다.

### 5-4. `team_lead_state`: 빈 JSON 흔적은 없음

- `scoreboard_v1`(09-18): 생방안전 2명, 방송사고 12명, 정제본 분기 선택 0건
- `contribution_manual_v1`(09-18): 2026년 28명
- `reviewer_name_chips_v1`(09-21): 31명
- 현재 비어 있는 상태는 아니다. 이전에 덮였다가 다시 입력됐는지는 이력이 없어 알 수 없다.

### 5-5. `home_popup_notice_state`: 크기 문제

- 한 행의 크기가 약 **4.25MB**다(공지 3, 글 33, 댓글 0). 쓰기 때마다 이 행 전체를 읽고 다시 쓴다. O-9의 경쟁 창이 넓어지고, egress 비용도 크다.

### 5-6. 후속 조회 결과 (같은 날, 사용자 권한 허용 후 SELECT)

**DESK 기록의 월별 날짜 분포**: 2026-02~08, 2026-10~2027-05에는 날짜가 있지만 **2026-09는 0건**이다. 따라서 9월 근무표에 우선 휴가가 0건인 것은 정상이다. 5-3의 9월 스크럽 의심은 **해소**됐다.

**휴가 신청 시점**: 6~11월 각 달 `vacation_requests`의 마지막 수정 시각이 모두 `2026-10-02 16:00:36`이다. 한 사용자의 저장이 본인 신청 전체(모든 달)를 다시 upsert하는 동작(L-7 경로)과 일치한다. 신청 행 자체는 남아 있다.

**게시 근무표의 휴가칸과 당첨자 비교** (관리일 기준, 근속·검진 제외, 신청자 이름 일치 건수)

| 월 | DB 당첨자 수 | 게시본 휴가 | 그중 신청자와 일치 |
|---|---|---|---|
| 2026-06 | 54 | 73 | 49 |
| 2026-07 | 52 | 103 | 69 |
| 2026-08 | 93 | 145 | 102 |
| **2026-09** | **0** | 100 | **78** |
| **2026-10** | **0** | 81 | **59** |
| **2026-11** | **0** | 71 | **67** |

- 9·10·11월 게시본에는 신청자와 이름이 일치하는 휴가가 각각 78·59·67건 들어 있다. **추첨과 근무 반영을 실제로 했고, 그 뒤 `vacation_months`의 당첨자와 정원만 지워진 것으로 판단한다**(배경 사고 피해 확정).
- 근무표 자체(게시본·초안)의 휴가는 남아 있다. 직원에게 보이는 근무표는 영향을 받지 않았고, 사라진 것은 휴가관리 화면의 추첨 결과·정원·반영 기록이다.
- 복구 방향: 게시본 휴가칸에서 "그 날짜의 신청자"를 당첨자로 역산해 `annual_winners`/`compensatory_winners`를 다시 채울 수 있다. 다만 6~8월 비교에서 보듯 일치 건수와 실제 당첨자 수가 다르다(DESK 수기 추가 휴가, 연차/대휴 구분 등). 그래서 자동 복구 대신 **DESK 검토용 복구안 CSV를 만들고 확인을 받은 뒤 쓰는 것**이 안전하다. 정원(`limits`)은 근무표에서 역산할 수 없으므로 DESK가 다시 입력해야 한다.
