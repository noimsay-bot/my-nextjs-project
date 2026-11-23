-- Purpose: 관리자(admin) 계정이 총괄팀장(team_lead) 권한·데이터로 올라가는 경로를 DB에서 막는다.
--
-- 막는 경로
--   1. admin이 profiles.role을 바꿔 자기 자신(또는 다른 사람)을 team_lead로 승격
--   2. admin이 다른 사람의 profiles.email/login_id를 바꿔 임시 비밀번호 메일을 가로채기
--      (임시 비밀번호 API는 auth.users 이메일을 쓰도록 코드도 함께 수정함)
--   3. admin이 team_lead_state(점수판·참고 메모·기여도·평가 권한 명단 등)를 읽거나
--      review_access_v1 명단에 자기 ID를 넣어 베스트리포트 열람·평가 권한을 얻기
--   4. admin이 review_assignments(평가자 배정)를 읽거나 조작
--
-- 유지되는 동작
--   - team_lead는 지금처럼 모든 사용자의 role/approved/정보를 변경·삭제할 수 있다.
--   - admin은 팀원 등 일반 계정의 approved(승인/비활성) 변경과 삭제를 계속 할 수 있다.
--   - admin/desk는 final_cut_v1(DESK 최종컷)을 계속 읽고 쓸 수 있다.
--   - desk의 team_lead_state 조회 범위는 바꾸지 않는다.
--   - service_role(서버 API)과 SQL Editor(auth.uid() 없음)는 트리거 검사 대상이 아니다.
--
-- 적용: Supabase SQL Editor에서 전체를 한 번에 실행. 운영 적용 전 사람 승인 필요.
-- 롤백: 파일 맨 아래 주석 참고.

begin;

-- ---------------------------------------------------------------------------
-- 1·2. profiles 권한 컬럼 보호 트리거
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_privileged_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.app_role;
begin
  -- 서버(service_role)·SQL Editor·가입 트리거처럼 로그인 사용자 맥락이 없는 경우는 통과.
  if actor_id is null then
    return coalesce(new, old);
  end if;

  select role
  into actor_role
  from public.profiles
  where id = actor_id
    and approved = true;

  -- 총괄팀장은 기존과 동일하게 모든 변경 허용.
  if actor_role = 'team_lead' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.role in ('team_lead', 'admin') then
      raise exception '총괄팀장·관리자 계정은 총괄팀장만 삭제할 수 있습니다.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if new.id is distinct from old.id then
    raise exception '프로필 ID는 변경할 수 없습니다.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    raise exception '권한 등급은 총괄팀장만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if old.id <> actor_id then
    if old.role in ('team_lead', 'admin') then
      raise exception '총괄팀장·관리자 계정 정보는 총괄팀장만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;

    if new.email is distinct from old.email
      or new.login_id is distinct from old.login_id then
      raise exception '다른 사용자의 이메일·아이디는 총괄팀장만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_profile_privileged_changes() from public, anon, authenticated;

drop trigger if exists guard_profile_privileged_changes on public.profiles;
create trigger guard_profile_privileged_changes
before update or delete on public.profiles
for each row
execute function public.guard_profile_privileged_changes();

-- ---------------------------------------------------------------------------
-- 3. team_lead_state: admin은 final_cut_v1만 읽기/쓰기
-- ---------------------------------------------------------------------------
drop policy if exists "team_lead_state_select_managers" on public.team_lead_state;
create policy "team_lead_state_select_managers"
on public.team_lead_state
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_state_manage_team_lead_admin" on public.team_lead_state;
drop policy if exists "team_lead_state_manage_team_lead" on public.team_lead_state;
create policy "team_lead_state_manage_team_lead"
on public.team_lead_state
for all
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_state_manage_admin_final_cut" on public.team_lead_state;
create policy "team_lead_state_manage_admin_final_cut"
on public.team_lead_state
for all
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_approved() = true
  and key = 'final_cut_v1'
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_approved() = true
  and key = 'final_cut_v1'
);

-- ---------------------------------------------------------------------------
-- 4. review_assignments: 배정 관리는 team_lead만
-- ---------------------------------------------------------------------------
drop policy if exists "review_assignments_select_leads" on public.review_assignments;
create policy "review_assignments_select_leads"
on public.review_assignments
for select
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

drop policy if exists "review_assignments_insert_leads" on public.review_assignments;
create policy "review_assignments_insert_leads"
on public.review_assignments
for insert
to authenticated
with check (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

drop policy if exists "review_assignments_update_leads" on public.review_assignments;
create policy "review_assignments_update_leads"
on public.review_assignments
for update
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

drop policy if exists "review_assignments_delete_leads" on public.review_assignments;
create policy "review_assignments_delete_leads"
on public.review_assignments
for delete
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

commit;

-- 적용 후 확인(읽기 전용):
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename in ('team_lead_state', 'review_assignments');
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- 롤백(필요할 때만):
--   drop trigger if exists guard_profile_privileged_changes on public.profiles;
--   drop function if exists public.guard_profile_privileged_changes();
--   그리고 team_lead_state / review_assignments 정책을 이전 정의('team_lead','admin' 포함)로 다시 생성.
