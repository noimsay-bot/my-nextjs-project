# election

## 범위
- 포털 내부 `/election` 라우트는 선거 중계 포인트 표를 관리한다.
- 관리자, DESK, 총괄팀장 실제 권한 사용자는 draft/published 상태를 작성, 게시, 최종 저장할 수 있다.
- 승인된 일반 사용자는 published 상태의 선거 중계표만 읽는다.

## 데이터
- 선거 원본은 `election_events`, `election_points`에 저장한다.
- `schedule_months.draft_state`, `schedule_months.published_state`, `equipment_items`는 선거 데이터로 직접 수정하지 않는다.
- `draft` 또는 `published` 상태의 선거는 partial unique index로 하나만 유지하고, `closed`는 최종 저장된 기록으로 보존한다.

## 오버레이
- 홈은 KST 기준 선거일 전날부터 선거 당일까지 `published` 상태의 요약 카드를 보여준다.
- 라이브장비현황은 오늘 published 선거의 TVU 장비명을 정규화해 `선거중계`로 덧대어 보여준다.
- 일정배정은 선거일과 촬영기자 이름이 일치하는 행에 장소만 표시한다. 중계시간, 장비명, TRS, 취재기자, 오디오맨, 주소, 비고는 일정배정에 표시하지 않는다.
- 선거 포인트 한 행은 오전/오후 입력을 지원한다. 분할 대상은 촬영기자, 오디오맨, 중계시간, 취재기자만이다.
- 중계자리는 텍스트가 아니라 체크 상태로만 저장하고 화면에서는 색 상태로 표시한다.

## 운영
- 최종 저장은 삭제가 아니라 `closed` 전환이다.
- 최종 저장 후 홈, TVU 라이브장비현황, 일정배정 오버레이는 즉시 중단되고 관리자 화면의 기록에서만 확인한다.
- Supabase 적용은 `supabase/incremental_election_events.sql` 또는 최신 `supabase/schema.sql`을 SQL Editor에서 실행해야 한다.
