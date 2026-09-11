# tech-debt-tracker

## 수동 추적 항목
- 2026-09 안정화: [실행 기록과 SQL 배포 전 확인사항](stabilization-2026-09.md). 실제 DB 적용 및 운영 스키마/동시성 검증은 미실행 상태다.
- 근무표 초안/게시/휴가 반영 기록은 여러 쓰기 단계다. 자기 버전 충돌과 허위 성공 표시는 보완했으나 전체 도메인 트랜잭션으로 전환한 것은 아니다.
- 월 방문 순위는 60초 캐시와 페이지네이션으로 반복 조회/잘림을 줄였지만 최초 조회는 해당 월 방문 행을 읽는다. 더 큰 데이터 규모에서는 승인된 서버 집계 RPC를 별도 설계한다.
- Supabase schema SQL에 없는 것으로 보이는 테이블 사용처는 실제 schema source를 추후 확인해야 한다.
- `public.is_admin()`의 의미가 admin-only인지 team_lead 포함인지 도메인별로 문서화가 더 필요하다.
- 홈 초기 로딩의 published schedule/repair 경로는 성능 회귀 후보로 계속 감시한다.
- README류 과거 문서와 현재 기준 문서의 중복은 점진적으로 정리한다.
- client component의 transitive import graph 분석은 추후 하네스 고도화 후보로 남긴다.

## 정기 작업 후보
- `npm run harness:all` 결과 확인.
- generated 문서 재생성.
- 깨진 문서 링크 확인.
- Supabase SQL과 코드 사용 테이블 간 차이 조사.

<!-- harness-quality:start -->
## 자동 점검 메모

- 현재 자동 점검 기준에서 즉시 기록할 하네스 부채가 없습니다.

<!-- harness-quality:end -->
