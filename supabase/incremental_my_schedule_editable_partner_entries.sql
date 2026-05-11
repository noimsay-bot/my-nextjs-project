-- Purpose: Allow approved non-partner users to edit their own corporate-card schedule helper fields.
-- Apply in Supabase SQL Editor before deploying the matching app code.

alter table public.schedule_partner_entries
add column if not exists memo_text text;

create or replace function public.upsert_my_schedule_partner_entry(
  p_schedule_date date,
  p_schedule_item_id text,
  p_audio_man_name text default null,
  p_senior_name text default null,
  p_memo_text text default null
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
    raise exception '수정할 수 있는 내 일정을 찾을 수 없습니다.';
  end if;

  insert into public.schedule_partner_entries (
    schedule_date,
    schedule_item_id,
    photographer_profile_id,
    photographer_name,
    schedule_content,
    audio_man_name,
    senior_name,
    memo_text,
    partner_profile_id
  )
  values (
    target_assignment.schedule_date,
    target_assignment.schedule_item_id,
    target_assignment.photographer_profile_id,
    target_assignment.photographer_name,
    target_assignment.schedule_content,
    nullif(trim(coalesce(p_audio_man_name, '')), ''),
    nullif(trim(coalesce(p_senior_name, '')), ''),
    nullif(trim(coalesce(p_memo_text, '')), ''),
    null
  )
  on conflict (schedule_item_id) do update
  set
    schedule_date = excluded.schedule_date,
    photographer_profile_id = excluded.photographer_profile_id,
    photographer_name = excluded.photographer_name,
    schedule_content = excluded.schedule_content,
    audio_man_name = excluded.audio_man_name,
    senior_name = excluded.senior_name,
    memo_text = excluded.memo_text;
end;
$$;

revoke execute on function public.upsert_my_schedule_partner_entry(date, text, text, text, text) from public, anon;
grant execute on function public.upsert_my_schedule_partner_entry(date, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
