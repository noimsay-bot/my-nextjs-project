begin;

create table if not exists public.home_news_issue_sets (
  id uuid primary key default gen_random_uuid(),
  issue_date date not null,
  briefing_slot text not null check (briefing_slot in ('morning_6', 'afternoon_3')),
  title text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'locked', 'archived')),
  published_at timestamptz null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.home_news_issue_set_items (
  id uuid primary key default gen_random_uuid(),
  issue_set_id uuid not null references public.home_news_issue_sets (id) on delete cascade,
  briefing_id uuid not null references public.home_news_briefings (id) on delete restrict,
  display_order integer not null check (display_order between 1 and 3),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists home_news_issue_sets_official_uidx
on public.home_news_issue_sets (issue_date, briefing_slot)
where status in ('published', 'locked');

create index if not exists home_news_issue_sets_date_slot_idx
on public.home_news_issue_sets (issue_date desc, briefing_slot, created_at desc);

create unique index if not exists home_news_issue_set_items_issue_briefing_uidx
on public.home_news_issue_set_items (issue_set_id, briefing_id);

create unique index if not exists home_news_issue_set_items_issue_order_uidx
on public.home_news_issue_set_items (issue_set_id, display_order);

create or replace function public.validate_home_news_issue_set_items()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing_count integer;
begin
  select count(*)
  into existing_count
  from public.home_news_issue_set_items
  where issue_set_id = new.issue_set_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if existing_count >= 3 then
    raise exception 'A home news issue set can contain at most 3 items.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_home_news_issue_set_items_trigger on public.home_news_issue_set_items;
create trigger validate_home_news_issue_set_items_trigger
before insert or update on public.home_news_issue_set_items
for each row
execute function public.validate_home_news_issue_set_items();

drop trigger if exists set_home_news_issue_sets_updated_at on public.home_news_issue_sets;
create trigger set_home_news_issue_sets_updated_at
before update on public.home_news_issue_sets
for each row
execute function public.set_updated_at();

drop trigger if exists set_home_news_issue_set_items_updated_at on public.home_news_issue_set_items;
create trigger set_home_news_issue_set_items_updated_at
before update on public.home_news_issue_set_items
for each row
execute function public.set_updated_at();

alter table public.home_news_issue_sets enable row level security;
alter table public.home_news_issue_set_items enable row level security;

drop policy if exists "home_news_issue_sets_admin_only" on public.home_news_issue_sets;
drop policy if exists "home_news_issue_sets_manage_privileged" on public.home_news_issue_sets;
create policy "home_news_issue_sets_manage_privileged"
on public.home_news_issue_sets
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

drop policy if exists "home_news_issue_set_items_admin_only" on public.home_news_issue_set_items;
drop policy if exists "home_news_issue_set_items_manage_privileged" on public.home_news_issue_set_items;
create policy "home_news_issue_set_items_manage_privileged"
on public.home_news_issue_set_items
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
