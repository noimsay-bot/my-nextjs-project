create or replace function public.get_home_current_trips(p_start_date date, p_end_date date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with recursive
  bounds as (
    select
      least(p_start_date, p_end_date) as start_date,
      greatest(p_start_date, p_end_date) as end_date
    where p_start_date is not null
      and p_end_date is not null
      and greatest(p_start_date, p_end_date) <= least(p_start_date, p_end_date) + 4000
  ),
  month_keys as (
    select to_char(month_start::date, 'YYYY-MM') as month_key
    from bounds
    cross join lateral generate_series(
      date_trunc('month', bounds.start_date)::date,
      date_trunc('month', bounds.end_date)::date,
      interval '1 month'
    ) as month_start
  ),
  current_profile as (
    select id
    from public.profiles
    where id = auth.uid()
      and approved = true
  ),
  target_schedule as (
    select schedule_months.month_key, schedule_months.published_state
    from public.schedule_months
    join month_keys on month_keys.month_key = schedule_months.month_key
    where schedule_months.published_state is not null
      and exists (select 1 from current_profile)
  ),
  target_assignment as (
    select team_lead_schedule_assignments.month_key, team_lead_schedule_assignments.entries, team_lead_schedule_assignments.rows
    from public.team_lead_schedule_assignments
    join month_keys on month_keys.month_key = team_lead_schedule_assignments.month_key
  ),
  target_day as (
    select
      target_schedule.month_key,
      day.value as day,
      day.value->>'dateKey' as date_key
    from target_schedule
    cross join bounds
    cross join lateral jsonb_array_elements(coalesce(target_schedule.published_state->'days', '[]'::jsonb)) as day(value)
    where day.value->>'dateKey' between to_char(bounds.start_date, 'YYYY-MM-DD') and to_char(bounds.end_date, 'YYYY-MM-DD')
      and day.value->>'dateKey' like target_schedule.month_key || '-%'
  ),
  base_rows as (
    select
      target_day.month_key,
      target_day.date_key,
      person.name,
      target_day.date_key || '::' || category.key || '::' || (person.ordinality - 1)::text || '::' || person.name as row_key
    from target_day
    cross join lateral jsonb_each(coalesce(target_day.day->'assignments', '{}'::jsonb)) as category(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(category.value, '[]'::jsonb)) with ordinality as person(name, ordinality)
    where category.key not in ('휴가', '제크')
  ),
  added_rows as (
    select
      target_day.month_key,
      target_day.date_key,
      coalesce(added.value->>'name', '') as name,
      target_day.date_key || '::custom::' || coalesce(added.value->>'id', '') as row_key
    from target_day
    left join target_assignment on target_assignment.month_key = target_day.month_key
    cross join lateral jsonb_array_elements(coalesce(target_assignment.rows->target_day.date_key->'addedRows', '[]'::jsonb)) as added(value)
  ),
  visible_rows as (
    select
      visible.name,
      visible.date_key,
      visible.row_key,
      visible.entry,
      coalesce(visible.entry->'schedules', '[]'::jsonb) as schedules,
      row_number() over (partition by visible.name order by visible.date_key, visible.row_key) as rn
    from (
      select
        rows.month_key,
        rows.date_key,
        rows.row_key,
        coalesce(
          target_assignment.rows->rows.date_key->'rowOverrides'->rows.row_key->>'name',
          rows.name
        ) as name,
        target_assignment.entries->rows.row_key as entry,
        target_assignment.rows as assignment_rows
      from (
        select * from base_rows
        union all
        select * from added_rows
      ) rows
      left join target_assignment on target_assignment.month_key = rows.month_key
    ) visible
    where coalesce(visible.name, '') <> ''
      and not (coalesce(visible.assignment_rows->visible.date_key->'deletedRowKeys', '[]'::jsonb) ? visible.row_key)
  ),
  trip_state as (
    select
      v.name,
      v.rn,
      v.date_key,
      v.row_key,
      v.schedules,
      next_active.active_id as active_id,
      next_active.active_label as active_label,
      next_active.active_travel as active_travel,
      trip_for_day.trip_id,
      trip_for_day.trip_label,
      trip_for_day.trip_travel
    from visible_rows v
    cross join lateral (
      select
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagId', '')
          else null
        end as explicit_id,
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagLabel', '')
          else null
        end as explicit_label,
        coalesce(nullif(v.entry->>'travelType', ''), '') as explicit_travel,
        coalesce(nullif(v.entry->>'tripTagPhase', ''), '') as explicit_phase
    ) explicit
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or explicit.explicit_phase = 'ongoing')
            then explicit.explicit_id
          else null
        end as active_id,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or explicit.explicit_phase = 'ongoing')
            then explicit.explicit_label
          else null
        end as active_label,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or explicit.explicit_phase = 'ongoing')
            then explicit.explicit_travel
          else null
        end as active_travel
    ) active_before_return
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_id
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_id
          else null
        end as trip_id,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_label
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_label
          else null
        end as trip_label,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_travel
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_travel
          else null
        end as trip_travel
    ) trip_for_day
    cross join lateral (
      select
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_id
        end as active_id,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_label
        end as active_label,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_travel
        end as active_travel
    ) next_active
    where v.rn = 1

    union all

    select
      v.name,
      v.rn,
      v.date_key,
      v.row_key,
      v.schedules,
      next_active.active_id as active_id,
      next_active.active_label as active_label,
      next_active.active_travel as active_travel,
      trip_for_day.trip_id,
      trip_for_day.trip_label,
      trip_for_day.trip_travel
    from trip_state previous
    join visible_rows v on v.name = previous.name and v.rn = previous.rn + 1
    cross join lateral (
      select
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagId', '')
          else null
        end as explicit_id,
        case when nullif(v.entry->>'tripTagId', '') is not null and nullif(v.entry->>'tripTagLabel', '') is not null
          then nullif(v.entry->>'tripTagLabel', '')
          else null
        end as explicit_label,
        coalesce(nullif(v.entry->>'travelType', ''), previous.active_travel, '') as explicit_travel,
        coalesce(nullif(v.entry->>'tripTagPhase', ''), '') as explicit_phase
    ) explicit
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or (explicit.explicit_phase = 'ongoing' and previous.active_id is null))
            then explicit.explicit_id
          when previous.active_id is not null and explicit.explicit_id = previous.active_id
            then previous.active_id
          else previous.active_id
        end as active_id,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or (explicit.explicit_phase = 'ongoing' and previous.active_id is null))
            then explicit.explicit_label
          when previous.active_id is not null and explicit.explicit_id = previous.active_id
            then explicit.explicit_label
          else previous.active_label
        end as active_label,
        case
          when explicit.explicit_id is not null
            and (explicit.explicit_phase = 'departure' or (explicit.explicit_phase = 'ongoing' and previous.active_id is null))
            then explicit.explicit_travel
          when previous.active_id is not null and explicit.explicit_id = previous.active_id
            then coalesce(nullif(explicit.explicit_travel, ''), previous.active_travel)
          else previous.active_travel
        end as active_travel
    ) active_before_return
    cross join lateral (
      select
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_id
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_id
          when active_before_return.active_id is not null
            and coalesce(explicit.explicit_id, active_before_return.active_id) = active_before_return.active_id
            then active_before_return.active_id
          else null
        end as trip_id,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_label
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_label
          when active_before_return.active_id is not null
            and coalesce(explicit.explicit_id, active_before_return.active_id) = active_before_return.active_id
            then active_before_return.active_label
          else null
        end as trip_label,
        case
          when explicit.explicit_id is not null and explicit.explicit_travel = '당일출장' then explicit.explicit_travel
          when explicit.explicit_id is not null and explicit.explicit_phase in ('departure', 'ongoing') then active_before_return.active_travel
          when active_before_return.active_id is not null
            and coalesce(explicit.explicit_id, active_before_return.active_id) = active_before_return.active_id
            then active_before_return.active_travel
          else null
        end as trip_travel
    ) trip_for_day
    cross join lateral (
      select
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_id
        end as active_id,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_label
        end as active_label,
        case
          when explicit.explicit_phase = 'return'
            and active_before_return.active_id is not null
            and explicit.explicit_id = active_before_return.active_id
            then null
          else active_before_return.active_travel
        end as active_travel
    ) next_active
  ),
  trip_groups as (
    select distinct name, trip_id
    from trip_state
    where trip_id is not null
      and coalesce(trip_travel, '') <> ''
  ),
  trip_items as (
    select
      trip_groups.name,
      jsonb_build_object(
        'tripTagId', trip_groups.trip_id,
        'tripTagLabel', coalesce(latest.trip_label, '출장명 없음'),
        'travelType', coalesce(latest.trip_travel, ''),
        'startDateKey', dates.start_date_key,
        'endDateKey', dates.end_date_key,
        'dayCount', dates.day_count,
        'dateKeys', dates.date_keys,
        'duties', '[]'::jsonb,
        'schedules', coalesce(schedules.schedules, '[]'::jsonb)
      ) as item
    from trip_groups
    cross join lateral (
      select
        min(date_key) as start_date_key,
        max(date_key) as end_date_key,
        count(distinct date_key) as day_count,
        coalesce(jsonb_agg(date_key order by date_key), '[]'::jsonb) as date_keys
      from (
        select distinct date_key
        from trip_state
        where name = trip_groups.name
          and trip_id = trip_groups.trip_id
          and coalesce(trip_travel, '') <> ''
      ) distinct_dates
    ) dates
    cross join lateral (
      select trip_label, trip_travel
      from trip_state
      where name = trip_groups.name
        and trip_id = trip_groups.trip_id
        and coalesce(trip_travel, '') <> ''
      order by date_key desc, row_key desc
      limit 1
    ) latest
    cross join lateral (
      select jsonb_agg(schedule_text order by first_date_key, first_row_key, schedule_text) as schedules
      from (
        select
          schedule_text.value as schedule_text,
          min(trip_state.date_key) as first_date_key,
          min(trip_state.row_key) as first_row_key
        from trip_state
        cross join lateral jsonb_array_elements_text(trip_state.schedules) as schedule_text(value)
        where trip_state.name = trip_groups.name
          and trip_state.trip_id = trip_groups.trip_id
          and coalesce(trip_state.trip_travel, '') <> ''
          and schedule_text.value <> ''
        group by schedule_text.value
      ) distinct_schedules
    ) schedules
  ),
  cards as (
    select jsonb_build_object(
      'name', name,
      'items', jsonb_agg(item order by item->>'startDateKey')
    ) as card
    from trip_items
    group by name
  )
  select coalesce(jsonb_agg(card order by card->>'name'), '[]'::jsonb)
  from cards;
$$;

revoke execute on function public.get_home_current_trips(date, date) from public, anon;
grant execute on function public.get_home_current_trips(date, date) to authenticated;

create or replace function public.get_home_current_trips()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_home_current_trips(
    ((now() at time zone 'Asia/Seoul')::date - 3650),
    ((now() at time zone 'Asia/Seoul')::date + 7)
  );
$$;

revoke execute on function public.get_home_current_trips() from public, anon;
grant execute on function public.get_home_current_trips() to authenticated;
