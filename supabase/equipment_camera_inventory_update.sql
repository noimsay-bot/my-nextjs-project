with seed(category, group_name, name, code, sort_order, metadata) as (
  values
    ('camera_lens', '5D 렌즈', '16-35mm 1번', 'camera-5d-lens-16-35mm-01', 1111, '{"family":"5D","kind":"lens","variant_parent":"16-35mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '16-35mm 2번', 'camera-5d-lens-16-35mm-02', 1112, '{"family":"5D","kind":"lens","variant_parent":"16-35mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm 1번', 'camera-5d-lens-70-200mm-01', 1121, '{"family":"5D","kind":"lens","variant_parent":"70-200mm","variant_label":"1번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '70-200mm 2번', 'camera-5d-lens-70-200mm-02', 1122, '{"family":"5D","kind":"lens","variant_parent":"70-200mm","variant_label":"2번"}'::jsonb),
    ('camera_lens', '5D 렌즈', '100mm', 'camera-5d-lens-100mm', 1140, '{"family":"5D","kind":"lens"}'::jsonb),
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
    ('camera_lens', 'FX3 렌즈', '24-105mm', 'camera-fx3-lens-24-105mm-01', 3121, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '24-70mm', 'camera-fx3-lens-24-70mm', 3130, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '70-200mm', 'camera-fx3-lens-70-200mm', 3140, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', 'FX3 렌즈', '28-300mm', 'camera-fx3-lens-28-300mm', 3150, '{"family":"FX3","kind":"lens"}'::jsonb),
    ('camera_lens', '단독 카메라', 'rx100', 'camera-standalone-rx100-01', 4018, '{"family":"standalone","kind":"camera"}'::jsonb),
    ('camera_lens', '단독 카메라', '기타 장비', 'camera-standalone-etc', 4090, '{"family":"standalone","kind":"etc"}'::jsonb),
    ('camera_lens', '드론', '매빅2 프로', 'camera-drone-mavic-2-pro', 4604, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', '드론', '매빅 에어', 'camera-drone-mavic-air', 4605, '{"family":"drone","kind":"drone"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '망원렌즈', 'camera-eng-lens-telephoto', 4701, '{"family":"ENG","kind":"lens"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '와이드렌즈 1번', 'camera-eng-lens-wide-01', 4702, '{"family":"ENG","kind":"lens","variant_parent":"와이드렌즈","variant_label":"1번"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '와이드렌즈 2번', 'camera-eng-lens-wide-02', 4703, '{"family":"ENG","kind":"lens","variant_parent":"와이드렌즈","variant_label":"2번"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '와이드 컨버터', 'camera-eng-lens-wide-converter', 4704, '{"family":"ENG","kind":"lens"}'::jsonb),
    ('camera_lens', 'ENG렌즈', '어안', 'camera-eng-lens-fisheye', 4705, '{"family":"ENG","kind":"lens"}'::jsonb),
    ('live', '기타 라이브장비', 'tvu 배터리', 'live-tvu-battery', 2004, '{"kind":"tvu_battery"}'::jsonb)
  union all
  select
    'live',
    '기타 라이브장비',
    concat('VC300 ', n, '번'),
    concat('live-vc300-', lpad(n::text, 2, '0')),
    2004 + n,
    '{"kind":"vc300"}'::jsonb
  from generate_series(1, 4) as n
  union all
  select 'camera_lens', '단독 카메라', concat('z-90 ', n, '번'), concat('camera-standalone-z-90-', lpad(n::text, 2, '0')), 4000 + n, '{"family":"standalone","kind":"camera"}'::jsonb
  from generate_series(1, 4) as n
  union all
  select 'camera_lens', '단독 카메라', concat('ax40 ', n, '번'), concat('camera-standalone-ax40-', lpad(n::text, 2, '0')), 4010 + n, '{"family":"standalone","kind":"camera"}'::jsonb
  from generate_series(1, 2) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('오스모 ', n, '번'),
    case when n = 1 then 'camera-standalone-osmo' else concat('camera-standalone-osmo-', lpad(n::text, 2, '0')) end,
    4019 + n,
    '{"family":"standalone","kind":"camera","variant_parent":"오스모"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 4) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('360 ', n, '번'),
    case when n = 1 then 'camera-standalone-360' else concat('camera-standalone-360-', lpad(n::text, 2, '0')) end,
    4029 + n,
    '{"family":"standalone","kind":"camera","variant_parent":"360"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('공용와이어리스 ', n, '번'),
    case when n = 1 then 'camera-standalone-wireless' else concat('camera-standalone-wireless-', lpad(n::text, 2, '0')) end,
    4039 + n,
    '{"family":"standalone","kind":"audio","for":"z-90","variant_parent":"공용와이어리스"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 4) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('dji마이크 ', n, '번'),
    case when n = 1 then 'camera-standalone-dji-mic' else concat('camera-standalone-dji-mic-', lpad(n::text, 2, '0')) end,
    4049 + n,
    '{"family":"standalone","kind":"audio","variant_parent":"dji마이크"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('c타입 마이크 ', n, '번'),
    case when n = 1 then 'camera-standalone-c-type-mic' else concat('camera-standalone-c-type-mic-', lpad(n::text, 2, '0')) end,
    4059 + n,
    '{"family":"standalone","kind":"audio","variant_parent":"c타입 마이크"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 10) as n
  union all
  select
    'camera_lens',
    '단독 카메라',
    concat('탑포드 ', n, '번'),
    case when n = 1 then 'camera-standalone-topod' else concat('camera-standalone-topod-', lpad(n::text, 2, '0')) end,
    4090 + n,
    '{"family":"standalone","kind":"accessory","for":"etc","variant_parent":"탑포드"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 3) as n
  union all
  select
    'light',
    '조명',
    concat('400X ', n, '번'),
    case when n = 1 then 'light-400x' else concat('light-400x-', lpad(n::text, 2, '0')) end,
    99 + n,
    '{"family":"light","kind":"400X","variant_parent":"400X"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'light',
    '조명',
    concat('스텔라 ', n, '번'),
    case when n = 1 then 'light-stella' else concat('light-stella-', lpad(n::text, 2, '0')) end,
    109 + n,
    '{"family":"light","kind":"stella","variant_parent":"스텔라"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'light',
    '조명',
    concat('EX600U ', n, '번'),
    case when n = 1 then 'light-panel' else concat('light-ex600u-', lpad(n::text, 2, '0')) end,
    119 + n,
    '{"family":"light","kind":"EX600U","variant_parent":"EX600U"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 2) as n
  union all
  select
    'light',
    '조명',
    concat('LC500 ', n, '번'),
    case when n = 1 then 'light-lc500' else concat('light-lc500-', lpad(n::text, 2, '0')) end,
    124 + n,
    '{"family":"light","kind":"LC500","variant_parent":"LC500"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 3) as n
  union all
  select
    'light',
    '조명',
    concat('프라임 ', n, '번'),
    case when n = 1 then 'light-prime' else concat('light-prime-', lpad(n::text, 2, '0')) end,
    129 + n,
    '{"family":"light","kind":"prime","variant_parent":"프라임"}'::jsonb || jsonb_build_object('variant_label', concat(n, '번'))
  from generate_series(1, 8) as n
  union all
  select
    'live',
    '기타 라이브장비',
    concat('핀마이크 ', n, '번'),
    case when n = 1 then 'live-pin-mic' else concat('live-pin-mic-', lpad(n::text, 2, '0')) end,
    2010 + n,
    '{"kind":"pin_mic"}'::jsonb
  from generate_series(1, 10) as n
  union all
  select
    'live',
    '기타 라이브장비',
    concat('분배기 ', n, '번'),
    case when n = 1 then 'live-distributor' else concat('live-distributor-', lpad(n::text, 2, '0')) end,
    2030 + n,
    '{"kind":"distributor"}'::jsonb
  from generate_series(1, 7) as n
  union all
  select
    'live',
    'TVU',
    concat('TVU-', tvu_no),
    concat('live-tvu-', tvu_no),
    1000 + row_number() over (order by display_order),
    case
      when tvu_no between 15 and 19 then '{"kind":"tvu","network":"global"}'::jsonb
      else '{"kind":"tvu"}'::jsonb
    end
  from (
    values
      (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6),
      (14, 14), (15, 15), (16, 16), (17, 17), (18, 18), (19, 19)
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
  metadata = case
    when coalesce(public.equipment_items.metadata ->> 'is_under_repair', 'false') = 'true'
      then excluded.metadata || jsonb_build_object('is_under_repair', true)
    else excluded.metadata
  end,
  updated_at = timezone('utc', now());

update public.equipment_items
set
  is_active = false,
  updated_at = timezone('utc', now())
where code in (
  'camera-5d-lens-24-105mm',
  'camera-5d-lens-16-35mm',
  'camera-5d-lens-70-200mm',
  'camera-5d-lens-28-300mm',
  'camera-5d-lens-24-70mm',
  'camera-5d-lens-ts-e-24mm',
  'camera-5d-lens-macro',
  'camera-fx3-lens-24-105mm-02',
  'camera-gh4-lens-24-105mm',
  'camera-gh4-lens-12-35mm',
  'camera-standalone-ax40-03',
  'camera-standalone-gopro',
  'camera-drone-dji-s-1000',
  'camera-drone-inspiper-1',
  'camera-drone-inspiper-2',
  'live-cubotec',
  'live-bnc-cable'
)
or code like 'camera-gopro-battery-%';
