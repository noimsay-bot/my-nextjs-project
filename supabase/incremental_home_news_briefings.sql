begin;

create table if not exists public.home_news_briefings (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('politics', 'society', 'economy', 'world')),
  title text not null default '',
  summary_lines text[] not null default '{}',
  why_it_matters text not null default '',
  check_points text[] not null default '{}',
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  published_at timestamptz not null default timezone('utc', now()),
  briefing_slot text not null check (briefing_slot in ('morning_6', 'afternoon_3')),
  briefing_text text not null default '',
  is_active boolean not null default true,
  source_label text not null default '',
  tags text[] not null default '{}',
  event_stage text check (
    event_stage is null
    or event_stage in (
      'summon_requested',
      'summon_scheduled',
      'attending',
      'under_questioning',
      'warrant_review_scheduled',
      'warrant_requested',
      'warrant_issued',
      'warrant_denied',
      'investigation_update'
    )
  ),
  likes_count integer not null default 0 check (likes_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists home_news_briefings_active_published_idx
on public.home_news_briefings (is_active, published_at desc);

create index if not exists home_news_briefings_slot_published_idx
on public.home_news_briefings (briefing_slot, published_at desc);

create index if not exists home_news_briefings_category_published_idx
on public.home_news_briefings (category, published_at desc);

create index if not exists home_news_briefings_event_stage_idx
on public.home_news_briefings (event_stage);

drop trigger if exists set_home_news_briefings_updated_at on public.home_news_briefings;
create trigger set_home_news_briefings_updated_at
before update on public.home_news_briefings
for each row
execute function public.set_updated_at();

alter table public.home_news_briefings enable row level security;

drop policy if exists "home_news_briefings_select_active_approved" on public.home_news_briefings;
create policy "home_news_briefings_select_active_approved"
on public.home_news_briefings
for select
to authenticated
using (
  public.current_profile_approved() = true
  and is_active = true
);

drop policy if exists "home_news_briefings_select_privileged" on public.home_news_briefings;
create policy "home_news_briefings_select_privileged"
on public.home_news_briefings
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_briefings_manage_privileged" on public.home_news_briefings;
create policy "home_news_briefings_manage_privileged"
on public.home_news_briefings
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

commit;
