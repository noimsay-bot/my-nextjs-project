# SUPABASE

## 현재 확인된 사실
- `supabase/schema.sql`이 존재한다.
- `supabase/incremental_*.sql` 파일들이 존재한다.
- `lib/supabase/client.ts`, `server.ts`, `middleware.ts`, `admin.ts`가 분리되어 있다.
- `lib/supabase/admin.ts`는 `SUPABASE_SERVICE_ROLE_KEY`를 사용한다.
- service role admin client 사용은 `app/api/**`와 서버 도메인 로직에서 확인된다.

## RLS 원칙
- RLS 완화로 문제를 해결하지 않는다.
- 클라이언트는 RLS가 허용하는 범위에서만 PostgREST를 사용한다.
- 제한적 우회가 필요하면 서버 전용 route나 server-only 모듈로 격리한다.
- `profiles.role`, `approved` 흐름을 임의로 바꾸지 않는다.

## Generated 지도
- [generated/supabase-map.md](generated/supabase-map.md)는 SQL 파일의 table, enum, policy, function, trigger, RLS 키워드를 요약한다.
- 실제 Supabase 프로젝트 적용 상태는 generated 문서만으로 확정하지 않는다.

## DB 변경 보고 규칙
- `schema.sql`에 반영할 내용과 Supabase SQL Editor에 적용할 SQL을 분리한다.
- 마이그레이션을 새로 만들기 전 사람에게 적용 범위를 설명한다.
- 이번 하네스 작업에서는 DB를 변경하지 않는다.

## 미확인
- 실제 Supabase 대시보드의 현재 정책 적용 상태는 확인하지 않았다.
