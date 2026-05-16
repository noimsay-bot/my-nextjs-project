# prompt-template

아래 템플릿은 다음 Codex 작업에서 그대로 붙여 넣어 사용할 수 있다.

```text
목표:
- [작업 목표를 한 줄로 적는다]

수정 허용 범위:
- [수정 가능한 폴더/파일]
- 서비스 기능 변경 여부: [예/아니오]

건드리면 안 되는 파일/흐름:
- middleware.ts
- components/auth/auth-gate.tsx
- components/portal-shell.tsx
- Supabase RLS / profiles.role / approved 흐름
- 홈 초기 로딩 Supabase fan-out
- [작업별 추가 금지 항목]

먼저 읽을 문서:
- AGENTS.md
- docs/architecture/boundaries.md
- docs/architecture/dependency-rules.md
- docs/SUPABASE.md
- docs/SECURITY.md
- docs/FRONTEND.md
- [작업별 product 문서]

호출할 에이전트:
- project_mapper 또는 harness-architect
- [nextjs-vercel-guardian / supabase-security-guardian / frontend-boundary-guardian / performance_guard / quality-verifier / docs-gardener 중 선택]
- 구현 후 reviewer

구현 후 실행할 검증 명령:
- npm run harness:all
- npm run lint
- npm run build
- [필요 시 npm run test:e2e]

최종 보고 형식:
1. 한 줄 요약
2. 수정한 파일
3. 변경 이유
4. 기존 기능 영향
5. 실행한 명령
6. 테스트 결과
7. 배포 전 확인사항

실패/모호함 에스컬레이션:
- 비밀키/토큰 값이 필요한 경우 중단하고 사람에게 요청한다.
- RLS 완화나 DB 실제 적용이 필요한 경우 SQL 초안만 제시한다.
- 기존 기능 회귀 가능성이 큰 경우 구현 범위를 줄이고 확인을 요청한다.
- lint/build 실패가 기존 문제로 보이면 로그를 요약하고 임의 리팩터링하지 않는다.
```
