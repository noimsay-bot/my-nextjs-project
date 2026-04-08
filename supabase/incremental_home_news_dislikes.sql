begin;

create table if not exists public.home_news_briefing_dislikes (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.home_news_briefings (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists home_news_briefing_dislikes_briefing_profile_uidx
on public.home_news_briefing_dislikes (briefing_id, profile_id);

create index if not exists home_news_briefing_dislikes_profile_created_idx
on public.home_news_briefing_dislikes (profile_id, created_at desc);

create index if not exists home_news_briefing_dislikes_briefing_idx
on public.home_news_briefing_dislikes (briefing_id);

alter table public.home_news_briefing_dislikes enable row level security;

drop policy if exists "home_news_briefing_dislikes_select_own" on public.home_news_briefing_dislikes;
create policy "home_news_briefing_dislikes_select_own"
on public.home_news_briefing_dislikes
for select
to authenticated
using (
  auth.uid() = profile_id
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_briefing_dislikes_insert_own" on public.home_news_briefing_dislikes;
create policy "home_news_briefing_dislikes_insert_own"
on public.home_news_briefing_dislikes
for insert
to authenticated
with check (
  auth.uid() = profile_id
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_briefing_dislikes_delete_own" on public.home_news_briefing_dislikes;
create policy "home_news_briefing_dislikes_delete_own"
on public.home_news_briefing_dislikes
for delete
to authenticated
using (
  auth.uid() = profile_id
  and public.current_profile_approved() = true
);

commit;
