create type public.app_role as enum ('member', 'reviewer', 'advisor', 'observer', 'desk', 'team_lead', 'admin');

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
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "submissions_update_own" on public.submissions;
create policy "submissions_update_own"
on public.submissions
for update
to authenticated
using (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
)
with check (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "submissions_delete_own" on public.submissions;
create policy "submissions_delete_own"
on public.submissions
for delete
to authenticated
using (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "submissions_select_reviewers_and_leads" on public.submissions;
create policy "submissions_select_reviewers_and_leads"
on public.submissions
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
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
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
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
  is_active = true
  and public.current_profile_approved() = true
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
  and public.current_profile_role() not in ('advisor', 'observer')
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
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "vacation_requests_update_own" on public.vacation_requests;
create policy "vacation_requests_update_own"
on public.vacation_requests
for update
to authenticated
using (
  requester_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
)
with check (
  requester_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "vacation_requests_delete_own" on public.vacation_requests;
create policy "vacation_requests_delete_own"
on public.vacation_requests
for delete
to authenticated
using (
  requester_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
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
