-- Incremental patch for Stage 5 objects only.
-- Safe to run on a database where auth/profiles/submissions/reviews already exist.
-- This patch intentionally does NOT recreate app_role, profiles, auth triggers, submissions, reviews, or review_assignments.

create table if not exists public.schedule_settings (
  key text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.schedule_settings
  add column if not exists state jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists set_schedule_settings_updated_at on public.schedule_settings;
create trigger set_schedule_settings_updated_at
before update on public.schedule_settings
for each row
execute function public.set_updated_at();

alter table public.schedule_settings enable row level security;

drop policy if exists "schedule_settings_select_approved" on public.schedule_settings;
create policy "schedule_settings_select_approved"
on public.schedule_settings
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "schedule_settings_manage_privileged" on public.schedule_settings;
drop policy if exists "schedule_settings_manage_desk_admin" on public.schedule_settings;
create policy "schedule_settings_manage_privileged"
on public.schedule_settings
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

create table if not exists public.schedule_months (
  month_key text primary key,
  draft_state jsonb,
  published_state jsonb,
  published_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.schedule_months
  add column if not exists draft_state jsonb,
  add column if not exists published_state jsonb,
  add column if not exists published_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists schedule_months_published_at_idx on public.schedule_months (published_at desc);

drop trigger if exists set_schedule_months_updated_at on public.schedule_months;
create trigger set_schedule_months_updated_at
before update on public.schedule_months
for each row
execute function public.set_updated_at();

alter table public.schedule_months enable row level security;

drop policy if exists "schedule_months_select_approved" on public.schedule_months;
create policy "schedule_months_select_approved"
on public.schedule_months
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "schedule_months_manage_privileged" on public.schedule_months;
drop policy if exists "schedule_months_manage_desk_admin" on public.schedule_months;
create policy "schedule_months_manage_privileged"
on public.schedule_months
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

create table if not exists public.schedule_change_requests (
  id uuid primary key default gen_random_uuid(),
  month_key text not null,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  requester_name text not null default '',
  source_ref jsonb,
  target_ref jsonb,
  route jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  has_conflict_warning boolean not null default false,
  applied_state jsonb,
  history jsonb not null default '[]'::jsonb,
  resolved_by uuid references public.profiles (id) on delete set null,
  rolled_back_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  rolled_back_at timestamptz
);

alter table if exists public.schedule_change_requests
  add column if not exists month_key text,
  add column if not exists requester_id uuid references public.profiles (id) on delete cascade,
  add column if not exists requester_name text not null default '',
  add column if not exists source_ref jsonb,
  add column if not exists target_ref jsonb,
  add column if not exists route jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'pending',
  add column if not exists has_conflict_warning boolean not null default false,
  add column if not exists applied_state jsonb,
  add column if not exists history jsonb not null default '[]'::jsonb,
  add column if not exists resolved_by uuid references public.profiles (id) on delete set null,
  add column if not exists rolled_back_by uuid references public.profiles (id) on delete set null,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists resolved_at timestamptz,
  add column if not exists rolled_back_at timestamptz;

create index if not exists schedule_change_requests_month_key_idx on public.schedule_change_requests (month_key);
create index if not exists schedule_change_requests_requester_id_idx on public.schedule_change_requests (requester_id);
create index if not exists schedule_change_requests_status_idx on public.schedule_change_requests (status, created_at desc);

alter table public.schedule_change_requests enable row level security;

drop policy if exists "schedule_change_requests_select_requester" on public.schedule_change_requests;
create policy "schedule_change_requests_select_requester"
on public.schedule_change_requests
for select
to authenticated
using (requester_id = auth.uid());

drop policy if exists "schedule_change_requests_select_managers" on public.schedule_change_requests;
create policy "schedule_change_requests_select_managers"
on public.schedule_change_requests
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "schedule_change_requests_insert_requester" on public.schedule_change_requests;
create policy "schedule_change_requests_insert_requester"
on public.schedule_change_requests
for insert
to authenticated
with check (
  requester_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "schedule_change_requests_update_managers" on public.schedule_change_requests;
create policy "schedule_change_requests_update_managers"
on public.schedule_change_requests
for update
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "schedule_change_requests_delete_managers" on public.schedule_change_requests;
create policy "schedule_change_requests_delete_managers"
on public.schedule_change_requests
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "schedule_change_requests_delete_requester_pending" on public.schedule_change_requests;
create policy "schedule_change_requests_delete_requester_pending"
on public.schedule_change_requests
for delete
to authenticated
using (
  requester_id = auth.uid()
  and status = 'pending'
  and public.current_profile_approved() = true
);

create table if not exists public.vacation_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  requester_name text not null default '',
  type text not null,
  year integer not null,
  month integer not null,
  month_key text not null,
  requested_dates jsonb not null default '[]'::jsonb,
  raw_dates text not null default '',
  status text not null default 'submitted',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.vacation_requests
  add column if not exists requester_id uuid references public.profiles (id) on delete cascade,
  add column if not exists requester_name text not null default '',
  add column if not exists type text,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists month_key text,
  add column if not exists requested_dates jsonb not null default '[]'::jsonb,
  add column if not exists raw_dates text not null default '',
  add column if not exists status text not null default 'submitted',
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists vacation_requests_requester_id_idx on public.vacation_requests (requester_id);
create index if not exists vacation_requests_month_key_idx on public.vacation_requests (month_key, created_at desc);

drop trigger if exists set_vacation_requests_updated_at on public.vacation_requests;
create trigger set_vacation_requests_updated_at
before update on public.vacation_requests
for each row
execute function public.set_updated_at();

alter table public.vacation_requests enable row level security;

drop policy if exists "vacation_requests_select_own" on public.vacation_requests;
create policy "vacation_requests_select_own"
on public.vacation_requests
for select
to authenticated
using (requester_id = auth.uid());

drop policy if exists "vacation_requests_select_managers" on public.vacation_requests;
create policy "vacation_requests_select_managers"
on public.vacation_requests
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "vacation_requests_insert_own" on public.vacation_requests;
create policy "vacation_requests_insert_own"
on public.vacation_requests
for insert
to authenticated
with check (
  requester_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "vacation_requests_update_own" on public.vacation_requests;
create policy "vacation_requests_update_own"
on public.vacation_requests
for update
to authenticated
using (requester_id = auth.uid())
with check (requester_id = auth.uid());

drop policy if exists "vacation_requests_delete_own" on public.vacation_requests;
create policy "vacation_requests_delete_own"
on public.vacation_requests
for delete
to authenticated
using (requester_id = auth.uid());

create table if not exists public.vacation_months (
  month_key text primary key,
  managed_date_keys jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  annual_winners jsonb not null default '{}'::jsonb,
  compensatory_winners jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.vacation_months
  add column if not exists managed_date_keys jsonb not null default '[]'::jsonb,
  add column if not exists limits jsonb not null default '{}'::jsonb,
  add column if not exists annual_winners jsonb not null default '{}'::jsonb,
  add column if not exists compensatory_winners jsonb not null default '{}'::jsonb,
  add column if not exists applied_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists set_vacation_months_updated_at on public.vacation_months;
create trigger set_vacation_months_updated_at
before update on public.vacation_months
for each row
execute function public.set_updated_at();

alter table public.vacation_months enable row level security;

drop policy if exists "vacation_months_select_approved" on public.vacation_months;
create policy "vacation_months_select_approved"
on public.vacation_months
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "vacation_months_manage_privileged" on public.vacation_months;
drop policy if exists "vacation_months_manage_desk_admin" on public.vacation_months;
create policy "vacation_months_manage_privileged"
on public.vacation_months
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

create table if not exists public.vacation_settings (
  id text primary key,
  is_request_open boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.vacation_settings
  add column if not exists is_request_open boolean not null default false,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists set_vacation_settings_updated_at on public.vacation_settings;
create trigger set_vacation_settings_updated_at
before update on public.vacation_settings
for each row
execute function public.set_updated_at();

alter table public.vacation_settings enable row level security;

drop policy if exists "vacation_settings_select_approved" on public.vacation_settings;
create policy "vacation_settings_select_approved"
on public.vacation_settings
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "vacation_settings_manage_privileged" on public.vacation_settings;
create policy "vacation_settings_manage_privileged"
on public.vacation_settings
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

insert into public.vacation_settings (id, is_request_open)
values ('vacation_request_access', false)
on conflict (id) do nothing;

create table if not exists public.team_lead_schedule_assignments (
  month_key text primary key,
  entries jsonb not null default '{}'::jsonb,
  rows jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.team_lead_schedule_assignments
  add column if not exists entries jsonb not null default '{}'::jsonb,
  add column if not exists rows jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists set_team_lead_schedule_assignments_updated_at on public.team_lead_schedule_assignments;
create trigger set_team_lead_schedule_assignments_updated_at
before update on public.team_lead_schedule_assignments
for each row
execute function public.set_updated_at();

alter table public.team_lead_schedule_assignments enable row level security;

drop policy if exists "team_lead_schedule_assignments_select_managers" on public.team_lead_schedule_assignments;
create policy "team_lead_schedule_assignments_select_managers"
on public.team_lead_schedule_assignments
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_schedule_assignments_manage_privileged" on public.team_lead_schedule_assignments;
drop policy if exists "team_lead_schedule_assignments_manage_team_lead_admin" on public.team_lead_schedule_assignments;
create policy "team_lead_schedule_assignments_manage_privileged"
on public.team_lead_schedule_assignments
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

create table if not exists public.team_lead_state (
  key text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.team_lead_state
  add column if not exists state jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists set_team_lead_state_updated_at on public.team_lead_state;
create trigger set_team_lead_state_updated_at
before update on public.team_lead_state
for each row
execute function public.set_updated_at();

alter table public.team_lead_state enable row level security;

drop policy if exists "team_lead_state_select_managers" on public.team_lead_state;
create policy "team_lead_state_select_managers"
on public.team_lead_state
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_state_select_submission_access_approved" on public.team_lead_state;
create policy "team_lead_state_select_submission_access_approved"
on public.team_lead_state
for select
to authenticated
using (
  key = 'submission_access_v1'
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_state_manage_team_lead_admin" on public.team_lead_state;
create policy "team_lead_state_manage_team_lead_admin"
on public.team_lead_state
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_state_manage_desk_final_cut" on public.team_lead_state;
create policy "team_lead_state_manage_desk_final_cut"
on public.team_lead_state
for all
to authenticated
using (
  public.current_profile_role() = 'desk'
  and public.current_profile_approved() = true
  and key = 'final_cut_v1'
)
with check (
  public.current_profile_role() = 'desk'
  and public.current_profile_approved() = true
  and key = 'final_cut_v1'
);

create or replace function public.current_profile_has_review_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.current_profile_approved() = true
    and (
      public.current_profile_role() in ('reviewer', 'team_lead', 'admin', 'desk')
      or exists (
        select 1
        from public.team_lead_state
        where public.team_lead_state.key = 'review_access_v1'
          and coalesce(public.team_lead_state.state -> 'profileIds', '[]'::jsonb) @> to_jsonb(array[auth.uid()::text])
      )
    )
  );
$$;

drop policy if exists "submissions_select_granted_reviewers" on public.submissions;
create policy "submissions_select_granted_reviewers"
on public.submissions
for select
to authenticated
using (public.current_profile_has_review_access());

drop policy if exists "reviews_insert_granted_reviewers" on public.reviews;
create policy "reviews_insert_granted_reviewers"
on public.reviews
for insert
to authenticated
with check (
  reviewer_id = auth.uid()
  and public.current_profile_has_review_access()
);

drop policy if exists "reviews_update_granted_reviewers" on public.reviews;
create policy "reviews_update_granted_reviewers"
on public.reviews
for update
to authenticated
using (
  reviewer_id = auth.uid()
  and public.current_profile_has_review_access()
)
with check (
  reviewer_id = auth.uid()
  and public.current_profile_has_review_access()
);

drop policy if exists "reviews_delete_granted_reviewers" on public.reviews;
create policy "reviews_delete_granted_reviewers"
on public.reviews
for delete
to authenticated
using (
  reviewer_id = auth.uid()
  and public.current_profile_has_review_access()
);
