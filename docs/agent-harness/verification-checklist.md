# verification-checklist

## 하네스 변경
- [ ] `npm run harness:all`
- [ ] generated 문서 상단에 생성 시각과 스크립트명이 있다.
- [ ] `docs/generated/**`를 직접 편집하지 않았다.
- [ ] 문서 상대 링크가 깨지지 않는다.
- [ ] boundary check 실패가 없다.

## 일반 코드 변경
- [ ] 관련 `AGENTS.md`를 읽었다.
- [ ] 관련 product/architecture 문서를 읽었다.
- [ ] `npm run lint`
- [ ] 가능하면 `npm run build`
- [ ] 필요하면 `npm run test:e2e`

## 수동 확인 후보
- [ ] 로그인/로그아웃.
- [ ] 승인/미승인 사용자 흐름.
- [ ] role별 메뉴 노출.
- [ ] 근무표/휴가/베스트리포트/장비/뉴스 브리핑 주요 화면.
- [ ] 모바일 `<=1024px`, `<=720px`, `<=380px`.
