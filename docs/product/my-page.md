# my-page

## 현재 확인된 사실
- 마이페이지는 `app/(portal)/me/page.tsx`와 `app/(portal)/me/assignments/page.tsx`가 있다.
- 관련 개인 설정은 `portal_user_settings` SQL 항목이 확인된다.
- 사용자 세션/프로필 정보는 auth 흐름과 연결된다.

## 경계
- 본인 정보와 관리자성 사용자 관리를 섞지 않는다.
- 개인정보성 출력은 필요한 수준으로 제한한다.
- role/approved 변경은 관리자 흐름과 RLS를 함께 확인한다.
