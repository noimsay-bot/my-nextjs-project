create type public.app_role as enum ('member', 'outlet', 'reviewer', 'observer', 'desk', 'team_lead', 'admin');

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
  profile_id uuid not null references public.profiles (id) on delete cascade,
  page_key text not null check (page_key in ('community', 'work_schedule', 'restaurants')),
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
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_celebration_events_effect_check
    check (effect in ('confetti')),
  constraint portal_celebration_events_intensity_check
    check (intensity in ('light', 'normal', 'strong')),
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
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
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
    and (
      public.current_profile_role() in ('reviewer', 'team_lead', 'desk')
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

alter table public.equipment_items enable row level security;
alter table public.equipment_loans enable row level security;
alter table public.equipment_loan_items enable row level security;

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
  public.is_admin()
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
)
with check (
  public.is_admin()
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
  public.is_admin()
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
  public.is_admin()
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
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
    and is_active = true;

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
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
    returning id
  )
  select array_agg(id)
  into v_item_ids
  from upserted_items;

  return public.borrow_equipment_items(v_item_ids, 'eng_set');
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
        or public.is_admin()
      )
    returning equipment_loan_items.loan_id
  )
  select count(*), coalesce(array_agg(distinct loan_id), array[]::uuid[])
  into v_returned_count, v_loan_ids
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

  return coalesce(v_returned_count, 0);
end;
$$;

revoke execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) from public, anon;
revoke execute on function public.borrow_eng_sets(uuid[]) from public, anon;
revoke execute on function public.return_equipment_loan_items(uuid[]) from public, anon;
grant execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) to authenticated;
grant execute on function public.borrow_eng_sets(uuid[]) to authenticated;
grant execute on function public.return_equipment_loan_items(uuid[]) to authenticated;

with seed(category, group_name, name, code, sort_order, metadata) as (
  values
    ('camera_lens', '5D 바디', 'mark2-1', 'camera-5d-body-mark2-1', 1011, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark2-2', 'camera-5d-body-mark2-2', 1012, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark4-1', 'camera-5d-body-mark4-1', 1013, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark4-2', 'camera-5d-body-mark4-2', 1014, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 렌즈', '16-35mm', 'camera-5d-lens-16-35mm', 1111, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm', 'camera-5d-lens-70-200mm', 1112, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-105mm', 'camera-5d-lens-24-105mm', 1113, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '100mm', 'camera-5d-lens-100mm', 1114, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '28-300mm', 'camera-5d-lens-28-300mm', 1115, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-70mm', 'camera-5d-lens-24-70mm', 1116, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', 'Ts-e 24mm', 'camera-5d-lens-ts-e-24mm', 1117, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', 'macro', 'camera-5d-lens-macro', 1118, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 바디', 'gh4-1', 'camera-gh4-body-1', 2011, '{"family":"GH4","kind":"body"}'::jsonb),
    ('camera_lens', 'GH4 바디', 'gh4-2', 'camera-gh4-body-2', 2012, '{"family":"GH4","kind":"body"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '7-14mm', 'camera-gh4-lens-7-14mm', 2111, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '24-105mm', 'camera-gh4-lens-24-105mm', 2112, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '14mm', 'camera-gh4-lens-14mm', 2113, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '35-100mm', 'camera-gh4-lens-35-100mm', 2114, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm', 'camera-gh4-lens-12-35mm', 2115, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 바디', 'fx3-1', 'camera-fx3-body-1', 3011, '{"family":"FX3","kind":"body"}'::jsonb),
    ('camera_lens', 'FX3 바디', 'fx3-2', 'camera-fx3-body-2', 3012, '{"family":"FX3","kind":"body"}'::jsonb),
    ('camera_lens', '단독 카메라', 'rx100 1번', 'camera-standalone-rx100-01', 4018, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '고프로', 'camera-standalone-gopro', 4019, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '오스모', 'camera-standalone-osmo', 4020, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '360', 'camera-standalone-360', 4021, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '와이어리스', 'camera-standalone-wireless', 4022, '{"family":"standalone","kind":"audio"}'::jsonb),
    ('camera_lens', '단독 카메라', 'dji마이크', 'camera-standalone-dji-mic', 4023, '{"family":"standalone","kind":"audio"}'::jsonb),
    ('camera_lens', '단독 카메라', 'c타입 마이크', 'camera-standalone-c-type-mic', 4024, '{"family":"standalone","kind":"audio"}'::jsonb),
    ('camera_lens', '단독 카메라', '기타 장비', 'camera-standalone-etc', 4025, '{"family":"standalone","kind":"etc"}'::jsonb),
    ('light', '조명', '400x', 'light-400x', 100, '{}'::jsonb),
    ('light', '조명', '스텔라', 'light-stella', 110, '{}'::jsonb),
    ('light', '조명', '판조명', 'light-panel', 120, '{}'::jsonb),
    ('light', '조명', '프라임', 'light-prime', 130, '{}'::jsonb),
    ('live', '기타 라이브장비', '쿠보텍', 'live-cubotec', 2001, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', '분배기', 'live-distributor', 2002, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', 'bnc케이블', 'live-bnc-cable', 2003, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', 'tvu 배터리', 'live-tvu-battery', 2004, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', '핀마이크', 'live-pin-mic', 2005, '{"kind":"live_accessory"}'::jsonb)
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
  from generate_series(1, 3) as n
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
  select 'live', 'TVU', concat('TVU-', tvu_no), concat('live-tvu-', tvu_no), 1000 + row_number() over (order by display_order), '{"kind":"tvu"}'::jsonb
  from (
    values
      (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6),
      (14, 14), (16, 16), (17, 17), (18, 18), (19, 19)
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
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());
