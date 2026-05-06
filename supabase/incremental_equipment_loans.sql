-- Purpose: Add equipment rental inventory, loans, RLS, RPC mutations, and idempotent seed data.
-- Impact: Approved portal users can read equipment status/history; non-observer users can borrow/return their own loans; team_lead/admin can correct all.

create table if not exists public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('camera_lens', 'light', 'eng_set', 'live')),
  group_name text not null,
  name text not null,
  code text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists equipment_items_category_sort_idx
on public.equipment_items (category, sort_order, name);

drop trigger if exists set_equipment_items_updated_at on public.equipment_items;
create trigger set_equipment_items_updated_at
before update on public.equipment_items
for each row
execute function public.set_updated_at();

create table if not exists public.equipment_loans (
  id uuid primary key default gen_random_uuid(),
  borrower_profile_id uuid not null references public.profiles (id) on delete restrict,
  borrowed_at timestamptz not null default timezone('utc', now()),
  returned_at timestamptz,
  status text not null default 'borrowed' check (status in ('borrowed', 'returned')),
  loan_type text not null default 'normal' check (loan_type in ('normal', 'live', 'eng_set')),
  live_trs text,
  live_camera_reporter text,
  live_audio_man text,
  live_location text,
  live_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists equipment_loans_borrower_status_idx
on public.equipment_loans (borrower_profile_id, status, borrowed_at desc);

create index if not exists equipment_loans_status_borrowed_at_idx
on public.equipment_loans (status, borrowed_at desc);

drop trigger if exists set_equipment_loans_updated_at on public.equipment_loans;
create trigger set_equipment_loans_updated_at
before update on public.equipment_loans
for each row
execute function public.set_updated_at();

create table if not exists public.equipment_loan_items (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.equipment_loans (id) on delete cascade,
  equipment_item_id uuid not null references public.equipment_items (id) on delete restrict,
  borrowed_at timestamptz not null default timezone('utc', now()),
  returned_at timestamptz,
  status text not null default 'borrowed' check (status in ('borrowed', 'returned'))
);

create index if not exists equipment_loan_items_loan_idx
on public.equipment_loan_items (loan_id);

create index if not exists equipment_loan_items_item_status_idx
on public.equipment_loan_items (equipment_item_id, status);

create index if not exists equipment_loan_items_borrowed_at_idx
on public.equipment_loan_items (borrowed_at desc);

create unique index if not exists equipment_loan_items_active_item_uidx
on public.equipment_loan_items (equipment_item_id)
where status = 'borrowed';

alter table public.equipment_items enable row level security;
alter table public.equipment_loans enable row level security;
alter table public.equipment_loan_items enable row level security;

drop policy if exists "equipment_items_select_approved" on public.equipment_items;
create policy "equipment_items_select_approved"
on public.equipment_items
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "equipment_items_manage_admin" on public.equipment_items;
create policy "equipment_items_manage_admin"
on public.equipment_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "equipment_loans_select_approved" on public.equipment_loans;
create policy "equipment_loans_select_approved"
on public.equipment_loans
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "equipment_loans_insert_own" on public.equipment_loans;
create policy "equipment_loans_insert_own"
on public.equipment_loans
for insert
to authenticated
with check (
  public.current_profile_approved() = true
  and public.current_profile_role() <> 'observer'
  and borrower_profile_id = auth.uid()
  and status = 'borrowed'
);

drop policy if exists "equipment_loans_update_own_or_admin" on public.equipment_loans;
create policy "equipment_loans_update_own_or_admin"
on public.equipment_loans
for update
to authenticated
using (
  public.is_admin()
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
);

drop policy if exists "equipment_loan_items_select_approved" on public.equipment_loan_items;
create policy "equipment_loan_items_select_approved"
on public.equipment_loan_items
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "equipment_loan_items_insert_own" on public.equipment_loan_items;
create policy "equipment_loan_items_insert_own"
on public.equipment_loan_items
for insert
to authenticated
with check (
  status = 'borrowed'
  and exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
);

drop policy if exists "equipment_loan_items_update_own_or_admin" on public.equipment_loan_items;
create policy "equipment_loan_items_update_own_or_admin"
on public.equipment_loan_items
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
);

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
    and is_active = true;

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

create or replace function public.borrow_eng_sets(
  p_target_profile_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_profile_count integer;
  v_item_ids uuid[];
begin
  select count(distinct target_profile_id)
  into v_requested_count
  from unnest(coalesce(p_target_profile_ids, array[]::uuid[])) as target_profile_id;

  if coalesce(v_requested_count, 0) = 0 then
    raise exception '대여할 ENG SET을 선택해 주세요.';
  end if;

  select count(*)
  into v_profile_count
  from public.profiles
  where id in (
    select distinct target_profile_id
    from unnest(coalesce(p_target_profile_ids, array[]::uuid[])) as target_profile_id
  )
    and approved = true;

  if v_profile_count <> v_requested_count then
    raise exception '대여할 수 없는 ENG SET 대상자가 포함되어 있습니다.';
  end if;

  with target_profiles as (
    select distinct
      profiles.id,
      profiles.name
    from public.profiles
    where profiles.id in (
      select distinct target_profile_id
      from unnest(coalesce(p_target_profile_ids, array[]::uuid[])) as target_profile_id
    )
      and profiles.approved = true
  ),
  upserted_items as (
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
      'eng_set',
      'ENG SET',
      concat('ENG SET - ', target_profiles.name),
      concat('eng-set-', target_profiles.id::text),
      30000 + row_number() over (order by target_profiles.name),
      true,
      jsonb_build_object('target_profile_id', target_profiles.id::text, 'target_profile_name', target_profiles.name)
    from target_profiles
    on conflict (code) do update
    set
      name = excluded.name,
      is_active = true,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
    returning id
  )
  select array_agg(id)
  into v_item_ids
  from upserted_items;

  return public.borrow_equipment_items(v_item_ids, 'eng_set');
end;
$$;

create or replace function public.return_equipment_loan_items(
  p_loan_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_returned_count integer := 0;
  v_loan_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() = 'observer' then
    raise exception '장비 반납 권한이 없습니다.';
  end if;

  with requested_items as (
    select distinct loan_item_id
    from unnest(coalesce(p_loan_item_ids, array[]::uuid[])) as loan_item_id
  ),
  updated_items as (
    update public.equipment_loan_items
    set
      status = 'returned',
      returned_at = v_now
    from public.equipment_loans
    where equipment_loan_items.loan_id = equipment_loans.id
      and equipment_loan_items.id in (select loan_item_id from requested_items)
      and equipment_loan_items.status = 'borrowed'
      and (
        equipment_loans.borrower_profile_id = v_user_id
        or public.is_admin()
      )
    returning equipment_loan_items.loan_id
  )
  select count(*), coalesce(array_agg(distinct loan_id), array[]::uuid[])
  into v_returned_count, v_loan_ids
  from updated_items;

  update public.equipment_loans
  set
    status = 'returned',
    returned_at = v_now
  where id = any(v_loan_ids)
    and not exists (
      select 1
      from public.equipment_loan_items
      where equipment_loan_items.loan_id = equipment_loans.id
        and equipment_loan_items.status = 'borrowed'
    );

  return coalesce(v_returned_count, 0);
end;
$$;

revoke execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) from public, anon;
revoke execute on function public.borrow_eng_sets(uuid[]) from public, anon;
revoke execute on function public.return_equipment_loan_items(uuid[]) from public, anon;
grant execute on function public.borrow_equipment_items(uuid[], text, text, text, text, text, text) to authenticated;
grant execute on function public.borrow_eng_sets(uuid[]) to authenticated;
grant execute on function public.return_equipment_loan_items(uuid[]) to authenticated;

with seed(category, group_name, name, code, sort_order, metadata) as (
  values
    ('camera_lens', '5D 바디', 'mark2-1', 'camera-5d-body-mark2-1', 1011, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark2-2', 'camera-5d-body-mark2-2', 1012, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark4-1', 'camera-5d-body-mark4-1', 1013, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 바디', 'mark4-2', 'camera-5d-body-mark4-2', 1014, '{"family":"5D","kind":"body"}'::jsonb),
    ('camera_lens', '5D 렌즈', '16-35mm 1번', 'camera-5d-lens-16-35mm-01', 1111, '{"family":"5D","kind":"lens","variant_parent":"16-35mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '16-35mm 2번', 'camera-5d-lens-16-35mm-02', 1112, '{"family":"5D","kind":"lens","variant_parent":"16-35mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm 1번', 'camera-5d-lens-70-200mm-01', 1121, '{"family":"5D","kind":"lens","variant_parent":"70-200mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm 2번', 'camera-5d-lens-70-200mm-02', 1122, '{"family":"5D","kind":"lens","variant_parent":"70-200mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-105mm', 'camera-5d-lens-24-105mm', 1130, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '100mm', 'camera-5d-lens-100mm', 1140, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '28-300mm', 'camera-5d-lens-28-300mm', 1150, '{"family":"5D","kind":"lens"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-70mm 1번', 'camera-5d-lens-24-70mm-01', 1161, '{"family":"5D","kind":"lens","variant_parent":"24-70mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '24-70mm 2번', 'camera-5d-lens-24-70mm-02', 1162, '{"family":"5D","kind":"lens","variant_parent":"24-70mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', 'Ts-e 24mm 1번', 'camera-5d-lens-ts-e-24mm-01', 1171, '{"family":"5D","kind":"lens","variant_parent":"Ts-e 24mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', 'Ts-e 24mm 2번', 'camera-5d-lens-ts-e-24mm-02', 1172, '{"family":"5D","kind":"lens","variant_parent":"Ts-e 24mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'GH4 바디', 'gh4-1', 'camera-gh4-body-1', 2011, '{"family":"GH4","kind":"body"}'::jsonb),
    ('camera_lens', 'GH4 바디', 'gh4-2', 'camera-gh4-body-2', 2012, '{"family":"GH4","kind":"body"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '7-14mm', 'camera-gh4-lens-7-14mm', 2111, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '14mm', 'camera-gh4-lens-14mm', 2130, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '35-100mm', 'camera-gh4-lens-35-100mm', 2140, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm 1번', 'camera-gh4-lens-12-35mm-01', 2151, '{"family":"GH4","kind":"lens","variant_parent":"12-35mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm 2번', 'camera-gh4-lens-12-35mm-02', 2152, '{"family":"GH4","kind":"lens","variant_parent":"12-35mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 바디', 'fx3-1', 'camera-fx3-body-1', 3011, '{"family":"FX3","kind":"body"}'::jsonb),
    ('camera_lens', 'FX3 바디', 'fx3-2', 'camera-fx3-body-2', 3012, '{"family":"FX3","kind":"body"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-240mm 1번', 'camera-fx3-lens-24-240mm-01', 3111, '{"family":"FX3","kind":"lens","variant_parent":"24-240mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-240mm 2번', 'camera-fx3-lens-24-240mm-02', 3112, '{"family":"FX3","kind":"lens","variant_parent":"24-240mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-105mm 1번', 'camera-fx3-lens-24-105mm-01', 3121, '{"family":"FX3","kind":"lens","variant_parent":"24-105mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-105mm 2번', 'camera-fx3-lens-24-105mm-02', 3122, '{"family":"FX3","kind":"lens","variant_parent":"24-105mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-70mm', 'camera-fx3-lens-24-70mm', 3130, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '70-200mm', 'camera-fx3-lens-70-200mm', 3140, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '28-300mm', 'camera-fx3-lens-28-300mm', 3150, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', '단독 카메라', 'rx100 1번', 'camera-standalone-rx100-01', 4018, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '고프로', 'camera-standalone-gopro', 4019, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '오스모', 'camera-standalone-osmo', 4020, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '360', 'camera-standalone-360', 4021, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '와이어리스', 'camera-standalone-wireless', 4022, '{"family":"standalone","kind":"audio"}'::jsonb),
    ('camera_lens', '단독 카메라', 'dji마이크', 'camera-standalone-dji-mic', 4023, '{"family":"standalone","kind":"audio"}'::jsonb),
    ('camera_lens', '단독 카메라', 'c타입 마이크', 'camera-standalone-c-type-mic', 4024, '{"family":"standalone","kind":"audio"}'::jsonb),
    ('camera_lens', '단독 카메라', '기타 장비', 'camera-standalone-etc', 4025, '{"family":"standalone","kind":"etc"}'::jsonb),
    ('camera_lens', '드론', 'DJI S-1000', 'camera-drone-dji-s-1000', 4601, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', 'INSPIPER 1', 'camera-drone-inspiper-1', 4602, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', 'INSPIPER 2', 'camera-drone-inspiper-2', 4603, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', '매빅2 프로', 'camera-drone-mavic-2-pro', 4604, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', '매빅 에어', 'camera-drone-mavic-air', 4605, '{"family":"drone","kind":"drone"}'::jsonb),
    ('light', '조명', '400x', 'light-400x', 100, '{}'::jsonb),
    ('light', '조명', '스텔라', 'light-stella', 110, '{}'::jsonb),
    ('light', '조명', '판조명', 'light-panel', 120, '{}'::jsonb),
    ('light', '조명', '프라임', 'light-prime', 130, '{}'::jsonb),
    ('live', '기타 라이브장비', '쿠보텍', 'live-cubotec', 2001, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', '분배기', 'live-distributor', 2002, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', 'bnc케이블', 'live-bnc-cable', 2003, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', 'tvu 배터리', 'live-tvu-battery', 2004, '{"kind":"live_accessory"}'::jsonb),
    ('live', '기타 라이브장비', '핀마이크', 'live-pin-mic', 2005, '{"kind":"live_accessory"}'::jsonb)
  union all
  select 'camera_lens', '5D 배터리', concat('5D 배터리 ', n, '번'), concat('camera-5d-battery-', lpad(n::text, 2, '0')), 1200 + n, '{"family":"5D","kind":"battery"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'GH4 배터리', concat('GH4 배터리 ', n, '번'), concat('camera-gh4-battery-', lpad(n::text, 2, '0')), 2200 + n, '{"family":"GH4","kind":"battery"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'FX3 배터리', concat('FX3 배터리 ', n, '번'), concat('camera-fx3-battery-', lpad(n::text, 2, '0')), 3200 + n, '{"family":"FX3","kind":"battery"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', '단독 카메라', concat('z-90 ', n, '번'), concat('camera-standalone-z-90-', lpad(n::text, 2, '0')), 4000 + n, '{"family":"standalone","kind":"camera"}'::jsonb
  from generate_series(1, 4) as n
  union all
  select 'camera_lens', '단독 카메라', concat('ax40 ', n, '번'), concat('camera-standalone-ax40-', lpad(n::text, 2, '0')), 4010 + n, '{"family":"standalone","kind":"camera"}'::jsonb
  from generate_series(1, 3) as n
  union all
  select 'camera_lens', 'z-90 배터리', concat('z-90 배터리 ', n, '번'), concat('camera-z-90-battery-', lpad(n::text, 2, '0')), 4100 + n, '{"family":"standalone","kind":"battery","for":"z-90"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'ax40 배터리', concat('ax40 배터리 ', n, '번'), concat('camera-ax40-battery-', lpad(n::text, 2, '0')), 4200 + n, '{"family":"standalone","kind":"battery","for":"ax40"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', 'rx100 배터리', concat('rx100 배터리 ', n, '번'), concat('camera-rx100-battery-', lpad(n::text, 2, '0')), 4300 + n, '{"family":"standalone","kind":"battery","for":"rx100"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', '고프로 배터리', concat('고프로 배터리 ', n, '번'), concat('camera-gopro-battery-', lpad(n::text, 2, '0')), 4400 + n, '{"family":"standalone","kind":"battery","for":"gopro"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'camera_lens', '오스모 배터리', concat('오스모 배터리 ', n, '번'), concat('camera-osmo-battery-', lpad(n::text, 2, '0')), 4500 + n, '{"family":"standalone","kind":"battery","for":"osmo"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select 'eng_set', '공용 ENG', concat('공용ENG', shared_no), concat('eng-set-shared-', shared_no), shared_no, '{"kind":"shared_eng_set"}'::jsonb
  from generate_series(1, 3) as shared_no
  union all
  select 'live', 'TVU', concat('TVU-', tvu_no), concat('live-tvu-', tvu_no), 1000 + row_number() over (order by display_order), '{"kind":"tvu"}'::jsonb
  from (
    values
      (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6),
      (14, 14), (16, 16), (17, 17), (18, 18), (19, 19)
  ) as tvu(tvu_no, display_order)
)
insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
select
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
from seed
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());

update public.equipment_items
set
  is_active = false,
  updated_at = timezone('utc', now())
where code in (
  'camera-5d-lens-16-35mm',
  'camera-5d-lens-70-200mm',
  'camera-5d-lens-24-70mm',
  'camera-5d-lens-ts-e-24mm',
  'camera-5d-lens-macro',
  'camera-gh4-lens-24-105mm',
  'camera-gh4-lens-12-35mm'
);
