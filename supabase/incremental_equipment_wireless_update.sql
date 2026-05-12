-- Supabase SQL Editor: z-90 공용와이어리스 1~4번 선택 항목 추가.
-- 기존 camera-standalone-wireless 코드는 1번으로 유지해 과거 대여 기록 연결을 보존한다.

with seed(category, group_name, name, code, sort_order, metadata) as (
  select
    'camera_lens',
    '단독 카메라',
    concat('공용와이어리스 ', n, '번'),
    case
      when n = 1 then 'camera-standalone-wireless'
      else concat('camera-standalone-wireless-', lpad(n::text, 2, '0'))
    end,
    4039 + n,
    '{"family":"standalone","kind":"audio","for":"z-90","variant_parent":"공용와이어리스"}'::jsonb
      || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 4) as n
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
  metadata = case
    when coalesce(public.equipment_items.metadata ->> 'is_under_repair', 'false') = 'true'
      then excluded.metadata || jsonb_build_object('is_under_repair', true)
    else excluded.metadata
  end,
  updated_at = timezone('utc', now());
