-- 라이브장비 '분배기 6번' 누락분 보충
-- 시드(supabase/incremental_equipment_loans.sql)의 generate_series(1,7) 규칙을 그대로 따른다.
--   n=6 -> name '분배기 6번', code 'live-distributor-06', sort_order 2030+6=2036,
--          metadata {"kind":"distributor"}
-- 이미 존재하면 활성화/정렬만 맞춘다(수리중 플래그는 보존).

insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
values (
  'live',
  '기타 라이브장비',
  '분배기 6번',
  'live-distributor-06',
  2036,
  '{"kind":"distributor"}'::jsonb
)
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  metadata = case
    when coalesce(public.equipment_items.metadata ->> 'is_under_repair', 'false') = 'true'
      then excluded.metadata || jsonb_build_object('is_under_repair', true)
    else excluded.metadata
  end,
  updated_at = timezone('utc', now());
