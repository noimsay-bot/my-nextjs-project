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
  assignment_month as (
    select
      t.month_key,
      coalesce(t.entries, '{}'::jsonb) as entries,
      coalesce(t.rows, '{}'::jsonb) as rows,
      coalesce(sm.published_state, sm.draft_state) as schedule_state
    from public.team_lead_schedule_assignments t
    left join public.schedule_months sm on sm.month_key = t.month_key
    where t.month_key = trim(coalesce(p_month_key, ''))
  ),
  schedule_days as (
    select
      assignment_month.month_key,
      assignment_month.entries,
      assignment_month.rows,
      day_item.value as day_state
    from assignment_month
    cross join lateral jsonb_array_elements(coalesce(assignment_month.schedule_state -> 'days', '[]'::jsonb)) as day_item(value)
    where day_item.value ->> 'dateKey' like assignment_month.month_key || '-__'
  ),
  base_rows as (
    select
      schedule_days.month_key,
      row_identity.date_key,
      row_identity.row_key,
      coalesce(
        nullif(trim(schedule_days.rows -> row_identity.date_key -> 'rowOverrides' -> row_identity.row_key ->> 'name'), ''),
        row_identity.base_name
      ) as photographer_name
    from schedule_days
    cross join lateral jsonb_each(coalesce(schedule_days.day_state -> 'assignments', '{}'::jsonb)) as assignment(category, names)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(assignment.names) = 'array' then assignment.names
        else '[]'::jsonb
      end
    ) with ordinality as person(name, ordinality)
    cross join lateral (
      select
        schedule_days.day_state ->> 'dateKey' as date_key,
        concat(
          schedule_days.day_state ->> 'dateKey',
          '::',
          assignment.category,
          '::',
          (person.ordinality - 1)::text,
          '::',
          person.name
        ) as row_key,
        trim(person.name) as base_name
    ) as row_identity
    where assignment.category <> '휴가'
      and assignment.category <> '제크'
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(schedule_days.rows -> row_identity.date_key -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = row_identity.row_key
      )
  ),
  custom_rows as (
    select
      assignment_month.month_key,
      row_identity.date_key,
      row_identity.row_key,
      trim(custom_row.value ->> 'name') as photographer_name
    from assignment_month
    cross join lateral jsonb_each(assignment_month.rows) as day_rows(date_key, value)
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(day_rows.value -> 'addedRows') = 'array' then day_rows.value -> 'addedRows'
        else '[]'::jsonb
      end
    ) as custom_row(value)
    cross join lateral (
      select
        day_rows.date_key,
        concat(day_rows.date_key, '::custom::', custom_row.value ->> 'id') as row_key
    ) as row_identity
    where day_rows.date_key like assignment_month.month_key || '-__'
      and trim(custom_row.value ->> 'id') <> ''
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(day_rows.value -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = row_identity.row_key
      )
  ),
  visible_rows as (
    select * from base_rows
    union all
    select * from custom_rows
  ),
  entry_items as (
    select
      assignment_month.month_key,
      entry_item.key as row_key,
      schedule_item.content,
      schedule_item.ordinality
    from assignment_month
    cross join lateral jsonb_each(assignment_month.entries) as entry_item(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
  )
  select
    visible_rows.date_key::date as schedule_date,
    concat(visible_rows.row_key, '::schedule::', entry_items.ordinality::text) as schedule_item_id,
    current_profile.id as photographer_profile_id,
    current_profile.name as photographer_name,
    trim(entry_items.content) as schedule_content
  from visible_rows
  join entry_items on entry_items.month_key = visible_rows.month_key
    and entry_items.row_key = visible_rows.row_key
  join current_profile on visible_rows.photographer_name = current_profile.name
  where trim(entry_items.content) <> ''
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
  assignment_month as (
    select
      t.month_key,
      coalesce(t.entries, '{}'::jsonb) as entries,
      coalesce(t.rows, '{}'::jsonb) as rows,
      coalesce(sm.published_state, sm.draft_state) as schedule_state
    from public.team_lead_schedule_assignments t
    cross join allowed
    left join public.schedule_months sm on sm.month_key = t.month_key
    where allowed.ok
      and t.month_key = to_char(p_schedule_date, 'YYYY-MM')
  ),
  schedule_days as (
    select
      assignment_month.month_key,
      assignment_month.entries,
      assignment_month.rows,
      day_item.value as day_state
    from assignment_month
    cross join lateral jsonb_array_elements(coalesce(assignment_month.schedule_state -> 'days', '[]'::jsonb)) as day_item(value)
    where day_item.value ->> 'dateKey' = p_schedule_date::text
  ),
  base_rows as (
    select
      schedule_days.month_key,
      row_identity.date_key,
      row_identity.row_key,
      coalesce(
        nullif(trim(schedule_days.rows -> row_identity.date_key -> 'rowOverrides' -> row_identity.row_key ->> 'name'), ''),
        row_identity.base_name
      ) as photographer_name
    from schedule_days
    cross join lateral jsonb_each(coalesce(schedule_days.day_state -> 'assignments', '{}'::jsonb)) as assignment(category, names)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(assignment.names) = 'array' then assignment.names
        else '[]'::jsonb
      end
    ) with ordinality as person(name, ordinality)
    cross join lateral (
      select
        schedule_days.day_state ->> 'dateKey' as date_key,
        concat(
          schedule_days.day_state ->> 'dateKey',
          '::',
          assignment.category,
          '::',
          (person.ordinality - 1)::text,
          '::',
          person.name
        ) as row_key,
        trim(person.name) as base_name
    ) as row_identity
    where assignment.category <> '휴가'
      and assignment.category <> '제크'
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(schedule_days.rows -> row_identity.date_key -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = row_identity.row_key
      )
  ),
  custom_rows as (
    select
      assignment_month.month_key,
      row_identity.date_key,
      row_identity.row_key,
      trim(custom_row.value ->> 'name') as photographer_name
    from assignment_month
    cross join lateral jsonb_each(assignment_month.rows) as day_rows(date_key, value)
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(day_rows.value -> 'addedRows') = 'array' then day_rows.value -> 'addedRows'
        else '[]'::jsonb
      end
    ) as custom_row(value)
    cross join lateral (
      select
        day_rows.date_key,
        concat(day_rows.date_key, '::custom::', custom_row.value ->> 'id') as row_key
    ) as row_identity
    where day_rows.date_key = p_schedule_date::text
      and trim(custom_row.value ->> 'id') <> ''
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(day_rows.value -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = row_identity.row_key
      )
  ),
  visible_rows as (
    select * from base_rows
    union all
    select * from custom_rows
  ),
  entry_items as (
    select
      assignment_month.month_key,
      entry_item.key as row_key,
      schedule_item.content,
      schedule_item.ordinality
    from assignment_month
    cross join lateral jsonb_each(assignment_month.entries) as entry_item(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
  )
  select
    visible_rows.date_key::date as schedule_date,
    concat(visible_rows.row_key, '::schedule::', entry_items.ordinality::text) as schedule_item_id,
    photographer.id as photographer_profile_id,
    visible_rows.photographer_name as photographer_name,
    trim(entry_items.content) as schedule_content
  from visible_rows
  join entry_items on entry_items.month_key = visible_rows.month_key
    and entry_items.row_key = visible_rows.row_key
  left join public.profiles photographer
    on photographer.approved = true
   and photographer.name = visible_rows.photographer_name
  where trim(entry_items.content) <> ''
  order by photographer_name, schedule_item_id;
$$;

revoke execute on function public.get_my_schedule_assignment_items(text) from public, anon;
revoke execute on function public.get_partner_schedule_assignment_items(date) from public, anon;
grant execute on function public.get_my_schedule_assignment_items(text) to authenticated;
grant execute on function public.get_partner_schedule_assignment_items(date) to authenticated;
