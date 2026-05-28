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

revoke all on table public.election_events from anon;
revoke all on table public.election_points from anon;
grant select, insert, update, delete on table public.election_events to authenticated, service_role;
grant select, insert, update, delete on table public.election_points to authenticated, service_role;

notify pgrst, 'reload schema';
