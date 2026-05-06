with seed(category, group_name, name, code, sort_order, metadata) as (
  values
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
    ('camera_lens', 'GH4 렌즈', '7-14mm', 'camera-gh4-lens-7-14mm', 2111, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '14mm', 'camera-gh4-lens-14mm', 2130, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '35-100mm', 'camera-gh4-lens-35-100mm', 2140, '{"family":"GH4","kind":"lens"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm 1번', 'camera-gh4-lens-12-35mm-01', 2151, '{"family":"GH4","kind":"lens","variant_parent":"12-35mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'GH4 렌즈', '12-35mm 2번', 'camera-gh4-lens-12-35mm-02', 2152, '{"family":"GH4","kind":"lens","variant_parent":"12-35mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-240mm 1번', 'camera-fx3-lens-24-240mm-01', 3111, '{"family":"FX3","kind":"lens","variant_parent":"24-240mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-240mm 2번', 'camera-fx3-lens-24-240mm-02', 3112, '{"family":"FX3","kind":"lens","variant_parent":"24-240mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-105mm 1번', 'camera-fx3-lens-24-105mm-01', 3121, '{"family":"FX3","kind":"lens","variant_parent":"24-105mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-105mm 2번', 'camera-fx3-lens-24-105mm-02', 3122, '{"family":"FX3","kind":"lens","variant_parent":"24-105mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-70mm', 'camera-fx3-lens-24-70mm', 3130, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '70-200mm', 'camera-fx3-lens-70-200mm', 3140, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '28-300mm', 'camera-fx3-lens-28-300mm', 3150, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', '드론', 'DJI S-1000', 'camera-drone-dji-s-1000', 4601, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', 'INSPIPER 1', 'camera-drone-inspiper-1', 4602, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', 'INSPIPER 2', 'camera-drone-inspiper-2', 4603, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', '매빅2 프로', 'camera-drone-mavic-2-pro', 4604, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', '매빅 에어', 'camera-drone-mavic-air', 4605, '{"family":"drone","kind":"drone"}'::jsonb)
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
