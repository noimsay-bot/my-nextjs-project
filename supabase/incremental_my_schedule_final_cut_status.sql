-- Purpose: Persist "정제본 생성완료" status for my schedule items in Supabase.
-- Impact: Completed status no longer depends only on browser localStorage.

alter table public.schedule_partner_entries
add column if not exists final_cut_completed boolean not null default false;

create or replace function public.update_my_schedule_final_cut_status(
  p_schedule_date date,
  p_schedule_item_id text,
  p_final_cut_completed boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment record;
begin
  select *
  into target_assignment
  from public.get_my_schedule_assignment_items(to_char(p_schedule_date, 'YYYY-MM'))
  where schedule_date = p_schedule_date
    and schedule_item_id = trim(coalesce(p_schedule_item_id, ''))
    and photographer_profile_id = auth.uid()
  limit 1;

  if not found then
    raise exception '정제본 생성완료 처리할 내 일정을 찾을 수 없습니다.';
  end if;

  insert into public.schedule_partner_entries (
    schedule_date,
    schedule_item_id,
    photographer_profile_id,
    photographer_name,
    schedule_content,
    final_cut_completed,
    partner_profile_id
  )
  values (
    target_assignment.schedule_date,
    target_assignment.schedule_item_id,
    target_assignment.photographer_profile_id,
    target_assignment.photographer_name,
    target_assignment.schedule_content,
    coalesce(p_final_cut_completed, false),
    null
  )
  on conflict (schedule_item_id) do update
  set
    schedule_date = excluded.schedule_date,
    photographer_profile_id = excluded.photographer_profile_id,
    photographer_name = excluded.photographer_name,
    schedule_content = excluded.schedule_content,
    final_cut_completed = excluded.final_cut_completed;
end;
$$;

revoke execute on function public.update_my_schedule_final_cut_status(date, text, boolean) from public, anon;
grant execute on function public.update_my_schedule_final_cut_status(date, text, boolean) to authenticated;

notify pgrst, 'reload schema';
