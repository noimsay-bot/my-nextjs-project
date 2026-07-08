-- Purpose: Add vacation_extra_units and vacation_extra_requests tables for independent extra-round
--          vacation applications that are fully isolated from the primary vacation_requests /
--          vacation_months flow. Extra units have their own open state, arbitrary date sets,
--          per-date capacity limits, lottery results, and apply via union (append-only) to the
--          target month's schedule.
-- Impact: New tables only. vacation_requests / vacation_months / vacation_settings untouched.
-- Rollback:
--   DROP TABLE IF EXISTS public.vacation_extra_requests;
--   DROP TABLE IF EXISTS public.vacation_extra_units;
--
-- RLS note: Role-based privilege (desk/admin/team_lead only manage units) is enforced
-- at the application layer. RLS here enforces authentication ownership only, so this
-- migration has no dependency on custom types (app_role) or helper functions
-- (current_profile_role / current_profile_approved).

-- ── vacation_extra_units ───────────────────────────────────────────────────────
create table if not exists public.vacation_extra_units (
  id                   uuid        primary key default gen_random_uuid(),
  label                text        not null default '',
  target_year          integer     not null,
  target_month         integer     not null,
  date_keys            jsonb       not null default '[]'::jsonb,
  limits               jsonb       not null default '{}'::jsonb,
  annual_winners       jsonb       not null default '{}'::jsonb,
  compensatory_winners jsonb       not null default '{}'::jsonb,
  is_open              boolean     not null default false,
  applied_at           timestamptz,
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create index if not exists vacation_extra_units_target_idx
  on public.vacation_extra_units (target_year, target_month);

drop trigger if exists set_vacation_extra_units_updated_at on public.vacation_extra_units;
create trigger set_vacation_extra_units_updated_at
  before update on public.vacation_extra_units
  for each row execute function public.set_updated_at();

alter table public.vacation_extra_units enable row level security;

drop policy if exists "vacation_extra_units_select_approved" on public.vacation_extra_units;
create policy "vacation_extra_units_select_approved"
  on public.vacation_extra_units
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "vacation_extra_units_manage_privileged" on public.vacation_extra_units;
create policy "vacation_extra_units_manage_privileged"
  on public.vacation_extra_units
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ── vacation_extra_requests ────────────────────────────────────────────────────
create table if not exists public.vacation_extra_requests (
  id               uuid        primary key default gen_random_uuid(),
  unit_id          uuid        not null references public.vacation_extra_units(id) on delete cascade,
  requester_id     uuid        not null references public.profiles(id) on delete cascade,
  requester_name   text        not null default '',
  type             text        not null,
  requested_dates  jsonb       not null default '[]'::jsonb,
  raw_dates        text        not null default '',
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create index if not exists vacation_extra_requests_unit_id_idx
  on public.vacation_extra_requests (unit_id, created_at desc);
create index if not exists vacation_extra_requests_requester_id_idx
  on public.vacation_extra_requests (requester_id);

drop trigger if exists set_vacation_extra_requests_updated_at on public.vacation_extra_requests;
create trigger set_vacation_extra_requests_updated_at
  before update on public.vacation_extra_requests
  for each row execute function public.set_updated_at();

alter table public.vacation_extra_requests enable row level security;

-- All authenticated users can read all requests (desk needs full visibility)
drop policy if exists "vacation_extra_requests_select_approved" on public.vacation_extra_requests;
create policy "vacation_extra_requests_select_approved"
  on public.vacation_extra_requests
  for select to authenticated
  using (auth.uid() is not null);

-- Own requests only: insert
drop policy if exists "vacation_extra_requests_insert_own" on public.vacation_extra_requests;
create policy "vacation_extra_requests_insert_own"
  on public.vacation_extra_requests
  for insert to authenticated
  with check (requester_id = auth.uid());

-- Own requests only: update
drop policy if exists "vacation_extra_requests_update_own" on public.vacation_extra_requests;
create policy "vacation_extra_requests_update_own"
  on public.vacation_extra_requests
  for update to authenticated
  using (requester_id = auth.uid())
  with check (requester_id = auth.uid());

-- Own requests only: delete
drop policy if exists "vacation_extra_requests_delete_own" on public.vacation_extra_requests;
create policy "vacation_extra_requests_delete_own"
  on public.vacation_extra_requests
  for delete to authenticated
  using (requester_id = auth.uid());

grant select, insert, update, delete on table public.vacation_extra_units to authenticated, service_role;
grant select, insert, update, delete on table public.vacation_extra_requests to authenticated, service_role;
