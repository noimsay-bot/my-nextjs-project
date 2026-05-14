-- Rental TVU equipment management.
-- Run after supabase/incremental_equipment_loans.sql.

with rental_seed as (
  select
    'live'::text as category,
    'TVU'::text as group_name,
    concat('TVU', tvu_no)::text as name,
    concat('live-rental-tvu-', tvu_no)::text as code,
    (1100 + tvu_no)::integer as sort_order,
    jsonb_build_object(
      'kind', 'tvu',
      'rental', true,
      'rental_id', concat('TVU', tvu_no),
      'rental_number', tvu_no
    ) as metadata
  from generate_series(21, 40) as tvu_no
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
  false,
  metadata
from rental_seed
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = case
    when coalesce(public.equipment_items.metadata ->> 'rental_custom_name', 'false') = 'true'
      then public.equipment_items.name
    else excluded.name
  end,
  sort_order = excluded.sort_order,
  is_active = public.equipment_items.is_active,
  metadata = coalesce(public.equipment_items.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = timezone('utc', now());

create or replace function public.set_rental_tvu_items_active(
  p_equipment_item_ids uuid[],
  p_is_active boolean default true
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
  v_rental_count integer;
  v_updated_count integer := 0;
  v_is_active boolean := coalesce(p_is_active, true);
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'team_lead', 'admin') then
    raise exception '임대 장비 관리 권한이 없습니다.';
  end if;

  select count(distinct item_id)
  into v_requested_count
  from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '변경할 임대 장비를 선택해 주세요.';
  end if;

  select count(*)
  into v_rental_count
  from public.equipment_items
  where id in (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  )
    and category = 'live'
    and group_name = 'TVU'
    and coalesce(metadata ->> 'rental', 'false') = 'true';

  if v_rental_count <> v_requested_count then
    raise exception '임대 TVU 장비만 변경할 수 있습니다.';
  end if;

  if v_is_active = false and exists (
    select 1
    from public.equipment_loan_items
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    )
      and status = 'borrowed'
  ) then
    raise exception '대여중인 임대 장비는 비활성화할 수 없습니다.';
  end if;

  with requested_items as (
    select distinct item_id
    from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
  ),
  updated_items as (
    update public.equipment_items
    set
      is_active = v_is_active,
      metadata = jsonb_set(
        jsonb_set(
          coalesce(metadata, '{}'::jsonb),
          '{rental_updated_by}',
          to_jsonb(v_user_id::text),
          true
        ),
        '{rental_updated_at}',
        to_jsonb(v_now::text),
        true
      ),
      updated_at = v_now
    where id in (select item_id from requested_items)
      and category = 'live'
      and group_name = 'TVU'
      and coalesce(metadata ->> 'rental', 'false') = 'true'
      and is_active is distinct from v_is_active
    returning id
  )
  select count(*)
  into v_updated_count
  from updated_items;

  if v_updated_count <> v_requested_count then
    raise exception '이미 처리되었거나 변경할 수 없는 임대 장비가 포함되어 있습니다.';
  end if;

  if v_is_active = false then
    delete from public.live_equipment_status_board
    where equipment_item_id in (
      select distinct item_id
      from unnest(coalesce(p_equipment_item_ids, array[]::uuid[])) as item_id
    );
  end if;

  return coalesce(v_updated_count, 0);
end;
$$;

create or replace function public.rename_rental_tvu_item(
  p_equipment_item_id uuid,
  p_name text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_updated_count integer := 0;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'team_lead', 'admin') then
    raise exception '임대 장비 관리 권한이 없습니다.';
  end if;

  if p_equipment_item_id is null then
    raise exception '이름을 수정할 임대 장비를 선택해 주세요.';
  end if;

  if v_name is null then
    raise exception '임대 장비 이름을 입력해 주세요.';
  end if;

  if char_length(v_name) > 80 then
    raise exception '임대 장비 이름은 80자 이내로 입력해 주세요.';
  end if;

  update public.equipment_items
  set
    name = v_name,
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(metadata, '{}'::jsonb),
          '{rental_custom_name}',
          'true'::jsonb,
          true
        ),
        '{rental_updated_by}',
        to_jsonb(v_user_id::text),
        true
      ),
      '{rental_updated_at}',
      to_jsonb(v_now::text),
      true
    ),
    updated_at = v_now
  where id = p_equipment_item_id
    and category = 'live'
    and group_name = 'TVU'
    and coalesce(metadata ->> 'rental', 'false') = 'true';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception '이름을 수정할 임대 TVU 장비를 찾을 수 없습니다.';
  end if;

  return v_updated_count;
end;
$$;

revoke all on function public.set_rental_tvu_items_active(uuid[], boolean) from public;
revoke all on function public.rename_rental_tvu_item(uuid, text) from public;
grant execute on function public.set_rental_tvu_items_active(uuid[], boolean) to authenticated;
grant execute on function public.rename_rental_tvu_item(uuid, text) to authenticated;
