# JTBC Portal Backend

NestJS + PostgreSQL + Prisma 기반 백엔드입니다. 현재 프론트엔드는 `localStorage` mock 인증/데이터 저장을 사용하고 있어, 이 백엔드는 그 구조를 서버 기반 인증/인가와 사용자별 데이터 분리로 치환할 수 있도록 설계되었습니다.

## 프론트엔드 분석 요약

현재 프론트엔드에서 확인된 핵심 흐름은 다음과 같습니다.

- 인증: `lib/auth/storage.ts`
  - 회원가입 / 로그인 / 임시비밀번호 / 비밀번호 변경
  - 역할: `member`, `reviewer`, `team_lead`, `desk`, `admin`
  - 현재는 평문 비밀번호 + 로컬 세션 저장
- 제출: `app/submissions/page.tsx`
  - 사용자별 베스트리포트 제출
  - 제출 카드 최대 3개
- 평가: `app/review/page.tsx`
  - 제출 카드별 평가
  - 기본 점수 + 5번 가점 + 추가 가점 점수 + 의견
- 관리자: `app/admin/page.tsx`
  - 사용자 조회 / 상태 변경 / 역할 변경
- 휴가: `lib/vacation/storage.ts`
  - 사용자별 휴가 신청

즉, 백엔드에서 최소한 아래 도메인이 필요합니다.

- 인증 / 세션 / 이메일 토큰 / 비밀번호 재설정
- 사용자 / 관리자
- 제출 / 평가
- 휴가 요청

## 아키텍처

### 모듈 구성

- `AuthModule`
  - 회원가입 / 로그인 / 이메일 인증 / 비밀번호 재설정 / access token / refresh token
- `UsersModule`
  - 현재 로그인 사용자 프로필
- `AdminModule`
  - 사용자 목록 / 역할 변경 / 상태 변경 / 관리자 통계
- `SubmissionsModule`
  - 사용자 본인 제출 저장 / 조회
- `ReviewsModule`
  - 제출 카드별 평가 저장 / 조회
- `VacationRequestsModule`
  - 사용자별 휴가 요청 저장 / 조회 / 관리자 상태 변경
- `PrismaModule`
  - PrismaClient 공유
- `MailModule`
  - SMTP 또는 로그 기반 메일 전송

### 권한 모델

요구사항의 `user / admin` 분리를 기본으로 하되, 현재 프론트 역할을 수용하기 위해 확장형 enum을 사용합니다.

- `USER`
- `REVIEWER`
- `TEAM_LEAD`
- `DESK`
- `ADMIN`

프론트와 연결할 때 매핑은 다음처럼 잡으면 됩니다.

- `member -> USER`
- `reviewer -> REVIEWER`
- `team_lead -> TEAM_LEAD`
- `desk -> DESK`
- `admin -> ADMIN`

### 사용자별 데이터 분리

모든 데이터는 소유자 또는 평가자 기준으로 분리합니다.

- 제출: `Submission.ownerId`
- 평가: `Review.reviewerId`
- 휴가 요청: `VacationRequest.requesterId`
- 관리자 외 일반 사용자는 본인 데이터만 조회

## DB 스키마

Prisma 스키마는 [prisma/schema.prisma](/C:/Users/noims/my-nextjs-project/backend/prisma/schema.prisma)에 있습니다.

핵심 모델:

- `User`
  - 로그인 ID, 이메일, bcrypt 비밀번호 해시, 역할, 상태, 이메일 인증 시각
- `RefreshToken`
  - refresh token rotation / 세션 관리
- `MailToken`
  - 이메일 인증 / 비밀번호 재설정 토큰
- `Submission`
  - 사용자당 최신 제출 1건
- `SubmissionCard`
  - 제출 리포트 카드
- `Review`
  - 카드별 평가자 평가
- `VacationRequest`
  - 사용자 휴가 요청
- `AuditLog`
  - 인증/관리 관련 감사 로그

## 인증 / 인가 흐름

### 회원가입

1. `POST /api/auth/register`
2. bcrypt로 비밀번호 해시 저장
3. 사용자 상태는 `PENDING`
4. 이메일 인증 토큰 생성
5. 인증 메일 발송

### 이메일 인증

1. `POST /api/auth/verify-email`
2. 토큰 검증
3. `emailVerifiedAt` 기록
4. 사용자 상태를 `ACTIVE`로 전환

### 로그인

1. `POST /api/auth/login`
2. bcrypt 비교
3. 이메일 인증 및 상태 확인
4. access token 발급
5. refresh token 발급
6. refresh token 해시를 DB에 저장

### refresh

1. `POST /api/auth/refresh`
2. refresh JWT 검증
3. DB 세션 해시 비교
4. 이전 refresh token revoke
5. 새 access / refresh token 재발급

### 로그아웃

1. `POST /api/auth/logout`
2. 현재 refresh token 세션 revoke

### 비밀번호 찾기 / 재설정

1. `POST /api/auth/forgot-password`
2. 비밀번호 재설정 토큰 발급 + 이메일 전송
3. `POST /api/auth/reset-password`
4. 새 비밀번호 bcrypt 해시 저장
5. 기존 refresh 세션 revoke

## 실행 방법

### 1. 환경변수 준비

`.env.example`를 참고해 `.env` 생성

### 2. Prisma client 생성

```bash
npm run prisma:generate
```

### 3. 마이그레이션

```bash
npm run prisma:migrate
```

### 4. 관리자 시드

```bash
npm run prisma:seed
```

### 5. 개발 서버 실행

```bash
npm run start:dev
```

### 6. Swagger 문서

- `http://localhost:4000/docs`

## 환경변수

예시는 [.env.example](/C:/Users/noims/my-nextjs-project/backend/.env.example)에 있습니다.

핵심 값:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `APP_ORIGIN`
- `SMTP_HOST`
- `SMTP_PORT`
- `EMAIL_FROM`
- `MAIL_LOG_ONLY`

## 프론트 연결 포인트

현재 프론트는 `lib/auth/storage.ts` 및 각 `localStorage` 기반 저장소를 직접 사용합니다. 실제 연결 시에는 아래부터 바꾸는 것이 좋습니다.

1. `lib/auth/storage.ts`
   - 백엔드 `auth` API 호출로 교체
2. `app/submissions/page.tsx`
   - `GET /api/submissions/me`
   - `PUT /api/submissions/me`
3. `app/review/page.tsx`
   - `GET /api/submissions`
   - `GET /api/reviews/submissions/:submissionId`
   - `PUT /api/reviews/cards/:cardId`
4. `app/admin/page.tsx`
   - `GET /api/admin/stats`
   - `GET /api/admin/users`
   - `PATCH /api/admin/users/:id/role`
   - `PATCH /api/admin/users/:id/status`
5. `app/vacation/page.tsx`
   - `POST /api/vacation-requests`
   - `GET /api/vacation-requests/me`

## 변경 파일 목록

- `backend/package.json`
- `backend/tsconfig.json`
- `backend/tsconfig.build.json`
- `backend/nest-cli.json`
- `backend/.env.example`
- `backend/prisma/schema.prisma`
- `backend/prisma/seed.ts`
- `backend/src/main.ts`
- `backend/src/app.module.ts`
- `backend/src/config/env.schema.ts`
- `backend/src/health.controller.ts`
- `backend/src/common/decorators/current-user.decorator.ts`
- `backend/src/common/decorators/roles.decorator.ts`
- `backend/src/common/guards/jwt-auth.guard.ts`
- `backend/src/common/guards/refresh-auth.guard.ts`
- `backend/src/common/guards/roles.guard.ts`
- `backend/src/common/interfaces/authenticated-user.interface.ts`
- `backend/src/prisma/prisma.module.ts`
- `backend/src/prisma/prisma.service.ts`
- `backend/src/mail/mail.module.ts`
- `backend/src/mail/mail.service.ts`
- `backend/src/auth/auth.module.ts`
- `backend/src/auth/auth.controller.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/auth/dto/auth.dto.ts`
- `backend/src/auth/strategies/access-token.strategy.ts`
- `backend/src/auth/strategies/refresh-token.strategy.ts`
- `backend/src/users/users.module.ts`
- `backend/src/users/users.controller.ts`
- `backend/src/users/users.service.ts`
- `backend/src/admin/admin.module.ts`
- `backend/src/admin/admin.controller.ts`
- `backend/src/admin/admin.service.ts`
- `backend/src/submissions/submissions.module.ts`
- `backend/src/submissions/submissions.controller.ts`
- `backend/src/submissions/submissions.service.ts`
- `backend/src/submissions/dto/submission.dto.ts`
- `backend/src/reviews/reviews.module.ts`
- `backend/src/reviews/reviews.controller.ts`
- `backend/src/reviews/reviews.service.ts`
- `backend/src/reviews/rubrics.ts`
- `backend/src/reviews/dto/review.dto.ts`
- `backend/src/vacation-requests/vacation-requests.module.ts`
- `backend/src/vacation-requests/vacation-requests.controller.ts`
- `backend/src/vacation-requests/vacation-requests.service.ts`
- `backend/src/vacation-requests/dto/vacation-request.dto.ts`
- `backend/docs/API_SPEC.md`
