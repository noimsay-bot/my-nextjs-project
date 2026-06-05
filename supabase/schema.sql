create type public.app_role as enum ('member', 'outlet', 'reviewer', 'observer', 'partner', 'desk', 'team_lead', 'admin');

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  login_id text,
  name text not null,
  role public.app_role not null default 'member',
  approved boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));
create unique index if not exists profiles_login_id_lower_idx on public.profiles (lower(login_id))
where login_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.current_profile_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(approved, false)
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.find_email_by_login_id(input_login_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where lower(login_id) = lower(trim(input_login_id))
  limit 1;
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
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_name text;
  next_login_id text;
  next_role public.app_role;
begin
  next_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    split_part(new.email, '@', 1)
  );
  next_login_id := nullif(lower(trim(coalesce(new.raw_user_meta_data ->> 'login_id', ''))), '');
  next_role := case
    when next_login_id = 'noimsay' then 'admin'::public.app_role
    else 'member'::public.app_role
  end;

  insert into public.profiles (
    id,
    email,
    login_id,
    name,
    role,
    approved
  )
  values (
    new.id,
    new.email,
    next_login_id,
    next_name,
    next_role,
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    login_id = coalesce(excluded.login_id, public.profiles.login_id),
    name = coalesce(excluded.name, public.profiles.name),
    role = case
      when coalesce(excluded.login_id, public.profiles.login_id) = 'noimsay' then 'admin'::public.app_role
      else public.profiles.role
    end,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

update public.profiles
set
  role = 'admin',
  approved = true,
  updated_at = timezone('utc', now())
where lower(trim(coalesce(login_id, ''))) = 'noimsay';

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_select_approved_directory"
on public.profiles
for select
to authenticated
using (approved = true);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and role = 'member'
  and approved = true
);

create policy "profiles_update_own_basic_fields"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = public.current_profile_role()
  and approved = public.current_profile_approved()
);

create policy "profiles_admin_select_all"
on public.profiles
for select
to authenticated
using (public.is_admin());

create policy "profiles_admin_update_all"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "profiles_admin_delete_all" on public.profiles;
create policy "profiles_admin_delete_all"
on public.profiles
for delete
to authenticated
using (public.is_admin());

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null default '',
  link text not null default '',
  date date,
  notes text,
  status text not null default 'submitted',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists submissions_author_id_idx on public.submissions (author_id);
create index if not exists submissions_updated_at_idx on public.submissions (updated_at desc);

drop trigger if exists set_submissions_updated_at on public.submissions;

create trigger set_submissions_updated_at
before update on public.submissions
for each row
execute function public.set_updated_at();

alter table public.submissions enable row level security;

drop policy if exists "submissions_select_own" on public.submissions;
create policy "submissions_select_own"
on public.submissions
for select
to authenticated
using (author_id = auth.uid());

drop policy if exists "submissions_insert_own" on public.submissions;
create policy "submissions_insert_own"
on public.submissions
for insert
to authenticated
with check (
  author_id = auth.uid()
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "submissions_update_own" on public.submissions;
create policy "submissions_update_own"
on public.submissions
for update
to authenticated
using (
  author_id = auth.uid()
  and public.current_profile_role() <> 'observer'
)
with check (
  author_id = auth.uid()
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "submissions_delete_own" on public.submissions;
create policy "submissions_delete_own"
on public.submissions
for delete
to authenticated
using (
  author_id = auth.uid()
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "submissions_select_reviewers_and_leads" on public.submissions;
create policy "submissions_select_reviewers_and_leads"
on public.submissions
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'desk')
  and public.current_profile_approved() = true
);

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  reset_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (submission_id, reviewer_id)
);

create index if not exists review_assignments_submission_id_idx on public.review_assignments (submission_id);
create index if not exists review_assignments_reviewer_id_idx on public.review_assignments (reviewer_id);
create index if not exists review_assignments_active_reviewer_idx on public.review_assignments (reviewer_id, assigned_at desc)
where reset_at is null;
create unique index if not exists review_assignments_one_active_submission_idx on public.review_assignments (submission_id)
where reset_at is null;

drop policy if exists "submissions_select_assigned_reviewer" on public.submissions;
create policy "submissions_select_assigned_reviewer"
on public.submissions
for select
to authenticated
using (
  public.current_profile_role() = 'reviewer'
  and public.current_profile_approved() = true
  and exists (
    select 1
    from public.review_assignments
    where public.review_assignments.submission_id = public.submissions.id
      and public.review_assignments.reviewer_id = auth.uid()
      and public.review_assignments.reset_at is null
  )
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  comment text,
  total numeric,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (submission_id, reviewer_id)
);

create index if not exists reviews_submission_id_idx on public.reviews (submission_id);
create index if not exists reviews_reviewer_id_idx on public.reviews (reviewer_id);
create index if not exists reviews_completed_at_idx on public.reviews (completed_at desc);

drop trigger if exists set_reviews_updated_at on public.reviews;

create trigger set_reviews_updated_at
before update on public.reviews
for each row
execute function public.set_updated_at();

alter table public.review_assignments enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "review_assignments_select_own" on public.review_assignments;
create policy "review_assignments_select_own"
on public.review_assignments
for select
to authenticated
using (reviewer_id = auth.uid());

drop policy if exists "review_assignments_select_leads" on public.review_assignments;
create policy "review_assignments_select_leads"
on public.review_assignments
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "review_assignments_insert_leads" on public.review_assignments;
create policy "review_assignments_insert_leads"
on public.review_assignments
for insert
to authenticated
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "review_assignments_update_leads" on public.review_assignments;
create policy "review_assignments_update_leads"
on public.review_assignments
for update
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "review_assignments_delete_leads" on public.review_assignments;
create policy "review_assignments_delete_leads"
on public.review_assignments
for delete
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "reviews_select_own" on public.reviews;
create policy "reviews_select_own"
on public.reviews
for select
to authenticated
using (reviewer_id = auth.uid());

drop policy if exists "reviews_select_privileged" on public.reviews;
create policy "reviews_select_privileged"
on public.reviews
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "reviews_insert_assigned_reviewer" on public.reviews;
create policy "reviews_insert_assigned_reviewer"
on public.reviews
for insert
to authenticated
with check (
  reviewer_id = auth.uid()
  and public.current_profile_role() = 'reviewer'
  and public.current_profile_approved() = true
  and exists (
    select 1
    from public.review_assignments
    where public.review_assignments.submission_id = public.reviews.submission_id
      and public.review_assignments.reviewer_id = auth.uid()
      and public.review_assignments.reset_at is null
  )
);

drop policy if exists "reviews_update_assigned_reviewer" on public.reviews;
create policy "reviews_update_assigned_reviewer"
on public.reviews
for update
to authenticated
using (
  reviewer_id = auth.uid()
  and public.current_profile_role() = 'reviewer'
  and public.current_profile_approved() = true
  and exists (
    select 1
    from public.review_assignments
    where public.review_assignments.submission_id = public.reviews.submission_id
      and public.review_assignments.reviewer_id = auth.uid()
      and public.review_assignments.reset_at is null
  )
)
with check (
  reviewer_id = auth.uid()
  and public.current_profile_role() = 'reviewer'
  and public.current_profile_approved() = true
  and exists (
    select 1
    from public.review_assignments
    where public.review_assignments.submission_id = public.reviews.submission_id
      and public.review_assignments.reviewer_id = auth.uid()
      and public.review_assignments.reset_at is null
  )
);

drop policy if exists "reviews_delete_assigned_reviewer" on public.reviews;
create policy "reviews_delete_assigned_reviewer"
on public.reviews
for delete
to authenticated
using (
  reviewer_id = auth.uid()
  and public.current_profile_role() = 'reviewer'
  and public.current_profile_approved() = true
  and exists (
    select 1
    from public.review_assignments
    where public.review_assignments.submission_id = public.reviews.submission_id
      and public.review_assignments.reviewer_id = auth.uid()
      and public.review_assignments.reset_at is null
  )
);

create table if not exists public.schedule_settings (
  key text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

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

create table if not exists public.portal_user_settings (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  key text not null,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (profile_id, key)
);

drop trigger if exists set_portal_user_settings_updated_at on public.portal_user_settings;

create trigger set_portal_user_settings_updated_at
before update on public.portal_user_settings
for each row
execute function public.set_updated_at();

alter table public.portal_user_settings enable row level security;

drop policy if exists "portal_user_settings_select_own" on public.portal_user_settings;
create policy "portal_user_settings_select_own"
on public.portal_user_settings
for select
to authenticated
using (
  profile_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "portal_user_settings_insert_own" on public.portal_user_settings;
create policy "portal_user_settings_insert_own"
on public.portal_user_settings
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "portal_user_settings_update_own" on public.portal_user_settings;
create policy "portal_user_settings_update_own"
on public.portal_user_settings
for update
to authenticated
using (
  profile_id = auth.uid()
  and public.current_profile_approved() = true
)
with check (
  profile_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "portal_user_settings_delete_own" on public.portal_user_settings;
create policy "portal_user_settings_delete_own"
on public.portal_user_settings
for delete
to authenticated
using (
  profile_id = auth.uid()
  and public.current_profile_approved() = true
);

grant select, insert, update, delete on public.portal_user_settings to authenticated;

create table if not exists public.schedule_months (
  month_key text primary key,
  draft_state jsonb,
  published_state jsonb,
  published_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

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

create table if not exists public.schedule_assembly_sync_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  trigger_type text not null check (trigger_type in ('hub_publish', 'assembly_webhook')),
  target_month text not null,
  source text not null default 'assembly_export_api',
  total_source_count integer not null default 0 check (total_source_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  deleted_count integer not null default 0 check (deleted_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  error_details jsonb
);

create index if not exists schedule_assembly_sync_logs_month_created_idx
on public.schedule_assembly_sync_logs (target_month, created_at desc);

create index if not exists schedule_assembly_sync_logs_trigger_created_idx
on public.schedule_assembly_sync_logs (trigger_type, created_at desc);

alter table public.schedule_assembly_sync_logs enable row level security;

create table if not exists public.schedule_assembly_leave_push_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  action text not null check (action in ('upsert', 'delete')),
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  member_name text not null default '',
  request_id text not null,
  success boolean not null default false,
  error_message text
);

create index if not exists schedule_assembly_leave_push_logs_request_created_idx
on public.schedule_assembly_leave_push_logs (request_id, created_at desc);

create index if not exists schedule_assembly_leave_push_logs_date_created_idx
on public.schedule_assembly_leave_push_logs (date, created_at desc);

alter table public.schedule_assembly_leave_push_logs enable row level security;

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

create table if not exists public.home_popup_notice_state (
  key text primary key,
  notice_id uuid not null default gen_random_uuid(),
  title text not null default '',
  body text not null default '',
  is_active boolean not null default false,
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_home_popup_notice_state_updated_at on public.home_popup_notice_state;
create trigger set_home_popup_notice_state_updated_at
before update on public.home_popup_notice_state
for each row
execute function public.set_updated_at();

alter table public.home_popup_notice_state enable row level security;

drop policy if exists "home_popup_notice_state_select_active_approved" on public.home_popup_notice_state;
create policy "home_popup_notice_state_select_active_approved"
on public.home_popup_notice_state
for select
to authenticated
using (
  public.current_profile_approved() = true
);

drop policy if exists "home_popup_notice_state_select_managers" on public.home_popup_notice_state;
create policy "home_popup_notice_state_select_managers"
on public.home_popup_notice_state
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "home_popup_notice_state_manage_privileged" on public.home_popup_notice_state;
create policy "home_popup_notice_state_manage_privileged"
on public.home_popup_notice_state
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

create table if not exists public.home_popup_notice_applications (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null,
  applicant_id uuid not null references public.profiles (id) on delete cascade,
  applicant_name text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists home_popup_notice_applications_notice_id_idx
  on public.home_popup_notice_applications (notice_id, created_at desc);
create index if not exists home_popup_notice_applications_applicant_id_idx
  on public.home_popup_notice_applications (applicant_id, created_at desc);
create unique index if not exists home_popup_notice_applications_notice_applicant_uidx
  on public.home_popup_notice_applications (notice_id, applicant_id);

alter table public.home_popup_notice_applications enable row level security;

drop policy if exists "home_popup_notice_applications_select_managers" on public.home_popup_notice_applications;
create policy "home_popup_notice_applications_select_managers"
on public.home_popup_notice_applications
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "home_popup_notice_applications_select_own" on public.home_popup_notice_applications;
create policy "home_popup_notice_applications_select_own"
on public.home_popup_notice_applications
for select
to authenticated
using (
  applicant_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "home_popup_notice_applications_insert_own" on public.home_popup_notice_applications;
create policy "home_popup_notice_applications_insert_own"
on public.home_popup_notice_applications
for insert
to authenticated
with check (
  applicant_id = auth.uid()
  and public.current_profile_approved() = true
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "home_popup_notice_applications_manage_privileged" on public.home_popup_notice_applications;
create policy "home_popup_notice_applications_manage_privileged"
on public.home_popup_notice_applications
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

create table if not exists public.home_notice_poll_votes (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null,
  poll_id uuid not null,
  option_id uuid not null,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  voter_name text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists home_notice_poll_votes_notice_poll_idx
  on public.home_notice_poll_votes (notice_id, poll_id, created_at desc);
create index if not exists home_notice_poll_votes_option_idx
  on public.home_notice_poll_votes (notice_id, poll_id, option_id);
create index if not exists home_notice_poll_votes_voter_idx
  on public.home_notice_poll_votes (voter_id, created_at desc);
create unique index if not exists home_notice_poll_votes_once_uidx
  on public.home_notice_poll_votes (notice_id, poll_id, voter_id);

alter table public.home_notice_poll_votes enable row level security;

drop policy if exists "home_notice_poll_votes_select_own" on public.home_notice_poll_votes;
create policy "home_notice_poll_votes_select_own"
on public.home_notice_poll_votes
for select
to authenticated
using (
  voter_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "home_notice_poll_votes_insert_own" on public.home_notice_poll_votes;
create policy "home_notice_poll_votes_insert_own"
on public.home_notice_poll_votes
for insert
to authenticated
with check (
  voter_id = auth.uid()
  and public.current_profile_approved() = true
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "home_notice_poll_votes_delete_privileged" on public.home_notice_poll_votes;
create policy "home_notice_poll_votes_delete_privileged"
on public.home_notice_poll_votes
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
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

drop policy if exists "vacation_requests_select_approved" on public.vacation_requests;
create policy "vacation_requests_select_approved"
on public.vacation_requests
for select
to authenticated
using (public.current_profile_approved() = true);

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
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "vacation_requests_update_own" on public.vacation_requests;
create policy "vacation_requests_update_own"
on public.vacation_requests
for update
to authenticated
using (
  requester_id = auth.uid()
  and public.current_profile_role() <> 'observer'
)
with check (
  requester_id = auth.uid()
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "vacation_requests_delete_own" on public.vacation_requests;
create policy "vacation_requests_delete_own"
on public.vacation_requests
for delete
to authenticated
using (
  requester_id = auth.uid()
  and public.current_profile_role() <> 'observer'
);

create table if not exists public.vacation_months (
  month_key text primary key,
  managed_date_keys jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  annual_winners jsonb not null default '{}'::jsonb,
  compensatory_winners jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

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

create table if not exists public.team_lead_schedule_assignment_backups (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'daily' check (kind in ('daily')),
  month_key text not null,
  backup_date date not null,
  label text not null default '',
  entries jsonb not null default '{}'::jsonb,
  rows jsonb not null default '{}'::jsonb,
  entry_count integer not null default 0 check (entry_count >= 0),
  row_change_count integer not null default 0 check (row_change_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint team_lead_schedule_assignment_backups_daily_unique unique (kind, month_key, backup_date)
);

create index if not exists team_lead_schedule_assignment_backups_month_date_idx
on public.team_lead_schedule_assignment_backups (month_key, backup_date desc);

drop trigger if exists set_team_lead_schedule_assignment_backups_updated_at on public.team_lead_schedule_assignment_backups;

create trigger set_team_lead_schedule_assignment_backups_updated_at
before update on public.team_lead_schedule_assignment_backups
for each row
execute function public.set_updated_at();

create or replace function public.prune_team_lead_schedule_assignment_backups()
returns trigger
language plpgsql
as $$
begin
  delete from public.team_lead_schedule_assignment_backups backups
  where backups.kind = new.kind
    and backups.month_key = new.month_key
    and backups.backup_date < new.backup_date - 9;

  delete from public.team_lead_schedule_assignment_backups backups
  where backups.id in (
    select ranked.id
    from (
      select
        id,
        row_number() over (
          partition by kind, month_key
          order by backup_date desc, updated_at desc, id desc
        ) as backup_rank
      from public.team_lead_schedule_assignment_backups
      where kind = new.kind
        and month_key = new.month_key
    ) ranked
    where ranked.backup_rank > 10
  );

  return new;
end;
$$;

drop trigger if exists prune_team_lead_schedule_assignment_backups on public.team_lead_schedule_assignment_backups;

create trigger prune_team_lead_schedule_assignment_backups
after insert or update on public.team_lead_schedule_assignment_backups
for each row
execute function public.prune_team_lead_schedule_assignment_backups();

alter table public.team_lead_schedule_assignment_backups enable row level security;

drop policy if exists "team_lead_schedule_assignment_backups_select_managers" on public.team_lead_schedule_assignment_backups;
create policy "team_lead_schedule_assignment_backups_select_managers"
on public.team_lead_schedule_assignment_backups
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_schedule_assignment_backups_manage_privileged" on public.team_lead_schedule_assignment_backups;
create policy "team_lead_schedule_assignment_backups_manage_privileged"
on public.team_lead_schedule_assignment_backups
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

create table if not exists public.schedule_partner_entries (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  schedule_item_id text not null,
  photographer_profile_id uuid references public.profiles (id) on delete set null,
  photographer_name text not null default '',
  schedule_content text not null default '',
  audio_man_name text,
  senior_name text,
  memo_text text,
  final_cut_completed boolean not null default false,
  partner_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists schedule_partner_entries_schedule_item_idx
  on public.schedule_partner_entries (schedule_item_id);
create index if not exists schedule_partner_entries_date_idx
  on public.schedule_partner_entries (schedule_date);
create index if not exists schedule_partner_entries_photographer_idx
  on public.schedule_partner_entries (photographer_profile_id, schedule_date);

drop trigger if exists set_schedule_partner_entries_updated_at on public.schedule_partner_entries;
create trigger set_schedule_partner_entries_updated_at
before update on public.schedule_partner_entries
for each row
execute function public.set_updated_at();

alter table public.schedule_partner_entries enable row level security;

drop policy if exists "schedule_partner_entries_select_scoped" on public.schedule_partner_entries;
create policy "schedule_partner_entries_select_scoped"
on public.schedule_partner_entries
for select
to authenticated
using (
  public.current_profile_approved() = true
  and (
    photographer_profile_id = auth.uid()
    or public.current_profile_role() in ('partner', 'team_lead', 'admin')
  )
);

drop policy if exists "schedule_partner_entries_insert_partner" on public.schedule_partner_entries;
create policy "schedule_partner_entries_insert_partner"
on public.schedule_partner_entries
for insert
to authenticated
with check (
  public.current_profile_role() = 'partner'
  and public.current_profile_approved() = true
  and partner_profile_id = auth.uid()
);

drop policy if exists "schedule_partner_entries_update_partner" on public.schedule_partner_entries;
create policy "schedule_partner_entries_update_partner"
on public.schedule_partner_entries
for update
to authenticated
using (
  public.current_profile_role() = 'partner'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() = 'partner'
  and public.current_profile_approved() = true
  and partner_profile_id = auth.uid()
);

create or replace function public.get_my_schedule_assignment_items(
  p_month_key text
)
returns table (
  schedule_date date,
  schedule_item_id text,
  photographer_profile_id uuid,
  photographer_name text,
  schedule_content text
)
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select id, name
    from public.profiles
    where id = auth.uid()
      and approved = true
      and role <> 'partner'
      and role <> 'observer'
  ),
  requested_month as (
    select trim(coalesce(p_month_key, '')) as month_key
  ),
  requested_window as (
    select
      requested_month.month_key,
      (requested_month.month_key || '-01')::date as first_day
    from requested_month
    where requested_month.month_key ~ '^\d{4}-\d{2}$'
  ),
  assignment_month as (
    select
      t.month_key,
      coalesce(t.entries, '{}'::jsonb) as entries,
      coalesce(t.rows, '{}'::jsonb) as rows,
      requested_window.month_key as requested_month_key
    from public.team_lead_schedule_assignments t
    join requested_window on t.month_key in (
      to_char(requested_window.first_day - interval '1 month', 'YYYY-MM'),
      requested_window.month_key,
      to_char(requested_window.first_day + interval '1 month', 'YYYY-MM')
    )
  ),
  entry_items as (
    select
      assignment_month.month_key,
      assignment_month.requested_month_key,
      assignment_month.rows,
      entry_item.key as row_key,
      schedule_item.content,
      schedule_item.ordinality
    from assignment_month
    cross join lateral jsonb_each(assignment_month.entries) as entry_item(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
  ),
  parsed_entry_items as (
    select
      entry_items.month_key,
      entry_items.rows,
      entry_items.row_key,
      entry_items.ordinality,
      split_part(entry_items.row_key, '::', 1) as date_key,
      split_part(entry_items.row_key, '::', 2) as row_type,
      split_part(entry_items.row_key, '::', 3) as row_ref,
      nullif(trim(split_part(entry_items.row_key, '::', 4)), '') as base_name,
      trim(entry_items.content) as schedule_content,
      case
        when entry_items.month_key = substring(split_part(entry_items.row_key, '::', 1) from 1 for 7) then 0
        when entry_items.month_key = entry_items.requested_month_key then 1
        else 2
      end as source_rank
    from entry_items
    where split_part(entry_items.row_key, '::', 1) like entry_items.requested_month_key || '-__'
      and split_part(entry_items.row_key, '::', 1) ~ '^\d{4}-\d{2}-\d{2}$'
      and split_part(entry_items.row_key, '::', 2) <> '휴가'
      and split_part(entry_items.row_key, '::', 2) <> '제크'
      and trim(entry_items.content) <> ''
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(entry_items.rows -> split_part(entry_items.row_key, '::', 1) -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = entry_items.row_key
      )
  ),
  visible_items as (
    select
      parsed_entry_items.date_key,
      concat(parsed_entry_items.row_key, '::schedule::', parsed_entry_items.ordinality::text) as schedule_item_id,
      parsed_entry_items.row_key,
      parsed_entry_items.ordinality,
      parsed_entry_items.schedule_content,
      parsed_entry_items.source_rank,
      case when partner_entry.id is null then 1 else 0 end as partner_rank,
      coalesce(
        nullif(trim(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'rowOverrides' -> parsed_entry_items.row_key ->> 'name'), ''),
        nullif(trim(custom_row.value ->> 'name'), ''),
        parsed_entry_items.base_name
      ) as photographer_name
    from parsed_entry_items
    left join lateral jsonb_array_elements(
      case
        when parsed_entry_items.row_type = 'custom'
          and jsonb_typeof(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows') = 'array'
          then parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows'
        else '[]'::jsonb
      end
    ) as custom_row(value)
      on parsed_entry_items.row_type = 'custom'
     and custom_row.value ->> 'id' = parsed_entry_items.row_ref
    left join public.schedule_partner_entries partner_entry
      on partner_entry.schedule_item_id = concat(parsed_entry_items.row_key, '::schedule::', parsed_entry_items.ordinality::text)
  ),
  deduped_items as (
    select *
    from (
      select
        visible_items.*,
        row_number() over (
          partition by visible_items.date_key, visible_items.photographer_name, visible_items.schedule_content
          order by visible_items.partner_rank, visible_items.source_rank, visible_items.schedule_item_id
        ) as duplicate_rank
      from visible_items
    ) ranked_items
    where ranked_items.duplicate_rank = 1
  )
  select
    deduped_items.date_key::date as schedule_date,
    deduped_items.schedule_item_id as schedule_item_id,
    current_profile.id as photographer_profile_id,
    current_profile.name as photographer_name,
    deduped_items.schedule_content as schedule_content
  from deduped_items
  join current_profile on deduped_items.photographer_name = current_profile.name
  order by schedule_date, schedule_item_id;
$$;

create or replace function public.get_partner_schedule_assignment_items(
  p_schedule_date date
)
returns table (
  schedule_date date,
  schedule_item_id text,
  photographer_profile_id uuid,
  photographer_name text,
  schedule_content text
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select public.current_profile_approved() = true
      and public.current_profile_role() = 'partner' as ok
  ),
  target_date as (
    select
      p_schedule_date as schedule_date,
      to_char(p_schedule_date, 'YYYY-MM') as month_key,
      date_trunc('month', p_schedule_date)::date as first_day
    where p_schedule_date is not null
  ),
  assignment_month as (
    select
      t.month_key,
      coalesce(t.entries, '{}'::jsonb) as entries,
      coalesce(t.rows, '{}'::jsonb) as rows,
      target_date.schedule_date
    from public.team_lead_schedule_assignments t
    cross join allowed
    join target_date on t.month_key in (
      to_char(target_date.first_day - interval '1 month', 'YYYY-MM'),
      target_date.month_key,
      to_char(target_date.first_day + interval '1 month', 'YYYY-MM')
    )
    where allowed.ok
  ),
  entry_items as (
    select
      assignment_month.month_key,
      assignment_month.rows,
      assignment_month.schedule_date,
      entry_item.key as row_key,
      schedule_item.content,
      schedule_item.ordinality
    from assignment_month
    cross join lateral jsonb_each(assignment_month.entries) as entry_item(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
  ),
  parsed_entry_items as (
    select
      entry_items.month_key,
      entry_items.rows,
      entry_items.row_key,
      entry_items.ordinality,
      split_part(entry_items.row_key, '::', 1) as date_key,
      split_part(entry_items.row_key, '::', 2) as row_type,
      split_part(entry_items.row_key, '::', 3) as row_ref,
      nullif(trim(split_part(entry_items.row_key, '::', 4)), '') as base_name,
      trim(entry_items.content) as schedule_content,
      case
        when entry_items.month_key = substring(split_part(entry_items.row_key, '::', 1) from 1 for 7) then 0
        else 1
      end as source_rank
    from entry_items
    where split_part(entry_items.row_key, '::', 1) = entry_items.schedule_date::text
      and split_part(entry_items.row_key, '::', 1) ~ '^\d{4}-\d{2}-\d{2}$'
      and split_part(entry_items.row_key, '::', 2) <> '휴가'
      and split_part(entry_items.row_key, '::', 2) <> '제크'
      and trim(entry_items.content) <> ''
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(entry_items.rows -> split_part(entry_items.row_key, '::', 1) -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = entry_items.row_key
      )
  ),
  visible_items as (
    select
      parsed_entry_items.date_key,
      concat(parsed_entry_items.row_key, '::schedule::', parsed_entry_items.ordinality::text) as schedule_item_id,
      parsed_entry_items.row_key,
      parsed_entry_items.ordinality,
      parsed_entry_items.schedule_content,
      parsed_entry_items.source_rank,
      case when partner_entry.id is null then 1 else 0 end as partner_rank,
      coalesce(
        nullif(trim(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'rowOverrides' -> parsed_entry_items.row_key ->> 'name'), ''),
        nullif(trim(custom_row.value ->> 'name'), ''),
        parsed_entry_items.base_name
      ) as photographer_name
    from parsed_entry_items
    left join lateral jsonb_array_elements(
      case
        when parsed_entry_items.row_type = 'custom'
          and jsonb_typeof(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows') = 'array'
          then parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows'
        else '[]'::jsonb
      end
    ) as custom_row(value)
      on parsed_entry_items.row_type = 'custom'
     and custom_row.value ->> 'id' = parsed_entry_items.row_ref
    left join public.schedule_partner_entries partner_entry
      on partner_entry.schedule_item_id = concat(parsed_entry_items.row_key, '::schedule::', parsed_entry_items.ordinality::text)
  ),
  deduped_items as (
    select *
    from (
      select
        visible_items.*,
        row_number() over (
          partition by visible_items.date_key, visible_items.photographer_name, visible_items.schedule_content
          order by visible_items.partner_rank, visible_items.source_rank, visible_items.schedule_item_id
        ) as duplicate_rank
      from visible_items
    ) ranked_items
    where ranked_items.duplicate_rank = 1
  )
  select
    deduped_items.date_key::date as schedule_date,
    deduped_items.schedule_item_id as schedule_item_id,
    photographer.id as photographer_profile_id,
    deduped_items.photographer_name as photographer_name,
    deduped_items.schedule_content as schedule_content
  from deduped_items
  left join public.profiles photographer
    on photographer.approved = true
   and photographer.name = deduped_items.photographer_name
  where deduped_items.photographer_name is not null
  order by photographer_name, schedule_item_id;
$$;

create or replace function public.upsert_my_schedule_partner_entry(
  p_schedule_date date,
  p_schedule_item_id text,
  p_audio_man_name text default null,
  p_senior_name text default null,
  p_memo_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment record;
begin
  select *
  into target_assignment
  from public.get_my_schedule_assignment_items(to_char(p_schedule_date, 'YYYY-MM'))
  where schedule_date = p_schedule_date
    and schedule_item_id = trim(coalesce(p_schedule_item_id, ''))
    and photographer_profile_id = auth.uid()
  limit 1;

  if not found then
    raise exception '수정할 수 있는 내 일정을 찾을 수 없습니다.';
  end if;

  insert into public.schedule_partner_entries (
    schedule_date,
    schedule_item_id,
    photographer_profile_id,
    photographer_name,
    schedule_content,
    audio_man_name,
    senior_name,
    memo_text,
    partner_profile_id
  )
  values (
    target_assignment.schedule_date,
    target_assignment.schedule_item_id,
    target_assignment.photographer_profile_id,
    target_assignment.photographer_name,
    target_assignment.schedule_content,
    nullif(trim(coalesce(p_audio_man_name, '')), ''),
    nullif(trim(coalesce(p_senior_name, '')), ''),
    nullif(trim(coalesce(p_memo_text, '')), ''),
    null
  )
  on conflict (schedule_item_id) do update
  set
    schedule_date = excluded.schedule_date,
    photographer_profile_id = excluded.photographer_profile_id,
    photographer_name = excluded.photographer_name,
    schedule_content = excluded.schedule_content,
    audio_man_name = excluded.audio_man_name,
    senior_name = excluded.senior_name,
    memo_text = excluded.memo_text;
end;
$$;

create or replace function public.update_my_schedule_final_cut_status(
  p_schedule_date date,
  p_schedule_item_id text,
  p_final_cut_completed boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment record;
begin
  select *
  into target_assignment
  from public.get_my_schedule_assignment_items(to_char(p_schedule_date, 'YYYY-MM'))
  where schedule_date = p_schedule_date
    and schedule_item_id = trim(coalesce(p_schedule_item_id, ''))
    and photographer_profile_id = auth.uid()
  limit 1;

  if not found then
    raise exception '정제본 생성완료 처리할 내 일정을 찾을 수 없습니다.';
  end if;

  insert into public.schedule_partner_entries (
    schedule_date,
    schedule_item_id,
    photographer_profile_id,
    photographer_name,
    schedule_content,
    final_cut_completed,
    partner_profile_id
  )
  values (
    target_assignment.schedule_date,
    target_assignment.schedule_item_id,
    target_assignment.photographer_profile_id,
    target_assignment.photographer_name,
    target_assignment.schedule_content,
    coalesce(p_final_cut_completed, false),
    null
  )
  on conflict (schedule_item_id) do update
  set
    schedule_date = excluded.schedule_date,
    photographer_profile_id = excluded.photographer_profile_id,
    photographer_name = excluded.photographer_name,
    schedule_content = excluded.schedule_content,
    final_cut_completed = excluded.final_cut_completed;
end;
$$;

revoke execute on function public.get_my_schedule_assignment_items(text) from public, anon;
revoke execute on function public.get_partner_schedule_assignment_items(date) from public, anon;
revoke execute on function public.upsert_my_schedule_partner_entry(date, text, text, text, text) from public, anon;
revoke execute on function public.update_my_schedule_final_cut_status(date, text, boolean) from public, anon;
grant execute on function public.get_my_schedule_assignment_items(text) to authenticated;
grant execute on function public.get_partner_schedule_assignment_items(date) to authenticated;
grant execute on function public.upsert_my_schedule_partner_entry(date, text, text, text, text) to authenticated;
grant execute on function public.update_my_schedule_final_cut_status(date, text, boolean) to authenticated;

notify pgrst, 'reload schema';

create table if not exists public.team_lead_schedule_assignment_cell_locks (
  cell_key text primary key,
  month_key text not null,
  date_key text not null,
  row_key text not null,
  field_key text not null,
  locked_by uuid references public.profiles (id) on delete cascade,
  locked_by_name text not null default '',
  claim_token text not null,
  expires_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists team_lead_schedule_assignment_cell_locks_month_idx
  on public.team_lead_schedule_assignment_cell_locks (month_key, expires_at);

drop trigger if exists set_team_lead_schedule_assignment_cell_locks_updated_at on public.team_lead_schedule_assignment_cell_locks;

create trigger set_team_lead_schedule_assignment_cell_locks_updated_at
before update on public.team_lead_schedule_assignment_cell_locks
for each row
execute function public.set_updated_at();

alter table public.team_lead_schedule_assignment_cell_locks enable row level security;

drop policy if exists "team_lead_schedule_assignment_cell_locks_select_managers" on public.team_lead_schedule_assignment_cell_locks;
create policy "team_lead_schedule_assignment_cell_locks_select_managers"
on public.team_lead_schedule_assignment_cell_locks
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_schedule_assignment_cell_locks_manage_privileged" on public.team_lead_schedule_assignment_cell_locks;
create policy "team_lead_schedule_assignment_cell_locks_manage_privileged"
on public.team_lead_schedule_assignment_cell_locks
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

create or replace function public.acquire_team_lead_schedule_assignment_cell_lock(
  p_month_key text,
  p_date_key text,
  p_row_key text,
  p_field_key text,
  p_claim_token text,
  p_duration_seconds integer default 8
)
returns table (
  ok boolean,
  cell_key text,
  month_key text,
  date_key text,
  row_key text,
  field_key text,
  locked_by uuid,
  locked_by_name text,
  expires_at timestamptz,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_cell_key text := concat_ws('::', p_month_key, p_date_key, p_row_key, p_field_key);
  v_user_id uuid := auth.uid();
  v_user_name text := '';
  v_lock_row public.team_lead_schedule_assignment_cell_locks%rowtype;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('team_lead', 'admin', 'desk') then
    raise exception '권한이 없습니다.';
  end if;

  select coalesce(name, '')
  into v_user_name
  from public.profiles
  where id = v_user_id;

  insert into public.team_lead_schedule_assignment_cell_locks (
    cell_key,
    month_key,
    date_key,
    row_key,
    field_key,
    locked_by,
    locked_by_name,
    claim_token,
    expires_at
  )
  values (
    v_cell_key,
    p_month_key,
    p_date_key,
    p_row_key,
    p_field_key,
    v_user_id,
    v_user_name,
    p_claim_token,
    timezone('utc', now()) + make_interval(secs => greatest(coalesce(p_duration_seconds, 8), 2))
  )
  on conflict (cell_key) do update
  set
    month_key = excluded.month_key,
    date_key = excluded.date_key,
    row_key = excluded.row_key,
    field_key = excluded.field_key,
    locked_by = excluded.locked_by,
    locked_by_name = excluded.locked_by_name,
    claim_token = excluded.claim_token,
    expires_at = excluded.expires_at
  where
    public.team_lead_schedule_assignment_cell_locks.expires_at <= timezone('utc', now())
    or public.team_lead_schedule_assignment_cell_locks.locked_by = v_user_id
  returning *
  into v_lock_row;

  if found then
    return query
    select
      true,
      v_lock_row.cell_key,
      v_lock_row.month_key,
      v_lock_row.date_key,
      v_lock_row.row_key,
      v_lock_row.field_key,
      v_lock_row.locked_by,
      v_lock_row.locked_by_name,
      v_lock_row.expires_at,
      v_lock_row.updated_at;
    return;
  end if;

  select *
  into v_lock_row
  from public.team_lead_schedule_assignment_cell_locks
  where public.team_lead_schedule_assignment_cell_locks.cell_key = v_cell_key;

  return query
  select
    false,
    v_lock_row.cell_key,
    v_lock_row.month_key,
    v_lock_row.date_key,
    v_lock_row.row_key,
    v_lock_row.field_key,
    v_lock_row.locked_by,
    v_lock_row.locked_by_name,
    v_lock_row.expires_at,
    v_lock_row.updated_at;
end;
$$;

create or replace function public.release_team_lead_schedule_assignment_cell_lock(
  p_cell_key text,
  p_claim_token text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  delete from public.team_lead_schedule_assignment_cell_locks
  where public.team_lead_schedule_assignment_cell_locks.cell_key = p_cell_key
    and public.team_lead_schedule_assignment_cell_locks.locked_by = v_user_id
    and public.team_lead_schedule_assignment_cell_locks.claim_token = p_claim_token;

  return found;
end;
$$;

create table if not exists public.team_lead_state (
  key text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

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

create table if not exists public.page_visit_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete cascade,
  page_key text not null check (page_key in ('me', 'community', 'work_schedule', 'restaurants', 'equipment', 'election_internal', 'election_external')),
  path text not null default '',
  visited_at timestamptz not null default timezone('utc', now())
);

create index if not exists page_visit_events_visited_at_idx
on public.page_visit_events (visited_at desc);

create index if not exists page_visit_events_page_visited_idx
on public.page_visit_events (page_key, visited_at desc);

create index if not exists page_visit_events_profile_visited_idx
on public.page_visit_events (profile_id, visited_at desc);

alter table public.page_visit_events enable row level security;

drop policy if exists "page_visit_events_insert_own" on public.page_visit_events;
create policy "page_visit_events_insert_own"
on public.page_visit_events
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "page_visit_events_select_managers" on public.page_visit_events;
create policy "page_visit_events_select_managers"
on public.page_visit_events
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

create table if not exists public.customer_support_messages (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'processed')),
  processed_at timestamptz,
  processed_by uuid references public.profiles (id) on delete set null,
  processed_feedback text,
  feedback_seen_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.customer_support_messages
add column if not exists requester_id uuid references public.profiles (id) on delete set null;

alter table public.customer_support_messages
add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.customer_support_messages
add column if not exists status text not null default 'open';

alter table public.customer_support_messages
add column if not exists processed_at timestamptz;

alter table public.customer_support_messages
add column if not exists processed_by uuid references public.profiles (id) on delete set null;

alter table public.customer_support_messages
add column if not exists processed_feedback text;

alter table public.customer_support_messages
add column if not exists feedback_seen_at timestamptz;

alter table public.customer_support_messages
add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.customer_support_messages
drop constraint if exists customer_support_messages_status_check;

alter table public.customer_support_messages
add constraint customer_support_messages_status_check
check (status in ('open', 'processed'));

create index if not exists customer_support_messages_created_at_idx
on public.customer_support_messages (created_at desc);

create index if not exists customer_support_messages_status_created_at_idx
on public.customer_support_messages (status, created_at desc);

create index if not exists customer_support_messages_requester_feedback_idx
on public.customer_support_messages (requester_id, status, feedback_seen_at, processed_at desc)
where requester_id is not null;

drop trigger if exists set_customer_support_messages_updated_at on public.customer_support_messages;
create trigger set_customer_support_messages_updated_at
before update on public.customer_support_messages
for each row
execute function public.set_updated_at();

alter table public.customer_support_messages enable row level security;

drop policy if exists "customer_support_messages_insert_approved" on public.customer_support_messages;
create policy "customer_support_messages_insert_approved"
on public.customer_support_messages
for insert
to authenticated
with check (public.current_profile_approved() = true);

drop policy if exists "customer_support_messages_select_admins" on public.customer_support_messages;
create policy "customer_support_messages_select_admins"
on public.customer_support_messages
for select
to authenticated
using (public.is_admin());

drop policy if exists "customer_support_messages_select_own_processed_feedback" on public.customer_support_messages;
create policy "customer_support_messages_select_own_processed_feedback"
on public.customer_support_messages
for select
to authenticated
using (
  requester_id = auth.uid()
  and status = 'processed'
  and public.current_profile_approved() = true
);

drop policy if exists "customer_support_messages_update_admins" on public.customer_support_messages;
create policy "customer_support_messages_update_admins"
on public.customer_support_messages
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "customer_support_messages_delete_admins" on public.customer_support_messages;
create policy "customer_support_messages_delete_admins"
on public.customer_support_messages
for delete
to authenticated
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-support-attachments',
  'customer-support-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

drop policy if exists "customer_support_attachments_insert_approved" on storage.objects;
create policy "customer_support_attachments_insert_approved"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'customer-support-attachments'
  and public.current_profile_approved() = true
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "customer_support_attachments_select_admins" on storage.objects;
create policy "customer_support_attachments_select_admins"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'customer-support-attachments'
  and public.is_admin()
);

drop policy if exists "customer_support_attachments_delete_own" on storage.objects;
create policy "customer_support_attachments_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-support-attachments'
  and public.current_profile_approved() = true
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "customer_support_attachments_delete_admins" on storage.objects;
create policy "customer_support_attachments_delete_admins"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-support-attachments'
  and public.is_admin()
);

drop function if exists public.mark_customer_support_message_processed(uuid);

create or replace function public.mark_customer_support_message_processed(
  p_message_id uuid,
  p_feedback text default null
)
returns public.customer_support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.customer_support_messages;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.is_admin() is distinct from true then
    raise exception '고객센터 접수 내용 처리 권한이 없습니다.';
  end if;

  update public.customer_support_messages
  set
    status = 'processed',
    processed_at = timezone('utc', now()),
    processed_by = v_user_id,
    processed_feedback = nullif(trim(coalesce(p_feedback, '')), ''),
    feedback_seen_at = case
      when requester_id is null then timezone('utc', now())
      else null
    end
  where id = p_message_id
  returning * into v_row;

  if v_row.id is null then
    raise exception '처리할 고객센터 접수 내용을 찾을 수 없습니다.';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.mark_customer_support_message_processed(uuid, text) from public, anon;
grant execute on function public.mark_customer_support_message_processed(uuid, text) to authenticated;

create or replace function public.mark_customer_support_feedback_seen(
  p_message_id uuid
)
returns public.customer_support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.customer_support_messages;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  update public.customer_support_messages
  set feedback_seen_at = timezone('utc', now())
  where id = p_message_id
    and requester_id = v_user_id
    and status = 'processed'
  returning * into v_row;

  if v_row.id is null then
    raise exception '확인할 고객센터 처리완료 알림을 찾을 수 없습니다.';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.mark_customer_support_feedback_seen(uuid) from public, anon;
grant execute on function public.mark_customer_support_feedback_seen(uuid) to authenticated;

create table if not exists public.home_news_briefings (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('politics', 'society', 'economy', 'world')),
  title text not null default '',
  summary_lines text[] not null default '{}',
  why_it_matters text not null default '',
  check_points text[] not null default '{}',
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  published_at timestamptz not null default timezone('utc', now()),
  briefing_slot text not null check (briefing_slot in ('morning_6', 'afternoon_3')),
  briefing_text text not null default '',
  is_active boolean not null default true,
  source_label text not null default '',
  tags text[] not null default '{}',
  event_stage text check (
    event_stage is null
    or event_stage in (
      'summon_requested',
      'summon_scheduled',
      'attending',
      'under_questioning',
      'warrant_review_scheduled',
      'warrant_requested',
      'warrant_issued',
      'warrant_denied',
      'investigation_update'
    )
  ),
  likes_count integer not null default 0 check (likes_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists home_news_briefings_active_published_idx
on public.home_news_briefings (is_active, published_at desc);

create index if not exists home_news_briefings_slot_published_idx
on public.home_news_briefings (briefing_slot, published_at desc);

create index if not exists home_news_briefings_category_published_idx
on public.home_news_briefings (category, published_at desc);

create index if not exists home_news_briefings_event_stage_idx
on public.home_news_briefings (event_stage);

drop trigger if exists set_home_news_briefings_updated_at on public.home_news_briefings;
create trigger set_home_news_briefings_updated_at
before update on public.home_news_briefings
for each row
execute function public.set_updated_at();

alter table public.home_news_briefings enable row level security;

drop policy if exists "home_news_briefings_select_active_approved" on public.home_news_briefings;
create policy "home_news_briefings_select_active_approved"
on public.home_news_briefings
for select
to authenticated
using (
  public.current_profile_approved() = true
  and is_active = true
);

drop policy if exists "home_news_briefings_select_privileged" on public.home_news_briefings;
create policy "home_news_briefings_select_privileged"
on public.home_news_briefings
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_briefings_manage_privileged" on public.home_news_briefings;
create policy "home_news_briefings_manage_privileged"
on public.home_news_briefings
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

create table if not exists public.portal_celebration_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text,
  button_label text not null default '확인하고 닫기',
  effect text not null default 'confetti',
  intensity text not null default 'normal',
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  recurrence text not null default 'none',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_celebration_events_effect_check
    check (effect in ('confetti')),
  constraint portal_celebration_events_intensity_check
    check (intensity in ('light', 'normal', 'strong')),
  constraint portal_celebration_events_recurrence_check
    check (recurrence in ('none', 'yearly')),
  constraint portal_celebration_events_date_range_check
    check (starts_at is null or ends_at is null or starts_at <= ends_at)
);

create index if not exists portal_celebration_events_active_created_at_idx
on public.portal_celebration_events (is_active, created_at desc);

drop trigger if exists set_portal_celebration_events_updated_at on public.portal_celebration_events;
create trigger set_portal_celebration_events_updated_at
before update on public.portal_celebration_events
for each row
execute function public.set_updated_at();

alter table public.portal_celebration_events enable row level security;

drop policy if exists "portal_celebration_events_select_current_active" on public.portal_celebration_events;
create policy "portal_celebration_events_select_current_active"
on public.portal_celebration_events
for select
to authenticated
using (
  is_active = true
  and (
    (
      recurrence = 'none'
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    )
    or (
      recurrence = 'yearly'
      and starts_at is not null
      and starts_at <= now()
      and (
        (
          ends_at is null
          and to_char(timezone('Asia/Seoul', now()), 'MMDD') = to_char(timezone('Asia/Seoul', starts_at), 'MMDD')
        )
        or (
          ends_at is not null
          and (
            (
              to_char(timezone('Asia/Seoul', starts_at), 'MMDD') <= to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
              and to_char(timezone('Asia/Seoul', now()), 'MMDD')
                between to_char(timezone('Asia/Seoul', starts_at), 'MMDD')
                and to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
            )
            or (
              to_char(timezone('Asia/Seoul', starts_at), 'MMDD') > to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
              and (
                to_char(timezone('Asia/Seoul', now()), 'MMDD') >= to_char(timezone('Asia/Seoul', starts_at), 'MMDD')
                or to_char(timezone('Asia/Seoul', now()), 'MMDD') <= to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
              )
            )
          )
        )
      )
    )
  )
);

drop policy if exists "portal_celebration_events_admin_select_all" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_select_all"
on public.portal_celebration_events
for select
to authenticated
using (public.is_admin());

drop policy if exists "portal_celebration_events_admin_insert" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_insert"
on public.portal_celebration_events
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "portal_celebration_events_admin_update" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_update"
on public.portal_celebration_events
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "portal_celebration_events_admin_delete" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_delete"
on public.portal_celebration_events
for delete
to authenticated
using (public.is_admin());

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'portal_celebration_events'
  ) then
    execute 'alter publication supabase_realtime add table public.portal_celebration_events';
  end if;
end
$$;

create or replace function public.current_profile_has_review_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.current_profile_approved() = true
    and exists (
      select 1
      from public.team_lead_state
      where public.team_lead_state.key = 'review_access_v1'
        and coalesce(public.team_lead_state.state -> 'profileIds', '[]'::jsonb) @> to_jsonb(array[auth.uid()::text])
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

do $$
declare
  target_function regprocedure;
  exposed_functions regprocedure[] := array[
    to_regprocedure('public.current_profile_approved()'),
    to_regprocedure('public.current_profile_has_review_access()'),
    to_regprocedure('public.current_profile_role()'),
    to_regprocedure('public.is_admin()'),
    to_regprocedure('public.find_email_by_login_id(text)'),
    to_regprocedure('public.handle_new_user()'),
    to_regprocedure('public.repair_current_member_profile()'),
    to_regprocedure('public.sync_home_news_briefing_dislikes_count()'),
    to_regprocedure('public.sync_home_news_briefing_likes_count()')
  ];
  direct_only_functions regprocedure[] := array[
    to_regprocedure('public.find_email_by_login_id(text)'),
    to_regprocedure('public.handle_new_user()'),
    to_regprocedure('public.repair_current_member_profile()'),
    to_regprocedure('public.sync_home_news_briefing_dislikes_count()'),
    to_regprocedure('public.sync_home_news_briefing_likes_count()')
  ];
begin
  foreach target_function in array exposed_functions loop
    if target_function is not null then
      execute format(
        'revoke execute on function %s from public, anon',
        target_function
      );
    end if;
  end loop;

  foreach target_function in array direct_only_functions loop
    if target_function is not null then
      execute format(
        'revoke execute on function %s from authenticated',
        target_function
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.current_profile_approved() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_has_review_access() to authenticated;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "submissions_select_assigned_reviewer" on public.submissions;
drop policy if exists "reviews_insert_assigned_reviewer" on public.reviews;
drop policy if exists "reviews_update_assigned_reviewer" on public.reviews;

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

create table if not exists public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('camera_lens', 'light', 'eng_set', 'live')),
  group_name text not null,
  name text not null,
  code text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists equipment_items_category_sort_idx
on public.equipment_items (category, sort_order, name);

drop trigger if exists set_equipment_items_updated_at on public.equipment_items;
create trigger set_equipment_items_updated_at
before update on public.equipment_items
for each row
execute function public.set_updated_at();

create table if not exists public.equipment_loans (
  id uuid primary key default gen_random_uuid(),
  borrower_profile_id uuid not null references public.profiles (id) on delete restrict,
  borrowed_at timestamptz not null default timezone('utc', now()),
  returned_at timestamptz,
  status text not null default 'borrowed' check (status in ('borrowed', 'returned')),
  loan_type text not null default 'normal' check (loan_type in ('normal', 'live', 'eng_set')),
  live_trs text,
  live_camera_reporter text,
  live_audio_man text,
  live_location text,
  live_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists equipment_loans_borrower_status_idx
on public.equipment_loans (borrower_profile_id, status, borrowed_at desc);

create index if not exists equipment_loans_status_borrowed_at_idx
on public.equipment_loans (status, borrowed_at desc);

drop trigger if exists set_equipment_loans_updated_at on public.equipment_loans;
create trigger set_equipment_loans_updated_at
before update on public.equipment_loans
for each row
execute function public.set_updated_at();

create table if not exists public.equipment_loan_items (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.equipment_loans (id) on delete cascade,
  equipment_item_id uuid not null references public.equipment_items (id) on delete restrict,
  borrowed_at timestamptz not null default timezone('utc', now()),
  returned_at timestamptz,
  status text not null default 'borrowed' check (status in ('borrowed', 'returned'))
);

create index if not exists equipment_loan_items_loan_idx
on public.equipment_loan_items (loan_id);

create index if not exists equipment_loan_items_item_status_idx
on public.equipment_loan_items (equipment_item_id, status);

create index if not exists equipment_loan_items_borrowed_at_idx
on public.equipment_loan_items (borrowed_at desc);

create unique index if not exists equipment_loan_items_active_item_uidx
on public.equipment_loan_items (equipment_item_id)
where status = 'borrowed';

create table if not exists public.live_equipment_status_board (
  equipment_item_id uuid primary key references public.equipment_items (id) on delete cascade,
  live_trs text,
  live_camera_reporter text,
  live_audio_man text,
  live_location text,
  live_note text,
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_live_equipment_status_board_updated_at on public.live_equipment_status_board;
create trigger set_live_equipment_status_board_updated_at
before update on public.live_equipment_status_board
for each row
execute function public.set_updated_at();

alter table public.equipment_items enable row level security;
alter table public.equipment_loans enable row level security;
alter table public.equipment_loan_items enable row level security;
alter table public.live_equipment_status_board enable row level security;

drop policy if exists "equipment_items_select_approved" on public.equipment_items;
create policy "equipment_items_select_approved"
on public.equipment_items
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "equipment_items_manage_admin" on public.equipment_items;
create policy "equipment_items_manage_admin"
on public.equipment_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "equipment_loans_select_approved" on public.equipment_loans;
create policy "equipment_loans_select_approved"
on public.equipment_loans
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "equipment_loans_insert_own" on public.equipment_loans;
create policy "equipment_loans_insert_own"
on public.equipment_loans
for insert
to authenticated
with check (
  public.current_profile_approved() = true
  and public.current_profile_role() <> 'observer'
  and borrower_profile_id = auth.uid()
  and status = 'borrowed'
);

drop policy if exists "equipment_loans_update_own_or_admin" on public.equipment_loans;
create policy "equipment_loans_update_own_or_admin"
on public.equipment_loans
for update
to authenticated
using (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
)
with check (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
);

drop policy if exists "equipment_loan_items_select_approved" on public.equipment_loan_items;
create policy "equipment_loan_items_select_approved"
on public.equipment_loan_items
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "equipment_loan_items_insert_own" on public.equipment_loan_items;
create policy "equipment_loan_items_insert_own"
on public.equipment_loan_items
for insert
to authenticated
with check (
  status = 'borrowed'
  and exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
);

drop policy if exists "equipment_loan_items_update_own_or_admin" on public.equipment_loan_items;
create policy "equipment_loan_items_update_own_or_admin"
on public.equipment_loan_items
for update
to authenticated
using (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
)
with check (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
);

drop policy if exists "live_equipment_status_board_select_approved" on public.live_equipment_status_board;
create policy "live_equipment_status_board_select_approved"
on public.live_equipment_status_board
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "live_equipment_status_board_insert_privileged" on public.live_equipment_status_board;
create policy "live_equipment_status_board_insert_privileged"
on public.live_equipment_status_board
for insert
to authenticated
with check (
  public.current_profile_approved() = true
  and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and updated_by = auth.uid()
);

drop policy if exists "live_equipment_status_board_update_privileged" on public.live_equipment_status_board;
create policy "live_equipment_status_board_update_privileged"
on public.live_equipment_status_board
for update
to authenticated
using (
  public.current_profile_approved() = true
  and public.current_profile_role() in ('desk', 'admin', 'team_lead')
)
with check (
  public.current_profile_approved() = true
  and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and updated_by = auth.uid()
);

create or replace function public.borrow_equipment_items(
  p_equipment_item_ids uuid[],
  p_loan_type text default 'normal',
  p_live_trs text default null,
  p_live_camera_reporter text default null,
  p_live_audio_man text default null,
  p_live_location text default null,
  p_live_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_requested_count integer;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() = 'observer' then
    raise exception '장비 대여 권한이 없습니다.';
  end if;

  if coalesce(p_loan_type, 'normal') not in ('normal', 'live', 'eng_set') then
    raise exception '지원하지 않는 장비 대여 유형입니다.';
  end if;

  select count(distinct item_id)
  into v_requested_count
  from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '대여할 장비를 선택해 주세요.';
  end if;

  select count(*)
  into v_active_count
  from public.equipment_items
  where id in (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  )
    and is_active = true
    and coalesce(metadata ->> 'is_under_repair', 'false') <> 'true'
    and coalesce(metadata ->> 'borrowable', 'true') <> 'false';

  if v_active_count <> v_requested_count then
    raise exception '대여할 수 없는 장비가 포함되어 있습니다.';
  end if;

  if exists (
    select 1
    from public.equipment_loan_items
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    )
      and status = 'borrowed'
  ) then
    raise exception '이미 대여중인 장비가 포함되어 있습니다.';
  end if;

  insert into public.equipment_loans (
    borrower_profile_id,
    borrowed_at,
    status,
    loan_type,
    live_trs,
    live_camera_reporter,
    live_audio_man,
    live_location,
    live_note
  )
  values (
    v_user_id,
    v_now,
    'borrowed',
    coalesce(p_loan_type, 'normal'),
    nullif(trim(coalesce(p_live_trs, '')), ''),
    nullif(trim(coalesce(p_live_camera_reporter, '')), ''),
    nullif(trim(coalesce(p_live_audio_man, '')), ''),
    nullif(trim(coalesce(p_live_location, '')), ''),
    nullif(trim(coalesce(p_live_note, '')), '')
  )
  returning id into v_loan_id;

  begin
    insert into public.equipment_loan_items (
      loan_id,
      equipment_item_id,
      borrowed_at,
      status
    )
    select
      v_loan_id,
      item_id,
      v_now,
      'borrowed'
    from (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    ) requested_items;
  exception
    when unique_violation then
      raise exception '이미 대여중인 장비가 포함되어 있습니다.';
  end;

  return v_loan_id;
end;
$$;

create or replace function public.borrow_eng_sets(
  p_target_profile_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_profile_count integer;
  v_item_ids uuid[];
begin
  select count(distinct target_profile_id)
  into v_requested_count
  from unnest(coalesce(p_target_profile_ids, array[]::uuid[])) as target_profile_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '대여할 ENG SET을 선택해 주세요.';
  end if;

  select count(*)
  into v_profile_count
  from public.profiles
  where id in (
    select distinct target_profile_id
    from unnest(coalesce(p_target_profile_ids, array[]::uuid[])) as target_profile_id
  )
    and approved = true;

  if v_profile_count <> v_requested_count then
    raise exception '대여할 수 없는 ENG SET 대상자가 포함되어 있습니다.';
  end if;

  with target_profiles as (
    select distinct
      profiles.id,
      profiles.name
    from public.profiles
    where profiles.id in (
      select distinct target_profile_id
      from unnest(coalesce(p_target_profile_ids, array[]::uuid[])) as target_profile_id
    )
      and profiles.approved = true
  ),
  upserted_items as (
    insert into public.equipment_items (
      category,
      group_name,
      name,
      code,
      sort_order,
      is_active,
      metadata
    )
    select
      'eng_set',
      'ENG SET',
      concat('ENG SET - ', target_profiles.name),
      concat('eng-set-', target_profiles.id::text),
      30000 + row_number() over (order by target_profiles.name),
      true,
      jsonb_build_object('target_profile_id', target_profiles.id::text, 'target_profile_name', target_profiles.name)
    from target_profiles
    on conflict (code) do update
    set
      name = excluded.name,
      is_active = true,
      metadata = case
        when coalesce(public.equipment_items.metadata ->> 'is_under_repair', 'false') = 'true'
          then excluded.metadata || jsonb_build_object('is_under_repair', true)
        else excluded.metadata
      end,
      updated_at = timezone('utc', now())
    returning id
  )
  select array_agg(id)
  into v_item_ids
  from upserted_items;

  return public.borrow_equipment_items(v_item_ids, 'eng_set');
end;
$$;

create or replace function public.set_equipment_items_repair_status(
  p_equipment_item_ids uuid[],
  p_is_under_repair boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_requested_count integer;
  v_updated_count integer := 0;
  v_is_under_repair boolean := coalesce(p_is_under_repair, true);
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'admin', 'team_lead') then
    raise exception '장비 수리 처리 권한이 없습니다.';
  end if;

  select count(distinct item_id)
  into v_requested_count
  from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '수리 처리할 장비를 선택해 주세요.';
  end if;

  if v_is_under_repair and exists (
    select 1
    from public.equipment_loan_items
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    )
      and status = 'borrowed'
  ) then
    raise exception '대여중인 장비는 수리 처리할 수 없습니다.';
  end if;

  with requested_items as (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  ),
  updated_items as (
    update public.equipment_items
    set
      metadata = jsonb_set(
        jsonb_set(
          case
            when v_is_under_repair
              then jsonb_set(coalesce(metadata, '{}'::jsonb), '{is_under_repair}', 'true'::jsonb, true)
            else coalesce(metadata, '{}'::jsonb) - 'is_under_repair'
          end,
          '{repair_updated_by}',
          to_jsonb(v_user_id::text),
          true
        ),
        '{repair_updated_at}',
        to_jsonb(v_now::text),
        true
      ),
      updated_at = v_now
    where id in (select item_id from requested_items)
      and is_active = true
    returning id
  )
  select count(*)
  into v_updated_count
  from updated_items;

  if v_updated_count <> v_requested_count then
    raise exception '수리 처리할 수 없는 장비가 포함되어 있습니다.';
  end if;

  return coalesce(v_updated_count, 0);
end;
$$;

create or replace function public.return_equipment_loan_items(
  p_loan_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_returned_count integer := 0;
  v_loan_ids uuid[] := array[]::uuid[];
  v_returned_item_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() = 'observer' then
    raise exception '장비 반납 권한이 없습니다.';
  end if;

  with requested_items as (
    select distinct loan_item_id
    from unnest(coalesce(p_loan_item_ids, array[]::uuid[])) as loan_item_id
  ),
  updated_items as (
    update public.equipment_loan_items
    set
      status = 'returned',
      returned_at = v_now
    from public.equipment_loans
    where equipment_loan_items.loan_id = equipment_loans.id
      and equipment_loan_items.id in (select loan_item_id from requested_items)
      and equipment_loan_items.status = 'borrowed'
      and (
        equipment_loans.borrower_profile_id = v_user_id
        or public.current_profile_role() in ('desk', 'admin', 'team_lead')
      )
    returning equipment_loan_items.loan_id, equipment_loan_items.equipment_item_id
  )
  select
    count(*),
    coalesce(array_agg(distinct loan_id), array[]::uuid[]),
    coalesce(array_agg(distinct equipment_item_id), array[]::uuid[])
  into v_returned_count, v_loan_ids, v_returned_item_ids
  from updated_items;

  update public.equipment_loans
  set
    status = 'returned',
    returned_at = v_now
  where id = any(v_loan_ids)
    and not exists (
      select 1
      from public.equipment_loan_items
      where equipment_loan_items.loan_id = equipment_loans.id
        and equipment_loan_items.status = 'borrowed'
    );

  delete from public.live_equipment_status_board
  where equipment_item_id = any(v_returned_item_ids);

  return coalesce(v_returned_count, 0);
end;
$$;

revoke execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) from public, anon;
revoke execute on function public.borrow_eng_sets(uuid[]) from public, anon;
revoke execute on function public.set_equipment_items_repair_status(uuid[], boolean) from public, anon;
revoke execute on function public.return_equipment_loan_items(uuid[]) from public, anon;
grant execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) to authenticated;
grant execute on function public.borrow_eng_sets(uuid[]) to authenticated;
grant execute on function public.set_equipment_items_repair_status(uuid[], boolean) to authenticated;
grant execute on function public.return_equipment_loan_items(uuid[]) to authenticated;

with seed(category, group_name, name, code, sort_order, metadata) as (
  values
    ('camera_lens', '5D 바디', 'mark2-1', 'camera-5d-body-mark2-1', 1011, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark2-2', 'camera-5d-body-mark2-2', 1012, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark4-1', 'camera-5d-body-mark4-1', 1013, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark4-2', 'camera-5d-body-mark4-2', 1014, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 렌즈', '16-35mm 1번', 'camera-5d-lens-16-35mm-01', 1111, '{"family":"5D","kind":"lens","variant_parent":"16-35mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '16-35mm 2번', 'camera-5d-lens-16-35mm-02', 1112, '{"family":"5D","kind":"lens","variant_parent":"16-35mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm 1번', 'camera-5d-lens-70-200mm-01', 1121, '{"family":"5D","kind":"lens","variant_parent":"70-200mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm 2번', 'camera-5d-lens-70-200mm-02', 1122, '{"family":"5D","kind":"lens","variant_parent":"70-200mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '100mm', 'camera-5d-lens-100mm', 1140, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-70mm 1번', 'camera-5d-lens-24-70mm-01', 1161, '{"family":"5D","kind":"lens","variant_parent":"24-70mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-70mm 2번', 'camera-5d-lens-24-70mm-02', 1162, '{"family":"5D","kind":"lens","variant_parent":"24-70mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', 'Ts-e 24mm 1번', 'camera-5d-lens-ts-e-24mm-01', 1171, '{"family":"5D","kind":"lens","variant_parent":"Ts-e 24mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', 'Ts-e 24mm 2번', 'camera-5d-lens-ts-e-24mm-02', 1172, '{"family":"5D","kind":"lens","variant_parent":"Ts-e 24mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'GH4 바디', 'gh4-1', 'camera-gh4-body-1', 2011, '{"family":"GH4","kind":"body"}'::jsonb),
    ('camera_lens', 'GH4 바디', 'gh4-2', 'camera-gh4-body-2', 2012, '{"family":"GH4","kind":"body"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '7-14mm', 'camera-gh4-lens-7-14mm', 2111, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '14mm', 'camera-gh4-lens-14mm', 2130, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '35-100mm', 'camera-gh4-lens-35-100mm', 2140, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm 1번', 'camera-gh4-lens-12-35mm-01', 2151, '{"family":"GH4","kind":"lens","variant_parent":"12-35mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm 2번', 'camera-gh4-lens-12-35mm-02', 2152, '{"family":"GH4","kind":"lens","variant_parent":"12-35mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 바디', 'fx3-1', 'camera-fx3-body-1', 3011, '{"family":"FX3","kind":"body"}'::jsonb),
    ('camera_lens', 'FX3 바디', 'fx3-2', 'camera-fx3-body-2', 3012, '{"family":"FX3","kind":"body"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-240mm 1번', 'camera-fx3-lens-24-240mm-01', 3111, '{"family":"FX3","kind":"lens","variant_parent":"24-240mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-240mm 2번', 'camera-fx3-lens-24-240mm-02', 3112, '{"family":"FX3","kind":"lens","variant_parent":"24-240mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-105mm', 'camera-fx3-lens-24-105mm-01', 3121, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-70mm', 'camera-fx3-lens-24-70mm', 3130, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '70-200mm', 'camera-fx3-lens-70-200mm', 3140, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '28-300mm', 'camera-fx3-lens-28-300mm', 3150, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', '단독 카메라', 'rx100', 'camera-standalone-rx100-01', 4018, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '기타 장비', 'camera-standalone-etc', 4090, '{"family":"standalone","kind":"etc"}'::jsonb),
    ('camera_lens', '드론', '매빅2 프로', 'camera-drone-mavic-2-pro', 4604, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', '매빅 에어', 'camera-drone-mavic-air', 4605, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '망원렌즈', 'camera-eng-lens-telephoto', 4701, '{"family":"ENG","kind":"lens"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '와이드렌즈 1번', 'camera-eng-lens-wide-01', 4702, '{"family":"ENG","kind":"lens","variant_parent":"와이드렌즈","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '와이드렌즈 2번', 'camera-eng-lens-wide-02', 4703, '{"family":"ENG","kind":"lens","variant_parent":"와이드렌즈","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '와이드 컨버터', 'camera-eng-lens-wide-converter', 4704, '{"family":"ENG","kind":"lens"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '어안', 'camera-eng-lens-fisheye', 4705, '{"family":"ENG","kind":"lens"}'::jsonb),
    ('live', '기타 라이브장비', 'tvu 배터리', 'live-tvu-battery', 2004, '{"kind":"tvu_battery"}'::jsonb)
  union all
  select
    'live',
    '기타 라이브장비',
    concat('VC300 ', n, '번'),
    concat('live-vc300-', lpad(n::text, 2, '0')),
    2004 + n,
    '{"kind":"vc300"}'::jsonb
  from generate_series(1, 4) as n
  union all
  select 'camera_lens', '5D 배터리', concat('5D 배터리 ', n, '번'), concat('camera-5d-battery-', lpad(n::text, 2, '0')), 1200 + n, '{"family":"5D","kind":"battery"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'GH4 배터리', concat('GH4 배터리 ', n, '번'), concat('camera-gh4-battery-', lpad(n::text, 2, '0')), 2200 + n, '{"family":"GH4","kind":"battery"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'FX3 배터리', concat('FX3 배터리 ', n, '번'), concat('camera-fx3-battery-', lpad(n::text, 2, '0')), 3200 + n, '{"family":"FX3","kind":"battery"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', '단독 카메라', concat('z-90 ', n, '번'), concat('camera-standalone-z-90-', lpad(n::text, 2, '0')), 4000 + n, '{"family":"standalone","kind":"camera"}'::jsonb
  from generate_series(1, 4) as n
  union all
  select 'camera_lens', '단독 카메라', concat('ax40 ', n, '번'), concat('camera-standalone-ax40-', lpad(n::text, 2, '0')), 4010 + n, '{"family":"standalone","kind":"camera"}'::jsonb
  from generate_series(1, 2) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('오스모 ', n, '번'),
    case when n = 1 then 'camera-standalone-osmo' else concat('camera-standalone-osmo-', lpad(n::text, 2, '0')) end,
    4019 + n,
    '{"family":"standalone","kind":"camera","variant_parent":"오스모"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 4) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('360 ', n, '번'),
    case when n = 1 then 'camera-standalone-360' else concat('camera-standalone-360-', lpad(n::text, 2, '0')) end,
    4029 + n,
    '{"family":"standalone","kind":"camera","variant_parent":"360"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('공용와이어리스 ', n, '번'),
    case when n = 1 then 'camera-standalone-wireless' else concat('camera-standalone-wireless-', lpad(n::text, 2, '0')) end,
    4039 + n,
    '{"family":"standalone","kind":"audio","for":"z-90","variant_parent":"공용와이어리스"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 4) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('dji마이크 ', n, '번'),
    case when n = 1 then 'camera-standalone-dji-mic' else concat('camera-standalone-dji-mic-', lpad(n::text, 2, '0')) end,
    4049 + n,
    '{"family":"standalone","kind":"audio","variant_parent":"dji마이크"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('c타입 마이크 ', n, '번'),
    case when n = 1 then 'camera-standalone-c-type-mic' else concat('camera-standalone-c-type-mic-', lpad(n::text, 2, '0')) end,
    4059 + n,
    '{"family":"standalone","kind":"audio","variant_parent":"c타입 마이크"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'z-90 배터리', concat('z-90 배터리 ', n, '번'), concat('camera-z-90-battery-', lpad(n::text, 2, '0')), 4100 + n, '{"family":"standalone","kind":"battery","for":"z-90"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'ax40 배터리', concat('ax40 배터리 ', n, '번'), concat('camera-ax40-battery-', lpad(n::text, 2, '0')), 4200 + n, '{"family":"standalone","kind":"battery","for":"ax40"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'rx100 배터리', concat('rx100 배터리 ', n, '번'), concat('camera-rx100-battery-', lpad(n::text, 2, '0')), 4300 + n, '{"family":"standalone","kind":"battery","for":"rx100"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', '고프로 배터리', concat('고프로 배터리 ', n, '번'), concat('camera-gopro-battery-', lpad(n::text, 2, '0')), 4400 + n, '{"family":"standalone","kind":"battery","for":"gopro"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', '오스모 배터리', concat('오스모 배터리 ', n, '번'), concat('camera-osmo-battery-', lpad(n::text, 2, '0')), 4500 + n, '{"family":"standalone","kind":"battery","for":"osmo"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('탑포드 ', n, '번'),
    case when n = 1 then 'camera-standalone-topod' else concat('camera-standalone-topod-', lpad(n::text, 2, '0')) end,
    4090 + n,
    '{"family":"standalone","kind":"accessory","for":"etc","variant_parent":"탑포드"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 3) as n
  union all
  select
    'light',
    '조명',
    concat('400X ', n, '번'),
    case when n = 1 then 'light-400x' else concat('light-400x-', lpad(n::text, 2, '0')) end,
    99 + n,
    '{"family":"light","kind":"400X","variant_parent":"400X"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'light',
    '조명',
    concat('스텔라 ', n, '번'),
    case when n = 1 then 'light-stella' else concat('light-stella-', lpad(n::text, 2, '0')) end,
    109 + n,
    '{"family":"light","kind":"stella","variant_parent":"스텔라"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'light',
    '조명',
    concat('EX600U ', n, '번'),
    case when n = 1 then 'light-panel' else concat('light-ex600u-', lpad(n::text, 2, '0')) end,
    119 + n,
    '{"family":"light","kind":"EX600U","variant_parent":"EX600U"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'light',
    '조명',
    concat('LC500 ', n, '번'),
    case when n = 1 then 'light-lc500' else concat('light-lc500-', lpad(n::text, 2, '0')) end,
    124 + n,
    '{"family":"light","kind":"LC500","variant_parent":"LC500"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 3) as n
  union all
  select
    'light',
    '조명',
    concat('프라임 ', n, '번'),
    case when n = 1 then 'light-prime' else concat('light-prime-', lpad(n::text, 2, '0')) end,
    129 + n,
    '{"family":"light","kind":"prime","variant_parent":"프라임"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 8) as n
  union all
  select 'eng_set', '공용 ENG', concat('공용ENG', shared_no), concat('eng-set-shared-', shared_no), shared_no, '{"kind":"shared_eng_set"}'::jsonb
  from generate_series(1, 3) as shared_no
  union all
  select
    'live',
    '기타 라이브장비',
    concat('핀마이크 ', n, '번'),
    case when n = 1 then 'live-pin-mic' else concat('live-pin-mic-', lpad(n::text, 2, '0')) end,
    2010 + n,
    '{"kind":"pin_mic"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select
    'live',
    '기타 라이브장비',
    concat('분배기 ', n, '번'),
    case when n = 1 then 'live-distributor' else concat('live-distributor-', lpad(n::text, 2, '0')) end,
    2030 + n,
    '{"kind":"distributor"}'::jsonb
  from generate_series(1, 7) as n
  union all
  select
    'live',
    'TVU',
    concat('TVU-', tvu_no),
    concat('live-tvu-', tvu_no),
    1000 + row_number() over (order by display_order),
    case
      when tvu_no between 15 and 19 then '{"kind":"tvu","network":"global"}'::jsonb
      else '{"kind":"tvu"}'::jsonb
    end
  from (
    values
      (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6),
      (14, 14), (15, 15), (16, 16), (17, 17), (18, 18), (19, 19)
  ) as tvu(tvu_no, display_order)
)
insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
select
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
from seed
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  metadata = case
    when coalesce(public.equipment_items.metadata ->> 'is_under_repair', 'false') = 'true'
      then excluded.metadata || jsonb_build_object('is_under_repair', true)
    else excluded.metadata
  end,
  updated_at = timezone('utc', now());

update public.equipment_items
set
  is_active = false,
  updated_at = timezone('utc', now())
where code in (
  'camera-5d-lens-24-105mm',
  'camera-5d-lens-16-35mm',
  'camera-5d-lens-70-200mm',
  'camera-5d-lens-28-300mm',
  'camera-5d-lens-24-70mm',
  'camera-5d-lens-ts-e-24mm',
  'camera-5d-lens-macro',
  'camera-fx3-lens-24-105mm-02',
  'camera-gh4-lens-24-105mm',
  'camera-gh4-lens-12-35mm',
  'camera-standalone-ax40-03',
  'camera-standalone-gopro',
  'camera-drone-dji-s-1000',
  'camera-drone-inspiper-1',
  'camera-drone-inspiper-2',
  'live-cubotec',
  'live-bnc-cable'
)
or code like 'camera-gopro-battery-%';

with rental_seed as (
  select
    'live'::text as category,
    'TVU'::text as group_name,
    concat('TVU-', tvu_no)::text as name,
    concat('live-rental-tvu-', tvu_no)::text as code,
    (1100 + tvu_no)::integer as sort_order,
    jsonb_build_object(
      'kind', 'tvu',
      'rental', true,
      'rental_id', concat('TVU-', tvu_no),
      'rental_number', tvu_no
    ) as metadata
  from generate_series(21, 40) as tvu_no
)
insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  is_active,
  metadata
)
select
  category,
  group_name,
  name,
  code,
  sort_order,
  false,
  metadata
from rental_seed
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = case
    when coalesce(public.equipment_items.metadata ->> 'rental_custom_name', 'false') = 'true'
      then public.equipment_items.name
    else excluded.name
  end,
  sort_order = excluded.sort_order,
  is_active = public.equipment_items.is_active,
  metadata = coalesce(public.equipment_items.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = timezone('utc', now());

with regional_seed as (
  select
    'live'::text as category,
    'TVU'::text as group_name,
    concat('TVU-', tvu_no)::text as name,
    concat('live-regional-tvu-', tvu_no)::text as code,
    (1060 + display_order)::integer as sort_order,
    jsonb_build_object(
      'kind', 'tvu',
      'regional_transmission', true,
      'regional_id', concat('TVU-', tvu_no),
      'regional_number', tvu_no,
      'borrowable', false
    ) as metadata
  from (
    values
      (7, 1),
      (8, 2),
      (9, 3),
      (10, 4),
      (11, 5),
      (12, 6),
      (13, 7),
      (61, 8)
  ) as tvu(tvu_no, display_order)
)
insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  is_active,
  metadata
)
select
  category,
  group_name,
  name,
  code,
  sort_order,
  true,
  metadata
from regional_seed
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  metadata = coalesce(public.equipment_items.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = timezone('utc', now());

create or replace function public.set_rental_tvu_items_active(
  p_equipment_item_ids uuid[],
  p_is_active boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_requested_count integer;
  v_rental_count integer;
  v_updated_count integer := 0;
  v_is_active boolean := coalesce(p_is_active, true);
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'team_lead', 'admin') then
    raise exception '임대 장비 관리 권한이 없습니다.';
  end if;

  select count(distinct item_id)
  into v_requested_count
  from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '변경할 임대 장비를 선택해 주세요.';
  end if;

  select count(*)
  into v_rental_count
  from public.equipment_items
  where id in (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  )
    and category = 'live'
    and group_name = 'TVU'
    and coalesce(metadata ->> 'rental', 'false') = 'true';

  if v_rental_count <> v_requested_count then
    raise exception '임대 TVU 장비만 변경할 수 있습니다.';
  end if;

  if v_is_active = false and exists (
    select 1
    from public.equipment_loan_items
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    )
      and status = 'borrowed'
  ) then
    raise exception '대여중인 임대 장비는 비활성화할 수 없습니다.';
  end if;

  with requested_items as (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  ),
  updated_items as (
    update public.equipment_items
    set
      is_active = v_is_active,
      metadata = jsonb_set(
        jsonb_set(
          coalesce(metadata, '{}'::jsonb),
          '{rental_updated_by}',
          to_jsonb(v_user_id::text),
          true
        ),
        '{rental_updated_at}',
        to_jsonb(v_now::text),
        true
      ),
      updated_at = v_now
    where id in (select item_id from requested_items)
      and category = 'live'
      and group_name = 'TVU'
      and coalesce(metadata ->> 'rental', 'false') = 'true'
      and is_active is distinct from v_is_active
    returning id
  )
  select count(*)
  into v_updated_count
  from updated_items;

  if v_updated_count <> v_requested_count then
    raise exception '이미 처리되었거나 변경할 수 없는 임대 장비가 포함되어 있습니다.';
  end if;

  if v_is_active = false then
    delete from public.live_equipment_status_board
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    );
  end if;

  return coalesce(v_updated_count, 0);
end;
$$;

create or replace function public.rename_rental_tvu_item(
  p_equipment_item_id uuid,
  p_name text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_updated_count integer := 0;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'team_lead', 'admin') then
    raise exception '임대 장비 관리 권한이 없습니다.';
  end if;

  if p_equipment_item_id is null then
    raise exception '이름을 수정할 임대 장비를 선택해 주세요.';
  end if;

  if v_name is null then
    raise exception '임대 장비 이름을 입력해 주세요.';
  end if;

  if char_length(v_name) > 80 then
    raise exception '임대 장비 이름은 80자 이내로 입력해 주세요.';
  end if;

  update public.equipment_items
  set
    name = v_name,
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(metadata, '{}'::jsonb),
          '{rental_custom_name}',
          'true'::jsonb,
          true
        ),
        '{rental_updated_by}',
        to_jsonb(v_user_id::text),
        true
      ),
      '{rental_updated_at}',
      to_jsonb(v_now::text),
      true
    ),
    updated_at = v_now
  where id = p_equipment_item_id
    and category = 'live'
    and group_name = 'TVU'
    and coalesce(metadata ->> 'rental', 'false') = 'true';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception '이름을 수정할 임대 TVU 장비를 찾을 수 없습니다.';
  end if;

  return v_updated_count;
end;
$$;

create or replace function public.set_tvu_grid_status(
  p_equipment_item_id uuid,
  p_is_grid boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_is_grid boolean := coalesce(p_is_grid, false);
  v_updated_count integer := 0;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'team_lead', 'admin') then
    raise exception 'TVU Grid 표시 변경 권한이 없습니다.';
  end if;

  if p_equipment_item_id is null then
    raise exception 'Grid 표시를 변경할 TVU 장비를 선택해 주세요.';
  end if;

  update public.equipment_items
  set
    metadata = case
      when v_is_grid then
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{grid}',
              'true'::jsonb,
              true
            ),
            '{grid_updated_by}',
            to_jsonb(v_user_id::text),
            true
          ),
          '{grid_updated_at}',
          to_jsonb(v_now::text),
          true
        )
      else
        jsonb_set(
          jsonb_set(
            coalesce(metadata, '{}'::jsonb) - 'grid',
            '{grid_updated_by}',
            to_jsonb(v_user_id::text),
            true
          ),
          '{grid_updated_at}',
          to_jsonb(v_now::text),
          true
        )
      end,
    updated_at = v_now
  where id = p_equipment_item_id
    and category = 'live'
    and group_name = 'TVU';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'Grid 표시를 변경할 TVU 장비를 찾을 수 없습니다.';
  end if;

  return v_is_grid;
end;
$$;

revoke all on function public.set_rental_tvu_items_active(uuid[], boolean) from public;
revoke all on function public.rename_rental_tvu_item(uuid, text) from public;
revoke all on function public.set_tvu_grid_status(uuid, boolean) from public;
grant execute on function public.set_rental_tvu_items_active(uuid[], boolean) to authenticated;
grant execute on function public.rename_rental_tvu_item(uuid, text) to authenticated;
grant execute on function public.set_tvu_grid_status(uuid, boolean) to authenticated;

create table if not exists public.election_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  election_date date not null,
  status text not null default 'draft',
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint election_events_status_check check (status in ('draft', 'published', 'closed'))
);

create table if not exists public.election_points (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.election_events (id) on delete cascade,
  sort_order integer not null default 0,
  region text,
  place text,
  pool_video text,
  equipment_name text,
  equipment_type text,
  trs text,
  camera_staff_name text,
  camera_staff_user_id uuid references public.profiles (id) on delete set null,
  camera_staff_name_pm text,
  camera_staff_user_id_pm uuid references public.profiles (id) on delete set null,
  audio_staff_name text,
  audio_staff_user_id uuid references public.profiles (id) on delete set null,
  audio_staff_name_pm text,
  reporter_name text,
  reporter_user_id uuid references public.profiles (id) on delete set null,
  reporter_name_pm text,
  live_time text,
  live_time_pm text,
  address text,
  note text,
  live_position text,
  lan text,
  lighting text,
  region_color text,
  cell_colors jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.election_points
  add column if not exists camera_staff_name_pm text,
  add column if not exists camera_staff_user_id_pm uuid references public.profiles (id) on delete set null,
  add column if not exists audio_staff_name_pm text,
  add column if not exists reporter_name_pm text,
  add column if not exists live_time_pm text,
  add column if not exists lan text,
  add column if not exists region_color text,
  add column if not exists cell_colors jsonb not null default '{}'::jsonb;

create unique index if not exists election_events_single_open_idx
on public.election_events ((true))
where status in ('draft', 'published');

create index if not exists election_events_status_date_idx
on public.election_events (status, election_date);

create index if not exists election_points_event_sort_idx
on public.election_points (event_id, sort_order);

create index if not exists election_points_camera_staff_user_idx
on public.election_points (camera_staff_user_id)
where camera_staff_user_id is not null;

create index if not exists election_points_camera_staff_user_pm_idx
on public.election_points (camera_staff_user_id_pm)
where camera_staff_user_id_pm is not null;

drop trigger if exists set_election_events_updated_at on public.election_events;
create trigger set_election_events_updated_at
before update on public.election_events
for each row
execute function public.set_updated_at();

drop trigger if exists set_election_points_updated_at on public.election_points;
create trigger set_election_points_updated_at
before update on public.election_points
for each row
execute function public.set_updated_at();

alter table public.election_events enable row level security;
alter table public.election_points enable row level security;

drop policy if exists "election_events_select_desk_or_published" on public.election_events;
create policy "election_events_select_desk_or_published"
on public.election_events
for select
to authenticated
using (
  (
    public.current_profile_role() in ('desk', 'team_lead', 'admin')
    and public.current_profile_approved() = true
  )
  or (
    status in ('published', 'closed')
    and public.current_profile_approved() = true
  )
);

drop policy if exists "election_events_select_anon_published" on public.election_events;
create policy "election_events_select_anon_published"
on public.election_events
for select
to anon
using (status = 'published');

drop policy if exists "election_events_insert_desk" on public.election_events;
create policy "election_events_insert_desk"
on public.election_events
for insert
to authenticated
with check (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "election_events_update_desk" on public.election_events;
create policy "election_events_update_desk"
on public.election_events
for update
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "election_events_delete_desk" on public.election_events;
create policy "election_events_delete_desk"
on public.election_events
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "election_points_select_desk_or_published" on public.election_points;
create policy "election_points_select_desk_or_published"
on public.election_points
for select
to authenticated
using (
  (
    public.current_profile_role() in ('desk', 'team_lead', 'admin')
    and public.current_profile_approved() = true
  )
  or (
    public.current_profile_approved() = true
    and exists (
      select 1
      from public.election_events e
      where e.id = election_points.event_id
        and e.status in ('published', 'closed')
    )
  )
);

drop policy if exists "election_points_select_anon_published" on public.election_points;
create policy "election_points_select_anon_published"
on public.election_points
for select
to anon
using (
  is_active = true
  and exists (
    select 1
    from public.election_events e
    where e.id = election_points.event_id
      and e.status = 'published'
  )
);

drop policy if exists "election_points_insert_desk" on public.election_points;
create policy "election_points_insert_desk"
on public.election_points
for insert
to authenticated
with check (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "election_points_update_desk" on public.election_points;
create policy "election_points_update_desk"
on public.election_points
for update
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "election_points_delete_desk" on public.election_points;
create policy "election_points_delete_desk"
on public.election_points
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

grant select, insert, update, delete on public.election_events to authenticated;
grant select, insert, update, delete on public.election_points to authenticated;

create or replace function public.get_home_current_trips(p_start_date date, p_end_date date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with recursive
  bounds as (
    select
      least(p_start_date, p_end_date) as start_date,
      greatest(p_start_date, p_end_date) as end_date
    where p_start_date is not null
      and p_end_date is not null
      and greatest(p_start_date, p_end_date) <= least(p_start_date, p_end_date) + 4000
  ),
  month_keys as (
    select to_char(month_start::date, 'YYYY-MM') as month_key
    from bounds
    cross join lateral generate_series(
      date_trunc('month', bounds.start_date)::date,
      date_trunc('month', bounds.end_date)::date,
      interval '1 month'
    ) as month_start
  ),
  current_profile as (
    select id
    from public.profiles
    where id = auth.uid()
      and approved = true
  ),
  target_schedule as (
    select schedule_months.month_key, schedule_months.published_state
    from public.schedule_months
    join month_keys on month_keys.month_key = schedule_months.month_key
    where schedule_months.published_state is not null
      and exists (select 1 from current_profile)
  ),
  target_assignment as (
    select team_lead_schedule_assignments.month_key, team_lead_schedule_assignments.entries, team_lead_schedule_assignments.rows
    from public.team_lead_schedule_assignments
    join month_keys on month_keys.month_key = team_lead_schedule_assignments.month_key
  ),
  target_day as (
    select
      target_schedule.month_key,
      day.value as day,
      day.value->>'dateKey' as date_key
    from target_schedule
    cross join bounds
    cross join lateral jsonb_array_elements(coalesce(target_schedule.published_state->'days', '[]'::jsonb)) as day(value)
    where day.value->>'dateKey' between to_char(bounds.start_date, 'YYYY-MM-DD') and to_char(bounds.end_date, 'YYYY-MM-DD')
      and day.value->>'dateKey' like target_schedule.month_key || '-%'
  ),
  base_rows as (
    select
      target_day.month_key,
      target_day.date_key,
      person.name,
      target_day.date_key || '::' || category.key || '::' || (person.ordinality - 1)::text || '::' || person.name as row_key
    from target_day
    cross join lateral jsonb_each(coalesce(target_day.day->'assignments', '{}'::jsonb)) as category(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(category.value, '[]'::jsonb)) with ordinality as person(name, ordinality)
    where category.key not in ('휴가', '제크')
  ),
  added_rows as (
    select
      target_day.month_key,
      target_day.date_key,
      coalesce(added.value->>'name', '') as name,
      target_day.date_key || '::custom::' || coalesce(added.value->>'id', '') as row_key
    from target_day
    left join target_assignment on target_assignment.month_key = target_day.month_key
    cross join lateral jsonb_array_elements(coalesce(target_assignment.rows->target_day.date_key->'addedRows', '[]'::jsonb)) as added(value)
  ),
  visible_rows as (
    select
      visible.name,
      visible.date_key,
      visible.row_key,
      visible.entry,
      coalesce(visible.entry->'schedules', '[]'::jsonb) as schedules,
      row_number() over (partition by visible.name order by visible.date_key, visible.row_key) as rn
    from (
      select
        rows.month_key,
        rows.date_key,
        rows.row_key,
        coalesce(
          target_assignment.rows->rows.date_key->'rowOverrides'->rows.row_key->>'name',
          rows.name
        ) as name,
        target_assignment.entries->rows.row_key as entry,
        target_assignment.rows as assignment_rows
      from (
        select * from base_rows
        union all
        select * from added_rows
      ) rows
      left join target_assignment on target_assignment.month_key = rows.month_key
    ) visible
    where coalesce(visible.name, '') <> ''
      and not (coalesce(visible.assignment_rows->visible.date_key->'deletedRowKeys', '[]'::jsonb) ? visible.row_key)
  ),
  trip_state as (
    select
      v.name,
      v.rn,
      v.date_key,
      v.row_key,
      v.schedules,
      next_active.active_id as active_id,
      next_active.active_label as active_label,
      next_active.active_travel as active_travel,
      trip_for_day.trip_id,
      trip_for_day.trip_label,
      trip_for_day.trip_travel
    from visible_rows v
    cross join lateral (
      select
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagId', '')
          else null
        end as explicit_id,
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagLabel', '')
          else null
        end as explicit_label,
        coalesce(nullif(v.entry->>'travelType', ''), '') as explicit_travel,
        coalesce(nullif(v.entry->>'tripTagPhase', ''), '') as explicit_phase
    ) explicit
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or explicit.explicit_phase = 'ongoing')
            then explicit.explicit_id
          else null
        end as active_id,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or explicit.explicit_phase = 'ongoing')
            then explicit.explicit_label
          else null
        end as active_label,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or explicit.explicit_phase = 'ongoing')
            then explicit.explicit_travel
          else null
        end as active_travel
    ) active_before_return
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_id
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_id
          else null
        end as trip_id,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_label
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_label
          else null
        end as trip_label,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_travel
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_travel
          else null
        end as trip_travel
    ) trip_for_day
    cross join lateral (
      select
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_id
        end as active_id,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_label
        end as active_label,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_travel
        end as active_travel
    ) next_active
    where v.rn = 1

    union all

    select
      v.name,
      v.rn,
      v.date_key,
      v.row_key,
      v.schedules,
      next_active.active_id as active_id,
      next_active.active_label as active_label,
      next_active.active_travel as active_travel,
      trip_for_day.trip_id,
      trip_for_day.trip_label,
      trip_for_day.trip_travel
    from trip_state previous
    join visible_rows v on v.name = previous.name and v.rn = previous.rn + 1
    cross join lateral (
      select
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagId', '')
          else null
        end as explicit_id,
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagLabel', '')
          else null
        end as explicit_label,
        coalesce(nullif(v.entry->>'travelType', ''), previous.active_travel, '') as explicit_travel,
        coalesce(nullif(v.entry->>'tripTagPhase', ''), '') as explicit_phase
    ) explicit
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or (explicit.explicit_phase = 'ongoing' and previous.active_id is null))
            then explicit.explicit_id
          when previous.active_id is not null and explicit.explicit_id = previous.active_id
            then previous.active_id
          else previous.active_id
        end as active_id,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or (explicit.explicit_phase = 'ongoing' and previous.active_id is null))
            then explicit.explicit_label
          when previous.active_id is not null and explicit.explicit_id = previous.active_id
            then explicit.explicit_label
          else previous.active_label
        end as active_label,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or (explicit.explicit_phase = 'ongoing' and previous.active_id is null))
            then explicit.explicit_travel
          when previous.active_id is not null and explicit.explicit_id = previous.active_id
            then coalesce(nullif(explicit.explicit_travel, ''), previous.active_travel)
          else previous.active_travel
        end as active_travel
    ) active_before_return
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_id
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_id
          when active_before_return.active_id is not null
            and coalesce(explicit.explicit_id, active_before_return.active_id) = active_before_return.active_id
            then active_before_return.active_id
          else null
        end as trip_id,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_label
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_label
          when active_before_return.active_id is not null
            and coalesce(explicit.explicit_id, active_before_return.active_id) = active_before_return.active_id
            then active_before_return.active_label
          else null
        end as trip_label,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_travel
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_travel
          when active_before_return.active_id is not null
            and coalesce(explicit.explicit_id, active_before_return.active_id) = active_before_return.active_id
            then active_before_return.active_travel
          else null
        end as trip_travel
    ) trip_for_day
    cross join lateral (
      select
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_id
        end as active_id,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_label
        end as active_label,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_travel
        end as active_travel
    ) next_active
  ),
  trip_groups as (
    select distinct name, trip_id
    from trip_state
    where trip_id is not null
      and coalesce(trip_travel, '') <> ''
  ),
  trip_items as (
    select
      trip_groups.name,
      jsonb_build_object(
        'tripTagId', trip_groups.trip_id,
        'tripTagLabel', coalesce(latest.trip_label, '출장명 없음'),
        'travelType', coalesce(latest.trip_travel, ''),
        'startDateKey', dates.start_date_key,
        'endDateKey', dates.end_date_key,
        'dayCount', dates.day_count,
        'dateKeys', dates.date_keys,
        'duties', '[]'::jsonb,
        'schedules', coalesce(schedules.schedules, '[]'::jsonb)
      ) as item
    from trip_groups
    cross join lateral (
      select
        min(date_key) as start_date_key,
        max(date_key) as end_date_key,
        count(distinct date_key) as day_count,
        coalesce(jsonb_agg(date_key order by date_key), '[]'::jsonb) as date_keys
      from (
        select distinct date_key
        from trip_state
        where name = trip_groups.name
          and trip_id = trip_groups.trip_id
          and coalesce(trip_travel, '') <> ''
      ) distinct_dates
    ) dates
    cross join lateral (
      select trip_label, trip_travel
      from trip_state
      where name = trip_groups.name
        and trip_id = trip_groups.trip_id
        and coalesce(trip_travel, '') <> ''
      order by date_key desc, row_key desc
      limit 1
    ) latest
    cross join lateral (
      select jsonb_agg(schedule_text order by first_date_key, first_row_key, schedule_text) as schedules
      from (
        select
          schedule_text.value as schedule_text,
          min(trip_state.date_key) as first_date_key,
          min(trip_state.row_key) as first_row_key
        from trip_state
        cross join lateral jsonb_array_elements_text(trip_state.schedules) as schedule_text(value)
        where trip_state.name = trip_groups.name
          and trip_state.trip_id = trip_groups.trip_id
          and coalesce(trip_state.trip_travel, '') <> ''
          and schedule_text.value <> ''
        group by schedule_text.value
      ) distinct_schedules
    ) schedules
  ),
  cards as (
    select jsonb_build_object(
      'name', name,
      'items', jsonb_agg(item order by item->>'startDateKey')
    ) as card
    from trip_items
    group by name
  )
  select coalesce(jsonb_agg(card order by card->>'name'), '[]'::jsonb)
  from cards;
$$;

revoke execute on function public.get_home_current_trips(date, date) from public, anon;
grant execute on function public.get_home_current_trips(date, date) to authenticated;

create or replace function public.get_home_current_trips()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_home_current_trips(
    ((now() at time zone 'Asia/Seoul')::date - 3650),
    ((now() at time zone 'Asia/Seoul')::date + 7)
  );
$$;

revoke execute on function public.get_home_current_trips() from public, anon;
grant execute on function public.get_home_current_trips() to authenticated;

-- Explicit Data API table privileges for Supabase public schema opt-in behavior.
-- RLS policies above still decide which authenticated users can access rows.
revoke all on table public.profiles from anon;
grant select, insert, update, delete on table public.profiles to authenticated, service_role;
revoke all on table public.submissions from anon;
grant select, insert, update, delete on table public.submissions to authenticated, service_role;
revoke all on table public.review_assignments from anon;
grant select, insert, update, delete on table public.review_assignments to authenticated, service_role;
revoke all on table public.reviews from anon;
grant select, insert, update, delete on table public.reviews to authenticated, service_role;
revoke all on table public.schedule_settings from anon;
grant select, insert, update, delete on table public.schedule_settings to authenticated, service_role;
revoke all on table public.portal_user_settings from anon;
grant select, insert, update, delete on table public.portal_user_settings to authenticated, service_role;
revoke all on table public.schedule_months from anon;
grant select, insert, update, delete on table public.schedule_months to authenticated, service_role;
revoke all on table public.schedule_assembly_sync_logs from anon;
grant select, insert, update, delete on table public.schedule_assembly_sync_logs to service_role;
revoke all on table public.schedule_assembly_leave_push_logs from anon;
grant select, insert, update, delete on table public.schedule_assembly_leave_push_logs to service_role;
revoke all on table public.schedule_change_requests from anon;
grant select, insert, update, delete on table public.schedule_change_requests to authenticated, service_role;
revoke all on table public.home_popup_notice_state from anon;
grant select, insert, update, delete on table public.home_popup_notice_state to authenticated, service_role;
revoke all on table public.home_popup_notice_applications from anon;
grant select, insert, update, delete on table public.home_popup_notice_applications to authenticated, service_role;
revoke all on table public.home_notice_poll_votes from anon;
grant select, insert, delete on table public.home_notice_poll_votes to authenticated;
grant select, insert, update, delete on table public.home_notice_poll_votes to service_role;
revoke all on table public.vacation_requests from anon;
grant select, insert, update, delete on table public.vacation_requests to authenticated, service_role;
revoke all on table public.vacation_months from anon;
grant select, insert, update, delete on table public.vacation_months to authenticated, service_role;
revoke all on table public.vacation_settings from anon;
grant select, insert, update, delete on table public.vacation_settings to authenticated, service_role;
revoke all on table public.team_lead_schedule_assignments from anon;
grant select, insert, update, delete on table public.team_lead_schedule_assignments to authenticated, service_role;
revoke all on table public.team_lead_schedule_assignment_backups from anon;
grant select, insert, update, delete on table public.team_lead_schedule_assignment_backups to authenticated, service_role;
revoke all on table public.schedule_partner_entries from anon;
grant select, insert, update on table public.schedule_partner_entries to authenticated;
grant select, insert, update, delete on table public.schedule_partner_entries to service_role;
revoke all on table public.team_lead_schedule_assignment_cell_locks from anon;
grant select, insert, update, delete on table public.team_lead_schedule_assignment_cell_locks to authenticated, service_role;
revoke all on table public.team_lead_state from anon;
grant select, insert, update, delete on table public.team_lead_state to authenticated, service_role;
revoke all on table public.page_visit_events from anon;
grant select, insert on table public.page_visit_events to authenticated;
grant select, insert, update, delete on table public.page_visit_events to service_role;
revoke all on table public.customer_support_messages from anon;
grant select, insert, update, delete on table public.customer_support_messages to authenticated, service_role;
revoke all on table public.home_news_briefings from anon;
grant select, insert, update, delete on table public.home_news_briefings to authenticated, service_role;
revoke all on table public.portal_celebration_events from anon;
grant select, insert, update, delete on table public.portal_celebration_events to authenticated, service_role;
revoke all on table public.equipment_items from anon;
grant select, insert, update, delete on table public.equipment_items to authenticated, service_role;
revoke all on table public.equipment_loans from anon;
grant select, insert, update on table public.equipment_loans to authenticated;
grant select, insert, update, delete on table public.equipment_loans to service_role;
revoke all on table public.equipment_loan_items from anon;
grant select, insert, update on table public.equipment_loan_items to authenticated;
grant select, insert, update, delete on table public.equipment_loan_items to service_role;
revoke all on table public.live_equipment_status_board from anon;
grant select, insert, update on table public.live_equipment_status_board to authenticated;
grant select, insert, update, delete on table public.live_equipment_status_board to service_role;
revoke all on table public.election_events from anon;
grant select (
  id,
  title,
  election_date,
  status,
  published_at,
  created_at,
  updated_at
) on table public.election_events to anon;
grant select, insert, update, delete on table public.election_events to authenticated, service_role;
revoke all on table public.election_points from anon;
grant select (
  id,
  event_id,
  sort_order,
  region,
  place,
  pool_video,
  equipment_name,
  equipment_type,
  trs,
  camera_staff_name,
  camera_staff_name_pm,
  audio_staff_name,
  audio_staff_name_pm,
  reporter_name,
  reporter_name_pm,
  live_time,
  live_time_pm,
  address,
  note,
  live_position,
  lan,
  lighting,
  region_color,
  cell_colors,
  is_active,
  created_at,
  updated_at
) on table public.election_points to anon;
grant select, insert, update, delete on table public.election_points to authenticated, service_role;

notify pgrst, 'reload schema';
