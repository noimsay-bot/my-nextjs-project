# news-briefing

## 현재 확인된 사실
- 홈 뉴스 브리핑 관련 로직은 `lib/home-news`와 `components/home`, `components/admin/news`에 있다.
- 관리자 뉴스 화면은 `app/(portal)/admin/news/page.tsx`에 있다.
- `OPENAI_API_KEY`는 server-only로 다룬다.

## 경계
- 홈 초기 로딩은 가볍게 유지한다.
- 외부 뉴스/AI 초안 생성은 서버 전용 환경변수 경계를 지킨다.
- 관리자 기능과 홈 표시 기능을 구분한다.

## 검증 후보
- 홈 표시.
- 관리자 뉴스 등록/토글.
- API key가 없을 때 graceful failure.
