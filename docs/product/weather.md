# weather

## 현재 범위
- `/weather`는 관리자(`role === "admin"`) 전용 포털 페이지다.
- 레이더 1H 강수예측 영역은 기상청 APIHub 활용신청 승인 후 HSR 현재 실황 1개와 1H예측 6개를 하나의 완성 세트로 표시한다.
- 강수 출동 추천은 브라우저 현재 위치 기준 직선거리 이동권과 공공데이터포털 초단기예보 강수 흐름으로 추천을 만든다.

## 권한
- 사이드바 메뉴는 admin 역할에만 노출한다.
- 직접 URL 접근은 `AuthGate`에서 admin 역할만 허용한다.
- `app/api/weather/**`는 Route Handler 내부에서 서버 세션과 profile role을 다시 확인한다.

## 비용/보안
- `KMA_APIHUB_AUTH_KEY`는 server-only 환경변수다.
- `DATA_GO_KR_SERVICE_KEY`는 server-only 환경변수다.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 route가 `weather_radar_frame_sets`, `weather_radar_frames`, `weather_dispatch_cache`에 캐시를 upsert할 때만 사용한다.
- 운영 반영 전 Supabase SQL Editor에서 `supabase/incremental_weather_cache_tables.sql`, `supabase/incremental_weather_radar_frame_sets.sql`을 적용하고, Vercel 환경변수 추가 후 redeploy한다.
- 카카오모빌리티, TMAP, 네이버 길찾기 같은 유료 이동시간 API는 사용하지 않는다.
- 이동시간은 실제 길찾기가 아니라 현재 위치 기준 Haversine 직선거리 이동권으로 계산한다.
- 추천 영역은 브라우저 위치 권한 허용 후 현재 위치 좌표를 서버 route에 전달해 계산한다.
- 현재 위치 기반 추천은 사용자별 좌표가 섞이지 않도록 `weather_dispatch_cache` 공유 payload를 읽거나 쓰지 않는다.
- 레이더 영역은 먼저 Supabase 캐시 테이블을 읽고, 새로고침 버튼이 눌린 경우에만 서버 route가 캐시 미스 상태에서 외부 API를 호출한다.
- 레이더 PNG는 Vercel route나 `/_next/image`를 거치지 않고 기상청 APIHub 이미지 URL을 브라우저가 직접 로드한다.
- 레이더 화면은 Leaflet 지도 타일 위에 APIHub의 배경지도 없는 레이더 PNG를 오버레이한다.
- 레이더 1H예측은 `현재`, `+10분`, `+20분`, `+30분`, `+40분`, `+50분`, `+60분` 7개 프레임이 모두 있을 때만 완성된 active set으로 본다.
- `현재` 프레임은 APIHub 4.1 레이더-HSR(`nph-rdr_cmp1_imgp`)에서 가져오고, `+10분`부터 `+60분`까지는 APIHub 4.4 레이더-1H예측(`nph-qpf_ana_imgp`)에서 가져온다.
- 새로고침 결과가 불완전하면 `weather_radar_frame_sets.is_active`로 승격하지 않고, 기존 active complete set이 있으면 그대로 표시한다.
- 불완전 세트는 `missing_frames`, `available_frames`, `debug` 상태 확인용으로만 저장하며 가까운 시간대 프레임으로 대체하지 않는다.
- APIHub 문서상 레이더-1H예측은 `PROJ=LCC`, `STARTX/STARTY/ENDX/ENDY`, `ZOOMLVL`을 제공한다. 현재 변환 helper는 APIHub 경량 지도 좌표가 한국 도메인 bounds로 안전하게 환산될 때만 오버레이하고, 확정하지 못하면 원본 PNG fallback을 표시한다.
- API 키 미설정, 활용신청 미승인, 403, nodata, 외부 API 장애 상황에서는 캐시에 실패 상태를 짧게 남기고 화면은 안내/빈 추천 상태로 유지한다.

## 추천 기준
- 이동권 선택은 현재 위치 기준 `10분`, `20분`, `30분` 이내로 제공한다.
- 도착 시점만 보지 않고 도착 후 세팅시간 10분을 더한다.
- 평가 구간은 `도착 + 10분`부터 `도착 + 40분`까지다.
- 강수강도, 지속시간, 피크 타이밍, 이동거리, 촬영 적합도를 합산한다.

## 다음 단계
- 현재 위치 권한 거부 시 사용할 수 있는 수동 기준 위치 입력이 필요한지 운영 방식에 맞춰 결정한다.
