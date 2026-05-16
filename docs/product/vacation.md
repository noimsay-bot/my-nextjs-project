# vacation

## 현재 확인된 사실
- 휴가 화면은 `app/(portal)/vacation/page.tsx`와 schedule 하위 휴가 페이지가 있다.
- 관련 로직은 `lib/vacation`에 있다.
- SQL에는 `vacation_requests`, `vacation_months`, `vacation_settings` 항목이 있다.

## 경계
- 본인 신청/조회와 관리자성 조회를 구분한다.
- role/approved/RLS 흐름을 임의로 바꾸지 않는다.
- DB 변경은 SQL과 코드 변경을 분리 보고한다.

## 검증 후보
- 본인 휴가 신청.
- 승인 사용자 조회.
- desk/team_lead/admin 관리 흐름.
