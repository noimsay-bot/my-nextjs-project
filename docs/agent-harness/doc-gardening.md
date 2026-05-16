# doc-gardening

## 원칙
- 문서가 코드와 다르면 코드를 확인한 뒤 문서를 수정한다.
- generated 문서는 직접 수정하지 않는다.
- 한 문서는 한 책임만 가진다.
- 확인하지 않은 내용은 `미확인`으로 표시한다.

## 오래된 문서 탐지 기준
- 코드 파일명이 바뀌었는데 문서 링크가 깨진 경우.
- route map/env map/supabase map이 현재 코드와 다르게 보이는 경우.
- 역할 enum, 권한 조건, route group 설명이 코드와 충돌하는 경우.
- README류 문서에 과거 구현 기록과 현재 기준이 섞인 경우.

## generated 재생성 기준
- `app/**` route convention 변경: `npm run harness:routes`.
- 환경변수 사용처 변경: `npm run harness:env`.
- `supabase/*.sql` 변경: `npm run harness:supabase`.
- `package.json` scripts 변경: `npm run harness:scripts`.
- 품질/의존성 지도 변경: `npm run harness:quality`.
- 여러 항목 변경: `npm run harness:all`.

## 기능 변경 시 함께 갱신할 문서
- 권한 변경: [../product/permissions.md](../product/permissions.md), [../SECURITY.md](../SECURITY.md).
- 라우트/레이아웃 변경: [../architecture/nextjs-app-router.md](../architecture/nextjs-app-router.md).
- Supabase/RLS 변경: [../SUPABASE.md](../SUPABASE.md), [../generated/supabase-map.md](../generated/supabase-map.md).
- UI 셸 변경: [../FRONTEND.md](../FRONTEND.md).
- 검증/CI 변경: [../RELIABILITY.md](../RELIABILITY.md), [../QUALITY_SCORE.md](../QUALITY_SCORE.md).

## 품질 점수 하락 시 조치
- 90점 미만 항목을 [../exec-plans/tech-debt-tracker.md](../exec-plans/tech-debt-tracker.md)에 남긴다.
- 하네스 자체 문제는 먼저 수정한다.
- 서비스 구조 문제는 별도 실행 계획으로 분리한다.
