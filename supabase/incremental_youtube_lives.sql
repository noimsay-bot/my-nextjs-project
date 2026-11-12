-- DESK > 모바일 라이브
-- youtube_lives: JTBC News 채널 라이브 수집 결과. 쓰기는 서버(service_role)만 한다.
-- live_participation: 영상취재팀 참여 체크. 수집 upsert와 분리해 재수집해도 체크가 유지된다.
-- 조회: 승인된 허브 로그인 사용자
-- 체크/해제: 승인된 desk/team_lead (DESK 메뉴 접근 권한과 동일)

create table if not exists public.youtube_lives (
  video_id text primary key,
  title text not null default '',
  started_at timestamptz not null,
  collected_at timestamptz not null default timezone('utc', now())
);

create index if not exists youtube_lives_started_at_idx
on public.youtube_lives (started_at);

create table if not exists public.live_participation (
  video_id text primary key references public.youtube_lives (video_id) on delete cascade,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz not null default timezone('utc', now())
);

alter table public.youtube_lives enable row level security;
alter table public.live_participation enable row level security;

drop policy if exists "youtube_lives_select_approved" on public.youtube_lives;
create policy "youtube_lives_select_approved"
on public.youtube_lives
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "live_participation_select_approved" on public.live_participation;
create policy "live_participation_select_approved"
on public.live_participation
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "live_participation_insert_desk" on public.live_participation;
create policy "live_participation_insert_desk"
on public.live_participation
for insert
to authenticated
with check (
  public.current_profile_role() in ('desk', 'team_lead')
  and public.current_profile_approved() = true
  and checked_by = auth.uid()
);

drop policy if exists "live_participation_delete_desk" on public.live_participation;
create policy "live_participation_delete_desk"
on public.live_participation
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead')
  and public.current_profile_approved() = true
);

revoke all on table public.youtube_lives from anon;
revoke all on table public.youtube_lives from authenticated;
grant select on table public.youtube_lives to authenticated;
grant select, insert, update, delete on table public.youtube_lives to service_role;

revoke all on table public.live_participation from anon;
revoke all on table public.live_participation from authenticated;
grant select, insert, delete on table public.live_participation to authenticated;
grant select, insert, update, delete on table public.live_participation to service_role;

notify pgrst, 'reload schema';
