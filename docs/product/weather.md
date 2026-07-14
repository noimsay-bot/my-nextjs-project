# weather

## 현재 범위
- `/weather`는 승인된 팀원 포털 역할(`member`, `outlet`, `reviewer`, `observer`, `desk`, `team_lead`, `admin`)이 사용하는 페이지다. 외부 파트너 역할은 접근하지 않는다.
- 레이더 1H 강수예측 영역은 기상청 APIHub 활용신청 승인 후 HSR 현재 실황 1개와 1H예측 6개를 하나의 완성 세트로 표시한다.
- 강수 출동 추천은 브라우저 현재 위치 기준 직선거리 이동권과 공공데이터포털 초단기예보 강수 흐름으로 추천을 만든다.

## 권한
- 사이드바 메뉴와 직접 URL 접근은 승인된 팀원 포털 역할에 허용한다.
- `app/api/weather/**`는 Route Handler 내부에서 서버 세션, 승인 상태, 팀원 포털 role을 다시 확인한다.

## 비용/보안
- `KMA_APIHUB_AUTH_KEY`는 server-only 환경변수다.
- `DATA_GO_KR_SERVICE_KEY`는 server-only 환경변수다.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 route가 `weather_radar_frame_sets`, `weather_radar_frames`, `weather_dispatch_cache`에 캐시를 upsert할 때만 사용한다.
- 운영 반영 전 Supabase SQL Editor에서 `supabase/incremental_weather_cache_tables.sql`, `supabase/incremental_weather_radar_frame_sets.sql`, `supabase/incremental_weather_member_access.sql` 순서로 적용하고, Vercel 환경변수 추가 후 redeploy한다.
- 카카오모빌리티, TMAP, 네이버 길찾기 같은 유료 이동시간 API는 사용하지 않는다.
- 이동시간은 실제 길찾기가 아니라 현재 위치 기준 Haversine 직선거리 이동권으로 계산한다.
- 추천 영역은 브라우저 위치 권한 허용 후 현재 위치 좌표를 서버 route에 전달해 계산한다.
- 현재 위치 기반 추천은 사용자별 좌표가 섞이지 않도록 `weather_dispatch_cache` 공유 payload를 읽거나 쓰지 않는다.
- 레이더 영역은 먼저 Supabase 캐시 테이블을 읽고, 진입 직후와 새로고침 버튼에서 서버 route가 최신 active complete set을 확인한다.
- 신선한 active complete set이 있으면 외부 API를 호출하지 않고 반환하며, 없거나 만료된 경우에는 진입 직후 자동 갱신으로 APIHub를 호출할 수 있다.
- 레이더 PNG는 Vercel route나 `/_next/image`를 거치지 않고 기상청 APIHub 이미지 URL을 브라우저가 직접 로드한다.
- 레이더 화면은 Leaflet 지도 타일 위에 APIHub의 배경지도 없는 레이더 PNG를 오버레이한다.
- 레이더 1H예측은 `현재`, `+10분`, `+20분`, `+30분`, `+40분`, `+50분`, `+60분` 7개 프레임이 모두 있을 때만 완성된 active set으로 본다.
- `현재` 프레임은 APIHub 4.1 레이더-HSR(`nph-rdr_cmp1_imgp`)에서 가져오고, `+10분`부터 `+60분`까지는 APIHub 4.4 레이더-1H예측(`nph-qpf_ana_imgp`)에서 가져온다.
- 1H예측 `qpf`는 `M(MAPLE)`을 우선 사용하고, 완성 세트가 안 만들어지면 `B(블랜딩)`도 같은 완성 조건으로 시도한다.
- `+40분` 프레임은 `ef=40`을 우선 요청하고, 해당 프레임만 비면 APIHub 문서의 `(+0,+1,,,)` 표기 검증을 위해 `ef=4`를 1회 추가 시도하며 이 결과를 debug에 남긴다.
- APIHub 이미지 CGI는 JSON이 성공이어도 간헐적으로 완전 투명 빈 PNG를 생성하며, 같은 URL은 이후에도 채워지지 않는다. 서버 route는 다운로드한 이미지의 visible pixel이 0이면 새 CGI 요청으로 최대 3회 재시도하고, 끝까지 비면 해당 프레임을 nodata로 기록해 완성 세트로 승격하지 않는다.
- 1H예측 PNG는 흰 배경이 포함되어 내려오므로, Leaflet overlay pane에 `mix-blend-mode: darken`을 적용해 지도 타일 위에서 흰 배경이 보이지 않게 한다. 오버레이 이미지 요소 자체에 blend를 걸면 pane의 stacking context 때문에 무효라서 pane 레벨에 적용한다.
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
