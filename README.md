# J특공대 포털

`schedule-integrated-v10.html`을 기준으로 근무표 기능을 먼저 React/Next.js 구조로 분리한 앱입니다.

## 실행

1. Node.js 20 이상 설치
2. 이 폴더에서 `npm install`
3. `npm run dev`
4. 브라우저에서 `http://localhost:3000`
5. 로그인 페이지는 `http://localhost:3000/login`

## 구조

- `app/schedule/page.tsx`
  - 근무표 페이지 진입점
- `components/schedule/schedule-app.tsx`
  - 근무표 UI
  - 오프, 자동 재배치, 스냅샷, 수정 모드, 드래그 이동
- `lib/schedule/constants.ts`
  - 카테고리 정의
  - 사용자 제공 seed 순번표 기본값
- `lib/schedule/engine.ts`
  - 근무표 생성 로직
  - 주 단위 연장 처리
  - 평일/주말/휴일 분기
  - 수동 칸 수정과 이동 로직
- `app/submissions/page.tsx`
  - 영상평가 제출 화면
- `app/review/page.tsx`
  - 평가 화면
- `app/team-lead/page.tsx`
  - 팀장 화면
- `app/admin/page.tsx`
  - 관리자 화면
- `app/login/page.tsx`
  - 로그인 / 회원가입 / 비밀번호 찾기 / 비밀번호 변경 화면
- `lib/auth/storage.ts`
  - 계정, 승인 상태, 세션, 임시비밀번호 저장 로직

## 참고

- 원본 HTML 파일은 삭제하지 않았습니다.
- 실행 환경에 Node.js가 없으면 앱 실행 검증은 할 수 없습니다.
- 실제 메일 전송은 백엔드 연동이 필요해서 현재는 로컬 로그로 남깁니다.
