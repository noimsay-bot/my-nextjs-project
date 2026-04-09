begin;

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

commit;
