insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
select
  'camera_lens',
  '단독 카메라',
  concat('탑포드 ', n, '번'),
  case when n = 1 then 'camera-standalone-topod' else concat('camera-standalone-topod-', lpad(n::text, 2, '0')) end,
  4090 + n,
  '{"family":"standalone","kind":"accessory","for":"etc","variant_parent":"탑포드"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
from generate_series(1, 3) as n
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
