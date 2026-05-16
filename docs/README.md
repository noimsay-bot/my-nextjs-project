# docs README

이 디렉터리는 Codex와 하위 에이전트가 저장소를 빠르게 이해하기 위한 지식 저장소다.

## 현재 확인된 사실
- 앱은 Next.js App Router 기반이며 `app/(public)`, `app/(portal)`, `app/api` 구조를 사용한다.
- 인증/권한은 Supabase Auth, `profiles.role`, `approved`, `AuthGate`, RLS가 함께 담당한다.
- Vercel 배포와 npm 기반 스크립트를 사용한다.
- 세부 경계는 [architecture/boundaries.md](architecture/boundaries.md)에 둔다.

## 문서 라우팅
- 에이전트 지도: [AGENT_MAP.md](AGENT_MAP.md)
- 전체 구조: [ARCHITECTURE.md](ARCHITECTURE.md)
- 프론트엔드: [FRONTEND.md](FRONTEND.md)
- Supabase: [SUPABASE.md](SUPABASE.md)
- 보안: [SECURITY.md](SECURITY.md)
- 신뢰성/운영: [RELIABILITY.md](RELIABILITY.md)
- 제품 맥락: [PRODUCT_CONTEXT.md](PRODUCT_CONTEXT.md)
- 품질 점수: [QUALITY_SCORE.md](QUALITY_SCORE.md)
- 변경 기록: [CHANGELOG_GUIDE.md](CHANGELOG_GUIDE.md)

## 하위 디렉터리
- [agent-harness/README.md](agent-harness/README.md): Codex 작업 루프와 프롬프트.
- [architecture/overview.md](architecture/overview.md): 구조와 의존성 규칙.
- [product/overview.md](product/overview.md): 도메인별 기능 맥락.
- [exec-plans/README.md](exec-plans/README.md): 기술 부채와 실행 계획.
- [generated/README.md](generated/README.md): 자동 생성 문서.

## 원칙
- 코드와 문서가 다르면 코드를 먼저 확인하고 문서를 고친다.
- generated 문서는 직접 수정하지 않는다.
- 실제 키 값, 토큰, service role key는 어떤 문서에도 쓰지 않는다.
- 미확인 내용은 `미확인`으로 표시한다.
