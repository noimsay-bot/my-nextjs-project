# FRONTEND

## 현재 확인된 사실
- 포털 전역 셸은 `components/portal-shell.tsx`가 담당한다.
- `PortalShell`은 메뉴뿐 아니라 사용자명/권한/레벨 표시, 테마 변경, 고객센터, 로그아웃, 권한 체험 전환까지 포함한다.
- 보호 라우트는 `app/(portal)/layout.tsx`에서 `AuthGate`와 `PortalShell`로 감싼다.
- 공개 로그인 라우트는 `app/(public)/login/page.tsx`에 있다.
- 모바일 사이드바와 전역 탐색은 `components/sidebar.tsx`, `components/portal-shell.tsx`, `app/globals.css`에 걸쳐 있다.
- schedule/team-lead 영역은 별도 하위 shell 컴포넌트를 사용한다.
- 날씨 화면은 관리자 전용 포털 페이지로, 레이더 영역과 추천 카드가 모바일에서 한 열로 접혀야 한다.

## 경계
- `components/**`는 UI 중심이다.
- client component는 `NEXT_PUBLIC_`이 아닌 환경변수를 직접 읽지 않는다.
- `components/**`는 Supabase service role/admin client를 직접 import하지 않는다.
- 공개 라우트는 `PortalShell`/`AuthGate`에 직접 의존하지 않는다.

## 모바일 우선 확인
- `<=1024px`: 사이드바 열림/닫힘, backdrop, 스크롤.
- `<=720px`: 하위 탭과 주요 버튼 overflow.
- `<=380px`: 긴 이름, 권한 표시, 로그아웃/테마 버튼.

## 목표 상태
- 전역 메뉴와 전역 액션은 `PortalShell`에서 관리한다.
- 인증 차단은 `AuthGate`, 메뉴 노출은 `PortalShell`, 기능 버튼 권한은 도메인 컴포넌트에서 관리한다.
- UI 변경 시 기능 로직, Supabase query, AuthGate를 함께 바꾸지 않는다.
- 사이드바/상단바를 바꿀 때 전역 액션을 중복 배치하거나 제거하지 않는다.
- 모바일 트리거 위치 저장, backdrop, body overflow, submenu 위치 보정 흐름을 보존한다.

## 미확인
- 현재 모든 모바일 화면의 시각적 회귀는 브라우저로 확인하지 않았다.
