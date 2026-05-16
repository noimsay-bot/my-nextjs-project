# dependency-rules

## 허용 방향
- `app/**` -> `components/**`, `lib/**`.
- `components/**` -> UI helper, public/client-safe `lib/**`.
- `app/api/**` -> server-safe `lib/**`.
- `lib/**` -> domain helper, Supabase wrapper.
- `scripts/harness/**` -> Node 기본 모듈과 저장소 파일 읽기.

## 금지 방향
- `components/**` -> `lib/supabase/admin`.
- client component -> `lib/server/**`.
- client component -> non-`NEXT_PUBLIC_` env.
- `app/api/**` -> UI component.
- `app/(public)/**` -> `PortalShell` 또는 `AuthGate`.
- `middleware.ts` -> 무거운 DB query.

## 현재 상태 / 목표 상태 / 갭
- 현재 상태: Supabase helper는 용도별 파일로 분리되어 있다.
- 목표 상태: 정적 boundary check가 치명적 위반을 실패 처리한다.
- 갭: TypeScript import graph 전체 분석은 아직 미구현이다.

## 검사 명령
- `npm run harness:boundaries`
- `npm run harness:all`
