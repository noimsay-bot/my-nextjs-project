# AGENT_MAP

## 현재 확인된 에이전트
- `project_mapper`: 파일, 라우트, 컴포넌트, Supabase 흐름을 읽는 구조 분석.
- `db_rls_guard`: Supabase DB/RLS/service role 안전성 검토.
- `ui_architect`: 반응형 UI, PortalShell, 모바일 구조 검토.
- `performance_guard`: Supabase 호출 수, egress, 홈 초기 로딩 검토.
- `reviewer`: 회귀, 인증, RLS, 모바일, 빌드 위험 리뷰.
- `feature_planner`: 기능 범위와 단계 분리.
- `implementer`: 최소 변경 구현.
- `harness-architect`: 하네스 구조, 문서, 스크립트 경계 검토.
- `nextjs-vercel-guardian`: App Router, Vercel, route group, CI 구조 검토.
- `supabase-security-guardian`: Supabase/RLS/비밀키 경계 검토.
- `frontend-boundary-guardian`: client component와 UI 경계 검토.
- `quality-verifier`: harness, lint, build, CI 검증.
- `docs-gardener`: AGENTS와 docs 관리.

## 호출 기준
- 시작 전 구조 파악: `project_mapper`, 필요 시 `harness-architect`.
- Next.js/Vercel: `nextjs-vercel-guardian`.
- Supabase/RLS/보안: `db_rls_guard` 또는 `supabase-security-guardian`.
- UI/모바일/컴포넌트 경계: `ui_architect` 또는 `frontend-boundary-guardian`.
- 성능/비용/홈 초기 로딩: `performance_guard`.
- 검증/CI/빌드: `quality-verifier` 또는 `reviewer`.
- 문서/가드닝: `docs-gardener`.

## 셀프 리뷰 대체
- 도구가 직접 에이전트 호출을 지원하지 않으면 `.codex/agents/*.toml`을 읽고 같은 형식으로 셀프 리뷰한다.
- 구현 전 1회, 구현 후 1회 리뷰한다.
- 리뷰 결과는 최종 보고서에 요약한다.
