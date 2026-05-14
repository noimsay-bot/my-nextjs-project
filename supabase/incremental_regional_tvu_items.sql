-- Regional TVU transmission equipment.
-- Run after supabase/incremental_equipment_loans.sql.

with regional_seed as (
  select
    'live'::text as category,
    'TVU'::text as group_name,
    concat('TVU-', tvu_no)::text as name,
    concat('live-regional-tvu-', tvu_no)::text as code,
    (1060 + display_order)::integer as sort_order,
    jsonb_build_object(
      'kind', 'tvu',
      'regional_transmission', true,
      'regional_id', concat('TVU-', tvu_no),
      'regional_number', tvu_no,
      'borrowable', false
    ) as metadata
  from (
    values
      (7, 1),
      (8, 2),
      (9, 3),
      (10, 4),
      (11, 5),
      (12, 6),
      (13, 7),
      (61, 8)
  ) as tvu(tvu_no, display_order)
)
insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  is_active,
  metadata
)
select
  category,
  group_name,
  name,
  code,
  sort_order,
  true,
  metadata
from regional_seed
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  metadata = coalesce(public.equipment_items.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = timezone('utc', now());

create or replace function public.borrow_equipment_items(
  p_equipment_item_ids uuid[],
  p_loan_type text default 'normal',
  p_live_trs text default null,
  p_live_camera_reporter text default null,
  p_live_audio_man text default null,
  p_live_location text default null,
  p_live_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_requested_count integer;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() = 'observer' then
    raise exception '장비 대여 권한이 없습니다.';
  end if;

  if coalesce(p_loan_type, 'normal') not in ('normal', 'live', 'eng_set') then
    raise exception '지원하지 않는 장비 대여 유형입니다.';
  end if;

  select count(distinct item_id)
  into v_requested_count
  from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '대여할 장비를 선택해 주세요.';
  end if;

  select count(*)
  into v_active_count
  from public.equipment_items
  where id in (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  )
    and is_active = true
    and coalesce(metadata ->> 'is_under_repair', 'false') <> 'true'
    and coalesce(metadata ->> 'borrowable', 'true') <> 'false';

  if v_active_count <> v_requested_count then
    raise exception '대여할 수 없는 장비가 포함되어 있습니다.';
  end if;

  if exists (
    select 1
    from public.equipment_loan_items
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    )
      and status = 'borrowed'
  ) then
    raise exception '이미 대여중인 장비가 포함되어 있습니다.';
  end if;

  insert into public.equipment_loans (
    borrower_profile_id,
    borrowed_at,
    status,
    loan_type,
    live_trs,
    live_camera_reporter,
    live_audio_man,
    live_location,
    live_note
  )
  values (
    v_user_id,
    v_now,
    'borrowed',
    coalesce(p_loan_type, 'normal'),
    nullif(trim(coalesce(p_live_trs, '')), ''),
    nullif(trim(coalesce(p_live_camera_reporter, '')), ''),
    nullif(trim(coalesce(p_live_audio_man, '')), ''),
    nullif(trim(coalesce(p_live_location, '')), ''),
    nullif(trim(coalesce(p_live_note, '')), '')
  )
  returning id into v_loan_id;

  begin
    insert into public.equipment_loan_items (
      loan_id,
      equipment_item_id,
      borrowed_at,
      status
    )
    select
      v_loan_id,
      item_id,
      v_now,
      'borrowed'
    from (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    ) requested_items;
  exception
    when unique_violation then
      raise exception '이미 대여중인 장비가 포함되어 있습니다.';
  end;

  return v_loan_id;
end;
$$;

create or replace function public.set_equipment_items_repair_status(
  p_equipment_item_ids uuid[],
  p_is_under_repair boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_requested_count integer;
  v_updated_count integer := 0;
  v_is_under_repair boolean := coalesce(p_is_under_repair, true);
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'admin', 'team_lead') then
    raise exception '장비 수리 처리 권한이 없습니다.';
  end if;

  select count(distinct item_id)
  into v_requested_count
  from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '수리 처리할 장비를 선택해 주세요.';
  end if;

  if v_is_under_repair and exists (
    select 1
    from public.equipment_loan_items
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    )
      and status = 'borrowed'
  ) then
    raise exception '대여중인 장비는 수리 처리할 수 없습니다.';
  end if;

  with requested_items as (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  ),
  updated_items as (
    update public.equipment_items
    set
      metadata = jsonb_set(
        jsonb_set(
          case
            when v_is_under_repair
              then jsonb_set(coalesce(metadata, '{}'::jsonb), '{is_under_repair}', 'true'::jsonb, true)
            else coalesce(metadata, '{}'::jsonb) - 'is_under_repair'
          end,
          '{repair_updated_by}',
          to_jsonb(v_user_id::text),
          true
        ),
        '{repair_updated_at}',
        to_jsonb(v_now::text),
        true
      ),
      updated_at = v_now
    where id in (select item_id from requested_items)
      and is_active = true
    returning id
  )
  select count(*)
  into v_updated_count
  from updated_items;

  if v_updated_count <> v_requested_count then
    raise exception '수리 처리할 수 없는 장비가 포함되어 있습니다.';
  end if;

  return coalesce(v_updated_count, 0);
end;
$$;

revoke execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) from public, anon;
revoke execute on function public.set_equipment_items_repair_status(uuid[], boolean) from public, anon;
grant execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) to authenticated;
grant execute on function public.set_equipment_items_repair_status(uuid[], boolean) to authenticated;
