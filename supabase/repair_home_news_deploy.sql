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
  dislikes_count integer not null default 0 check (dislikes_count >= 0),
  occurred_at timestamptz null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.home_news_briefings
  add column if not exists dislikes_count integer not null default 0 check (dislikes_count >= 0);

alter table public.home_news_briefings
  add column if not exists occurred_at timestamptz null;

create index if not exists home_news_briefings_active_published_idx
on public.home_news_briefings (is_active, published_at desc);

create index if not exists home_news_briefings_slot_published_idx
on public.home_news_briefings (briefing_slot, published_at desc);

create index if not exists home_news_briefings_category_published_idx
on public.home_news_briefings (category, published_at desc);

create index if not exists home_news_briefings_event_stage_idx
on public.home_news_briefings (event_stage);

create index if not exists home_news_briefings_occurred_idx
on public.home_news_briefings (occurred_at desc);

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

drop policy if exists "home_news_briefings_manage_admin_only" on public.home_news_briefings;
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

create or replace function public.sync_home_news_briefing_dislikes_count()
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
  set dislikes_count = (
    select count(*)
    from public.home_news_briefing_dislikes
    where briefing_id = target_briefing_id
  )
  where id = target_briefing_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_home_news_briefing_dislikes_count_insert on public.home_news_briefing_dislikes;
create trigger sync_home_news_briefing_dislikes_count_insert
after insert on public.home_news_briefing_dislikes
for each row
execute function public.sync_home_news_briefing_dislikes_count();

drop trigger if exists sync_home_news_briefing_dislikes_count_delete on public.home_news_briefing_dislikes;
create trigger sync_home_news_briefing_dislikes_count_delete
after delete on public.home_news_briefing_dislikes
for each row
execute function public.sync_home_news_briefing_dislikes_count();

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

update public.home_news_briefings briefing
set dislikes_count = dislike_counts.count_value
from (
  select briefing_id, count(*)::integer as count_value
  from public.home_news_briefing_dislikes
  group by briefing_id
) dislike_counts
where briefing.id = dislike_counts.briefing_id;

update public.home_news_briefings
set dislikes_count = 0
where id not in (
  select distinct briefing_id
  from public.home_news_briefing_dislikes
);

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

drop policy if exists "home_news_issue_sets_approved_select_official" on public.home_news_issue_sets;
create policy "home_news_issue_sets_approved_select_official"
on public.home_news_issue_sets
for select
to authenticated
using (
  public.current_profile_approved() = true
  and status in ('published', 'locked')
);

drop policy if exists "home_news_issue_set_items_approved_select_official" on public.home_news_issue_set_items;
create policy "home_news_issue_set_items_approved_select_official"
on public.home_news_issue_set_items
for select
to authenticated
using (
  public.current_profile_approved() = true
  and exists (
    select 1
    from public.home_news_issue_sets issue_set
    where issue_set.id = home_news_issue_set_items.issue_set_id
      and issue_set.status in ('published', 'locked')
  )
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'team_lead')
      and approved = true
  );
$$;

drop policy if exists "profiles_admin_delete_all" on public.profiles;
create policy "profiles_admin_delete_all"
on public.profiles
for delete
to authenticated
using (public.is_admin());

do $$
declare
  today_kst date := (timezone('Asia/Seoul', now()))::date;
  target_slot text;
  target_issue_set_id uuid;
begin
  foreach target_slot in array array['morning_6', 'afternoon_3']
  loop
    select id
    into target_issue_set_id
    from public.home_news_issue_sets
    where issue_date = today_kst
      and briefing_slot = target_slot
      and status <> 'archived'
    order by
      case status
        when 'published' then 0
        when 'locked' then 1
        when 'draft' then 2
        else 3
      end,
      created_at desc
    limit 1;

    if target_issue_set_id is null then
      insert into public.home_news_issue_sets (
        issue_date,
        briefing_slot,
        title,
        status,
        published_at,
        created_by,
        updated_by
      )
      values (
        today_kst,
        target_slot,
        to_char(today_kst, 'YYYY-MM-DD') || ' ' || case when target_slot = 'morning_6' then '오전 6시' else '오후 3시' end || ' 브리핑',
        'draft',
        null,
        null,
        null
      )
      returning id into target_issue_set_id;
    end if;

    update public.home_news_issue_sets
    set
      status = 'archived',
      updated_by = null
    where issue_date = today_kst
      and briefing_slot = target_slot
      and id <> target_issue_set_id
      and status in ('published', 'locked');

    delete from public.home_news_issue_set_items
    where issue_set_id = target_issue_set_id;

    insert into public.home_news_issue_set_items (
      issue_set_id,
      briefing_id,
      display_order
    )
    select
      target_issue_set_id,
      ranked.id,
      ranked.display_order
    from (
      select id, row_number() over (
        order by
          case priority
            when 'high' then 3
            when 'medium' then 2
            when 'low' then 1
            else 0
          end desc,
          coalesce(occurred_at, published_at) desc,
          published_at desc,
          updated_at desc
      ) as display_order
      from (
        select *
        from public.home_news_briefings
        where is_active = true
          and briefing_slot = target_slot

        union all

        select *
        from public.home_news_briefings
        where is_active = true
          and not exists (
            select 1
            from public.home_news_briefings slot_rows
            where slot_rows.is_active = true
              and slot_rows.briefing_slot = target_slot
          )
      ) candidates
      limit 3
    ) ranked
    where ranked.display_order <= 3;

    update public.home_news_issue_sets
    set
      status = case
        when exists (
          select 1
          from public.home_news_issue_set_items
          where issue_set_id = target_issue_set_id
        ) then 'published'
        else 'draft'
      end,
      published_at = case
        when exists (
          select 1
          from public.home_news_issue_set_items
          where issue_set_id = target_issue_set_id
        ) then timezone('utc', now())
        else null
      end,
      updated_by = null,
      title = to_char(today_kst, 'YYYY-MM-DD') || ' ' || case when target_slot = 'morning_6' then '오전 6시' else '오후 3시' end || ' 브리핑'
    where id = target_issue_set_id;
  end loop;
end $$;

commit;
