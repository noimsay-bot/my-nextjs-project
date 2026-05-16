# domain-layering

## 레이어
- `app`: 라우트와 페이지 조합.
- `components`: 도메인 UI와 클라이언트 상호작용.
- `lib/<domain>`: 도메인 로직, Supabase 호출, 타입 변환.
- `lib/supabase`: Supabase client 생성과 실행 환경 분리.
- `supabase`: SQL schema와 incremental change 기록.

## 도메인 폴더 예시
- `lib/auth`: 세션, role, approved, 로그인 흐름.
- `lib/schedule`: 근무표와 동기화.
- `lib/vacation`: 휴가 데이터.
- `lib/team-lead`: 평가/팀장 기능.
- `lib/equipment`: 장비 데이터.
- `lib/home-news`: 홈 뉴스 브리핑.
- `lib/restaurants`: 맛집/장소 기능.

## 금지
- 도메인 간 공통화 명목으로 인증/권한 로직을 섞지 않는다.
- UI 편의를 위해 Supabase admin client를 components로 올리지 않는다.
- schedule JSONB 전체 조회를 홈 초기 로딩에 새로 추가하지 않는다.
