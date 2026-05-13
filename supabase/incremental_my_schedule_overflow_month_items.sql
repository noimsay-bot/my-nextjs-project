-- Purpose: Include schedule-assignment items whose actual date belongs to the requested month
-- even when the row is stored in an adjacent month schedule as an overflow calendar day.

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
      and role <> 'partner'
      and role <> 'observer'
  ),
  requested_month as (
    select trim(coalesce(p_month_key, '')) as month_key
  ),
  requested_window as (
    select
      requested_month.month_key,
      (requested_month.month_key || '-01')::date as first_day
    from requested_month
    where requested_month.month_key ~ '^\d{4}-\d{2}$'
  ),
  assignment_month as (
    select
      t.month_key,
      coalesce(t.entries, '{}'::jsonb) as entries,
      coalesce(t.rows, '{}'::jsonb) as rows,
      requested_window.month_key as requested_month_key
    from public.team_lead_schedule_assignments t
    join requested_window on t.month_key in (
      to_char(requested_window.first_day - interval '1 month', 'YYYY-MM'),
      requested_window.month_key,
      to_char(requested_window.first_day + interval '1 month', 'YYYY-MM')
    )
  ),
  entry_items as (
    select
      assignment_month.month_key,
      assignment_month.requested_month_key,
      assignment_month.rows,
      entry_item.key as row_key,
      schedule_item.content,
      schedule_item.ordinality
    from assignment_month
    cross join lateral jsonb_each(assignment_month.entries) as entry_item(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
  ),
  parsed_entry_items as (
    select
      entry_items.month_key,
      entry_items.rows,
      entry_items.row_key,
      entry_items.ordinality,
      split_part(entry_items.row_key, '::', 1) as date_key,
      split_part(entry_items.row_key, '::', 2) as row_type,
      split_part(entry_items.row_key, '::', 3) as row_ref,
      nullif(trim(split_part(entry_items.row_key, '::', 4)), '') as base_name,
      trim(entry_items.content) as schedule_content
    from entry_items
    where split_part(entry_items.row_key, '::', 1) like entry_items.requested_month_key || '-__'
      and split_part(entry_items.row_key, '::', 1) ~ '^\d{4}-\d{2}-\d{2}$'
      and split_part(entry_items.row_key, '::', 2) <> '휴가'
      and split_part(entry_items.row_key, '::', 2) <> '제크'
      and trim(entry_items.content) <> ''
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(entry_items.rows -> split_part(entry_items.row_key, '::', 1) -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = entry_items.row_key
      )
  ),
  visible_items as (
    select
      parsed_entry_items.date_key,
      parsed_entry_items.row_key,
      parsed_entry_items.ordinality,
      parsed_entry_items.schedule_content,
      coalesce(
        nullif(trim(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'rowOverrides' -> parsed_entry_items.row_key ->> 'name'), ''),
        nullif(trim(custom_row.value ->> 'name'), ''),
        parsed_entry_items.base_name
      ) as photographer_name
    from parsed_entry_items
    left join lateral jsonb_array_elements(
      case
        when parsed_entry_items.row_type = 'custom'
          and jsonb_typeof(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows') = 'array'
          then parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows'
        else '[]'::jsonb
      end
    ) as custom_row(value)
      on parsed_entry_items.row_type = 'custom'
     and custom_row.value ->> 'id' = parsed_entry_items.row_ref
  )
  select
    visible_items.date_key::date as schedule_date,
    concat(visible_items.row_key, '::schedule::', visible_items.ordinality::text) as schedule_item_id,
    current_profile.id as photographer_profile_id,
    current_profile.name as photographer_name,
    visible_items.schedule_content as schedule_content
  from visible_items
  join current_profile on visible_items.photographer_name = current_profile.name
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
      and public.current_profile_role() = 'partner' as ok
  ),
  target_date as (
    select
      p_schedule_date as schedule_date,
      to_char(p_schedule_date, 'YYYY-MM') as month_key,
      date_trunc('month', p_schedule_date)::date as first_day
    where p_schedule_date is not null
  ),
  assignment_month as (
    select
      t.month_key,
      coalesce(t.entries, '{}'::jsonb) as entries,
      coalesce(t.rows, '{}'::jsonb) as rows,
      target_date.schedule_date
    from public.team_lead_schedule_assignments t
    cross join allowed
    join target_date on t.month_key in (
      to_char(target_date.first_day - interval '1 month', 'YYYY-MM'),
      target_date.month_key,
      to_char(target_date.first_day + interval '1 month', 'YYYY-MM')
    )
    where allowed.ok
  ),
  entry_items as (
    select
      assignment_month.month_key,
      assignment_month.rows,
      assignment_month.schedule_date,
      entry_item.key as row_key,
      schedule_item.content,
      schedule_item.ordinality
    from assignment_month
    cross join lateral jsonb_each(assignment_month.entries) as entry_item(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(entry_item.value -> 'schedules', '[]'::jsonb)) with ordinality as schedule_item(content, ordinality)
  ),
  parsed_entry_items as (
    select
      entry_items.month_key,
      entry_items.rows,
      entry_items.row_key,
      entry_items.ordinality,
      split_part(entry_items.row_key, '::', 1) as date_key,
      split_part(entry_items.row_key, '::', 2) as row_type,
      split_part(entry_items.row_key, '::', 3) as row_ref,
      nullif(trim(split_part(entry_items.row_key, '::', 4)), '') as base_name,
      trim(entry_items.content) as schedule_content
    from entry_items
    where split_part(entry_items.row_key, '::', 1) = entry_items.schedule_date::text
      and split_part(entry_items.row_key, '::', 1) ~ '^\d{4}-\d{2}-\d{2}$'
      and split_part(entry_items.row_key, '::', 2) <> '휴가'
      and split_part(entry_items.row_key, '::', 2) <> '제크'
      and trim(entry_items.content) <> ''
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(entry_items.rows -> split_part(entry_items.row_key, '::', 1) -> 'deletedRowKeys', '[]'::jsonb)) as deleted(row_key)
        where deleted.row_key = entry_items.row_key
      )
  ),
  visible_items as (
    select
      parsed_entry_items.date_key,
      parsed_entry_items.row_key,
      parsed_entry_items.ordinality,
      parsed_entry_items.schedule_content,
      coalesce(
        nullif(trim(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'rowOverrides' -> parsed_entry_items.row_key ->> 'name'), ''),
        nullif(trim(custom_row.value ->> 'name'), ''),
        parsed_entry_items.base_name
      ) as photographer_name
    from parsed_entry_items
    left join lateral jsonb_array_elements(
      case
        when parsed_entry_items.row_type = 'custom'
          and jsonb_typeof(parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows') = 'array'
          then parsed_entry_items.rows -> parsed_entry_items.date_key -> 'addedRows'
        else '[]'::jsonb
      end
    ) as custom_row(value)
      on parsed_entry_items.row_type = 'custom'
     and custom_row.value ->> 'id' = parsed_entry_items.row_ref
  )
  select
    visible_items.date_key::date as schedule_date,
    concat(visible_items.row_key, '::schedule::', visible_items.ordinality::text) as schedule_item_id,
    photographer.id as photographer_profile_id,
    visible_items.photographer_name as photographer_name,
    visible_items.schedule_content as schedule_content
  from visible_items
  left join public.profiles photographer
    on photographer.approved = true
   and photographer.name = visible_items.photographer_name
  where visible_items.photographer_name is not null
  order by photographer_name, schedule_item_id;
$$;

revoke execute on function public.get_my_schedule_assignment_items(text) from public, anon;
revoke execute on function public.get_partner_schedule_assignment_items(date) from public, anon;
grant execute on function public.get_my_schedule_assignment_items(text) to authenticated;
grant execute on function public.get_partner_schedule_assignment_items(date) to authenticated;
