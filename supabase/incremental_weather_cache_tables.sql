-- Weather cache tables for reducing Vercel Function/API egress.
-- Apply in Supabase SQL Editor before relying on browser-direct cache reads.

create table if not exists public.weather_radar_frames (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'kma_apihub_radar_1h',
  base_time_kst text not null,
  ef_minutes integer not null check (ef_minutes in (0, 10, 20, 30, 40, 50, 60)),
  qpf text not null check (qpf in ('M', 'B')),
  image_url text,
  legend_url text,
  date_time_text text,
  zoom_lvl text,
  coverage jsonb not null default '{}'::jsonb,
  nodata boolean not null default false,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  error_message text,
  unique (provider, base_time_kst, ef_minutes, qpf)
);

create table if not exists public.weather_dispatch_cache (
  id uuid primary key default gen_random_uuid(),
  base_time_kst text not null,
  range_minutes integer not null check (range_minutes in (30, 45, 60)),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  error_message text,
  unique (base_time_kst, range_minutes)
);

create index if not exists weather_radar_frames_expires_at_idx
on public.weather_radar_frames (expires_at);

create index if not exists weather_radar_frames_fetched_at_idx
on public.weather_radar_frames (fetched_at desc);

create unique index if not exists weather_radar_frames_cache_key_idx
on public.weather_radar_frames (provider, base_time_kst, ef_minutes, qpf);

create index if not exists weather_radar_frames_fresh_lookup_idx
on public.weather_radar_frames (provider, ef_minutes, expires_at, fetched_at desc);

create index if not exists weather_dispatch_cache_expires_at_idx
on public.weather_dispatch_cache (expires_at);

create index if not exists weather_dispatch_cache_fetched_at_idx
on public.weather_dispatch_cache (fetched_at desc);

create unique index if not exists weather_dispatch_cache_cache_key_idx
on public.weather_dispatch_cache (base_time_kst, range_minutes);

create index if not exists weather_dispatch_cache_fresh_lookup_idx
on public.weather_dispatch_cache (range_minutes, expires_at, fetched_at desc);

alter table public.weather_radar_frames enable row level security;
alter table public.weather_dispatch_cache enable row level security;

drop policy if exists "weather_radar_frames_admin_select" on public.weather_radar_frames;
create policy "weather_radar_frames_admin_select"
on public.weather_radar_frames
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

drop policy if exists "weather_dispatch_cache_admin_select" on public.weather_dispatch_cache;
create policy "weather_dispatch_cache_admin_select"
on public.weather_dispatch_cache
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

grant select on public.weather_radar_frames to authenticated;
grant select on public.weather_dispatch_cache to authenticated;

revoke insert, update, delete on public.weather_radar_frames from anon, authenticated;
revoke insert, update, delete on public.weather_dispatch_cache from anon, authenticated;
