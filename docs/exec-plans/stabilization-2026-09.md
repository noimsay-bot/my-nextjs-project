# 2026-09-10 기능 보존 안정화 실행 기록

## 범위와 원칙

사용자가 전체 리뷰 개선사항의 구현 및 테스트를 요청했다. 시작점은 `main`의 `0af9666`이며 작업 시작 시 변경 파일과 미완료 merge는 없었다. 최근 휴가 추첨 정원 0명 동작, 화면/역할 규칙, App Router 구조를 유지한다. 운영 DB 적용, 배포, 커밋, push는 하지 않는다.

## 변경 파일과 이유

| 영역 | 주요 파일 | 변경 및 기존 기능 영향 |
| --- | --- | --- |
| 휴가 관리 | `app/(portal)/schedule/vacations/page.tsx` | 저장소 갱신 이벤트는 로컬 캐시만 반영한다. 초기 로딩/월 선택/창 포커스는 재조회하며 자체 이벤트에 따른 네트워크 반복을 제거한다. 정원·추첨 규칙은 유지한다. |
| 근무표 저장 | `lib/schedule/month-version.ts`, `storage.ts`, `published.ts` | 성공한 로컬 쓰기만 초안/게시의 일치하는 이전 버전을 함께 전진시킨다. 다른 사용자의 변경은 계속 충돌로 처리한다. 신규 행은 insert, 게시 저장은 변경 월만 처리하고 모든 쓰기가 끝난 뒤 실패 복구한다. |
| 휴가 반영 | `lib/vacation/storage.ts` | 근무표 반영 후 휴가 반영 기록 저장 결과를 기다린다. 후속 저장 실패를 성공으로 표시하지 않는다. 전체 과정을 단일 트랜잭션으로 바꾸지는 않았다. |
| 뉴스·장비 저장 | `lib/home-news/issue-set-actions.ts`, `app/api/equipment/live-status/route.ts` | 구성 교체/공식 발행/라이브 대여·반납을 각각 단일 RPC로 호출한다. 관리자/승인 경계 및 성공 응답을 유지한다. SQL 미적용 시 안내 오류를 반환한다. |
| 데이터베이스 | `supabase/incremental_atomic_news_and_live_status.sql`, `schema.sql` | 기존 RLS를 바꾸지 않는 invoker 함수. 뉴스 발행은 advisory lock, 장비는 테이블 쓰기/대상 장비 행 잠금으로 직렬화하고 실패하면 전체 작업을 롤백한다. |
| 회원 점수 | `lib/portal/member-level.ts` | 단일 회원은 author 필터 HEAD count, 복수 회원은 필요한 author만 조회한다. 월 순위는 세션별 60초 캐시/동시 요청 공유와 페이지네이션을 사용한다. 점수·제외 역할·동점 순서는 유지한다. |
| 홈 캐시 | `lib/home-popup/storage.ts` | 커뮤니티 제외 요청은 기존 서버 요약 경로를 사용해 정상 경로의 전체 본문 다운로드를 피한다. 전체 캐시를 빈 요약으로 덮지 않고 계정 전환 시 분리한다. localStorage 용량/보안 오류는 원격 성공을 실패로 만들지 않는다. 기존 호환성 fallback은 남긴다. |
| UI 경량화 | `components/effects/ShinyText.tsx`, `ShinyText.module.css` | Motion 애니메이션을 CSS로 바꾸고 속도/방향/왕복/지연/일시정지/hover 옵션을 유지한다. reduced-motion 환경에서는 움직이지 않는다. |
| 홈 장비 분리 | `components/equipment/live-equipment-status-home-panel.tsx`, `live-status-shared.tsx`, `equipment-pages.tsx`, `components/home/home-deferred-widgets.tsx` | 홈의 읽기 전용 현황판을 관리/입력 화면 모듈에서 분리하고 기존 표시 함수를 공유한다. 조회 항목과 상태 표시를 유지한다. |
| 서버 안정성 | `lib/server/mail-core.ts`, `fetch-text-with-timeout.ts`, `app/api/weather/dispatch-recommendation/route.ts` | 메일 디버그 개인정보/임시 비밀번호 출력을 제거한다. 날씨 외부 요청은 헤더부터 본문까지 요청당 8초 제한과 타이머 정리를 적용한다. 예보 선택 규칙은 유지한다. |
| 서버 클라이언트 타입 | `lib/supabase/admin.ts` | generic 함수의 ReturnType이 RPC 인자 타입을 undefined로 추론하던 캐시 선언을 SDK 기본 SupabaseClient 타입으로 맞춘다. 서버 전용 클라이언트 생성/권한/자격 증명 처리는 바꾸지 않는다. |
| 가입 보안 | `supabase/incremental_safe_profile_bootstrap.sql`, `repair_missing_profiles.sql`, `schema.sql` | 가입자가 선택한 특수 로그인 ID로 admin이 되는 경로를 없앤다. 기존 관리자를 강등하거나 승인 값을 변경하지 않는다. 신규 관리자 부트스트랩은 신뢰된 운영자 절차로 분리한다. |
| 의존성 | `package.json`, `package-lock.json` | 사용되지 않는 `xlsx`와 CSS로 대체한 `motion`을 제거한다. 로컬 SQL 테스트용 PGlite는 개발 의존성으로만 추가한다. |
| 하네스·CI | `scripts/harness/utils.mjs`, `check-generated-freshness.mjs`, `quality-score.mjs`, `.github/workflows/harness-check.yml` | 실행 시각과 mtime 의존을 없애고 생성될 내용을 비교한다. 동일 내용은 다시 쓰지 않으며 CI에서 회귀 및 오프라인 브라우저 검증을 수행한다. |
| 테스트 | `tests/*.test.mjs`, `tests/offline/*`, `scripts/tests/*`, `playwright.offline.config.ts`, `playwright.config.ts`, `tests/temporary-password-mail.spec.ts` | 저장/권한/캐시/롤백/타임아웃/생성물 재현성을 검증하고 합성 데이터로 데스크톱·모바일 화면을 검사한다. 기존 운영 인증 E2E와 분리한다. |

## 검증 상태

- `npm run test:regression`: 최종 56개 통과. 기준 schema와 incremental SQL의 함수 정의 일치 검사도 포함한다.
- `npm run test:e2e:offline`: 14개 통과. 로그인과 비로그인 보호, 합성 근무표의 모바일 pinch 확대/축소, 읽기 전용 장비 현황 및 CSS 애니메이션·hover·reduced-motion 검사.
- `npm run lint`: 통과. `npx tsc --noEmit`: 통과.
- `npm run build`: 통과. Next.js 15.5.14 최적화 빌드 및 70/70 페이지 생성 완료.
- `npm run harness:all`: 통과. 경계 경고 0개, 문서 링크 및 내용 기반 freshness 검사 통과. 두 번 연속 실행한 generated/quality/tracker 파일의 SHA-256이 동일하다. 가시성 점수 98/100은 서비스 무결성 보증이 아니다.
- `git diff --check`: 통과.
- SQL 검증은 메모리 내 엔진과 합성 사용자로 실행했다. 뉴스 교체 실패 시 원본 복구, 발행 실패 시 기존 공식 세트 유지, 장비 후반 실패 시 앞선 부모/자식 반납 복구, 일반 사용자 실행 차단, 가입 메타데이터 권한 상승 차단을 검사한다.
- `home_news_issue_sets`/`home_news_issue_set_items`의 운영 DDL은 저장소에 없으므로 뉴스 SQL 테스트 테이블은 최소 fixture다. 실제 정책/트리거/동시 다중 연결 검증을 대체하지 않는다.
- 중간 실패: 새 테스트 하네스의 Windows Unicode 경로 복사/Node preload 경로 및 테스트 줄바꿈/숨김 버튼 선택 문제를 수정했다. 빌드에서는 새 장비 RPC 호출의 기존 admin client generic ReturnType 선언 문제와 화면 분리 중 누락된 타입 import를 바로잡았다. 함수 일치 테스트에서 발견한 SQL 포맷 차이도 맞췄다. 모두 수정 후 재검증했으며 실패를 건너뛰지 않았다.

## 배포 전 필수 절차 — 운영 DB에는 미적용

1. 실제 운영 DB가 아닌 동일 스키마의 테스트 환경에서 먼저 검증한다. 뉴스 테이블의 UUID 키, `issue_date`, `briefing_slot`, `status`, `published_at`, `updated_by`, 항목의 `issue_set_id`, `briefing_id`, `display_order` 컬럼 및 기존 RLS/GRANT/트리거를 확인한다. 운영 스키마가 다르면 적용하지 말고 차이를 먼저 해결한다.
2. 신뢰된 운영자가 SQL Editor에서 `supabase/incremental_safe_profile_bootstrap.sql`을 적용한다. 기존 role/approved가 유지되고 신규 및 누락 프로필은 member로 생성되는지 확인한다. 최초 관리자 생성이 필요하면 본인 확인한 정확한 Auth UUID 한 건만 대상으로 별도 승인·감사 절차를 거친다.
3. `supabase/incremental_atomic_news_and_live_status.sql`을 적용한다. 파일은 BEGIN/COMMIT으로 묶여 있고 기존 테이블/RLS를 새로 만들거나 완화하지 않는다. 전체 `schema.sql`을 운영에 무작정 재실행하지 않는다.
4. 승인 admin/team_lead 뉴스 저장 및 발행, 일반 사용자 거부, 승인 desk/team_lead/admin 장비 저장, 비승인 사용자 거부를 확인한다. 장비 RPC는 authenticated/anon에서 실행할 수 없어야 한다.
5. 별도 DB 연결 2개로 같은 날짜/슬롯 동시 발행, 같은 장비의 현황 저장과 기존 대여/반납 동시 실행을 확인한다. 직렬화/실패 후 재조회가 정상이고 부분 저장이 없어야 한다. 장비 테이블 쓰기 잠금은 읽기를 막지 않지만 다른 쓰기를 기다리게 하므로 지연을 관찰한다.
6. RPC 적용 및 PostgREST schema reload를 확인한 후 앱을 배포한다. SQL보다 앱을 먼저 배포하면 뉴스·라이브 현황 저장이 명시적으로 실패한다. 이전 다중 쓰기로 자동 복귀하지 않는다.
7. 테스트 계정으로 정원 0명 추첨·휴가 근무표 반영·다른 관리자의 동시 편집 충돌·홈/커뮤니티 전환·장비 대여/반납을 확인한다. 운영 회원 데이터로 자동 mutation E2E를 실행하지 않는다.

## 남은 한계

- 일반 운영 인증 E2E, SMTP 실발송, 실제 기상청 응답, 운영 DB migration/동시성은 실행하지 않았다.
- 초안/게시/휴가 기록은 여전히 별도 저장 단계다. 일부 단계가 실패하면 사용자에게 부분 결과를 알리고 다시 확인하도록 한다.
- 월 방문 순위 캐시는 최대 60초 지연이 있으며 최초 월 데이터 조회 자체는 서버 집계가 아니다. 모든 데이터 규모에서 부하가 해결되었다고 주장하지 않는다.
- 묶음 크기의 정확한 전후 비교와 운영 트래픽 감소율은 측정하지 않았다. 이번에는 불필요한 의존성/모듈 결합/조회 경로 제거와 기능 보존을 검증했다.
