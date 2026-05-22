# JTBC News Camera Hub - Agent Routing Map

## 1. 한 줄 설명
- Next.js 15 App Router, Supabase Auth/PostgREST/Storage/RLS, Vercel 기반 내부 포털이다.
- 주요 영역은 로그인, 홈, 근무표, 휴가신청, 베스트리포트 평가, 장비, 팀장, 관리자, 날씨, 마이페이지다.

## 2. 절대 경계
- 실제 서비스 기능 동작을 문서/하네스 작업 중 바꾸지 않는다.
- `app/(public)`, `app/(portal)`, `app/api` route group 구조를 불필요하게 흔들지 않는다.
- `middleware.ts`, `components/auth/auth-gate.tsx`, `components/portal-shell.tsx`는 꼭 필요할 때만 수정한다.
- Supabase Auth, RLS, `profiles.role`, `approved` 흐름을 임의로 바꾸지 않는다.
- 홈 초기 로딩에 불필요한 전체 월 근무표 fetch나 Supabase fan-out을 추가하지 않는다.
- RLS를 완화해서 문제를 해결하지 않는다.
- service role/admin client는 서버 전용 경로에만 둔다.

## 3. 작업 전 필수 읽기
- 저장소 전체 규칙: 이 파일
- App Router 구조: [docs/architecture/nextjs-app-router.md](docs/architecture/nextjs-app-router.md)
- 아키텍처 경계: [docs/architecture/boundaries.md](docs/architecture/boundaries.md)
- 의존성 규칙: [docs/architecture/dependency-rules.md](docs/architecture/dependency-rules.md)
- 제품 맥락: [docs/PRODUCT_CONTEXT.md](docs/PRODUCT_CONTEXT.md)
- Supabase/RLS: [docs/SUPABASE.md](docs/SUPABASE.md)
- 보안: [docs/SECURITY.md](docs/SECURITY.md)
- 프론트엔드 경계: [docs/FRONTEND.md](docs/FRONTEND.md)
- 검증 루프: [docs/agent-harness/review-loop.md](docs/agent-harness/review-loop.md)
- 자동 생성 지도: [docs/generated/README.md](docs/generated/README.md)

## 4. 폴더별 하위 규칙
- `app/**`: [app/AGENTS.md](app/AGENTS.md)를 먼저 읽는다.
- `components/**`: [components/AGENTS.md](components/AGENTS.md)를 먼저 읽는다.
- `lib/**`: [lib/AGENTS.md](lib/AGENTS.md)를 먼저 읽는다.
- `supabase/**`: DB 변경 없이 읽고 문서화한다. 실제 SQL 적용은 사람에게 분리 보고한다.
- `scripts/harness/**`: Node 기본 모듈 우선, Windows PowerShell에서 실행 가능해야 한다.
- `docs/generated/**`: 직접 수정하지 말고 harness script로 재생성한다.

## 5. 도메인별 진입 문서
- 전체 제품: [docs/product/overview.md](docs/product/overview.md)
- 권한/역할: [docs/product/permissions.md](docs/product/permissions.md)
- 근무표: [docs/product/schedule.md](docs/product/schedule.md)
- 휴가: [docs/product/vacation.md](docs/product/vacation.md)
- 베스트리포트 평가: [docs/product/review-best-report.md](docs/product/review-best-report.md)
- 장비: [docs/product/equipment.md](docs/product/equipment.md)
- 선거: [docs/product/election.md](docs/product/election.md)
- 뉴스 브리핑: [docs/product/news-briefing.md](docs/product/news-briefing.md)
- 날씨: [docs/product/weather.md](docs/product/weather.md)
- 마이페이지: [docs/product/my-page.md](docs/product/my-page.md)
- 변경 기록 방식: [docs/CHANGELOG_GUIDE.md](docs/CHANGELOG_GUIDE.md)
- 기술 부채: [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md)

## 6. Generated 문서
- route map: [docs/generated/route-map.md](docs/generated/route-map.md)
- env map: [docs/generated/env-map.md](docs/generated/env-map.md)
- Supabase map: [docs/generated/supabase-map.md](docs/generated/supabase-map.md)
- package scripts: [docs/generated/package-scripts.md](docs/generated/package-scripts.md)
- dependency/quality map: [docs/generated/dependency-map.md](docs/generated/dependency-map.md)
- generated 문서는 상단의 생성 시각과 스크립트명을 확인한다.
- route/env/supabase/package generated 문서는 `npm run harness:generate`로 재생성한다.
- `dependency-map.md`와 품질 점수는 `npm run harness:quality` 또는 `npm run harness:all`로 재생성한다.

## 7. 자주 쓰는 검증 명령
- 전체 하네스: `npm run harness:all`
- generated 재생성: `npm run harness:generate`
- 문서 링크/생성 freshness: `npm run harness:docs`
- 경계 검사: `npm run harness:boundaries`
- 품질 점수: `npm run harness:quality`
- lint: `npm run lint`
- build: `npm run build`
- e2e: `npm run test:e2e`

## 8. 에이전트 호출 규칙
- 작업 전 `.codex/agents/*.toml`의 실제 에이전트 이름과 역할을 확인한다.
- 구조 파악은 `project_mapper` 또는 `harness-architect` 역할로 시작한다.
- Next.js/Vercel 변경은 `nextjs-vercel-guardian` 역할을 호출한다.
- Supabase/RLS/보안 변경은 `db_rls_guard` 또는 `supabase-security-guardian` 역할을 호출한다.
- UI/레이아웃 변경은 `ui_architect` 또는 `frontend-boundary-guardian` 역할을 호출한다.
- 검증/CI 변경은 `quality-verifier` 또는 `reviewer` 역할을 호출한다.
- 문서 변경은 `docs-gardener` 역할을 호출한다.
- 직접 호출 기능이 없으면 같은 지침을 읽고 에이전트별 셀프 리뷰를 수행한다.
- 구현 후 같은 역할로 재리뷰하고 지적사항을 가능한 범위에서 반영한다.

## 9. 보안 금지사항
- `.env.local` 내용을 출력, 문서화, 커밋하지 않는다.
- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, SMTP 비밀번호, 토큰 값을 기록하지 않는다.
- `NEXT_PUBLIC_`이 아닌 환경변수를 client component에서 직접 읽지 않는다.
- `components/**`에서 admin client나 service role을 import하지 않는다.
- `app/api/**`는 서버 전용이며 UI component import를 피한다.
- RLS 우회는 제한된 서버 API route에서만 검토한다.

## 10. 변경 방식
- 기존 기능을 깨지 않는 최소 변경을 우선한다.
- 대규모 리팩터링을 임의로 하지 않는다.
- DB 변경이 필요하면 `schema.sql` 수정 내용과 Supabase SQL Editor 적용 SQL을 분리해 보고한다.
- UI 변경은 모바일, 태블릿, 데스크톱 영향을 함께 본다.
- 기능 추가는 1차 구현 범위를 작게 자른다.

## 11. 완료 보고
- 항상 한국어로 수정한 파일, 변경 이유, 기존 기능 영향, 실행한 명령, 테스트 결과, 배포 전 확인사항을 정리한다.
- 실패한 명령은 이번 변경 원인인지 기존 문제인지 구분해 요약한다.
- 커밋은 사용자가 명시적으로 요청하지 않는 한 만들지 않는다.

## 12. 불확실성 처리
- 확인한 파일 근거가 없으면 확정 표현을 쓰지 않는다.
- 외부 시스템 상태는 로컬 문서만으로 단정하지 않는다.
- 사람 승인 없이 destructive git 명령, 강제 push, 실제 DB 적용을 하지 않는다.
- 다음 작업자가 이어받기 쉽도록 남은 확인사항을 짧게 남긴다.
