# nextjs-app-router

## 현재 확인된 사실
- `app/layout.tsx`는 루트 layout이다.
- `app/(public)/login/page.tsx`는 로그인 페이지다.
- `app/(portal)/layout.tsx`는 포털 인증/셸 wrapper다.
- `app/api/**/route.ts`는 Route Handler다.
- `app/auth/callback/route.ts`는 인증 callback Route Handler다.

## 규칙
- `page.tsx`는 페이지 조합 중심으로 유지한다.
- 무거운 UI 로직은 `components`로 이동한다.
- Route Handler는 UI component를 import하지 않는다.
- route group 괄호 세그먼트는 URL 경로가 아니다.
- layout 수정은 영향 범위가 커서 최소화한다.

## Generated 지도
- 현재 route map은 [../generated/route-map.md](../generated/route-map.md)를 확인한다.
