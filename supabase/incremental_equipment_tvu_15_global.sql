insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
values
  ('live', 'TVU', 'TVU-15', 'live-tvu-15', 1008, '{"kind":"tvu","network":"global"}'::jsonb),
  ('live', 'TVU', 'TVU-16', 'live-tvu-16', 1009, '{"kind":"tvu","network":"global"}'::jsonb),
  ('live', 'TVU', 'TVU-17', 'live-tvu-17', 1010, '{"kind":"tvu","network":"global"}'::jsonb),
  ('live', 'TVU', 'TVU-18', 'live-tvu-18', 1011, '{"kind":"tvu","network":"global"}'::jsonb),
  ('live', 'TVU', 'TVU-19', 'live-tvu-19', 1012, '{"kind":"tvu","network":"global"}'::jsonb)
on conflict (code) do update
set
  category = excluded.category,
  group_name = excluded.group_name,
  name = excluded.name,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata,
  is_active = true,
  updated_at = now();
