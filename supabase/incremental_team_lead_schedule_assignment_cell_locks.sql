-- Purpose: Add cell-level edit locks for schedule assignment inputs so the first editor keeps priority.
-- Impact: Creates public.team_lead_schedule_assignment_cell_locks, lock acquire/release RPCs, and RLS for desk/team_lead/admin.
-- Rollback:
--   drop function if exists public.release_team_lead_schedule_assignment_cell_lock(text, text);
--   drop function if exists public.acquire_team_lead_schedule_assignment_cell_lock(text, text, text, text, text, integer);
--   drop table if exists public.team_lead_schedule_assignment_cell_locks;

create table if not exists public.team_lead_schedule_assignment_cell_locks (
  cell_key text primary key,
  month_key text not null,
  date_key text not null,
  row_key text not null,
  field_key text not null,
  locked_by uuid references public.profiles (id) on delete cascade,
  locked_by_name text not null default '',
  claim_token text not null,
  expires_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists team_lead_schedule_assignment_cell_locks_month_idx
  on public.team_lead_schedule_assignment_cell_locks (month_key, expires_at);

drop trigger if exists set_team_lead_schedule_assignment_cell_locks_updated_at on public.team_lead_schedule_assignment_cell_locks;

create trigger set_team_lead_schedule_assignment_cell_locks_updated_at
before update on public.team_lead_schedule_assignment_cell_locks
for each row
execute function public.set_updated_at();

alter table public.team_lead_schedule_assignment_cell_locks enable row level security;

drop policy if exists "team_lead_schedule_assignment_cell_locks_select_managers" on public.team_lead_schedule_assignment_cell_locks;
create policy "team_lead_schedule_assignment_cell_locks_select_managers"
on public.team_lead_schedule_assignment_cell_locks
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_schedule_assignment_cell_locks_manage_privileged" on public.team_lead_schedule_assignment_cell_locks;
create policy "team_lead_schedule_assignment_cell_locks_manage_privileged"
on public.team_lead_schedule_assignment_cell_locks
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

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
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  delete from public.team_lead_schedule_assignment_cell_locks
  where cell_key = p_cell_key
    and locked_by = v_user_id
    and claim_token = p_claim_token;

  return found;
end;
$$;
