# equipment

## 현재 확인된 사실
- 장비 화면은 `app/(portal)/equipment` 하위에 있다.
- 관련 UI/로직은 `components/equipment`, `lib/equipment`에 있다.
- SQL에는 `equipment_items`, `equipment_loans`, `equipment_loan_items`, `live_equipment_status_board`가 확인된다.
- 라이브장비 TVU 카드는 데스크/총괄팀장/관리자가 더블클릭해 `metadata.grid` 표시를 추가/삭제할 수 있다.

## 경계
- 장비 관리 권한은 desk/team_lead/admin 흐름을 코드와 RLS에서 함께 확인한다.
- 장비 대여/반납 로직은 UI만 보고 변경하지 않는다.
- service role로 클라이언트 권한 문제를 우회하지 않는다.

## 미확인
- 실물 장비 운영 정책의 세부 기준은 코드 밖 정책 확인이 필요하다.
