-- Supabase SQL Editor: rx100을 번호 선택 없이 단일 선택 항목으로 표시한다.
-- 기존 camera-standalone-rx100-01 코드는 유지해 과거 대여 기록 연결을 보존한다.

insert into public.equipment_items (
  category,
  group_name,
  name,
  code,
  sort_order,
  metadata
)
values (
  'camera_lens',
  '단독 카메라',
  'rx100',
  'camera-standalone-rx100-01',
  4018,
  '{"family":"standalone","kind":"camera"}'::jsonb
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
