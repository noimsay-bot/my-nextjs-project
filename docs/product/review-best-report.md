# review-best-report

## 현재 확인된 사실
- 제출/리뷰/배정 관련 SQL은 `submissions`, `reviews`, `review_assignments`를 포함한다.
- 관련 UI는 `app/(portal)/review`, `app/(portal)/submissions`, `team-lead` 영역에 있다.
- 관련 로직은 `lib/team-lead`, `components/team-lead`, `lib/portal/data`, page-local client state에 분산되어 있다.

## 경계
- reviewer 권한과 team_lead/admin 권한을 섞어 추정하지 않는다.
- review access grant가 있는 흐름은 SQL과 코드 모두 확인한다.
- RLS 완화로 리뷰 접근 문제를 해결하지 않는다.

## 검증 후보
- 제출자 본인 조회.
- 배정 reviewer 조회/작성.
- team_lead/admin 관리 화면.
