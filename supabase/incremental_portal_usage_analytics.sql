create table if not exists public.portal_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  user_name text not null default '',
  user_login_id text not null default '',
  user_role public.app_role not null default 'member',
  event_type text not null check (event_type in ('visit', 'page_view')),
  feature_key text not null default '',
  feature_label text not null default '',
  route_path text not null default '',
  day_key date not null default current_date,
  occurred_at timestamptz not null default timezone('utc', now())
);

create index if not exists portal_usage_events_day_key_idx on public.portal_usage_events (day_key desc);
create index if not exists portal_usage_events_user_day_idx on public.portal_usage_events (user_id, day_key desc);
create index if not exists portal_usage_events_feature_day_idx on public.portal_usage_events (feature_key, day_key desc);
create index if not exists portal_usage_events_occurred_at_idx on public.portal_usage_events (occurred_at desc);

alter table public.portal_usage_events enable row level security;

drop policy if exists "portal_usage_events_insert_own" on public.portal_usage_events;
create policy "portal_usage_events_insert_own"
on public.portal_usage_events
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "portal_usage_events_select_managers" on public.portal_usage_events;
create policy "portal_usage_events_select_managers"
on public.portal_usage_events
for select
to authenticated
using (public.is_admin());
