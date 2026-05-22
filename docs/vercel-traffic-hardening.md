# Vercel Traffic Hardening Checks

배포 후 임시로 `NEXT_PUBLIC_PORTAL_DEBUG_TRAFFIC=true`를 켜고 브라우저 DevTools Network/Console에서 아래만 확인한다. 검증이 끝나면 다시 끈다.

- 홈 첫 진입: `home-current-trips`가 `rpc success`로 찍히고, 현재 출장자 카드 때문에 `/api/home/public-workspace`가 같이 호출되지 않아야 한다.
- 내 근무 캘린더: `my-work-calendar`가 `rpc success`로 찍히면 `/api/schedule/my-work-calendar` fallback 호출이 없어야 한다.
- PortalShell 고객센터 요약: `portal-support-summary`가 `rpc success`로 찍히고, 실패 상황에서만 `fallback-direct`가 찍혀야 한다.
- 커뮤니티 첨부 다운로드: `home-community-attachment`가 `storage success`로 찍히면 Vercel legacy download API가 호출되지 않아야 한다.
- Vercel Usage: `/api/home/public-workspace`, `/api/schedule/my-work-calendar`, 커뮤니티 download API가 홈 첫 진입/정상 RPC 상황에서 상위 경로로 올라오지 않는지 확인한다.
