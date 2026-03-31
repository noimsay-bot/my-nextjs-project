# API Spec

Base URL: `http://localhost:4000/api`

## Auth

### `POST /auth/register`

회원가입

Request:

```json
{
  "loginId": "honggildong",
  "name": "홍길동",
  "email": "hong@example.com",
  "password": "ChangeMe123!",
  "phone": "010-1111-2222"
}
```

### `POST /auth/verify-email`

이메일 인증 토큰 처리

```json
{
  "token": "email-verification-token"
}
```

### `POST /auth/login`

로그인

```json
{
  "loginId": "honggildong",
  "password": "ChangeMe123!"
}
```

Response:

```json
{
  "accessToken": "jwt-access-token",
  "refreshToken": "jwt-refresh-token",
  "expiresIn": "15m",
  "user": {
    "id": "clx...",
    "loginId": "honggildong",
    "name": "홍길동",
    "role": "USER",
    "email": "hong@example.com",
    "emailVerified": true,
    "mustChangePassword": false
  }
}
```

### `POST /auth/refresh`

```json
{
  "refreshToken": "jwt-refresh-token"
}
```

### `POST /auth/logout`

```json
{
  "refreshToken": "jwt-refresh-token"
}
```

### `POST /auth/forgot-password`

```json
{
  "loginId": "honggildong"
}
```

### `POST /auth/reset-password`

```json
{
  "token": "password-reset-token",
  "password": "NewPassword123!"
}
```

### `POST /auth/change-password`

Bearer access token 필요

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

### `GET /auth/me`

Bearer access token 필요

## Users

### `GET /users/me`

현재 로그인 사용자 프로필

## Admin

### `GET /admin/stats`

관리자 통계

### `GET /admin/users`

사용자 목록

### `PATCH /admin/users/:userId/role`

```json
{
  "role": "REVIEWER"
}
```

### `PATCH /admin/users/:userId/status`

```json
{
  "status": "ACTIVE"
}
```

## Submissions

### `GET /submissions/me`

내 제출 조회

### `PUT /submissions/me`

내 제출 저장 또는 교체

```json
{
  "cards": [
    {
      "reportType": "일반리포트",
      "title": "제목",
      "link": "https://example.com",
      "date": "2026-03-31",
      "comment": "설명"
    }
  ]
}
```

### `GET /submissions`

- `USER`: 본인 제출만
- 그 외 역할: 전체 제출 조회

### `GET /submissions/:submissionId`

제출 상세

## Reviews

### `GET /reviews/submissions/:submissionId`

제출 + 카드 + 현재 평가자 리뷰 + rubric 조회

### `PUT /reviews/cards/:cardId`

```json
{
  "selectedCriteria": [
    "general-topic-1",
    "general-bonus-1"
  ],
  "bonusScore": 2,
  "bonusComment": "모바일 확장 대응 우수",
  "isFinal": true
}
```

검증 규칙:

- 허용된 criterion id만 저장 가능
- 5번 가점 항목 또는 추가 가점 점수를 사용하면 `bonusComment` 필수

## Vacation Requests

### `POST /vacation-requests`

```json
{
  "type": "연차",
  "year": 2026,
  "month": 4,
  "requestedDates": ["2026-04-10", "2026-04-11"],
  "rawDates": "10,11"
}
```

### `GET /vacation-requests/me`

내 휴가 요청

### `GET /vacation-requests`

- `ADMIN`, `DESK`: 전체 조회
- 그 외: 본인 요청만

### `PATCH /vacation-requests/:requestId/status`

```json
{
  "status": "APPROVED"
}
```
