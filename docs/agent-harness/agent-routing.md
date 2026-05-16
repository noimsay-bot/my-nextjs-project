# agent-routing

## 역할 선택
- 구조 분석: `project_mapper`, `harness-architect`.
- Next.js/Vercel: `nextjs-vercel-guardian`.
- Supabase/RLS/보안: `db_rls_guard`, `supabase-security-guardian`.
- UI/모바일: `ui_architect`, `frontend-boundary-guardian`.
- 성능/비용: `performance_guard`.
- QA/검증/CI: `quality-verifier`, `reviewer`.
- 문서 관리: `docs-gardener`.
- 구현: 분석이 끝난 뒤 `implementer`.

## 호출 원칙
- 구현 전에 관련 역할을 최소 1회 호출한다.
- 구현 후 같은 역할 또는 `reviewer`로 재검토한다.
- 도구에서 직접 호출할 수 없으면 `.codex/agents/*.toml` 지침을 읽고 셀프 리뷰한다.
- 리뷰 결과는 최종 보고서에 남긴다.

## 작업별 예시
- API route 추가: `nextjs-vercel-guardian`, `supabase-security-guardian`, `quality-verifier`.
- 홈 데이터 변경: `performance_guard`, `db_rls_guard`, `reviewer`.
- UI 셸 변경: `ui_architect`, `frontend-boundary-guardian`, `reviewer`.
- 문서/하네스 변경: `harness-architect`, `docs-gardener`, `quality-verifier`.
