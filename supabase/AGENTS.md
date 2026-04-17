# supabase/AGENTS.md

## 규칙
- 스키마 변경 시 목적, 영향, 롤백 가능성을 함께 적는다.
- RLS 정책 영향 여부를 항상 점검한다.
- 운영 중인 데이터와의 호환성을 우선한다.
- 임의 삭제/재생성보다 incremental SQL을 우선한다.
- auth, profiles, role, approved 관련 정책은 특히 보수적으로 수정한다.
- 프론트 코드 수정과 DB 수정이 동시에 필요한지 먼저 구분한다.
- 컬럼 추가 시 nullable 여부와 기본값을 신중히 판단한다.
