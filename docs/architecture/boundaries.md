# boundaries

## 기본 방향
- `app/(public)`: 로그인 등 공개 진입점. `PortalShell`/`AuthGate`에 의존하지 않아야 한다.
- `app/(portal)`: 인증 후 사용하는 내부 포털 영역. `PortalShell`/`AuthGate` 적용 가능.
- `app/api`: 서버 전용 API. UI component import 금지.
- `components`: UI 중심. 서버 비밀키, service role, admin client 직접 접근 금지.
- `lib/supabase`: client/server/admin/middleware 용도를 분리한다.
- `lib/server` 또는 server-only 모듈: 브라우저 경로로 import 금지.
- `middleware`: 인증 쿠키 존재 확인 등 가벼운 역할 유지. 무거운 DB 조회 금지.
- 홈 초기 로딩: 불필요한 Supabase fan-out 금지.
- RLS: 우회는 서버 전용 service role route에서만 제한적으로 허용.

## 현재 상태
- `app/(portal)/layout.tsx`에서 `AuthGate`와 `PortalShell`을 적용한다.
- `middleware.ts`는 일부 보호 prefix의 쿠키 존재를 확인한다.
- `lib/supabase/admin.ts`는 service role admin client를 캡슐화한다.
- 일부 API route가 admin client를 서버에서 사용한다.

## 목표 상태
- 공개/포털/API 경계를 자동 검사한다.
- client component의 server-only env 직접 접근을 실패로 본다.
- admin client는 브라우저 번들로 흘러가지 않는다.

## 갭
- 정적 검사만으로 모든 import graph를 완전 증명하지는 못한다.
- schema SQL과 실제 Supabase 적용 상태는 별도 확인이 필요하다.

## 추후 작업
- import graph 기반 경계 검사를 더 정밀하게 만들 수 있다.
- 실제 Supabase 정책 점검 SQL은 사람 승인 후 별도 실행한다.
