-- Purpose: Persist per-user portal UI settings such as hidden published schedule months.
-- Impact: Approved users can read and manage only their own settings.

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

revoke all on table public.portal_user_settings from anon;
grant select, insert, update, delete on table public.portal_user_settings to authenticated, service_role;

notify pgrst, 'reload schema';
