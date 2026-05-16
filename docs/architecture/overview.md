# architecture overview

## 현재 확인된 사실
- Next.js App Router를 사용한다.
- 공개 로그인은 `app/(public)/login`에 있다.
- 보호 포털은 `app/(portal)` 아래에 있다.
- 서버 API는 `app/api/**/route.ts`에 있다.
- Supabase helper는 `lib/supabase`에 분리되어 있다.

## 구조 요약
- `app`: 라우트 조합과 layout/page/route convention.
- `components`: UI와 클라이언트 상호작용.
- `lib`: 도메인 로직, storage/query helper, Supabase wrapper.
- `supabase`: schema와 incremental SQL.
- `scripts/harness`: 정적 문서 생성과 경계 검사.

## 목표
- route group, auth, RLS, UI, server API 경계를 문서와 스크립트로 보존한다.
- 하네스는 서비스 실행 경로에 영향을 주지 않는다.
