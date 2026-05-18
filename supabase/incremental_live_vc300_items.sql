insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
select
  'live',
  '기타 라이브장비',
  concat('VC300 ', n, '번'),
  concat('live-vc300-', lpad(n::text, 2, '0')),
  2004 + n,
  '{"kind":"vc300"}'::jsonb
from generate_series(1, 4) as n
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

notify pgrst, 'reload schema';
