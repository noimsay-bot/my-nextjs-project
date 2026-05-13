insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
select
  'light',
  '조명',
  concat('LC500 ', n, '번'),
  case when n = 1 then 'light-lc500' else concat('light-lc500-', lpad(n::text, 2, '0')) end,
  124 + n,
  '{"family":"light","kind":"LC500","variant_parent":"LC500"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
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
