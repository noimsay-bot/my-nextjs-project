# permissions

## 현재 확인된 role
- `member`
- `outlet`
- `reviewer`
- `observer`
- `partner`
- `desk`
- `team_lead`
- `admin`

## 핵심 조건
- `approved`는 보호 포털 접근의 핵심 조건이다.
- middleware는 일부 보호 prefix를 쿠키 기반으로 1차 보호한다.
- 클라이언트 포털 접근 제어는 `AuthGate`가 세션, role, approved, mustChangePassword 등을 함께 판단한다.
- 메뉴와 전역 액션 노출은 `PortalShell`이 판단한다.
- DB 접근은 Supabase RLS가 최종 방어선이다.
- `/weather`는 현재 `role === "admin"` 사용자에게만 노출/접근을 허용한다.
- `app/api/weather/**`는 AuthGate를 통과하지 않으므로 Route Handler에서 서버 세션과 admin profile을 다시 확인한다.

## 주의
- `admin`과 `team_lead`는 단순 계층 구조로 추정하지 않는다.
- `actualRole`/경험 역할 전환 흐름은 코드 확인 없이 바꾸지 않는다.
- RLS 정책의 `is_admin()` 의미는 SQL에서 확인해야 한다.
- `PortalShell` 수정 시 테마, 고객센터, 로그아웃, 사용자 표시, 권한 체험 전환이 사라지지 않는지 확인한다.
