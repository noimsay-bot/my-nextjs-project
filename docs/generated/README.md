# generated README

이 디렉터리는 harness 스크립트가 생성하는 문서를 둔다.

## 직접 수정 금지
- `docs/generated/**` 파일은 직접 수정하지 않는다.
- 변경이 필요하면 해당 스크립트를 수정한 뒤 재생성한다.

## 생성 명령
- route map: `npm run harness:routes`
- env map: `npm run harness:env`
- Supabase map: `npm run harness:supabase`
- package scripts: `npm run harness:scripts`
- dependency/quality map: `npm run harness:quality`
- 기본 generated 4종: `npm run harness:generate`
- 전체 생성과 검사: `npm run harness:all`

## 생성 파일
- [route-map.md](route-map.md)
- [env-map.md](env-map.md)
- [supabase-map.md](supabase-map.md)
- [package-scripts.md](package-scripts.md)
- [dependency-map.md](dependency-map.md)

## 보안 원칙
- env map은 실제 값을 읽거나 쓰지 않는다.
- 키 이름, 사용 위치, 주의사항만 기록한다.
