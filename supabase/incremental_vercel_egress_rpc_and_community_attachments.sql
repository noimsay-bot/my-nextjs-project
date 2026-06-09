-- Vercel Fast Origin Transfer 절감용 read/RPC 및 커뮤니티 첨부 Storage 정책.

insert into storage.buckets (id, name, public, file_size_limit)
values ('home-community-attachments', 'home-community-attachments', false, 6291456)
on conflict (id) do update
set public = false,
    file_size_limit = 6291456;

drop policy if exists "home_community_attachments_select_approved" on storage.objects;
create policy "home_community_attachments_select_approved"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'home-community-attachments'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.approved = true
  )
);

drop policy if exists "home_community_attachments_insert_own" on storage.objects;
create policy "home_community_attachments_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'home-community-attachments'
  and (storage.foldername(name))[1] = 'community'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.approved = true
      and profiles.role::text <> 'observer'
  )
);

drop policy if exists "home_community_attachments_delete_own_or_privileged" on storage.objects;
create policy "home_community_attachments_delete_own_or_privileged"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'home-community-attachments'
  and exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.approved = true
      and (
        (storage.foldername(name))[2] = auth.uid()::text
        or profiles.role::text in ('desk', 'team_lead', 'admin')
      )
  )
);

create or replace function public.get_my_work_calendar(p_month_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with current_profile as (
    select id, regexp_replace(coalesce(name, ''), '\s+', '', 'g') as normalized_name
    from public.profiles
    where id = auth.uid()
      and approved = true
  ),
  target_month as (
    select month_key, published_state, published_at
    from public.schedule_months
    where month_key = p_month_key
      and published_state is not null
      and exists (select 1 from current_profile)
  ),
  month_days as (
    select
      target_month.month_key,
      target_month.published_at,
      day.value as day
    from target_month
    cross join lateral jsonb_array_elements(coalesce(target_month.published_state->'days', '[]'::jsonb)) as day(value)
    where day.value->>'dateKey' like p_month_key || '-%'
  ),
  day_rows as (
    select
      day->>'dateKey' as date_key,
      coalesce((day->>'isWeekend')::boolean, false) as is_weekend,
      coalesce((day->>'isHoliday')::boolean, false) as is_holiday,
      coalesce((day->>'isCustomHoliday')::boolean, false) as is_custom_holiday,
      coalesce((day->>'isWeekdayHoliday')::boolean, false) as is_weekday_holiday,
      day
    from month_days
  ),
  header_events as (
    select jsonb_build_object(
      'id', date_key || ':header',
      'dateKey', date_key,
      'category', '데스크',
      'label', '데스크',
      'displayLabel', '데스크',
      'name', day->>'headerName',
      'nameLabel', day->>'headerName',
      'nameTag', null
    ) as event,
    date_key,
    0 as display_rank,
    '데스크' as label
    from day_rows
    where regexp_replace(coalesce(day->>'headerName', ''), '\s+', '', 'g') = (select normalized_name from current_profile)
  ),
  assignment_events as (
    select jsonb_build_object(
      'id', day_rows.date_key || ':' || category.key || ':' || (person.ordinality - 1)::text || ':' || person.name,
      'dateKey', day_rows.date_key,
      'category', category.key,
      'label', label.value,
      'displayLabel', label.value || coalesce(tag.label, ''),
      'name', comparable.value,
      'nameLabel', comparable.value || coalesce(tag.label, ''),
      'nameTag', tag.value
    ) as event,
    day_rows.date_key,
    case
      when category.key = '조근' then 1
      when category.key in ('일반', '주말일반근무') then 2
      when category.key = '연장' then 3
      when category.key = '석근' then 4
      when category.key = '야근' then 5
      when category.key = '제크' then 6
      when category.key = '휴가' then 7
      when category.key = '국회' then 8
      when category.key = '청사' then 9
      when category.key = '청와대' then 10
      when category.key = '주말조근' then 11
      when category.key = '뉴스대기' then 13
      else 99
    end as display_rank,
    label.value as label
    from day_rows
    cross join lateral jsonb_each(coalesce(day_rows.day->'assignments', '{}'::jsonb)) as category(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(category.value, '[]'::jsonb)) with ordinality as person(name, ordinality)
    cross join lateral (
      select case
        when category.key = '휴가' then regexp_replace(person.name, '^(연차|대휴|etc|기타|공가|근속휴가|건강검진|경조)\s*:(.+)$', '\2')
        else person.name
      end as value
    ) as comparable
    cross join lateral (
      select coalesce(
        nullif(day_rows.day->'assignmentLabelOverrides'->>category.key, ''),
        case
          when category.key = '주말조근' then '조근'
          when category.key = '주말일반근무' then '일반'
          else category.key
        end
      ) as value
    ) as label
    cross join lateral (
      select
        case day_rows.day->'assignmentNameTags'->>(category.key || '::' || comparable.value)
          when 'gov' then 'gov'
          when 'law' then 'law'
          when 'half' then 'half'
          when 'city' then 'city'
          when 'office' then 'office'
          else null
        end as value,
        case day_rows.day->'assignmentNameTags'->>(category.key || '::' || comparable.value)
          when 'gov' then '(국)'
          when 'law' then '(법)'
          when 'half' then '(반)'
          when 'city' then '(시)'
          when 'office' then '(청)'
          else ''
        end as label
    ) as tag
    where regexp_replace(comparable.value, '\s+', '', 'g') = (select normalized_name from current_profile)
      and not (
        label.value = '일반'
        and not (day_rows.is_weekend or day_rows.is_holiday or day_rows.is_custom_holiday or day_rows.is_weekday_holiday)
      )
  ),
  all_events as (
    select * from header_events
    union all
    select * from assignment_events
  )
  select jsonb_build_object(
    'monthKey', p_month_key,
    'publishedAt', coalesce((select published_at::text from target_month limit 1), ''),
    'days', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'dateKey', date_key,
            'isWeekend', is_weekend,
            'isHoliday', is_holiday,
            'isCustomHoliday', is_custom_holiday,
            'isWeekdayHoliday', is_weekday_holiday
          )
          order by date_key
        )
        from day_rows
      ),
      '[]'::jsonb
    ),
    'events', coalesce(
      (
        select jsonb_agg(event order by date_key, display_rank, label)
        from all_events
      ),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_my_work_calendar(text) from public, anon;
grant execute on function public.get_my_work_calendar(text) to authenticated;

create or replace function public.get_home_current_trips()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with current_profile as (
    select id
    from public.profiles
    where id = auth.uid()
      and approved = true
  ),
  today_meta as (
    select
      to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as date_key,
      to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM') as month_key
  ),
  target_schedule as (
    select schedule_months.month_key, schedule_months.published_state
    from public.schedule_months
    join today_meta on today_meta.month_key = schedule_months.month_key
    where schedule_months.published_state is not null
      and exists (select 1 from current_profile)
  ),
  target_assignment as (
    select team_lead_schedule_assignments.month_key, team_lead_schedule_assignments.entries, team_lead_schedule_assignments.rows
    from public.team_lead_schedule_assignments
    join today_meta on today_meta.month_key = team_lead_schedule_assignments.month_key
  ),
  target_day as (
    select day.value as day, today_meta.date_key
    from target_schedule
    join today_meta on true
    cross join lateral jsonb_array_elements(coalesce(target_schedule.published_state->'days', '[]'::jsonb)) as day(value)
    where day.value->>'dateKey' = today_meta.date_key
  ),
  base_rows as (
    select
      target_day.date_key,
      category.key as category,
      person.name,
      (person.ordinality - 1) as index,
      target_day.date_key || '::' || category.key || '::' || (person.ordinality - 1)::text || '::' || person.name as row_key
    from target_day
    cross join lateral jsonb_each(coalesce(target_day.day->'assignments', '{}'::jsonb)) as category(key, value)
    cross join lateral jsonb_array_elements_text(coalesce(category.value, '[]'::jsonb)) with ordinality as person(name, ordinality)
    where category.key not in ('휴가', '제크')
  ),
  added_rows as (
    select
      target_day.date_key,
      'custom' as category,
      coalesce(added.value->>'name', '') as name,
      0 as index,
      target_day.date_key || '::custom::' || coalesce(added.value->>'id', '') as row_key
    from target_day
    left join target_assignment on true
    cross join lateral jsonb_array_elements(coalesce(target_assignment.rows->target_day.date_key->'addedRows', '[]'::jsonb)) as added(value)
  ),
  visible_rows as (
    select
      rows.date_key,
      rows.row_key,
      coalesce(
        target_assignment.rows->rows.date_key->'rowOverrides'->rows.row_key->>'name',
        rows.name
      ) as name,
      target_assignment.entries->rows.row_key as entry
    from (
      select * from base_rows
      union all
      select * from added_rows
    ) rows
    left join target_assignment on true
    where coalesce(rows.name, '') <> ''
      and not coalesce(target_assignment.rows->rows.date_key->'deletedRowKeys', '[]'::jsonb) ? rows.row_key
  ),
  trip_rows as (
    select
      name,
      date_key,
      row_key,
      coalesce(nullif(entry->>'tripTagId', ''), row_key) as trip_tag_id,
      coalesce(nullif(entry->>'tripTagLabel', ''), '출장명 없음') as trip_tag_label,
      entry->>'travelType' as travel_type,
      coalesce(entry->'schedules', '[]'::jsonb) as schedules
    from visible_rows
    where entry->>'travelType' in ('국내출장', '해외출장')
  ),
  trip_items as (
    select
      name,
      trip_tag_id,
      jsonb_build_object(
        'tripTagId', trip_tag_id,
        'tripTagLabel', max(trip_tag_label),
        'travelType', max(travel_type),
        'startDateKey', min(date_key),
        'endDateKey', max(date_key),
        'dayCount', count(distinct date_key),
        'dateKeys', jsonb_agg(distinct date_key),
        'duties', '[]'::jsonb,
        'schedules', coalesce(jsonb_agg(distinct schedule_text.value) filter (where schedule_text.value <> ''), '[]'::jsonb)
      ) as item
    from trip_rows
    left join lateral jsonb_array_elements_text(schedules) as schedule_text(value) on true
    group by name, trip_tag_id
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

revoke execute on function public.get_home_current_trips() from public, anon;
grant execute on function public.get_home_current_trips() to authenticated;

create or replace function public.get_portal_support_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with current_profile as (
    select id, role
    from public.profiles
    where id = auth.uid()
      and approved = true
  ),
  feedback as (
    select customer_support_messages.*
    from public.customer_support_messages
    where requester_id = auth.uid()
      and status = 'processed'
      and feedback_seen_at is null
    order by processed_at desc nulls last
    limit 1
  )
  select jsonb_build_object(
    'openCount',
    case
      when (select role from current_profile) in ('admin', 'team_lead')
        then (
          select count(*)::int
          from public.customer_support_messages
          where coalesce(status, 'open') <> 'processed'
        )
      else 0
    end,
    'feedbackNotification',
    (
      select jsonb_build_object(
        'id', id,
        'body', body,
        'processedAt', processed_at,
        'processedFeedback', nullif(trim(coalesce(processed_feedback, '')), ''),
        'createdAt', created_at
      )
      from feedback
    )
  )
  where exists (select 1 from current_profile);
$$;

revoke execute on function public.get_portal_support_summary() from public, anon;
grant execute on function public.get_portal_support_summary() to authenticated;
