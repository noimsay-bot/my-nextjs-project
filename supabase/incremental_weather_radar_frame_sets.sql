-- Weather radar frame sets for complete HSR + 1H forecast playback.
-- Apply in Supabase SQL Editor before relying on active complete radar sets.

create table if not exists public.weather_radar_frame_sets (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'kma_apihub_radar_1h',
  base_time_kst text not null,
  qpf text not null check (qpf in ('M', 'B')),
  expected_frames integer not null default 7,
  available_frames integer not null default 0,
  missing_frames integer[] not null default '{}'::integer[],
  is_complete boolean not null default false,
  is_active boolean not null default false,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  error_message text,
  debug jsonb not null default '{}'::jsonb,
  unique (provider, base_time_kst, qpf)
);

alter table public.weather_radar_frames
  add column if not exists frame_kind text,
  add column if not exists frame_set_id uuid,
  add column if not exists source_endpoint text,
  add column if not exists status text,
  add column if not exists debug jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'weather_radar_frames_frame_set_id_fkey'
      and conrelid = 'public.weather_radar_frames'::regclass
  ) then
    alter table public.weather_radar_frames
      add constraint weather_radar_frames_frame_set_id_fkey
      foreign key (frame_set_id)
      references public.weather_radar_frame_sets (id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'weather_radar_frames_frame_kind_check'
      and conrelid = 'public.weather_radar_frames'::regclass
  ) then
    alter table public.weather_radar_frames
      add constraint weather_radar_frames_frame_kind_check
      check (frame_kind is null or frame_kind in ('observed', 'forecast'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'weather_radar_frames_source_endpoint_check'
      and conrelid = 'public.weather_radar_frames'::regclass
  ) then
    alter table public.weather_radar_frames
      add constraint weather_radar_frames_source_endpoint_check
      check (source_endpoint is null or source_endpoint in ('nph-rdr_cmp1_imgp', 'nph-qpf_ana_imgp'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'weather_radar_frames_status_check'
      and conrelid = 'public.weather_radar_frames'::regclass
  ) then
    alter table public.weather_radar_frames
      add constraint weather_radar_frames_status_check
      check (status is null or status in ('available', 'nodata', 'error'));
  end if;
end $$;

create index if not exists weather_radar_frame_sets_active_complete_idx
on public.weather_radar_frame_sets (provider, is_active, is_complete, fetched_at desc);

create index if not exists weather_radar_frame_sets_expires_at_idx
on public.weather_radar_frame_sets (expires_at);

create unique index if not exists weather_radar_frame_sets_cache_key_idx
on public.weather_radar_frame_sets (provider, base_time_kst, qpf);

create index if not exists weather_radar_frame_sets_refreshing_idx
on public.weather_radar_frame_sets (provider, error_message, expires_at, fetched_at desc);

create index if not exists weather_radar_frames_frame_set_idx
on public.weather_radar_frames (frame_set_id, ef_minutes);

create unique index if not exists weather_radar_frames_frame_set_offset_idx
on public.weather_radar_frames (frame_set_id, ef_minutes)
where frame_set_id is not null;

create index if not exists weather_radar_frames_active_lookup_idx
on public.weather_radar_frames (provider, frame_set_id, ef_minutes);

alter table public.weather_radar_frame_sets enable row level security;

drop policy if exists "weather_radar_frame_sets_admin_select" on public.weather_radar_frame_sets;
create policy "weather_radar_frame_sets_admin_select"
on public.weather_radar_frame_sets
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approved is true
      and p.role::text = 'admin'
  )
);

grant select on public.weather_radar_frame_sets to authenticated;

revoke all on public.weather_radar_frame_sets from anon;
revoke insert, update, delete on public.weather_radar_frame_sets from anon, authenticated;
