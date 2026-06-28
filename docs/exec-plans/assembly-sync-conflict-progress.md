# 국회근무연동-허브근무표 충돌 수정 진행 기록

## 작업1 - 대휴 교환 필터 경계

- 상태: 구현 완료, 검증 대기.
- 원인: 국회 대휴 push 필터가 `날짜+이름`으로 판단해, 대휴 교환 후 도착 날짜에 아직 국회 칸에 없는 정상 대상자의 `upsert`를 차단했다.
- 수정: `filterAssemblyCompensatoryLeavePushOperationsForAssemblyDuties`를 국회근무표에 존재하는 이름 기준으로 변경했다. 따라서 국회근무표에 없는 이름은 차단하고, 국회근무표에 있는 사람의 교환 target `upsert`는 허용한다.
- 회귀 테스트: 황현우/정철원 교환 케이스에서 양쪽이 국회근무표에 있으면 delete/upsert 4건이 모두 통과하는 테스트를 추가했다.

## P1.5 - W1 국회근무연동의 최신 허브 상태 병합

- 상태: 구현 완료, 좁은 spec 통과.
- 원인: optimistic lock 충돌 후에는 최신 행을 다시 읽었지만, 첫 write payload는 최초 read 스냅샷 기준으로 만들어질 수 있었다.
- 수정: W1 `syncAssemblyDutiesToHub`가 쓰기 직전에도 `schedule_months` 최신 행을 다시 읽고, 그 최신 행에 `applyAssemblyDutiesToSchedule`을 재적용한 payload만 update한다. 충돌 재시도도 매번 최신 행을 다시 읽어 같은 방식으로 재적용한다.
- 회귀 테스트: 사용자가 최신 허브 근무표에서 `휴가/대휴`를 삭제한 상태에 국회 export를 적용해도 `휴가`가 되살아나지 않는 테스트를 추가했다.

## C2 - 국회 칸 동기화 소유권 분리

- 상태: 구현 완료, 좁은 spec 통과.
- 수정: `GeneratedSchedule.assembly_duty_sync_state`를 추가해 국회근무연동이 삽입한 이름만 추적한다. 이후 export가 비어 오거나 변경되어도 sync 소유 이름만 제거하고, 상태가 없는 기존 국회 칸 값은 허브 수동 입력으로 보존한다.
- 회귀 테스트: `assembly_duty_sync_state`에 있던 이름만 삭제되고 수동 국회 인원은 남는 테스트를 추가했다.

## 현재 검증

- `npm run test:e2e -- tests/schedule-general-auto-sync.spec.ts`: 통과, 41개.
