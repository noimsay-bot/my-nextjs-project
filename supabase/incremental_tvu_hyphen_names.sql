-- Normalize live TVU equipment names to TVU-<number>.
-- Run after supabase/incremental_equipment_loans.sql and the TVU seed SQL files.

with normalized_tvu as (
  select
    id,
    regexp_replace(trim(name), '^TVU\s*-?\s*([0-9]+)$', 'TVU-\1', 'i') as normalized_name
  from public.equipment_items
  where category = 'live'
    and upper(trim(group_name)) = 'TVU'
    and trim(name) ~* '^TVU\s*-?\s*[0-9]+$'
)
update public.equipment_items as equipment_items
set
  name = normalized_tvu.normalized_name,
  metadata = case
    when coalesce(equipment_items.metadata ->> 'rental', 'false') = 'true' then
      jsonb_set(
        coalesce(equipment_items.metadata, '{}'::jsonb),
        '{rental_id}',
        to_jsonb(normalized_tvu.normalized_name),
        true
      )
    when coalesce(equipment_items.metadata ->> 'regional_transmission', 'false') = 'true' then
      jsonb_set(
        coalesce(equipment_items.metadata, '{}'::jsonb),
        '{regional_id}',
        to_jsonb(normalized_tvu.normalized_name),
        true
      )
    else coalesce(equipment_items.metadata, '{}'::jsonb)
  end,
  updated_at = timezone('utc', now())
from normalized_tvu
where equipment_items.id = normalized_tvu.id
  and (
    equipment_items.name is distinct from normalized_tvu.normalized_name
    or (
      coalesce(equipment_items.metadata ->> 'rental', 'false') = 'true'
      and (equipment_items.metadata ->> 'rental_id') is distinct from normalized_tvu.normalized_name
    )
    or (
      coalesce(equipment_items.metadata ->> 'regional_transmission', 'false') = 'true'
      and (equipment_items.metadata ->> 'regional_id') is distinct from normalized_tvu.normalized_name
    )
  );
