# exec-plans README

## 목적
- 큰 변경을 바로 구현하지 않고 실행 계획과 기술 부채를 분리한다.

## 디렉터리
- `active/`: 진행 중이거나 다음 후보 계획.
- `completed/`: 완료된 계획.
- [tech-debt-tracker.md](tech-debt-tracker.md): 하네스와 서비스 구조 부채 추적.

## 규칙
- 계획은 작게 쪼갠다.
- DB 변경은 별도 섹션으로 분리한다.
- generated 문서 변경은 실행 명령으로 남긴다.
