# weather

## 현재 범위
- `/weather`는 관리자(`role === "admin"`) 전용 포털 페이지다.
- 레이더 1H 강수예측 영역은 기상청 APIHub 활용신청 승인 후 실제 영상을 표시할 수 있게 준비한다.
- 강수 출동 추천은 상암동 DMC 기준 직선거리 이동권과 mock 강수 흐름으로 1차 추천을 만든다.

## 권한
- 사이드바 메뉴는 admin 역할에만 노출한다.
- 직접 URL 접근은 `AuthGate`에서 admin 역할만 허용한다.
- `app/api/weather/**`는 Route Handler 내부에서 서버 세션과 profile role을 다시 확인한다.

## 비용/보안
- `KMA_APIHUB_AUTH_KEY`는 server-only 환경변수다.
- 카카오모빌리티, TMAP, 네이버 길찾기 같은 유료 이동시간 API는 사용하지 않는다.
- 이동시간은 실제 길찾기가 아니라 상암동 기준 Haversine 직선거리 이동권으로 계산한다.
- 추천 새로고침은 사용자 버튼 클릭 시에만 API를 호출한다.

## 추천 기준
- 도착 시점만 보지 않고 도착 후 세팅시간 10분을 더한다.
- 평가 구간은 `도착 + 10분`부터 `도착 + 40분`까지다.
- 강수강도, 지속시간, 피크 타이밍, 이동거리, 촬영 적합도를 합산한다.

## 다음 단계
- mock forecast provider를 data.go.kr 초단기예보 또는 APIHub 격자형 강수예측 provider로 교체한다.
- 실제 회사 좌표가 확정되면 `SANGAM_BASE` 값을 조정한다.
