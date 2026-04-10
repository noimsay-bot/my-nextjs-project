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

alter table if exists public.home_popup_notice_state
  add column if not exists notice_id uuid not null default gen_random_uuid(),
  add column if not exists title text not null default '',
  add column if not exists body text not null default '',
  add column if not exists is_active boolean not null default false,
  add column if not exists expires_at timestamptz,
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

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

alter table if exists public.home_popup_notice_applications
  add column if not exists notice_id uuid not null default gen_random_uuid(),
  add column if not exists applicant_id uuid references public.profiles (id) on delete cascade,
  add column if not exists applicant_name text not null default '',
  add column if not exists created_at timestamptz not null default timezone('utc', now());

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
