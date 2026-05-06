do $$
begin
  alter type public.app_role add value if not exists 'partner';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.schedule_partner_entries (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  schedule_item_id text not null,
  photographer_profile_id uuid references public.profiles (id) on delete set null,
  photographer_name text not null default '',
  schedule_content text not null default '',
  audio_man_name text,
  senior_name text,
  partner_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists schedule_partner_entries_schedule_item_idx
  on public.schedule_partner_entries (schedule_item_id);
create index if not exists schedule_partner_entries_date_idx
  on public.schedule_partner_entries (schedule_date);
create index if not exists schedule_partner_entries_photographer_idx
  on public.schedule_partner_entries (photographer_profile_id, schedule_date);

drop trigger if exists set_schedule_partner_entries_updated_at on public.schedule_partner_entries;
create trigger set_schedule_partner_entries_updated_at
before update on public.schedule_partner_entries
for each row
execute function public.set_updated_at();

alter table public.schedule_partner_entries enable row level security;

drop policy if exists "schedule_partner_entries_select_scoped" on public.schedule_partner_entries;
create policy "schedule_partner_entries_select_scoped"
on public.schedule_partner_entries
for select
to authenticated
using (
  public.current_profile_approved() = true
  and (
    photographer_profile_id = auth.uid()
    or public.current_profile_role()::text in ('partner', 'team_lead', 'admin')
  )
);

drop policy if exists "schedule_partner_entries_insert_partner" on public.schedule_partner_entries;
create policy "schedule_partner_entries_insert_partner"
on public.schedule_partner_entries
for insert
to authenticated
with check (
  public.current_profile_role()::text = 'partner'
  and public.current_profile_approved() = true
  and partner_profile_id = auth.uid()
);

drop policy if exists "schedule_partner_entries_update_partner" on public.schedule_partner_entries;
create policy "schedule_partner_entries_update_partner"
on public.schedule_partner_entries
for update
to authenticated
using (
  public.current_profile_role()::text = 'partner'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role()::text = 'partner'
  and public.current_profile_approved() = true
  and partner_profile_id = auth.uid()
);

create or replace function public.get_my_schedule_assignment_items(
  p_month_key text
)
returns table (
  schedule_date date,
  schedule_item_id text,
  photographer_profile_id uuid,
  photographer_name text,
  schedule_content text
)
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select id, name
    from public.profiles
    where id = auth.uid()
      and approved = true
      and role::text <> 'partner'
      and role::text <> 'observer'
  ),
  raw_items as (
    select
      t.month_key,
      entry_item.key as row_key,
      matched.parts,
      schedule_item.content,
      schedule_item.ordinality
    from public.team_lead_schedule_assignments t
    cross join lateral jsonb_each(t.entries) as entry_item(key, value)
    cross join lateral regexp_match(entry_item.key, '^([^:]+)::([^:]+)::([^:]+)::(.*)$') as matched(parts)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
    where t.month_key = trim(coalesce(p_month_key, ''))
  )
  select
    raw_items.parts[1]::date as schedule_date,
    concat(raw_items.row_key, '::schedule::', raw_items.ordinality::text) as schedule_item_id,
    current_profile.id as photographer_profile_id,
    current_profile.name as photographer_name,
    trim(raw_items.content) as schedule_content
  from raw_items
  join current_profile on trim(raw_items.parts[4]) = current_profile.name
  where trim(raw_items.content) <> ''
  order by schedule_date, schedule_item_id;
$$;

create or replace function public.get_partner_schedule_assignment_items(
  p_schedule_date date
)
returns table (
  schedule_date date,
  schedule_item_id text,
  photographer_profile_id uuid,
  photographer_name text,
  schedule_content text
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select public.current_profile_approved() = true
      and public.current_profile_role()::text = 'partner' as ok
  ),
  raw_items as (
    select
      entry_item.key as row_key,
      matched.parts,
      schedule_item.content,
      schedule_item.ordinality
    from public.team_lead_schedule_assignments t
    cross join allowed
    cross join lateral jsonb_each(t.entries) as entry_item(key, value)
    cross join lateral regexp_match(entry_item.key, '^([^:]+)::([^:]+)::([^:]+)::(.*)$') as matched(parts)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
    where allowed.ok
      and t.month_key = to_char(p_schedule_date, 'YYYY-MM')
      and matched.parts[1] = p_schedule_date::text
  )
  select
    raw_items.parts[1]::date as schedule_date,
    concat(raw_items.row_key, '::schedule::', raw_items.ordinality::text) as schedule_item_id,
    photographer.id as photographer_profile_id,
    trim(raw_items.parts[4]) as photographer_name,
    trim(raw_items.content) as schedule_content
  from raw_items
  left join public.profiles photographer
    on photographer.approved = true
   and photographer.name = trim(raw_items.parts[4])
  where trim(raw_items.content) <> ''
  order by photographer_name, schedule_item_id;
$$;

revoke execute on function public.get_my_schedule_assignment_items(text) from public, anon;
revoke execute on function public.get_partner_schedule_assignment_items(date) from public, anon;
grant execute on function public.get_my_schedule_assignment_items(text) to authenticated;
grant execute on function public.get_partner_schedule_assignment_items(date) to authenticated;
