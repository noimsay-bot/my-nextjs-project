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
