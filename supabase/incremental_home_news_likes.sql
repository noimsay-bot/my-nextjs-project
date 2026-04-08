begin;

create table if not exists public.home_news_briefing_likes (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.home_news_briefings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists home_news_briefing_likes_briefing_profile_uidx
on public.home_news_briefing_likes (briefing_id, profile_id);

create index if not exists home_news_briefing_likes_profile_created_idx
on public.home_news_briefing_likes (profile_id, created_at desc);

create index if not exists home_news_briefing_likes_briefing_idx
on public.home_news_briefing_likes (briefing_id);

create or replace function public.sync_home_news_briefing_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_briefing_id uuid;
begin
  target_briefing_id := coalesce(new.briefing_id, old.briefing_id);

  update public.home_news_briefings
  set likes_count = (
    select count(*)
    from public.home_news_briefing_likes
    where briefing_id = target_briefing_id
  )
  where id = target_briefing_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_home_news_briefing_likes_count_insert on public.home_news_briefing_likes;
create trigger sync_home_news_briefing_likes_count_insert
after insert on public.home_news_briefing_likes
for each row
execute function public.sync_home_news_briefing_likes_count();

drop trigger if exists sync_home_news_briefing_likes_count_delete on public.home_news_briefing_likes;
create trigger sync_home_news_briefing_likes_count_delete
after delete on public.home_news_briefing_likes
for each row
execute function public.sync_home_news_briefing_likes_count();

alter table public.home_news_briefing_likes enable row level security;

drop policy if exists "home_news_briefing_likes_select_own" on public.home_news_briefing_likes;
create policy "home_news_briefing_likes_select_own"
on public.home_news_briefing_likes
for select
to authenticated
using (
  auth.uid() = profile_id
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_briefing_likes_insert_own" on public.home_news_briefing_likes;
create policy "home_news_briefing_likes_insert_own"
on public.home_news_briefing_likes
for insert
to authenticated
with check (
  auth.uid() = profile_id
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_briefing_likes_delete_own" on public.home_news_briefing_likes;
create policy "home_news_briefing_likes_delete_own"
on public.home_news_briefing_likes
for delete
to authenticated
using (
  auth.uid() = profile_id
  and public.current_profile_approved() = true
);

update public.home_news_briefings briefing
set likes_count = like_counts.count_value
from (
  select briefing_id, count(*)::integer as count_value
  from public.home_news_briefing_likes
  group by briefing_id
) like_counts
where briefing.id = like_counts.briefing_id;

update public.home_news_briefings
set likes_count = 0
where id not in (
  select distinct briefing_id
  from public.home_news_briefing_likes
);

commit;
