-- 총괄팀장 · DESK · admin 권한은 2단계 인증(인증 앱 6자리)을 마친 로그인에서만 쓴다. (DB 강제, 2단계)
--
-- 적용 시점: 유예가 끝난 뒤(2026-12-01 이후), 대상 계정 모두 인증 앱 등록을 마친 것을 확인하고 적용한다.
--   확인 쿼리(등록 안 한 대상 계정):
--     select p.name, p.role from public.profiles p
--     where p.approved and p.role in ('team_lead', 'desk', 'admin')
--       and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified');
--   적용할 때 supabase/schema.sql의 current_profile_role · is_admin 정의도 이 파일과 같게 바꾼다.
--
-- 왜 필요한가
--   화면(AuthGate)의 2단계 인증 확인은 편의 장치라, 비밀번호만 훔친 사람이 API를 직접 부르면 건너뛸 수 있다.
--   이 파일은 DB 권한 판단 함수 두 개가 로그인 토큰의 aal(인증 단계)을 보게 한다.
--   aal2가 아닌 로그인은 총괄팀장 · DESK · admin이어도 일반 멤버 권한만 갖는다.
--
-- 영향
--   - 2단계 인증을 마친 대상 계정: 바뀌는 것 없음.
--   - 대상 계정이 6자리 확인 전(aal1)이면 멤버 권한으로만 보인다. 화면은 이미 /mfa로 보내므로 실제로 볼 일은 거의 없다.
--   - 일반 멤버 · 서버(service role) 동작은 바뀌지 않는다.
--
-- 되돌리기: 이 파일 적용 전의 schema.sql에 있는 두 함수 정의를 다시 실행한다.
-- 여러 번 실행해도 안전하다.

create or replace function public.current_session_mfa_ok()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when role in ('team_lead', 'desk', 'admin') and not public.current_session_mfa_ok()
      then 'member'::public.app_role
    else role
  end
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'team_lead')
      and approved = true
  )
  and public.current_session_mfa_ok();
$$;

revoke all on function public.current_session_mfa_ok() from public, anon;
grant execute on function public.current_session_mfa_ok() to authenticated, service_role;
