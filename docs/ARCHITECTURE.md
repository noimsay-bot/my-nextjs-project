# ARCHITECTURE

## 현재 확인된 사실
- `app` 디렉터리 아래 App Router를 사용한다.
- `app/(public)/login`은 공개 로그인 진입점이다.
- `app/(portal)/layout.tsx`는 `AuthGate`, `PortalShell`, `CelebrationProvider`를 적용한다.
- `app/api/**/route.ts`는 서버 Route Handler다.
- `lib/supabase`에는 client/server/middleware/admin 용도 파일이 분리되어 있다.
- `supabase/schema.sql`과 incremental SQL 파일이 존재한다.

## 목표 상태
- 라우트 그룹별 책임을 문서와 하네스 검사로 고정한다.
- UI, 서버 API, Supabase admin client 경계를 자동 검사한다.
- 대규모 리팩터링 없이 현재 구조를 더 잘 설명한다.

## 상세 문서
- 개요: [architecture/overview.md](architecture/overview.md)
- 경계: [architecture/boundaries.md](architecture/boundaries.md)
- App Router: [architecture/nextjs-app-router.md](architecture/nextjs-app-router.md)
- 도메인 레이어: [architecture/domain-layering.md](architecture/domain-layering.md)
- 의존성 규칙: [architecture/dependency-rules.md](architecture/dependency-rules.md)
