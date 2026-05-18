-- TVU Grid chip toggle for desk/team_lead/admin.

create or replace function public.set_tvu_grid_status(
  p_equipment_item_id uuid,
  p_is_grid boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_is_grid boolean := coalesce(p_is_grid, false);
  v_updated_count integer := 0;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('desk', 'team_lead', 'admin') then
    raise exception 'TVU Grid 표시 변경 권한이 없습니다.';
  end if;

  if p_equipment_item_id is null then
    raise exception 'Grid 표시를 변경할 TVU 장비를 선택해 주세요.';
  end if;

  update public.equipment_items
  set
    metadata = case
      when v_is_grid then
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{grid}',
              'true'::jsonb,
              true
            ),
            '{grid_updated_by}',
            to_jsonb(v_user_id::text),
            true
          ),
          '{grid_updated_at}',
          to_jsonb(v_now::text),
          true
        )
      else
        jsonb_set(
          jsonb_set(
            coalesce(metadata, '{}'::jsonb) - 'grid',
            '{grid_updated_by}',
            to_jsonb(v_user_id::text),
            true
          ),
          '{grid_updated_at}',
          to_jsonb(v_now::text),
          true
        )
      end,
    updated_at = v_now
  where id = p_equipment_item_id
    and category = 'live'
    and group_name = 'TVU';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'Grid 표시를 변경할 TVU 장비를 찾을 수 없습니다.';
  end if;

  return v_is_grid;
end;
$$;

revoke all on function public.set_tvu_grid_status(uuid, boolean) from public;
grant execute on function public.set_tvu_grid_status(uuid, boolean) to authenticated;
