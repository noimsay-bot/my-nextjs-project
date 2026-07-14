-- 날씨 캐시 읽기 권한을 승인된 팀원 포털 역할로 확장한다.
-- Supabase SQL Editor에서 운영 DB에 별도로 적용한다.

drop policy if exists "weather_radar_frame_sets_admin_select" on public.weather_radar_frame_sets;
drop policy if exists "weather_radar_frame_sets_member_portal_select" on public.weather_radar_frame_sets;
create policy "weather_radar_frame_sets_member_portal_select"
on public.weather_radar_frame_sets
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approved is true
      and p.role::text in ('member', 'outlet', 'reviewer', 'observer', 'desk', 'team_lead', 'admin')
  )
);

drop policy if exists "weather_radar_frames_admin_select" on public.weather_radar_frames;
drop policy if exists "weather_radar_frames_member_portal_select" on public.weather_radar_frames;
create policy "weather_radar_frames_member_portal_select"
on public.weather_radar_frames
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approved is true
      and p.role::text in ('member', 'outlet', 'reviewer', 'observer', 'desk', 'team_lead', 'admin')
  )
);

drop policy if exists "weather_dispatch_cache_admin_select" on public.weather_dispatch_cache;
drop policy if exists "weather_dispatch_cache_member_portal_select" on public.weather_dispatch_cache;
create policy "weather_dispatch_cache_member_portal_select"
on public.weather_dispatch_cache
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approved is true
      and p.role::text in ('member', 'outlet', 'reviewer', 'observer', 'desk', 'team_lead', 'admin')
  )
);
