# SECURITY

## 금지
- `.env.local` 값을 읽어 문서화하지 않는다.
- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, SMTP 비밀번호, 토큰 값을 출력하지 않는다.
- service role/admin client를 브라우저 경로로 흘리지 않는다.
- `NEXT_PUBLIC_`이 아닌 환경변수를 client component에서 직접 읽지 않는다.
- RLS를 완화해 기능 오류를 우회하지 않는다.

## 현재 확인된 민감 키 이름
- `SUPABASE_SERVICE_ROLE_KEY`: server-only.
- `OPENAI_API_KEY`: server-only.
- `ASSEMBLY_EXPORT_TOKEN`: server-only.
- `HUB_ASSEMBLY_SYNC_TOKEN`: server-only.
- `KMA_APIHUB_AUTH_KEY`: server-only.
- `DATA_GO_KR_SERVICE_KEY`: server-only.
- SMTP 관련 키: server-only.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: client-exposed 가능.

## 자동 검사
- `npm run harness:env`: 키 이름과 사용처만 문서화한다.
- `npm run harness:boundaries`: client/component/server-only 경계 위반을 검사한다.
- `npm run harness:all`: 문서, generated, 경계, 품질 점검을 묶어 실행한다.

## 날씨 캐시
- `weather_radar_frames`, `weather_dispatch_cache`는 관리자 승인 profile만 select 가능하도록 RLS 정책을 둔다.
- 클라이언트는 캐시 테이블 select만 사용하고, 외부 API 키와 캐시 upsert는 서버 route/service role 경로에만 둔다.

## 실패로 보는 항목
- client component에서 server-only env 직접 접근.
- components에서 service role key 문자열 사용.
- components/client component에서 `lib/supabase/admin` import.
- 공개 라우트에서 `AuthGate`/`PortalShell` 직접 import.
- client component에서 `KMA_APIHUB_AUTH_KEY` 또는 `DATA_GO_KR_SERVICE_KEY` 직접 접근.

## 경고로 보는 항목
- `app/api`에서 UI component import.
- admin client import 경로가 서버 전용인지 정적 분석만으로 확정하기 어려운 경우.
- client component의 transitive import graph는 현재 정적 검사로 완전 증명하지 못한다.
