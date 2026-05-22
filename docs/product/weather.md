# weather

## 현재 범위
- `/weather`는 관리자(`role === "admin"`) 전용 포털 페이지다.
- 레이더 1H 강수예측 영역은 기상청 APIHub 활용신청 승인 후 실제 영상을 표시할 수 있게 준비한다.
- 강수 출동 추천은 상암동 DMC 기준 직선거리 이동권과 공공데이터포털 초단기예보 강수 흐름으로 추천을 만든다.

## 권한
- 사이드바 메뉴는 admin 역할에만 노출한다.
- 직접 URL 접근은 `AuthGate`에서 admin 역할만 허용한다.
- `app/api/weather/**`는 Route Handler 내부에서 서버 세션과 profile role을 다시 확인한다.

## 비용/보안
- `KMA_APIHUB_AUTH_KEY`는 server-only 환경변수다.
- `DATA_GO_KR_SERVICE_KEY`는 server-only 환경변수다.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 route가 `weather_radar_frames`, `weather_dispatch_cache`에 캐시를 upsert할 때만 사용한다.
- 운영 반영 전 Supabase SQL Editor에서 `supabase/incremental_weather_cache_tables.sql`을 적용하고, Vercel 환경변수 추가 후 redeploy한다.
- 카카오모빌리티, TMAP, 네이버 길찾기 같은 유료 이동시간 API는 사용하지 않는다.
- 이동시간은 실제 길찾기가 아니라 상암동 기준 Haversine 직선거리 이동권으로 계산한다.
- 추천 영역은 첫 진입과 이동권 전환 시 Supabase 캐시를 직접 읽고, 사용자 새로고침 시에만 서버 route를 호출한다.
- 레이더/추천 영역은 먼저 Supabase 캐시 테이블을 읽고, 새로고침 버튼이 눌린 경우에만 서버 route가 캐시 미스 상태에서 외부 API를 호출한다.
- 레이더 PNG는 Vercel route나 `/_next/image`를 거치지 않고 기상청 APIHub 이미지 URL을 브라우저가 직접 로드한다.
- 레이더 화면은 Leaflet 지도 타일 위에 APIHub의 배경지도 없는 레이더 PNG를 오버레이한다.
- APIHub 문서상 레이더-1H예측은 `PROJ=LCC`, `STARTX/STARTY/ENDX/ENDY`, `ZOOMLVL`을 제공한다. 현재 변환 helper는 APIHub 경량 지도 좌표가 한국 도메인 bounds로 안전하게 환산될 때만 오버레이하고, 확정하지 못하면 원본 PNG fallback을 표시한다.
- API 키 미설정, 활용신청 미승인, 403, nodata, 외부 API 장애 상황에서는 캐시에 실패 상태를 짧게 남기고 화면은 안내/빈 추천 상태로 유지한다.

## 추천 기준
- 도착 시점만 보지 않고 도착 후 세팅시간 10분을 더한다.
- 평가 구간은 `도착 + 10분`부터 `도착 + 40분`까지다.
- 강수강도, 지속시간, 피크 타이밍, 이동거리, 촬영 적합도를 합산한다.

## 다음 단계
- 실제 회사 좌표가 확정되면 `SANGAM_BASE` 값을 조정한다.
