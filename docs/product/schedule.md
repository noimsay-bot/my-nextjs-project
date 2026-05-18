# schedule

## 현재 확인된 사실
- 근무표 관련 페이지는 `app/(portal)/schedule`, `work-schedule`, `partner/schedule`, `team-lead/schedule-assignment` 등에 분산되어 있다.
- 관련 로직은 `lib/schedule`과 `components/schedule`에 있다.
- `schedule_months`, `schedule_settings`, `team_lead_schedule_assignments` 등 SQL 항목이 확인된다.
- 근무표 관리의 `big_events` 이름은 일정배정 근무유형 옵션에 자동 포함되고, 명단/기간이 맞는 행은 표시 근무유형을 빅이벤트명으로 계산한다.

## 성능 경계
- 홈 초기 로딩에 전체 월 근무표 fetch를 추가하지 않는다.
- JSONB 상태 컬럼은 필요한 범위로 좁혀 조회한다.
- repair성 정합성 작업은 홈 경로에 새로 얹지 않는다.

## 미확인
- 모든 근무표 세부 업무 규칙은 이 문서에서 확정하지 않는다.
