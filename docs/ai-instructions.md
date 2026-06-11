# AI Instructions

이 문서는 Codex와 Claude Code가 같은 프로젝트 원칙을 공유하기 위한 공통 작업 지침이다. 실제 동작은 코드, Supabase RLS, 하네스 결과를 기준으로 확인한다.

## Project Overview

- JTBC News Camera Hub는 Next.js 15 App Router, React 19, Supabase Auth/PostgREST/Storage/RLS, Vercel 기반 내부 포털이다.
- 주요 영역은 로그인, 홈 뉴스 브리핑/공지, 근무표, 휴가 신청/추첨, 베스트리포트 평가, 장비, 팀장, 관리자, 선거, 날씨, 마이페이지다.
- 루트 앱은 `app/(public)`, `app/(portal)`, `app/api` route group 구조를 사용한다.
- `backend/`에는 NestJS + Prisma 백엔드가 별도로 존재한다. 루트 Next.js 앱과 명령을 구분한다.

## Required Reading

작업 전 관련 문서를 먼저 읽는다.

- `AGENTS.md`: Codex용 라우팅 맵이지만 프로젝트 경계와 검증 규칙도 포함한다.
- `CLAUDE.md`: Claude Code용 시작 지침.
- `docs/README.md`: 문서 라우팅.
- `docs/architecture/boundaries.md`: app/components/lib/API/Supabase 경계.
- `docs/architecture/dependency-rules.md`: 허용/금지 import 방향.
- `docs/PRODUCT_CONTEXT.md`: 제품 맥락.
- `docs/SUPABASE.md`: Supabase/RLS 원칙.
- `docs/SECURITY.md`: 비밀키, service role, server-only 경계.
- `docs/FRONTEND.md`: 포털 셸과 모바일 UI 경계.
- `docs/agent-harness/review-loop.md`: 검증 루프.
- `docs/generated/README.md`: generated 문서 규칙.
- 도메인 변경 시 `docs/product/*.md`의 해당 문서를 읽는다.
- 폴더 변경 시 `app/AGENTS.md`, `components/AGENTS.md`, `lib/AGENTS.md`를 함께 읽는다.

## How AI Assistants Should Work

- 관련 파일을 먼저 읽고 실제 흐름을 확인한 뒤 수정한다.
- 수정 범위를 작게 유지한다.
- 기존 패턴, helper, 컴포넌트 구조를 우선 사용한다.
- 사용자가 요청하지 않은 대규모 리팩터링을 하지 않는다.
- 근무표, 휴가, 국회 연동, 선거, 권한, Supabase RLS 관련 변경은 영향 범위를 먼저 확인한다.
- 인증, 권한, middleware, AuthGate, PortalShell, RLS는 꼭 필요할 때만 바꾼다.
- 기존 기능을 망가뜨리지 않는다.
- 테스트 실패를 숨기지 않는다. 실패가 이번 변경 때문인지 기존 문제인지 구분한다.
- 실제 DB 적용, destructive git 명령, 강제 push는 사람 승인 없이 하지 않는다.
- `.env.local` 값, 토큰, 비밀키를 읽거나 출력하거나 문서화하지 않는다.

## Important Files

### App and Shell

- `app/layout.tsx`: 루트 layout.
- `app/(public)/login/page.tsx`: 공개 로그인 페이지.
- `app/(portal)/layout.tsx`: 보호 포털 layout.
- `components/auth/auth-gate.tsx`: 세션/권한/승인 접근 제어.
- `components/portal-shell.tsx`: 포털 전역 셸, 메뉴, 사용자 표시, 테마, 로그아웃.
- `middleware.ts`: 보호 prefix의 가벼운 쿠키 기반 확인.

### Schedule, Vacation, and Assembly

- `components/schedule/schedule-app.tsx`: DESK 근무표 주요 UI.
- `components/schedule/published-schedules-panel.tsx`: 게시 근무표 표시.
- `components/team-lead/schedule-assignment-page.tsx`: 팀장 일정배정 화면.
- `lib/schedule/engine.ts`: 근무표 생성/가공 핵심 엔진.
- `lib/schedule/storage.ts`: 근무표 상태 저장.
- `lib/schedule/published.ts`: 게시 근무표 저장/조회.
- `lib/schedule/assembly-sync.ts`: 국회 연동.
- `lib/schedule/assembly-sync-core.ts`: 국회 연동 core.
- `lib/schedule/assembly-leave-push.ts`: 국회 대휴 신청 push.
- `lib/schedule/assembly-leave-push-core.ts`: 대휴 push core.
- `lib/schedule/change-requests.ts`: 근무표 변경 요청.
- `lib/schedule/desk-records.ts`: DESK 기록성 일정.
- `lib/vacation/storage.ts`: 휴가 신청, 관리, 추첨, 근무 반영.
- `app/(portal)/vacation/page.tsx`: 사용자 휴가 신청 화면.
- `app/(portal)/schedule/vacations/page.tsx`: DESK 휴가 관리/추첨 화면.

### Supabase, Auth, and API

- `lib/auth/storage.ts`: 포털 세션/사용자 storage.
- `lib/supabase/client.ts`: client Supabase helper.
- `lib/supabase/server.ts`: server Supabase helper.
- `lib/supabase/admin.ts`: service role admin client. 서버 전용.
- `lib/supabase/portal.ts`: 포털 Supabase 접근 helper.
- `app/api/**/route.ts`: 서버 API route. UI component import 금지.
- `supabase/schema.sql`: 기준 schema/RLS.
- `supabase/incremental_*.sql`: incremental SQL. 실제 적용은 사람에게 분리 보고한다.

### Domain UI and Libraries

- `components/election/`: 선거 UI.
- `lib/election/`: 선거 storage/print/types.
- `components/team-lead/`: 팀장 화면.
- `lib/team-lead/`: 팀장 평가/점수/출력 로직.
- `components/equipment/`, `lib/equipment/`: 장비 화면/상태.
- `components/weather/`, `lib/weather/`, `app/api/weather/**`: 날씨/강수 추천.
- `components/home/`, `lib/home-news/`: 홈 뉴스 브리핑/공지.
- `components/restaurants/`, `lib/restaurants/`: 식당 기능.
- `components/my-page/`, `lib/my-page/`: 마이페이지/내 근무.
- `lib/print.ts`: 공통 인쇄 helper.

### Tests and Harness

- `tests/*.spec.ts`: Playwright e2e 테스트.
- `tests/e2e-auth.ts`: e2e 인증 helper.
- `scripts/harness/*.mjs`: route/env/supabase/package/generated/quality/boundary 검사.
- `docs/generated/*.md`: 하네스 생성 문서. 직접 수정하지 않는다.
- `.codex/agents/*.toml`: Codex 역할 정의. Claude Code는 직접 호출하지 못할 수 있으므로 역할 지침으로 참고한다.

## Commands

루트 `package.json`에 실제 존재하는 명령만 사용한다.

- `npm run dev`: Next.js 개발 서버.
- `npm run build`: production build.
- `npm run start`: build 결과 실행.
- `npm run lint`: ESLint.
- `npm run test:e2e`: Playwright 전체 e2e.
- `npm run debug:rebalance`: 근무표 rebalance 디버그.
- `npm run audit:legacy-home-dataurl`: legacy home data URL 감사.
- `npm run migrate:home-community-attachments`: 홈 커뮤니티 첨부 마이그레이션 스크립트.
- `npm run harness:all`: 전체 하네스.
- `npm run harness:generate`: route/env/supabase/package generated 문서 재생성.
- `npm run harness:docs`: 문서 링크와 generated freshness 검사.
- `npm run harness:boundaries`: 경계 검사.
- `npm run harness:quality`: 품질 점수.
- `npm run harness:routes`: route map 생성.
- `npm run harness:env`: env map 생성.
- `npm run harness:supabase`: Supabase map 생성.
- `npm run harness:supabase-grants`: Supabase table grant 검사.
- `npm run harness:scripts`: package scripts map 생성.

루트에는 별도 `typecheck` 또는 `npm test` 스크립트가 없다. 만들지 말고, 필요하면 `npm run build`, `npm run lint`, `npm run test:e2e`를 사용한다.

백엔드 전용 작업은 `backend/`에서 실행한다.

- `npm run build`: Nest build.
- `npm run start`: dist 실행.
- `npm run start:dev`: Nest watch.
- `npm run start:debug`: debug watch.
- `npm run lint`: `tsc --noEmit`.
- `npm run prisma:generate`: Prisma client 생성.
- `npm run prisma:migrate`: Prisma dev migration.
- `npm run prisma:deploy`: Prisma migration deploy.
- `npm run prisma:seed`: seed 실행.
- `npm test`: 현재 자동 테스트 대신 안내 메시지를 출력한다.

## Validation / Harness

- 문서만 바꾼 경우: `npm run harness:docs`를 우선 실행한다. generated 문서를 재생성했다면 `npm run harness:all`을 실행한다.
- App Router, API, import 경계 변경: `npm run harness:boundaries`, `npm run lint`, 가능하면 `npm run build`.
- Supabase/schema/RLS/환경변수 관련 변경: `npm run harness:supabase`, `npm run harness:supabase-grants`, `npm run harness:env`, `npm run harness:boundaries`. 실제 DB 적용은 하지 않는다.
- 근무표/휴가/국회 연동 변경: `npm run lint`, `npm run build`, 관련 Playwright 테스트를 `npm run test:e2e -- tests/<file>.spec.ts` 형태로 실행한다. 후보: `tests/schedule-edit-desktop.spec.ts`, `tests/schedule-edit-mobile.spec.ts`, `tests/schedule-mobile-layout.spec.ts`, `tests/schedule-general-auto-sync.spec.ts`, `tests/schedule-settings-month-change.spec.ts`, `tests/schedule-weekday-holiday-category-drag.spec.ts`, `tests/work-schedule-change-request.spec.ts`.
- 인쇄 변경: `npm run test:e2e -- tests/print.spec.ts`와 브라우저 인쇄 미리보기 수동 확인.
- 장비/카드 관련 변경: `npm run test:e2e -- tests/corporate-card-memo.spec.ts` 등 관련 테스트 확인.
- 국회/대휴 연동은 live token/API 의존이 있을 수 있다. 스크립트 실행 전 비밀값 필요 여부를 확인하고, 값을 출력하지 않는다.
- 검증 실패는 최종 보고에 반드시 포함한다.

## Agent Roles For Claude Code

Claude Code는 Codex 내부 에이전트를 직접 호출할 수 없을 수 있다. 그 경우 `.codex/agents/*.toml`과 `docs/AGENT_MAP.md`의 역할을 아래 관점으로 재현한다.

- `project_mapper`: 수정 전 관련 route, component, lib, Supabase query, 권한 흐름을 찾는다.
- `harness-architect`: 문서, 하네스, generated 문서, Windows/CI 실행성을 검토한다.
- `docs-gardener`: AGENTS, CLAUDE, docs, generated 문서 규칙과 중복을 검토한다.
- `nextjs-vercel-guardian`: App Router, route group, middleware, Vercel/build 안전성을 검토한다.
- `frontend-boundary-guardian`: components/client component/server-only env 경계를 검토한다.
- `ui_architect`: 모바일/태블릿/데스크톱 UI, PortalShell, 긴 텍스트, 반응형을 검토한다.
- `db_rls_guard`: schema, RLS, policy, 권한별 접근, 인덱스, service role 안전성을 읽기 전용으로 검토한다.
- `supabase-security-guardian`: Supabase Auth, PostgREST, Storage, RLS, 비밀키 경계를 검토한다.
- `performance_guard`: Supabase 호출 수, egress, 중복 fetch, 홈 초기 로딩 부담을 검토한다.
- `feature_planner`: 새 기능을 1차 구현과 후속 확장으로 나눈다.
- `implementer`: 분석 후 최소 변경으로 구현한다.
- `reviewer`: 구현 diff를 회귀, 인증, RLS, 모바일, 타입, 성능 관점에서 리뷰한다.
- `quality-verifier`: lint, build, harness, e2e 결과를 검토하고 실패 원인을 분류한다.

## When To Use Each Agent Role

- 작업 시작: `project_mapper` 관점 필수.
- 문서/하네스/Claude/Codex 지침 변경: `docs-gardener`, `harness-architect` 관점 필수.
- Next.js route, layout, middleware, API 변경: `nextjs-vercel-guardian` 관점 필수.
- Supabase query, RLS, schema, service role, 환경변수 변경: `db_rls_guard`, `supabase-security-guardian` 관점 필수.
- UI, 모바일, 인쇄, 표, 강조 표시 변경: `ui_architect`, `frontend-boundary-guardian` 관점 필수.
- 홈 초기 로딩, 대량 조회, Supabase fan-out 변경: `performance_guard` 관점 필수.
- 새 기능 설계: `feature_planner` 관점으로 1차 범위를 좁힌다.
- 구현 후: `reviewer`와 `quality-verifier` 관점으로 재검토한다.

## Safety Rules / Do Not Change

- `app/(public)`, `app/(portal)`, `app/api` route group 구조를 불필요하게 흔들지 않는다.
- `middleware.ts`, `components/auth/auth-gate.tsx`, `components/portal-shell.tsx`는 꼭 필요할 때만 수정한다.
- `profiles.role`, `approved`, Supabase Auth, RLS 흐름을 임의로 바꾸지 않는다.
- RLS를 완화해서 문제를 해결하지 않는다.
- service role/admin client는 서버 전용 경로에만 둔다.
- 홈 초기 로딩에 불필요한 전체 월 근무표 fetch나 Supabase fan-out을 추가하지 않는다.
- 기존 근무표 게시 데이터, 휴가/대휴 계산, 국회 연동 데이터 흐름을 임의로 바꾸지 않는다.
- 기존 migration 또는 incremental SQL을 되돌리거나 실제 DB에 적용하지 않는다.
- `docs/generated/**`는 직접 수정하지 않고 harness로 재생성한다.
- `.env.local`, Vercel secret, Supabase service role key, OpenAI key, SMTP 비밀번호, 토큰 값을 기록하지 않는다.

## Environment Variables

값은 절대 문서에 쓰지 않는다. 이름과 client/server 분류만 다룬다. 기준 문서는 `docs/generated/env-map.md`와 `.env.example`, `backend/.env.example`이다.

Client-exposed:

- `NEXT_PUBLIC_E2E`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_PORTAL_DEBUG_TRAFFIC`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`

Server-only or backend/runtime:

- `APP_ORIGIN`
- `ASSEMBLY_EXPORT_API_URL`
- `ASSEMBLY_EXPORT_TOKEN`
- `ASSEMBLY_LEAVE_APPLY_URL`
- `CRON_SECRET`
- `DATABASE_URL`
- `DATA_GO_KR_SERVICE_KEY`
- `EMAIL_FROM`
- `HOME_NEWS_EXTERNAL_FEEDS`
- `HUB_ASSEMBLY_SYNC_TOKEN`
- `HUB_TO_ASSEMBLY_TOKEN`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_EXPIRES_IN`
- `JWT_REFRESH_SECRET`
- `KMA_APIHUB_AUTH_KEY`
- `MAIL_LOG_ONLY`
- `NODE_ENV`
- `OPENAI_API_KEY`
- `OPENAI_NEWS_DRAFT_MODEL`
- `PORT`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_LOGIN_ID`
- `SEED_ADMIN_NAME`
- `SEED_ADMIN_PASSWORD`
- `SMTP_HOST`
- `SMTP_PASS`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VERCEL_USAGE_DEBUG`

## Output Style

완료 보고는 한국어로 간결하게 작성한다.

- 수정한 파일
- 변경 이유
- 변경 내용
- 기존 기능 영향
- 실행한 명령
- 테스트/검증 결과
- 실패한 명령이 있다면 이번 변경 원인인지 기존 문제인지 구분
- 배포 전 확인사항
- 남은 위험 또는 수동 확인 필요사항

커밋은 사용자가 명시적으로 요청하지 않는 한 만들지 않는다.
