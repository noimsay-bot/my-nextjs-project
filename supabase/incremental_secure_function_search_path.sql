-- Purpose: Lock function search_path to public to address mutable search_path warnings.
-- Impact: Replaces existing function definitions without changing behavior.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.acquire_team_lead_schedule_assignment_cell_lock(
  p_month_key text,
  p_date_key text,
  p_row_key text,
  p_field_key text,
  p_claim_token text,
  p_duration_seconds integer default 8
)
returns table (
  ok boolean,
  cell_key text,
  month_key text,
  date_key text,
  row_key text,
  field_key text,
  locked_by uuid,
  locked_by_name text,
  expires_at timestamptz,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_cell_key text := concat_ws('::', p_month_key, p_date_key, p_row_key, p_field_key);
  v_user_id uuid := auth.uid();
  v_user_name text := '';
  v_lock_row public.team_lead_schedule_assignment_cell_locks%rowtype;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() not in ('team_lead', 'admin', 'desk') then
    raise exception '권한이 없습니다.';
  end if;

  select coalesce(name, '')
  into v_user_name
  from public.profiles
  where id = v_user_id;

  insert into public.team_lead_schedule_assignment_cell_locks (
    cell_key,
    month_key,
    date_key,
    row_key,
    field_key,
    locked_by,
    locked_by_name,
    claim_token,
    expires_at
  )
  values (
    v_cell_key,
    p_month_key,
    p_date_key,
    p_row_key,
    p_field_key,
    v_user_id,
    v_user_name,
    p_claim_token,
    timezone('utc', now()) + make_interval(secs => greatest(coalesce(p_duration_seconds, 8), 2))
  )
  on conflict (cell_key) do update
  set
    month_key = excluded.month_key,
    date_key = excluded.date_key,
    row_key = excluded.row_key,
    field_key = excluded.field_key,
    locked_by = excluded.locked_by,
    locked_by_name = excluded.locked_by_name,
    claim_token = excluded.claim_token,
    expires_at = excluded.expires_at
  where
    public.team_lead_schedule_assignment_cell_locks.expires_at <= timezone('utc', now())
    or public.team_lead_schedule_assignment_cell_locks.locked_by = v_user_id
  returning *
  into v_lock_row;

  if found then
    return query
    select
      true,
      v_lock_row.cell_key,
      v_lock_row.month_key,
      v_lock_row.date_key,
      v_lock_row.row_key,
      v_lock_row.field_key,
      v_lock_row.locked_by,
      v_lock_row.locked_by_name,
      v_lock_row.expires_at,
      v_lock_row.updated_at;
    return;
  end if;

  select *
  into v_lock_row
  from public.team_lead_schedule_assignment_cell_locks
  where public.team_lead_schedule_assignment_cell_locks.cell_key = v_cell_key;

  return query
  select
    false,
    v_lock_row.cell_key,
    v_lock_row.month_key,
    v_lock_row.date_key,
    v_lock_row.row_key,
    v_lock_row.field_key,
    v_lock_row.locked_by,
    v_lock_row.locked_by_name,
    v_lock_row.expires_at,
    v_lock_row.updated_at;
end;
$$;

create or replace function public.release_team_lead_schedule_assignment_cell_lock(
  p_cell_key text,
  p_claim_token text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  delete from public.team_lead_schedule_assignment_cell_locks
  where public.team_lead_schedule_assignment_cell_locks.cell_key = p_cell_key
    and public.team_lead_schedule_assignment_cell_locks.locked_by = v_user_id
    and public.team_lead_schedule_assignment_cell_locks.claim_token = p_claim_token;

  return found;
end;
$$;
