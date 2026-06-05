-- Purpose: Add server-only logs for Hub -> Assembly compensatory leave push attempts.
-- Apply with: supabase db query --linked --file supabase/incremental_schedule_assembly_leave_push_logs.sql

create table if not exists public.schedule_assembly_leave_push_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  action text not null check (action in ('upsert', 'delete')),
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  member_name text not null default '',
  request_id text not null,
  success boolean not null default false,
  error_message text
);

create index if not exists schedule_assembly_leave_push_logs_request_created_idx
on public.schedule_assembly_leave_push_logs (request_id, created_at desc);

create index if not exists schedule_assembly_leave_push_logs_date_created_idx
on public.schedule_assembly_leave_push_logs (date, created_at desc);

alter table public.schedule_assembly_leave_push_logs enable row level security;

revoke all on table public.schedule_assembly_leave_push_logs from anon;
grant select, insert, update, delete on table public.schedule_assembly_leave_push_logs to service_role;
