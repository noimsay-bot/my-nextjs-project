# 데이터 덮어쓰기 버그 탐색 프롬프트

아래 내용을 새 Claude Code 세션에 그대로 붙여넣어 실행한다.

---

JTBC News Camera Hub 저장소에서 "클라이언트 캐시가 DB 데이터를 덮어써서 지우는" 유형의 버그를 찾아줘. **코드 수정은 하지 말고 조사와 보고만** 해줘. 운영 DB에는 쓰기 금지, `.env.local` 값 출력 금지.

## 배경 (실제로 발생한 사고, 커밋 a18c61a에서 수정)
- `lib/vacation/storage.ts`는 모듈 전역 캐시(`vacationStoreCache`, 초기값 빈 store)를 두고, `writeStore()`가 캐시 전체를 `persistVacationStore()`로 Supabase에 upsert했다.
- DESK 근무표 페이지(`components/schedule/schedule-app.tsx`)는 휴가 데이터를 `refreshVacationStore()`로 불러오지 않은 채 `syncVacationMonthSheetFromGeneratedSchedule()`를 호출했다.
- 그 결과 빈 캐시에서 새 month state가 만들어져 `vacation_months`의 당첨자와 정원이 빈 값으로 덮어써졌다. 같은 저장 과정에서 그 사용자의 `vacation_requests`도 "stale"로 보고 삭제될 수 있었다.
- 또 저장할 때 바뀐 달만이 아니라 모든 달을 upsert해서, 오래된 화면 상태가 다른 사용자의 최신 데이터를 덮을 수 있었다.

## 찾아야 할 패턴
`lib/**/storage.ts`, `lib/**/*-storage.ts`, `lib/**` 아래 모듈 전역 캐시를 쓰는 저장 모듈 전부를 대상으로 본다. 예: schedule, published, desk-records, change-requests, equipment, team-lead, home-news, my-page, restaurants, election, vacation/extra-storage, auth.

1. **로드 전 저장**: 캐시 초기값이 빈 값이고, `refresh*()`를 거치지 않은 화면이나 함수에서 `write*`/`save*`/`persist*`가 호출될 수 있는가? 호출 경로를 컴포넌트까지 따라가서 확인한다.
2. **전체 upsert**: 바뀐 항목만이 아니라 캐시 전체(모든 월, 모든 행)를 upsert하는가?
3. **차집합 삭제**: "DB에 있는데 캐시에 없는 것"을 삭제하는가? 캐시가 비어 있거나 일부만 로드되면 대량 삭제로 이어진다.
4. **실패와 타임아웃 폴백**: refresh가 실패하거나 시간 초과될 때 빈 store나 fallback으로 캐시를 채운 뒤, 이후 저장을 허용하는가?
5. **동기화성 쓰기**: 단순히 화면을 여는 것(get*/overview/sync* 함수)만으로 DB 쓰기가 일어나는가? 특히 다른 데이터(게시 근무표 등)가 부분 로드된 상태라면 위험하다.
6. **부분 로드 캐시**: `refreshX({ monthKeys })`처럼 일부만 불러온 캐시를 근거로 전체를 저장하거나 정리하는가?
7. **낙관적 잠금 부재**: `updated_at` 비교 없이 upsert해서 다른 사용자의 동시 수정을 덮는가? `lib/schedule/month-version.ts` 패턴과 비교한다.
8. **서버 API**: `app/api/**/route.ts`에서 클라이언트가 보낸 전체 상태를 그대로 덮어쓰는 엔드포인트가 있는가?

## 진행 방법
- CLAUDE.md, `docs/ai-instructions.md`, `docs/SUPABASE.md`를 먼저 읽는다.
- 모듈별로 캐시 변수, refresh 함수, write/persist 함수, 호출하는 컴포넌트를 표로 정리한다.
- 의심 지점마다 **재현 시나리오**를 적는다. 어떤 사용자가 어떤 페이지를 어떤 순서로 쓰면 어떤 테이블의 무엇이 지워지거나 덮어써지는지까지 쓴다.
- 확실한 버그(CONFIRMED)와 가능성(PLAUSIBLE)을 구분하고, 심각도(데이터 손실 > 덮어쓰기 > 표시 오류) 순으로 정렬한다.
- 각 항목에 `파일:줄`, 영향 테이블과 컬럼, 최소 수정 방향(로드 전 저장 차단, 변경분만 upsert, 낙관적 잠금 등)을 적는다.
- Supabase 데이터 확인이 필요하면 읽기 전용 SELECT만, 그것도 먼저 나에게 허락을 받는다.

## 결과물
`docs/exec-plans/data-overwrite-audit.md`에 한국어 보고서로 저장하고, 마지막에 우선 수정할 상위 5개를 요약해줘.
