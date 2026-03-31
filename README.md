# JTBC Portal Frontend

Next.js 15 App Router 기반 프론트엔드입니다.  
현재 1단계에서는 Supabase Auth + `public.profiles` 기반 인증 구조로 전환되어 있습니다.

## 이번 단계에 포함된 범위

- Supabase 연결
- 로그인 / 회원가입 / 로그아웃
- 비밀번호 찾기 메일 발송
- 비밀번호 재설정
- `profiles` 테이블 기반 역할 관리
- `member / reviewer / desk / team_lead / admin` 라우트 접근 제어 틀

아직 이번 단계에 포함되지 않은 범위:

- submissions 데이터 저장소 전환
- review 저장소 전환
- team-lead 저장소 전환
- schedule / vacation 저장소 전환
- admin 승인 UI 완성

## 1. Supabase 프로젝트 생성

1. [Supabase](https://supabase.com/)에서 새 프로젝트를 생성합니다.
2. 프로젝트 생성이 끝나면 `Project URL`과 `Publishable Key`를 확인합니다.
3. Authentication > Sign In / Providers에서 `Email` provider를 사용합니다.

중요 설정:

- `Confirm email`을 꺼 주세요.
- 이번 프로젝트는 이메일 인증을 쓰지 않습니다.
- 비밀번호 재설정 메일은 사용하므로 Redirect URL은 반드시 추가해야 합니다.

## 2. Redirect URL 설정

Authentication > URL Configuration에서 아래 URL을 추가합니다.

- `http://localhost:3000/auth/callback`
- `http://localhost:3000/login`

배포 시에는 아래도 추가합니다.

- `https://your-vercel-domain.vercel.app/auth/callback`
- `https://your-vercel-domain.vercel.app/login`

## 3. SQL 실행

Supabase SQL Editor에서 아래 파일 내용을 그대로 실행합니다.

- [supabase/schema.sql](/C:/Users/noims/my-nextjs-project/supabase/schema.sql)

이 SQL은 아래 항목을 생성합니다.

- `public.app_role` enum
- `public.profiles` 테이블
- `updated_at` 자동 갱신 함수 / 트리거
- `auth.users -> public.profiles` 자동 생성 트리거
- 기본 RLS 정책

## 4. 환경변수 설정

프로젝트 루트에 `.env.local` 파일을 만들고 아래 값을 넣습니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

예시는 [.env.example](/C:/Users/noims/my-nextjs-project/.env.example)에 있습니다.

## 5. 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 아래 주소를 엽니다.

- [http://localhost:3000](http://localhost:3000)
- [http://localhost:3000/login](http://localhost:3000/login)

## 6. 회원가입 / 로그인 정책

- 실제 로그인은 `email + password`입니다.
- `login_id`는 `profiles.login_id`에 보조 값으로 저장됩니다.
- 회원가입 기본 역할은 `member`입니다.
- `approved` 기본값은 `true`입니다.
- `desk / team_lead / admin` 승격은 이후 단계에서 admin이 처리합니다.

## 7. RLS 정책 요약

현재 포함된 기본 정책:

- 본인 프로필 조회 가능
- 승인된 프로필 목록 조회 가능
- 본인 프로필 기본 정보 업데이트 가능
- admin은 모든 프로필 조회 / 수정 가능
- 회원가입 시 `auth.users` 생성 후 `public.profiles`가 자동 생성됨

## 8. Vercel 배포 환경변수

Vercel 프로젝트에 아래 값을 등록합니다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

`NEXT_PUBLIC_SITE_URL` 예시:

- `https://your-vercel-domain.vercel.app`

배포 후에는 Supabase의 Redirect URL에도 같은 도메인을 추가해야 합니다.

## 9. 다음 단계 제안

다음 단계에서는 인증 위에 실제 업무 데이터를 순서대로 붙이는 것이 안전합니다.

1. `submissions` 테이블과 RLS를 만들고 `/submissions`를 Supabase CRUD로 교체
2. `reviews`와 `review_assignments`를 추가하고 `/review`를 reviewer 권한 기반으로 교체
3. team-lead 통계는 DB 집계 또는 JSONB 기반 저장소로 치환
4. 마지막에 schedule / vacation 저장소를 단계적으로 Supabase로 이전

## 관련 파일

- [lib/supabase/client.ts](/C:/Users/noims/my-nextjs-project/lib/supabase/client.ts)
- [lib/supabase/server.ts](/C:/Users/noims/my-nextjs-project/lib/supabase/server.ts)
- [lib/supabase/middleware.ts](/C:/Users/noims/my-nextjs-project/lib/supabase/middleware.ts)
- [middleware.ts](/C:/Users/noims/my-nextjs-project/middleware.ts)
- [lib/auth/storage.ts](/C:/Users/noims/my-nextjs-project/lib/auth/storage.ts)
- [app/login/page.tsx](/C:/Users/noims/my-nextjs-project/app/login/page.tsx)
- [supabase/schema.sql](/C:/Users/noims/my-nextjs-project/supabase/schema.sql)

## 10. Stage 3: Review / Assignments

이번 단계에서는 `/review` 페이지를 Supabase 기반으로 전환했습니다.

- `public.review_assignments`
  - 어떤 reviewer가 어떤 submission을 평가할 수 있는지 관리합니다.
- `public.reviews`
  - reviewer별 평가 결과를 저장합니다.
- `/review`
  - reviewer는 자신에게 배정된 submission만 조회하고 저장할 수 있습니다.
  - `team_lead`, `admin`, `desk`는 저장 없이 조회만 가능합니다.

추가된 핵심 정책:

- reviewer는 `review_assignments`에서 자신에게 배정된 row만 조회 가능
- reviewer는 자신에게 배정된 submission에 대해서만 `reviews` insert / update / delete 가능
- `team_lead`, `admin`은 `review_assignments`, `submissions`, `reviews` 전체 조회 가능
- `desk`는 `submissions`, `reviews` 조회 가능

## 11. Review Local Test Checklist

1. Supabase SQL Editor에서 최신 [supabase/schema.sql](/C:/Users/noims/my-nextjs-project/supabase/schema.sql)을 다시 실행합니다.
2. reviewer 계정과 member 계정을 각각 하나 이상 준비합니다.
3. member 계정으로 로그인해 `/submissions`에서 최소 1건 이상 제출합니다.
4. SQL Editor 또는 Table Editor에서 `review_assignments`에 reviewer와 submission을 연결합니다.
5. reviewer 계정으로 로그인해 `/review`에서 자신에게 assign된 submission만 보이는지 확인합니다.
6. reviewer가 체크 항목과 가점을 입력한 뒤 새로고침해도 저장값이 유지되는지 확인합니다.
7. reviewer가 `최종 확인` 후 새로고침했을 때 완료 상태가 유지되는지 확인합니다.
8. 다른 reviewer 계정으로 로그인했을 때 본인에게 assign되지 않은 submission이 보이지 않는지 확인합니다.
9. member 계정으로 `/review` 접근 시 접근 불가 상태가 유지되는지 확인합니다.
10. `team_lead`, `admin`, `desk` 계정으로 `/review`에 들어갔을 때 읽기 전용으로 조회만 가능한지 확인합니다.

## 12. Manual Seed Example

assignment UI는 아직 만들지 않았으므로, 테스트용 assignment는 SQL로 넣을 수 있습니다.

```sql
insert into public.review_assignments (submission_id, reviewer_id, assigned_by)
values (
  'submission-uuid-here',
  'reviewer-profile-uuid-here',
  'team-lead-or-admin-profile-uuid-here'
)
on conflict (submission_id, reviewer_id) do update
set
  reset_at = null,
  assigned_at = timezone('utc', now());
```

## 13. Stage 4: Team Lead / Admin

이번 단계에서는 `team_lead`와 `admin`이 같은 Supabase 구조 위에서 review 운영 데이터를 조회하고 관리할 수 있도록 연결했습니다.

- `team_lead`
  - `/team-lead/special-report`에서 submission 단위 reviewer assignment 생성 / 변경 / reset
  - `submissions`, `reviews`, `review_assignments`를 DB 기준으로 조회
- `admin`
  - `/admin`에서 `profiles` 전체 조회
  - role 변경
  - approved 토글
  - submissions / reviews / assignments 운영 현황 조회

추가된 DB 제약:

- `review_assignments_one_active_submission_idx`
  - `reset_at is null`인 활성 assignment는 submission당 1개만 유지합니다.

## 14. Team Lead / Admin Local Test Checklist

1. Supabase SQL Editor에서 최신 [supabase/schema.sql](/C:/Users/noims/my-nextjs-project/supabase/schema.sql)을 다시 실행합니다.
2. admin 계정 1개, team_lead 계정 1개, reviewer 계정 1개, member 계정 1개 이상을 준비합니다.
3. member 계정으로 `/submissions`에 여러 건을 저장합니다.
4. team_lead 계정으로 `/team-lead/special-report`에 접속합니다.
5. 각 submission row에서 reviewer를 선택하고 `배정 저장` 또는 `배정 변경`이 동작하는지 확인합니다.
6. 같은 submission에 대해 `assignment reset` 후 reviewer가 비워지는지 확인합니다.
7. reviewer 계정으로 `/review` 접속 시 team_lead가 배정한 submission만 보이는지 확인합니다.
8. reviewer가 저장한 review가 team_lead 화면과 admin 화면에서 반영되는지 확인합니다.
9. admin 계정으로 `/admin`에 접속해 사용자 목록이 전부 보이는지 확인합니다.
10. admin이 role 변경과 approved 토글 후 저장하면 새로고침 뒤에도 값이 유지되는지 확인합니다.

## 15. Next Step Proposal

다음 단계는 `schedule / vacation` 저장소 전환입니다.

- `schedule`
  - 현재 엔진은 유지하고 draft / published / change request 저장만 Supabase로 교체
- `vacation`
  - 요청 목록, 월별 추첨 결과, 반영 상태를 Supabase 테이블로 이동
- 순서 제안
  - `published schedules`
  - `change requests`
  - `vacation requests`
  - 마지막으로 schedule-assignment와 team-lead의 나머지 localStorage 영역 정리

## 16. Stage 5: Schedule / Vacation / Team Lead Storage

This stage moves the remaining operational storage to Supabase and keeps browser cache as a UI-only helper.

Source of truth rules:

- Supabase is always the source of truth.
- In-memory cache is only used to reduce UI flicker while a page is open.
- On focus and page boot, the app re-fetches from Supabase and overwrites cache.
- If a local optimistic update and DB state diverge, the app restores from DB.

Primary tables:

- `schedule_settings`
  - One global row keyed by `key='global'`
  - `state`: non-month schedule settings that the engine needs as one bundle
  - `updated_by`: who last changed the global schedule settings
  - `updated_at`: last write timestamp
- `schedule_months`
  - `month_key`: canonical month key like `2026-03`
  - `draft_state`: draft/generated month JSON used by the schedule engine
  - `published_state`: published month JSON shown to members
  - `published_at`: publish timestamp
  - `updated_by`: who last changed the row
  - `updated_at`: last write timestamp
- `schedule_change_requests`
  - Stores change-request routes, request history, apply snapshot, and rollback metadata
- `vacation_requests`
  - Stores member vacation requests per month
- `vacation_months`
  - Stores DESK vacation management state for one month
- `team_lead_schedule_assignments`
  - Stores monthly assignment editor data for team lead pages
- `team_lead_state`
  - Generic team lead state rows keyed by feature name
  - Current keys:
    - `contribution_manual_v1`: manual contribution score adjustments
    - `final_cut_v1`: final-cut decisions keyed by schedule item id
    - `scoreboard_v1`: manual score-board items and selected final-cut quarters

Why `schedule_settings` exists:

- The current schedule engine expects one `ScheduleState` object that includes global inputs such as orders, off rules, pointers, vacation text, snapshots, and current month selection.
- `schedule_months` alone is not enough to reconstruct that object safely.
- `schedule_settings.state` keeps only the global/non-month portion, while `schedule_months` stores month-specific generated drafts and published data.

Why `team_lead_state` exists:

- The remaining team lead features still depend on structured UI state that does not map cleanly to one normalized table per card yet.
- `team_lead_state` lets the app keep those feature states in Supabase now without rewriting the existing UI architecture.
- This keeps DB as the source of truth while preserving the current pages.

Draft and published precedence:

- Schedule editing pages read `schedule_settings + schedule_months.draft_state`.
- Member-facing published views read `schedule_months.published_state`.
- If a month has both draft and published data, editing uses draft and the published page uses published.

Remaining local storage usage after this stage:

- `desk-vacation-management-selection-v1`
  - Only remembers the last selected year/month in the DESK vacation management page.
  - This is UI preference cache only, not operational data.
## 17. Final Deployment Checklist

Run this checklist before the first production deploy.

- Execute the latest [supabase/schema.sql](/C:/Users/noims/my-nextjs-project/supabase/schema.sql) in Supabase SQL Editor.
- Confirm Supabase Auth email confirmation is disabled if the service should allow immediate sign-in.
- Confirm `profiles` rows are created automatically after sign-up.
- Confirm `noimsay` is promoted to `admin` as intended.
- Verify RLS with real test accounts for `member`, `reviewer`, `desk`, `team_lead`, and `admin`.
- Verify schedule / vacation / team-lead pages load with an empty database.
- Verify save failures show UI feedback and the next focus / refresh restores DB state.
- Set Vercel environment variables before the first deploy.
- Add Supabase redirect URLs for both local and production domains.

DB source of truth rules:

- Supabase is always the source of truth.
- Browser cache is only a UI helper.
- If cache and DB diverge, the next boot / focus refresh restores DB state from Supabase.

## 18. Operational Account Test Scenarios

Run these scenarios with separate real accounts.

### Auth / Member

- Sign up as `member` with `login_id + password + name + email`.
- Log in with `login_id + password`.
- Run password reset from the login page.
- Confirm an approved account can access member pages.
- Confirm an unapproved account is logged out and blocked from protected pages.

### Reviewer

- Log in as `reviewer`.
- Confirm `/review` only shows assigned submissions.
- Save a review, refresh, and verify the saved review reloads.
- Change the assignment in another session and confirm `/review` refreshes to the DB state.

### Team Lead

- Open reviewer assignment UI and assign / reassign / reset reviewers.
- Open contribution page and save manual contribution scores.
- Open final-cut page and save final-cut decisions.
- Open overall-score page and change selected final-cut quarters.
- Confirm all values reload from DB after refresh.

### Desk

- Create or edit a schedule draft.
- Publish a month and confirm member-facing published views read the published state.
- Create and resolve a change request.
- Open DESK vacation management and confirm monthly limits / winners / apply state reload from DB.

### Admin

- Open `/admin` and confirm the user list loads.
- Change `role` for a test user and confirm access updates on the next session sync.
- Change `approved` to `false` and confirm the target user is signed out and blocked.

### Failure Recovery

- Temporarily break Supabase access or use an invalid table state.
- Trigger save in schedule / vacation / team_lead pages.
- Confirm the UI shows a warning message.
- Refresh or refocus the page and confirm the UI restores the DB state.

## 19. Remaining localStorage Usage

These remaining keys are not operational data stores.

- `lib/auth/storage.ts`
  - Auth/session cache only.
  - Purpose: faster client bootstrap and client-side session sync helper.
  - DB/Auth remain the real source of truth.
- `lib/portal/data.ts`
  - Legacy submission compatibility cache only.
  - Purpose: keep an older submission consumer from breaking during staged migration.
  - Supabase `submissions` is the source of truth.
- `lib/print.ts`
  - `codex-disable-auto-print`
  - Purpose: print preference only.
- `app/schedule/vacations/page.tsx`
  - `desk-vacation-management-selection-v1`
  - Purpose: remember the last selected year/month in DESK vacation management.
  - This is UI preference only.

Non-runtime files may still reference `localStorage`, but they are not part of the deployed Next.js app path.

## 20. Known Issues / Remaining Risks

- Some older pages still contain mojibake text from earlier local prototype content. This is mostly presentation risk, not DB integrity risk.
- Several save flows still use optimistic UI updates first, then restore from DB on failure. The DB remains correct, but the user may briefly see optimistic state before the warning appears.
- Supabase schema drift is the biggest operational risk. If production schema is older than the repo SQL, schedule / vacation / team_lead features can fall back to empty state or save warnings.
- Team-lead state is intentionally stored in JSON-based rows for stability during migration. It is practical for the current UI, but not yet fully normalized.

## 21. Vercel and Supabase Setup

### Vercel Environment Variables

Set these in Vercel Project Settings.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

Recommended production value:

- `NEXT_PUBLIC_SITE_URL=https://your-domain.example.com`

### Supabase Redirect URLs

Add these in Supabase Auth URL settings.

Local:

- `http://localhost:3000/auth/callback`
- `http://localhost:3000/login`

Production:

- `https://your-domain.example.com/auth/callback`
- `https://your-domain.example.com/login`

### Supabase Site URL

Set the primary Site URL in Supabase to the production domain.

- `https://your-domain.example.com`
