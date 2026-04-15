-- Team lead DESK permission diagnostics
-- Run in Supabase SQL Editor against the target environment.

-- 1) Confirm helper functions and your current profile state.
select
  auth.uid() as auth_user_id,
  public.current_profile_role() as current_role,
  public.current_profile_approved() as current_approved,
  public.is_admin() as current_is_admin;

select
  id,
  email,
  login_id,
  name,
  role,
  approved,
  created_at,
  updated_at
from public.profiles
where id = auth.uid();

-- 2) Confirm the logged-in role is actually team_lead in profiles.
select
  id,
  login_id,
  name,
  role,
  approved
from public.profiles
where role = 'team_lead'
order by updated_at desc;

-- 3) Inspect RLS policies that must allow team_lead writes in DESK flows.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'schedule_settings',
    'schedule_months',
    'schedule_change_requests',
    'vacation_months',
    'vacation_settings',
    'team_lead_schedule_assignments',
    'team_lead_state'
  )
order by tablename, policyname;

-- 4) Quick check for old policy names that often indicate stale permission state.
select
  schemaname,
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and policyname in (
    'schedule_settings_manage_desk_admin',
    'schedule_months_manage_desk_admin',
    'team_lead_schedule_assignments_manage_team_lead_admin'
  )
order by tablename, policyname;

-- 5) Check whether required tables have RLS enabled.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'schedule_settings',
    'schedule_months',
    'schedule_change_requests',
    'vacation_months',
    'vacation_settings',
    'team_lead_schedule_assignments',
    'team_lead_state'
  )
order by c.relname;

-- 6) Optional: verify seed rows that some pages expect.
select key, state, updated_at
from public.team_lead_state
where key in ('submission_access_v1', 'review_access_v1', 'final_cut_v1')
order by key;

select id, is_request_open, updated_at
from public.vacation_settings
where id = 'vacation_request_access';
